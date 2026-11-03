"""The execution guard (#179): assistant-written Python doesn't run through
any route until approved; approving allows it; editing afterwards makes it
unreviewed again; a user's own file loads exactly as before.

The model file writes a harmless marker file when executed, so "did it run"
is a question about the file system, not about PsyNeuLink. Uses tmp_path only.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api import ws
from app.main import app
from app.services import executor, introspector, sandbox
from app.services.assistant import review
from app.services.assistant.review import REASON, UnreviewedAssistantCode

client = TestClient(app)


def marker_model(marker) -> str:
    return (
        "from pathlib import Path\n"
        f"Path({str(marker)!r}).write_text('ran')\n"
        "import psyneulink as pnl\n"
        "comp = pnl.Composition(name='guarded')\n"
    )


@pytest.fixture
def state(tmp_path, monkeypatch):
    monkeypatch.setenv(review.STATE_ENV, str(tmp_path / "state" / "review.json"))
    model = tmp_path / "Models" / "assistant_wrote.py"
    model.parent.mkdir()
    marker = tmp_path / "ran.txt"
    model.write_text(marker_model(marker))
    review.mark_unreviewed(str(model), model.read_text())
    return {"model": model, "marker": marker, "tmp": tmp_path}


def _with_star_backup(p: str) -> dict:
    """Undoing a star-import conversion restores a backup, then loads it."""
    backup = p[:-3] + ".star_import_original.py"
    open(backup, "w").write(open(p).read())
    return {"file_path": p}


ROUTES = [
    ("/api/model/load", lambda p: {"file_path": p}),
    ("/api/model/run", lambda p: {"file_path": p, "composition_name": "comp", "inputs": {}}),
    ("/api/model/learn", lambda p: {"file_path": p, "composition_name": "comp", "inputs": {}}),
    ("/api/model/show-graph", lambda p: {"file_path": p, "composition_name": "comp"}),
    ("/api/model/export-mdf", lambda p: {"file_path": p}),
    ("/api/model/mdf-gaps", lambda p: {"file_path": p}),
    ("/api/model/export-project", lambda p: {"file_path": p}),
    ("/api/model/save-source", lambda p: {"file_path": p, "source": open(p).read()}),
    ("/api/model/undo-star-convert", lambda p: _with_star_backup(p)),
]


@pytest.mark.parametrize("route,body", ROUTES, ids=[r for r, _ in ROUTES])
def test_route_refuses_unreviewed(state, route, body):
    resp = client.post(route, json=body(str(state["model"])))
    assert resp.status_code == 409, resp.text
    data = resp.json()
    assert data["reason"] == REASON
    assert data["path"] == str(state["model"])
    assert data["approve"]["url"] == "/api/assistant/review/approve"
    assert not state["marker"].exists()


def test_watchers_refuse_unreviewed(state, monkeypatch):
    """The file watcher's reload and the PsyNeuLink-code watcher's reload."""
    sent = []

    def record(coro, loop):
        sent.append(coro.cr_frame.f_locals.get("message"))
        coro.close()

    class Loop:
        def is_closed(self):
            return False

    monkeypatch.setattr(ws, "_loop", Loop())
    monkeypatch.setattr(ws.asyncio, "run_coroutine_threadsafe", record)
    ws._on_file_changed(str(state["model"]))
    monkeypatch.setattr(ws.file_watcher, "_watched_path", str(state["model"]))
    ws._on_psyneulink_changed(["x.py"])
    assert [m["type"] for m in sent] == ["reload_blocked", "reload_blocked"]
    assert all(m["reason"] == REASON for m in sent)
    assert not state["marker"].exists()


def test_inprocess_and_sandbox_entry_points_refuse(state):
    p = str(state["model"])
    with pytest.raises(UnreviewedAssistantCode):
        introspector.load_and_introspect(p, use_sandbox=False)
    with pytest.raises(UnreviewedAssistantCode):
        executor._run_model_inprocess(p, "comp", {})
    with pytest.raises(UnreviewedAssistantCode):
        executor._learn_model_inprocess(p, "comp", {}, {}, 1, None)
    with pytest.raises(UnreviewedAssistantCode):
        executor._get_input_nodes_inprocess(p, "comp")
    with pytest.raises(UnreviewedAssistantCode):
        sandbox.run_in_sandbox("introspect", {"file_path": p})
    assert not state["marker"].exists()


def test_approve_allows_then_edit_blocks_again(state):
    p = str(state["model"])
    resp = client.post("/api/assistant/review/status", json={"path": p})
    assert resp.json() == {"path": p, "tracked": True, "runnable": False}

    resp = client.post("/api/assistant/review/approve", json={"path": p})
    assert resp.status_code == 200 and resp.json()["runnable"] is True
    resp = client.post("/api/model/load", json={"file_path": p})
    assert resp.status_code == 200, resp.text
    assert state["marker"].read_text() == "ran"

    # Any later change, by anyone, is unreviewed again.
    state["marker"].unlink()
    state["model"].write_text(state["model"].read_text() + "# edited\n")
    resp = client.post("/api/model/load", json={"file_path": p})
    assert resp.status_code == 409 and resp.json()["reason"] == REASON
    assert not state["marker"].exists()
    assert review.status(p) == {"tracked": True, "runnable": False}

    # Approving again, after looking, allows the edited content.
    client.post("/api/assistant/review/approve", json={"path": p})
    assert client.post("/api/model/load", json={"file_path": p}).status_code == 200


def test_state_persists_across_restart(state):
    p = str(state["model"])
    review._cache = None  # as a fresh process would start
    assert review.is_runnable(p, state["model"].read_text()) is False
    client.post("/api/assistant/review/approve", json={"path": p})
    review._cache = None
    assert review.is_runnable(p, state["model"].read_text()) is True


def test_users_own_file_loads_as_before(state):
    own = state["tmp"] / "Models" / "mine.py"
    marker = state["tmp"] / "mine_ran.txt"
    own.write_text(marker_model(marker))
    assert review.status(str(own)) == {"tracked": False, "runnable": True}
    resp = client.post("/api/model/load", json={"file_path": str(own)})
    assert resp.status_code == 200, resp.text
    assert marker.read_text() == "ran"
    # Approving a file the assistant never wrote changes nothing.
    assert client.post("/api/assistant/review/approve", json={"path": str(own)}).json()["tracked"] is False


def test_no_state_file_means_no_cost_and_no_tracking(tmp_path, monkeypatch):
    monkeypatch.setenv(review.STATE_ENV, str(tmp_path / "nothing" / "review.json"))
    review._cache = None
    assert review.is_tracked("/anything/at/all.py") is False
    review.require_runnable("/anything/at/all.py")  # no read, no raise
