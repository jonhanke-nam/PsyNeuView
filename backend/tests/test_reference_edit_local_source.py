"""Editing a model from PsyNeuLink Library and the Reference Models, with a
local PsyNeuLink checkout (#1242, part of #652).

This is the everyday two-editor path: PsyNeuLink is a local editable checkout,
the user opens EGO from **PsyNeuLink Library** (which opens the checkout's own
file in place), and edits it in PyCharm. Two watchers are live at once:

- the open-model file watcher (``watcher.py``), which reports ``file_changed``
  with the new source and a re-read graph, and
- the PsyNeuLink code watcher (``pnl_code_watcher.py``, #1225), which watches the
  checkout's whole ``psyneulink/`` package and reports ``psyneulink_changed``.

The open model lives *inside* that package, so the code watcher is told to
ignore it; otherwise one save would be reported twice.

Why a backend test rather than a browser one: the code watcher only runs when
the active PsyNeuLink is a *local* checkout, and "which PsyNeuLink is active" is
read from the installed distribution's metadata (``direct_url.json``), not from
a setting the e2e harness can point elsewhere. So these tests stand in a fake
distribution whose editable root is a temporary copy of the library model —
never a developer's real checkout — and then drive the real app: the load
endpoints, the ``/ws`` socket, and both watchers on real filesystem events. Only
the model-runner restart is stubbed.

Saves are made the way PyCharm makes them ("safe write"): write a temp file
beside the original, move the original aside, rename the temp file into place,
delete the old one. None of the side files end in ``.py``, which matches
PyCharm's own naming (``___jb_tmp___`` / ``___jb_old___``).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import ws as ws_module
from app.main import app
from app.services import pnl_code_watcher as pcw
from app.services import pnl_source_guard, settings_info
from app.services.watcher import file_watcher

LIBRARY_NAME = "Giallanza2024_EGO_Study2"
REFERENCE_NAME = "Giallanza2024_ego_study2"

# How quickly an outside save reaches the app is part of what we promise
# (#1242 case 1). Measured from the rename that completes the save to the
# ``file_changed`` message arriving on the socket. That covers the watcher's
# 500 ms debounce plus re-reading EGO, which executes the model file. A few
# seconds on a laptop; the budget leaves room for a slow CI runner.
EDIT_TO_UPDATE_BUDGET_S = 10.0

# How long to keep listening for a message that must NOT arrive: the code
# watcher's 1 s debounce, then re-reading EGO before it broadcasts, with margin.
QUIET_WINDOW_S = pcw.DEBOUNCE_S + 4.0

# Reading more messages than this without seeing the one we want is a failure,
# not a hang (presence updates share the socket).
MAX_MESSAGES = 20


class _FakeDist:
    """An editable install of psyneulink rooted at a temporary checkout."""

    def __init__(self, root: Path, real):
        self._direct_url = {"url": "file://" + str(root), "dir_info": {"editable": True}}
        self._real = real
        self.version = getattr(real, "version", "0.0.0")

    def read_text(self, name):
        if name == "direct_url.json":
            return json.dumps(self._direct_url)
        return self._real.read_text(name)

    def locate_file(self, rel):
        return self._real.locate_file(rel)

    def __getattr__(self, attr):
        return getattr(self._real, attr)


def _real_library_models_dir() -> Path:
    import psyneulink

    d = Path(psyneulink.__file__).parent / "library" / "models"
    if not (d / f"{LIBRARY_NAME}.py").exists():
        pytest.skip(f"installed PsyNeuLink has no {LIBRARY_NAME}.py")
    return d


@pytest.fixture
def local_checkout(tmp_path, monkeypatch):
    """A temporary local PsyNeuLink checkout, made the active source.

    Holds only what these tests touch: the library EGO file under
    ``psyneulink/library/models/``. The model still imports the real, installed
    psyneulink; only *where PsyNeuLink's files are* is redirected.
    """
    real_models = _real_library_models_dir()
    root = tmp_path / "PsyNeuLink-local"
    models = root / "psyneulink" / "library" / "models"
    models.mkdir(parents=True)
    shutil.copy2(real_models / f"{LIBRARY_NAME}.py", models / f"{LIBRARY_NAME}.py")
    # A second PsyNeuLink file, for edits that are not the open model.
    (root / "psyneulink" / "core").mkdir()
    (root / "psyneulink" / "core" / "mechanism_stub.py").write_text("X = 1\n")

    real = settings_info.distribution("psyneulink")
    fake = _FakeDist(root, real)
    real_distribution = settings_info.distribution
    monkeypatch.setattr(
        settings_info,
        "distribution",
        lambda name: fake if name == "psyneulink" else real_distribution(name),
    )
    # Managed GitHub clones live under the clone root and count as "github";
    # keep the temp checkout outside it so it counts as "local".
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(tmp_path / "sources"))
    # Reference Models write a working copy; keep it out of backend/.
    monkeypatch.setenv("PSYNEWVIEW_WORKING_DIR", str(tmp_path / "working"))

    assert pnl_source_guard.active_kind() == "local"
    assert settings_info.active_psyneulink_package_dir() == root / "psyneulink"
    yield root
    pcw.pnl_code_watcher.stop()
    file_watcher.stop()


@pytest.fixture
def spies(monkeypatch):
    """Record runner restarts and code-watcher reloads without restarting anything.

    ``handle_websocket`` looks ``_on_psyneulink_changed`` up at call time, so
    wrapping the module attribute wraps what the code watcher is handed.
    """
    restarts: list[float] = []
    reloads: list[list[str]] = []
    monkeypatch.setattr(pcw.sandbox, "restart_warm_worker", lambda: restarts.append(time.time()) or True)
    real_on_changed = ws_module._on_psyneulink_changed

    def on_changed(changed):
        reloads.append(list(changed))
        real_on_changed(changed)

    monkeypatch.setattr(ws_module, "_on_psyneulink_changed", on_changed)
    return {"restarts": restarts, "reloads": reloads}


def _safe_write(path: Path, content: str) -> float:
    """Save the way PyCharm does, and return when the save completed."""
    tmp = path.with_name(path.name + "___jb_tmp___")
    old = path.with_name(path.name + "___jb_old___")
    tmp.write_text(content)
    os.replace(path, old)
    os.replace(tmp, path)
    done = time.monotonic()
    old.unlink()
    return done


def _await(socket, wanted: str, seen: list[dict]) -> dict:
    for _ in range(MAX_MESSAGES):
        message = socket.receive_json()
        seen.append(message)
        if message.get("type") == wanted:
            return message
    raise AssertionError(f"no {wanted!r} message within {MAX_MESSAGES}; saw {[m.get('type') for m in seen]}")


def _drain_quietly(socket, seen: list[dict], window_s: float) -> None:
    """Collect everything that arrives within ``window_s``.

    The test socket has no receive timeout, so wait out the window, then send
    a message the server always answers (an unknown type gets an ``error``)
    and read up to that reply. Anything broadcast in the window is ahead of it.
    """
    time.sleep(window_s)
    socket.send_json({"type": "reference-edit-1242-sentinel"})
    _await(socket, "error", seen)


def _open_and_watch(socket, file_path: str, seen: list[dict]) -> None:
    socket.send_json({"type": "watch_file", "filePath": file_path})
    _await(socket, "watching", seen)
    # macOS FSEvents can replay events from just before a watch starts; let
    # the observers settle so the edit below is the only thing they see.
    time.sleep(0.5)


def _node_names(model: dict) -> set[str]:
    names = set()
    for comp in model.get("compositions", []):
        names.update(n.get("name", "") for n in comp.get("nodes", []))
    return names


PREDICTION_LINE = re.compile(r"^PREDICTION\s*=\s*'PREDICTION'\s*$", re.M)


def _rename_prediction(source: str, new_name: str) -> str:
    assert PREDICTION_LINE.search(source), "EGO no longer names its PREDICTION layer this way; update the test"
    return PREDICTION_LINE.sub(f"PREDICTION = '{new_name}'", source, count=1)


# --- A. PsyNeuLink Library, with a local checkout ---------------------------


def test_library_lists_the_local_checkouts_own_file(local_checkout):
    """The Open menu's PsyNeuLink Library points into the active checkout.

    Guards the premise of the tests below: opening EGO from the Library opens
    the temporary checkout's file in place, not a copy.
    """
    with TestClient(app) as client:
        models = client.get("/api/library-models").json()["models"]
    ego = next(m for m in models if m["name"] == LIBRARY_NAME)
    assert Path(ego["path"]) == local_checkout / "psyneulink" / "library" / "models" / f"{LIBRARY_NAME}.py"


def test_an_outside_save_to_an_open_library_model_updates_the_app_once_and_quickly(local_checkout, spies):
    """#1242 cases 1 and 2.

    Case 1: a PyCharm save of the open Library model reaches the app as
    ``file_changed``, carrying the new source and a graph re-read from it,
    within the time budget. The measured time is printed (run with ``-s``).

    Case 2: that one save is reported once. The PsyNeuLink code watcher is
    watching the same checkout, but ignores the open model's own file, so no
    ``psyneulink_changed`` follows and the model runner is not restarted.
    """
    library_file = local_checkout / "psyneulink" / "library" / "models" / f"{LIBRARY_NAME}.py"
    seen: list[dict] = []
    with TestClient(app) as client:
        loaded = client.post("/api/model/load", json={"file_path": str(library_file)})
        assert loaded.status_code == 200, loaded.text
        assert "PREDICTION" in _node_names(loaded.json()["model"])

        with client.websocket_connect("/ws") as socket:
            _open_and_watch(socket, str(library_file), seen)
            # Both watchers are live, or the "only once" half proves nothing.
            assert pcw.pnl_code_watcher.watching == (local_checkout / "psyneulink").resolve()

            edited = _rename_prediction(library_file.read_text(), "PREDICTION_1242")
            saved_at = _safe_write(library_file, edited)
            message = _await(socket, "file_changed", seen)
            elapsed = time.monotonic() - saved_at
            print(f"\n[#1242] outside save -> file_changed: {elapsed:.2f}s (budget {EDIT_TO_UPDATE_BUDGET_S:.0f}s)")

            _drain_quietly(socket, seen, QUIET_WINDOW_S)

    # Case 1: the editor text and the graph both follow the outside save.
    assert Path(message["filePath"]).resolve() == library_file.resolve()
    assert message["source"] == edited
    nodes = _node_names(message["model"])
    assert "PREDICTION_1242" in nodes and "PREDICTION" not in nodes, sorted(nodes)
    assert elapsed <= EDIT_TO_UPDATE_BUDGET_S, f"outside save took {elapsed:.2f}s to reach the app"

    # Case 2: once, through the file watcher only.
    types = [m.get("type") for m in seen]
    assert types.count("file_changed") == 1, types
    assert "psyneulink_changed" not in types, types
    assert spies["reloads"] == [], "the code watcher reported the open model's own file"
    assert spies["restarts"] == [], "the model runner restarted for an edit to the open model"


def test_an_edit_elsewhere_in_the_checkout_is_still_reported(local_checkout, spies):
    """The other half of case 2: ignoring the open model ignores only that.

    Without this, the "only once" test above would also pass with the code
    watcher simply not working.
    """
    library_file = local_checkout / "psyneulink" / "library" / "models" / f"{LIBRARY_NAME}.py"
    other = local_checkout / "psyneulink" / "core" / "mechanism_stub.py"
    seen: list[dict] = []
    with TestClient(app) as client:
        assert client.post("/api/model/load", json={"file_path": str(library_file)}).status_code == 200
        with client.websocket_connect("/ws") as socket:
            _open_and_watch(socket, str(library_file), seen)
            _safe_write(other, "X = 2\n")
            message = _await(socket, "psyneulink_changed", seen)

    assert any(Path(f).resolve() == other.resolve() for f in message["changedFiles"])
    assert len(spies["restarts"]) == 1
    assert "file_changed" not in [m.get("type") for m in seen]


# --- B. Reference Models (developer mode / walkthroughs) --------------------


def test_an_edit_to_the_psyneulink_original_does_not_reach_the_reference_copy(local_checkout, spies):
    """#1242 case 3, pinned as it behaves today.

    With the EGO *reference* model open, editing PsyNeuLink's own EGO in the
    local checkout restarts the runner and sends ``psyneulink_changed``: the
    app then says "PsyNeuLink code changed … Reloaded with the new code". But
    the model on screen is PsyNeuView's own working copy, which doesn't import
    the library file, so its source and graph stay as they were, and nothing
    is written to it.

    That message overstates what happened for this model. If it changes (say
    so plainly, offer to open the Library version; see #1243), this test
    changes with it.
    """
    library_file = local_checkout / "psyneulink" / "library" / "models" / f"{LIBRARY_NAME}.py"
    seen: list[dict] = []
    with TestClient(app) as client:
        loaded = client.post("/api/reference-models/load", json={"name": REFERENCE_NAME})
        assert loaded.status_code == 200, loaded.text
        body = loaded.json()
        working = Path(body["file_path"])
        assert working.parent == (local_checkout.parent / "working").resolve()
        before = working.read_text()
        before_nodes = _node_names(body["model"])
        assert "PREDICTION" in before_nodes

        with client.websocket_connect("/ws") as socket:
            _open_and_watch(socket, str(working), seen)
            _safe_write(library_file, _rename_prediction(library_file.read_text(), "PREDICTION_1242"))
            message = _await(socket, "psyneulink_changed", seen)
            _drain_quietly(socket, seen, QUIET_WINDOW_S)

    # Today's behaviour: the change is announced as a PsyNeuLink code change...
    assert any(Path(f).resolve() == library_file.resolve() for f in message["changedFiles"])
    assert len(spies["restarts"]) == 1
    # ...about the open model, re-read, but that model is the unchanged copy.
    assert Path(message["filePath"]).resolve() == working.resolve()
    assert message["source"] == before
    assert _node_names(message["model"]) == before_nodes
    # The working copy on disk is untouched, and no file_changed for it.
    assert working.read_text() == before
    types = [m.get("type") for m in seen]
    assert "file_changed" not in types, types
    assert types.count("psyneulink_changed") == 1, types
