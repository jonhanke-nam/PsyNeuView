"""Tests for external-edit sync (PyCharm <-> PsyNeuView).

Covers the watcher's external-vs-echo decision and, most importantly, that a
change detected on the watchdog thread actually reaches connected WebSocket
clients. That last hop was silently dropped for the app's whole history: the
watcher fired, but the broadcast was scheduled with ``get_running_loop()`` on a
thread that has no running loop, so every notification vanished into a bare
``except RuntimeError: pass`` (#926).
"""

import asyncio
import os
import threading
import time
from pathlib import Path

import pytest

from app.api import ws as ws_module
from app.services.file_writer import write_model_source
from app.services.watcher import ModelFileWatcher

def _await_message(socket, wanted: str, limit: int = 5) -> dict:
    """Read until a message of type ``wanted`` arrives.

    The WebSocket multiplexes several kinds of message and gives no ordering
    guarantee; asserting on position makes a test fail whenever an unrelated
    message type is added.
    """
    for _ in range(limit):
        message = socket.receive_json()
        if message.get("type") == wanted:
            return message
    raise AssertionError(f"no {wanted!r} message within {limit} messages")


MODEL_SRC = """\
import psyneulink as pnl

a = pnl.TransferMechanism(name='a')
c = pnl.Composition(name='c')
c.add_node(a)
"""

# The watcher debounces, so waits must clear it with room to spare.
DEBOUNCE_MS = 50
SETTLE_S = 1.5
# A file_changed carries a freshly introspected model, and introspection execs
# the model file — seconds, not milliseconds. Poll, but allow real work.
INTROSPECT_S = 60


@pytest.fixture
def model_file(tmp_path):
    path = tmp_path / "model.py"
    path.write_text(MODEL_SRC)
    return path


@pytest.fixture
def watcher():
    w = ModelFileWatcher(debounce_ms=DEBOUNCE_MS)
    yield w
    w.stop()


def _wait_for(predicate, timeout=SETTLE_S):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return False


def test_external_edit_fires_callback(watcher, model_file):
    """An edit made outside PsyNeuView (PyCharm saving the file) is reported."""
    fired = []
    watcher.watch(str(model_file), lambda p: fired.append(p))

    model_file.write_text(MODEL_SRC + "\nb = pnl.TransferMechanism(name='b')\n")

    assert _wait_for(lambda: fired), "external edit should notify the watcher"
    assert fired[0] == str(model_file)


def test_psyneuview_own_write_does_not_fire(watcher, model_file):
    """PsyNeuView saving the model is not an 'external' edit.

    Without this, fixing the broadcast would make every in-app save bounce back
    as a file_changed and reload the editor underneath the user.
    """
    fired = []
    watcher.watch(str(model_file), lambda p: fired.append(p))

    new_source = MODEL_SRC + "\nb = pnl.TransferMechanism(name='b')\n"
    watcher.note_internal_write(str(model_file), new_source)
    model_file.write_text(new_source)

    assert not _wait_for(lambda: fired), "our own write must not report as external"


def test_no_op_save_does_not_fire(watcher, model_file):
    """Re-saving identical content (a reflexive Cmd-S in PyCharm) is not a change."""
    fired = []
    watcher.watch(str(model_file), lambda p: fired.append(p))

    model_file.write_text(MODEL_SRC)

    assert not _wait_for(lambda: fired), "unchanged content must not report as external"


def test_external_edit_after_own_write_still_fires(watcher, model_file):
    """Echo suppression must not swallow the *next* genuine external edit."""
    fired = []
    watcher.watch(str(model_file), lambda p: fired.append(p))

    ours = MODEL_SRC + "\nb = pnl.TransferMechanism(name='b')\n"
    watcher.note_internal_write(str(model_file), ours)
    model_file.write_text(ours)
    assert not _wait_for(lambda: fired, timeout=0.6)

    model_file.write_text(ours + "\nd = pnl.TransferMechanism(name='d')\n")
    assert _wait_for(lambda: fired), "a later external edit must still be reported"


