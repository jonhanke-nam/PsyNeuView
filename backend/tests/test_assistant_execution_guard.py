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

# The page's own requests: a browser sends the page's Origin, and the server
# is reached on this machine.
client = TestClient(app, base_url="http://127.0.0.1:8000", headers={"origin": "http://127.0.0.1:8000"})


def approve_current(path: str):
    """Approve what is on disk now, the way the page does: ask, then approve that hash."""
    shown = client.post("/api/assistant/review/status", json={"path": path}).json()
    return client.post("/api/assistant/review/approve", json={"path": path, "content_hash": shown["content_hash"]})


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
    shown = resp.json()
    assert shown["tracked"] is True and shown["runnable"] is False
    assert shown["content"] == state["model"].read_text()
    assert shown["content_hash"] == review.content_hash(shown["content"])

    resp = client.post("/api/assistant/review/approve", json={"path": p, "content_hash": shown["content_hash"]})
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
    approve_current(p)
    assert client.post("/api/model/load", json={"file_path": p}).status_code == 200


def test_state_persists_across_restart(state):
    p = str(state["model"])
    review._cache = None  # as a fresh process would start
    assert review.is_runnable(p, state["model"].read_text()) is False
    approve_current(p)
    review._cache = None
    assert review.is_runnable(p, state["model"].read_text()) is True


def test_users_own_file_loads_as_before(state):
    own = state["tmp"] / "Mine" / "mine.py"
    own.parent.mkdir()
    marker = state["tmp"] / "mine_ran.txt"
    own.write_text(marker_model(marker))
    assert review.status(str(own)) == {"tracked": False, "runnable": True}
    resp = client.post("/api/model/load", json={"file_path": str(own)})
    assert resp.status_code == 200, resp.text
    assert marker.read_text() == "ran"
    # Beside the unreviewed file: runs as before unless it imports it.
    beside = state["tmp"] / "Models" / "beside.py"
    beside.write_text(marker_model(state["tmp"] / "beside_ran.txt"))
    resp = client.post("/api/model/load", json={"file_path": str(beside)})
    assert resp.status_code == 200, resp.text
    assert (state["tmp"] / "beside_ran.txt").exists()
    importer = state["tmp"] / "Models" / "imports_it.py"
    importer.write_text("import sys, os\nsys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))\nimport assistant_wrote\n" + marker_model(state["tmp"] / "importer_ran.txt"))
    resp = client.post("/api/model/load", json={"file_path": str(importer)})
    assert resp.status_code == 409 and resp.json()["path"] == str(state["model"]), resp.text
    assert not (state["tmp"] / "importer_ran.txt").exists() and not state["marker"].exists()
    # Approving a file the assistant never wrote changes nothing.
    resp = client.post("/api/assistant/review/approve", json={"path": str(own), "content_hash": "anything"})
    assert resp.json()["tracked"] is False


def test_no_state_file_means_no_cost_and_no_tracking(tmp_path, monkeypatch):
    monkeypatch.setenv(review.STATE_ENV, str(tmp_path / "nothing" / "review.json"))
    review._cache = None
    assert review.is_tracked("/anything/at/all.py") is False
    review.require_runnable("/anything/at/all.py")  # no read, no raise


def test_project_import_of_unreviewed_content_refused(state, tmp_path, monkeypatch):
    """A bundle carrying unreviewed assistant-written code is saved but not run."""
    import io
    import zipfile
    from app.api import routes
    monkeypatch.setattr(routes, "get_default_save_dir", lambda: tmp_path / "imported")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("manifest.json", '{"model": {"name": "m"}, "files": {"source": "m.py"}}')
        z.writestr("m.py", state["model"].read_text())
    resp = client.post("/api/model/import-project", files={"file": ("m.pnlproject", buf.getvalue(), "application/zip")})
    assert resp.status_code == 409, resp.text
    assert resp.json()["reason"] == REASON
    assert not state["marker"].exists()


