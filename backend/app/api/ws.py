"""WebSocket handler for real-time sync between GUI and backend."""

import asyncio
import json
import logging
from pathlib import Path

from fastapi import WebSocket

from app.services.introspector import load_and_introspect
from app.services.file_writer import apply_parameter_change, apply_structural_change
from app.services.watcher import WatchUnavailable, file_watcher
from app.services.pnl_code_watcher import pnl_code_watcher
from app.services import presence

logger = logging.getLogger(__name__)


# Keep track of connected clients
_connected_clients: set[WebSocket] = set()

# The event loop serving the WebSocket endpoints. The file watcher calls back
# from a watchdog thread, which has no running loop of its own, so it needs a
# handle on this one to schedule the broadcast.
_loop: asyncio.AbstractEventLoop | None = None


async def broadcast(message: dict) -> None:
    """Send a message to all connected WebSocket clients."""
    dead = set()
    # Snapshot: we await per client, so the set can change under us.
    for ws in list(_connected_clients):
        try:
            await ws.send_json(message)
        except Exception:
            dead.add(ws)
    # Mutate in place. Rebinding with ``-=`` would make the name local to this
    # function and raise UnboundLocalError on the loop above.
    _connected_clients.difference_update(dead)


async def send_to(clients, message: dict) -> None:
    """Send a message to some of the connected clients."""
    dead = set()
    for ws in list(clients):
        try:
            await ws.send_json(message)
        except Exception:
            dead.add(ws)
    _connected_clients.difference_update(dead)


def _on_file_changed(file_path: str) -> None:
    """Called by the file watcher (from a watchdog thread) when the .py file changes externally.

    Sends the new source, not a graph (#442). Each window shows the model in
    its own view (nested, flattened, PyTorch, show_graph's layout) and keeps
    that view in the page, so each re-reads the model through /api/model/load
    with its own options. One graph built here for every window came back
    nested in a window showing the flattened view; and building it here as
    well would run the model twice per outside save.
    """
    try:
        source = Path(file_path).read_text()
        message = {
            "type": "file_changed",
            "filePath": file_path,
            "source": source,
        }
        # We are on a watchdog thread, so there is no running loop here to
        # schedule on. Hand the send to the loop captured when the client
        # asked us to watch this file. Only to those following this file
        # (#272): another window may have a different model open.
        loop = _loop
        if loop is None or loop.is_closed():
            print("File watcher: no event loop available; dropping file_changed")
            return
        asyncio.run_coroutine_threadsafe(send_to(file_watcher.subscribers(file_path), message), loop)
    except Exception as e:
        print(f"File watcher error: {e}")


def _is_open_model(path: str) -> bool:
    """An open model has its own watcher; don't report an edit to it twice."""
    try:
        target = str(Path(path).resolve())
    except OSError:
        return False
    return target in file_watcher.watched_paths()


def _on_psyneulink_changed(changed: list[str]) -> None:
    """PsyNeuLink's own code changed in the local checkout (#1225).

    The runner has already restarted by now. Re-read the open model so what's
    on screen reflects the new code, and say which files changed.
    """
    try:
        loop = _loop
        if loop is None or loop.is_closed():
            return
        paths = file_watcher.watched_paths()
        if not paths:
            asyncio.run_coroutine_threadsafe(
                broadcast({"type": "psyneulink_changed", "changedFiles": changed, "filePath": None}), loop)
            return
        # Each open model re-read for those who have it open (#272).
        for file_path in paths:
            message = {
                "type": "psyneulink_changed", "changedFiles": changed, "filePath": file_path,
                "source": Path(file_path).read_text(), "model": load_and_introspect(file_path),
            }
            asyncio.run_coroutine_threadsafe(send_to(file_watcher.subscribers(file_path), message), loop)
    except Exception as e:
        logger.warning("PsyNeuLink code watcher: couldn't reload the open model: %s", e)


async def _broadcast_presence() -> None:
    """Tell every client who else is here.

    Sent per-socket rather than broadcast identically, because each client
    needs *the others* — a list that differs for every recipient and must never
    include the recipient's own other tabs (#1082).
    """
    dead = set()
    # Snapshot: we await per client, so a window connecting or leaving
    # mid-broadcast would otherwise change the set under the loop (#305).
    for ws in list(_connected_clients):
        try:
            await ws.send_json(presence.snapshot_for(ws))
        except Exception:
            dead.add(ws)
    _connected_clients.difference_update(dead)


async def handle_websocket(websocket: WebSocket):
    """Main WebSocket loop. Receives JSON messages from the frontend
    and dispatches to the appropriate service."""
    _connected_clients.add(websocket)
    # Identity comes from the authenticating proxy; absent on a local run,
    # where there is nobody else to be present anyway.
    identity = presence.identity_from_headers(websocket.headers)
    presence.registry.register(websocket, identity)
    if presence.is_meaningful():
        # Without this the app attributes nothing to anyone, and a proxy that
        # silently stops forwarding identity is indistinguishable from everyone
        # working alone — the one failure this feature cannot show you.
        logger.info(
            "ws connect: identity=%s tabs=%d others=%d",
            identity or "<none>",
            presence.registry.connection_count(identity) if identity else 0,
            len(presence.registry.others(websocket)),
        )
    await _broadcast_presence()
    try:
        while True:
            raw = await websocket.receive_text()
            message = json.loads(raw)
            msg_type = message.get("type")

            if msg_type == "watch_file":
                file_path = message["filePath"]
                global _loop
                _loop = asyncio.get_running_loop()
                try:
                    file_watcher.subscribe(websocket, file_path, _on_file_changed)
                except WatchUnavailable as e:
                    # Already logged. Don't confirm a watch that isn't there:
                    # the sync indicator then shows this window isn't watching
                    # (#308, #1028).
                    await websocket.send_json(
                        {"type": "stopped_watching", "filePath": file_path, "reason": str(e)})
                    continue
                # Also follow PsyNeuLink's own code, if it's a local checkout.
                # Checked on each open, so a source switch re-points it.
                pnl_code_watcher.ensure(_on_psyneulink_changed, _is_open_model)
                await websocket.send_json({"type": "watching", "filePath": file_path})

            elif msg_type == "stop_watching":
                file_watcher.unsubscribe(websocket)
                await websocket.send_json({"type": "stopped_watching"})

            elif msg_type == "load_model":
                file_path = message["filePath"]
                model = load_and_introspect(file_path)
                await websocket.send_json({"type": "model_loaded", "model": model})

            elif msg_type == "update_parameter":
                file_path = message["filePath"]
                node_id = message["nodeId"]
                param_name = message["paramName"]
                new_value = message["newValue"]
                apply_parameter_change(file_path, node_id, param_name, new_value)
                model = load_and_introspect(file_path)
                await websocket.send_json({"type": "model_updated", "model": model})

            elif msg_type == "update_structure":
                file_path = message["filePath"]
                changes = message["changes"]
                apply_structural_change(file_path, changes)
                model = load_and_introspect(file_path)
                await websocket.send_json({"type": "model_updated", "model": model})

            elif msg_type == "run_model":
                await websocket.send_json({
                    "type": "run_result",
                    "status": "not_implemented",
                })

            else:
                await websocket.send_json({
                    "type": "error",
                    "message": f"Unknown message type: {msg_type}",
                })
    finally:
        _connected_clients.discard(websocket)
        presence.registry.unregister(websocket)
        # Someone leaving is as worth knowing as someone arriving.
        await _broadcast_presence()
        # Only this window's watch: other windows keep theirs (#272).
        file_watcher.unsubscribe(websocket)