def test_no_time_based_suppression_api_remains(watcher):
    """The timer is gone, not merely unused (#1152).

    `suppress_next()` ignored *every* change for a second after the app wrote,
    which could swallow a genuine save from an external editor — and a save
    landing right after a canvas edit is exactly when two people are working
    the same file. Identity is established by content instead, via
    `note_internal_write`.

    Asserted as an absent attribute rather than by timing. A timing test does
    not discriminate here: FSEvents coalesces and re-delivers, so an edit
    suppressed inside the window still arrives after it, and the test passes
    with the timer present. `test_external_edit_after_own_write_still_fires`
    is the behavioural guard — it fails with the timer reinstated.

    Leaving the method callable invites it back: it reads as the obvious way
    to stop an echo.
    """
    assert not hasattr(watcher, "suppress_next")
    assert not hasattr(watcher, "_suppress_until")


def test_write_model_source_marks_write_as_internal(watcher, model_file):
    """The app's real write path routes through the watcher-aware helper."""
    fired = []
    watcher.watch(str(model_file), lambda p: fired.append(p))

    import app.services.file_writer as fw

    original = fw.file_watcher
    fw.file_watcher = watcher
    try:
        write_model_source(model_file, MODEL_SRC + "\n# edited in PsyNeuView\n")
    finally:
        fw.file_watcher = original

    assert not _wait_for(lambda: fired), "write_model_source must suppress the echo"


class _FakeClient:
    """Stands in for a connected WebSocket client."""

    def __init__(self):
        self.messages = []

    async def send_json(self, message):
        self.messages.append(message)


def test_file_change_broadcast_reaches_clients_from_watcher_thread(model_file):
    """The regression: a change seen on the watchdog thread must reach the browser.

    ``_on_file_changed`` runs on a watchdog timer thread. It has to hand the
    coroutine to the event loop serving the WebSocket, not ask for a running
    loop it will never find.
    """
    client = _FakeClient()

    async def scenario():
        ws_module._connected_clients.add(client)
        ws_module._loop = asyncio.get_running_loop()
        try:
            # Call from a non-event-loop thread, exactly as watchdog does.
            done = threading.Event()
            threading.Thread(
                target=lambda: (ws_module._on_file_changed(str(model_file)), done.set()),
                daemon=True,
            ).start()
            assert done.wait(INTROSPECT_S), "_on_file_changed should finish"

            deadline = time.time() + SETTLE_S
            while not client.messages and time.time() < deadline:
                await asyncio.sleep(0.02)
        finally:
            ws_module._connected_clients.discard(client)
            ws_module._loop = None

    asyncio.run(scenario())

    assert client.messages, "file_changed must be delivered to connected clients"
    message = client.messages[0]
    assert message["type"] == "file_changed"
    assert message["filePath"] == str(model_file)
    assert "a = pnl.TransferMechanism" in message["source"]


def test_broadcast_without_a_loop_is_survivable(model_file):
    """No loop captured yet -> log and move on, never raise on the watchdog thread."""
    ws_module._loop = None
    ws_module._on_file_changed(str(model_file))  # must not raise


class _DeadClient:
    """A client whose socket has gone away."""

    async def send_json(self, message):
        raise ConnectionError("socket closed")


def test_broadcast_delivers_and_prunes_dead_clients():
    """``broadcast`` must reach live clients and drop dead ones.

    It previously pruned with ``_connected_clients -= dead``, which rebinds the
    module global and so made the name local to the function — raising
    UnboundLocalError on its own first line. Nothing was ever broadcast; the
    dropped-loop bug upstream meant no one noticed.
    """
    live, dead = _FakeClient(), _DeadClient()

    async def scenario():
        ws_module._connected_clients.update({live, dead})
        try:
            await ws_module.broadcast({"type": "file_changed"})
        finally:
            ws_module._connected_clients.discard(live)
            ws_module._connected_clients.discard(dead)

    asyncio.run(scenario())

    assert live.messages == [{"type": "file_changed"}]
    assert dead not in ws_module._connected_clients