def test_mdf_import_of_unreviewed_content_refused(state):
    mdf = state["tmp"] / "Models" / "m.mdf.json"
    text = '{"m": {"format": "ModECI MDF v0.4", "graphs": {}}}'
    mdf.write_text(text)
    review.mark_unreviewed(str(mdf), text)
    resp = client.post("/api/model/import-mdf", files={"file": ("m.mdf.json", text.encode(), "application/json")})
    assert resp.status_code == 409 and resp.json()["reason"] == REASON
    review.mark_reviewed(str(mdf), text)
    assert not review.is_unreviewed_content(text)


def test_approve_with_stale_hash_leaves_it_unrunnable(state):
    """The file changed between being shown and being approved."""
    p = str(state["model"])
    shown = client.post("/api/assistant/review/status", json={"path": p}).json()
    state["model"].write_text(state["model"].read_text() + "# changed after viewing\n")
    resp = client.post("/api/assistant/review/approve", json={"path": p, "content_hash": shown["content_hash"]})
    assert resp.status_code == 409, resp.text
    assert resp.json()["reason"] == "assistant_code_changed"
    assert resp.json()["content_hash"] == review.content_hash(state["model"].read_text())
    assert review.status(p) == {"tracked": True, "runnable": False}
    assert client.post("/api/model/load", json={"file_path": p}).status_code == 409
    assert not state["marker"].exists()
    # A made-up or empty hash is no better.
    for bad in ["", "0" * 64, "not a hash"]:
        assert client.post("/api/assistant/review/approve", json={"path": p, "content_hash": bad}).status_code == 409
    assert not state["marker"].exists()
    # The right hash, after looking again, allows it.
    assert approve_current(p).status_code == 200
    assert client.post("/api/model/load", json={"file_path": p}).status_code == 200
    assert state["marker"].read_text() == "ran"


@pytest.mark.parametrize("route", ["/api/assistant/review/status", "/api/assistant/review/approve"])
def test_review_routes_accept_only_the_apps_own_page(state, route):
    p = str(state["model"])
    body = {"path": p, "content_hash": review.content_hash(state["model"].read_text())}
    own = {"host": "127.0.0.1:8000", "origin": "http://127.0.0.1:8000"}
    foreign_origin = {"host": "127.0.0.1:8000", "origin": "http://evil.example"}
    foreign_host = {"host": "evil.example:8000", "origin": "http://evil.example:8000"}
    null_origin = {"host": "127.0.0.1:8000", "origin": "null"}
    for headers in (foreign_origin, foreign_host, null_origin):
        resp = client.post(route, json=body, headers=headers)
        assert resp.status_code == 403, (headers, resp.text)
        assert resp.json()["detail"]["reason"] == "not_app_page"
    assert review.status(p) == {"tracked": True, "runnable": False}
    assert not state["marker"].exists()
    resp = client.post(route, json=body, headers=own)
    assert resp.status_code == 200, resp.text
    # Without an Origin (not a browser page), the Host still has to be this machine.
    no_origin = TestClient(app, base_url="http://evil.example:8000")
    assert no_origin.post(route, json=body).status_code == 403
    assert TestClient(app, base_url="http://localhost:8000").post(route, json=body).status_code == 200


def test_is_own_page_rules():
    from app.services.assistant.same_site import is_own_page
    assert is_own_page("localhost:8000", "http://localhost:8000", "local")
    assert is_own_page("[::1]:8000", "http://[::1]:8000", "mac_app")
    assert is_own_page("127.0.0.1:8000", None, "local")
    assert not is_own_page("127.0.0.1:8000", "http://localhost:8000", "local")  # same machine, different site
    assert not is_own_page("myhost.example:8000", "http://myhost.example:8000", "local")
    assert is_own_page("myhost.example:8000", "http://myhost.example:8000", "hosted")
    assert not is_own_page("myhost.example:8000", "http://other.example", "hosted")
    assert not is_own_page("", None, "local")
    assert not is_own_page("127.0.0.1:8000", "file://", "local")