def test_end_to_end_external_edit_reaches_websocket_client(tmp_path):
    """The whole round trip through the real app: PyCharm saves, the browser hears.

    Exercises the actual FastAPI app and /ws endpoint rather than the pieces —
    the loop capture, the watchdog thread, the broadcast, and re-introspection
    of the edited source.
    """
    from fastapi.testclient import TestClient

    from app.main import app

    model = tmp_path / "model.py"
    model.write_text(MODEL_SRC)

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as socket:
            socket.send_json({"type": "watch_file", "filePath": str(model)})
            # The socket also carries presence updates (#1082), which may
            # arrive first. Wait for the ack rather than assuming it is the
            # first message — the protocol never promised an order, and the
            # frontend doesn't assume one either.
            assert _await_message(socket, "watching")

            # Stand in for PyCharm saving a new node into the file.
            time.sleep(0.3)
            model.write_text(
                MODEL_SRC + "b = pnl.TransferMechanism(name='b')\nc.add_node(b)\n"
            )

            message = _await_message(socket, "file_changed")

    assert message["type"] == "file_changed"
    assert message["filePath"] == str(model)
    assert "name='b'" in message["source"]
    node_names = [n.get("name") for n in message["model"]["compositions"][0]["nodes"]]
    assert "b" in node_names, f"re-introspected graph should include the new node: {node_names}"


# --- How real editors save -------------------------------------------------
#
# Writing in place is only one of several strategies, and our other tests only
# exercise that one. JetBrains IDEs default to "safe write" (temp file, then
# rename over the original) and VS Code can be configured the same way, so the
# save an actual user makes may never produce a modification event at all.


def _save_in_place(path: Path, content: str) -> None:
    path.write_text(content)


def _save_atomic_rename(path: Path, content: str) -> None:
    """JetBrains "safe write", VS Code atomic save."""
    tmp = path.with_suffix(path.suffix + ".tmp~")
    tmp.write_text(content)
    os.replace(tmp, path)


def _save_backup_then_create(path: Path, content: str) -> None:
    """Move the original aside, write a fresh file in its place."""
    os.replace(path, path.with_suffix(path.suffix + ".bak~"))
    path.write_text(content)


@pytest.mark.parametrize(
    "save",
    [_save_in_place, _save_atomic_rename, _save_backup_then_create],
    ids=["in-place", "atomic-rename", "backup-then-create"],
)
def test_watcher_sees_every_editor_save_strategy(watcher, model_file, save):
    """However the editor writes the file, we notice it changed."""
    fired = []
    watcher.watch(str(model_file), lambda p: fired.append(p))

    save(model_file, MODEL_SRC + "\nb = pnl.TransferMechanism(name='b')\n")

    assert _wait_for(lambda: fired), "an external save must be reported however it was written"


@pytest.mark.parametrize(
    "save",
    [_save_in_place, _save_atomic_rename, _save_backup_then_create],
    ids=["in-place", "atomic-rename", "backup-then-create"],
)
def test_echo_suppression_holds_across_save_strategies(watcher, model_file, save):
    """Broadening what we listen for must not reintroduce the echo."""
    fired = []
    watcher.watch(str(model_file), lambda p: fired.append(p))

    ours = MODEL_SRC + "\nb = pnl.TransferMechanism(name='b')\n"
    watcher.note_internal_write(str(model_file), ours)
    save(model_file, ours)

    assert not _wait_for(lambda: fired), "our own write is not external, however it lands"


def test_an_event_seen_mid_write_does_not_turn_our_save_into_an_outside_edit(watcher, model_file):
    """The watcher used to hash the file the moment an event arrived (#1284).

    A save that empties the file first (in place, or backup-then-create) can
    deliver its event while the file is still empty; that hash matched nothing
    known, so our own save was reported as external. Driven by hand here so the
    race happens every time instead of only under load.
    """
    fired = []
    watcher.watch(str(model_file), lambda p: fired.append(p))

    ours = MODEL_SRC + "\nb = pnl.TransferMechanism(name='b')\n"
    watcher.note_internal_write(str(model_file), ours)

    model_file.write_text("")          # the save has emptied the file...
    watcher._on_file_changed()         # ...and its event arrives right now
    model_file.write_text(ours)        # then the content lands
    watcher._on_file_changed()

    assert not _wait_for(lambda: fired), "our own save must not report as external"

