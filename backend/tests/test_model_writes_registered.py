"""Every app-side write of a model file tells the file watcher (#450).

The watcher decides "outside edit or our own echo?" by comparing the file's
content with what the app last told it it wrote. A write that skips
``write_model_source`` doesn't tell it, so a window already watching the file
hears PsyNeuView's own write as an outside change: a needless reload and an
"edited outside PsyNeuView" notice. Opening a model that uses
``from psyneulink import *`` did exactly that, because the conversion to
``import psyneulink as pnl`` was written with a plain ``write_text``.

Two tests:

- a guard that reads the backend's code and fails on any direct file write
  that is not on the list below of writes known not to be a model file, so a
  new model write has to go through ``write_model_source`` (or be added here
  with a reason a reviewer can check);
- the case that was broken: a watched star-import model, opened, sends no
  ``file_changed``.
"""

from __future__ import annotations

import ast
import threading
import time
from pathlib import Path

from app.api import ws as ws_module

APP_DIR = Path(__file__).resolve().parent.parent / "app"

# (file, function, kind of write) -> why it is not a write of a model file.
# A write of a model's own source must go through write_model_source instead.
NOT_MODEL_WRITES: dict[tuple[str, str, str], str] = {
    # The one sanctioned direct write: it tells the watcher first.
    ("services/file_writer.py", "write_model_source", "write_text"): "the helper itself",
    # Sidecars and other files that sit beside a model, never the model.
    ("api/routes.py", "load_model", "shutil.copy2"): "backup of a star-import model, beside it",
    ("api/routes.py", "save_sidecar", "write_text"): "layout or labels sidecar",
    ("api/routes.py", "save_copy", "write_bytes"): "a .pnlproject bundle (zip), not .py",
    ("api/routes.py", "save_copy", "write_text"): "an MDF export (.json/.yaml), not .py",
    ("api/routes.py", "save_project", "write_text"): "a project manifest.json",
    ("api/routes.py", "load_reference_model", "shutil.copy2"): "seeds layout sidecars beside a working copy",
    ("services/bundle.py", "write_bundle", "write_bytes"): "a .pnlproject bundle (zip), not .py",
    ("services/bundle.py", "write_bundle", "os.replace"): "a .pnlproject bundle (zip), not .py",
    ("services/bundle.py", "extract_bundle", "write_text"): "a bundle's manifest.json beside its working copy",
    ("services/converter.py", "convert_to_standard_format", "shutil.copy2"): "backup of the model, beside it",
    ("services/labels.py", "save_labels", "write_text"): "labels sidecar",
    ("services/layout.py", "save_layout", "write_text"): "layout sidecar",
    ("services/layout.py", "stamp_demo_origin", "write_text"): "layout sidecar",
    ("services/sidecar_copy.py", "_copy_layout", "shutil.copyfile"): "layout sidecar",
    ("services/sidecar_copy.py", "_copy_layout", "write_text"): "layout sidecar",
    ("services/sidecar_copy.py", "_copy_index", "shutil.copyfile"): "sidecar index",
    ("services/sidecar_copy.py", "_copy_index", "write_text"): "sidecar index",
    ("services/sidecar_copy.py", "apply", "shutil.copyfile"): "other sidecars of a model",
    ("services/sidecar_index.py", "save_index", "write_text"): "sidecar index",
    ("services/sidecar_index.py", "create_variant", "write_text"): "layout or labels variant",
    ("services/sidecar_index.py", "duplicate_variant", "write_text"): "layout or labels variant",
    ("services/sidecar_index.py", "rename_variant", "write_text"): "layout or labels variant",
    ("services/working_copies.py", "adopt_renamed_working_copy", "write_text"): "sidecar index",
    # A preview is a scratch copy the sandbox runs; no window watches it.
    ("services/preview.py", "write_preview", "write_text"): "scratch preview, never watched",
    ("services/preview.py", "sync_preview", "write_text"): "scratch preview, never watched",
    # Moving a whole folder to a new place: new paths, not an open model's.
    ("services/managed_layouts.py", "_copy_file", "shutil.copy2"): "folder move",
    ("services/project_folder.py", "_copy_file", "shutil.copy2"): "folder move",
    ("services/working_copies.py", "_copy_file", "shutil.copy2"): "folder move",
    # App state, settings, logs and caches.
    ("services/activity_log.py", "start_launch", "shutil.move"): "activity log",
    ("services/activity_log.py", "_trim", "write_bytes"): "activity log",
    ("services/activity_log.py", "_trim", "os.replace"): "activity log",
    ("services/activity_log.py", "remove_kinds", "write_text"): "activity log",
    ("services/activity_log.py", "remove_kinds", "os.replace"): "activity log",
    ("services/app_settings.py", "_write_config_atomic", "open"): "settings file",
    ("services/app_settings.py", "_write_config_atomic", "os.replace"): "settings file",
    ("services/checkout_updates.py", "_write_config_atomic", "open"): "settings file",
    ("services/checkout_updates.py", "_write_config_atomic", "os.replace"): "settings file",
    ("services/file_history.py", "_write_config_atomic", "open"): "settings file",
    ("services/file_history.py", "_write_config_atomic", "os.replace"): "settings file",
    ("services/source_history.py", "_write_config_atomic", "open"): "settings file",
    ("services/source_history.py", "_write_config_atomic", "os.replace"): "settings file",
    ("services/pnl_updates.py", "_write_config_atomic", "open"): "settings file",
    ("services/pnl_updates.py", "_write_config_atomic", "os.replace"): "settings file",
    ("services/examples_status.py", "_write_entries", "write_text"): "examples status cache",
    ("services/examples_status.py", "_write_entries", "os.replace"): "examples status cache",
    ("services/pnl_releases.py", "_write_disk_copy", "write_text"): "release list cache",
    ("services/clone_manager.py", "mark_installed", "write_text"): "install marker",
    ("services/install_manager.py", "_mark_local_installed", "write_text"): "install marker",
    # A developer command-line tool, run by hand, not by the app.
    ("services/test_extractor.py", "_cli", "write_text"): "developer command-line tool",
}


def _write_kind(call: ast.Call) -> str | None:
    """The kind of file write ``call`` makes, or None if it makes none."""
    func = call.func
    mode_arg = 1
    if isinstance(func, ast.Attribute):
        if func.attr in ("write_text", "write_bytes"):
            return func.attr
        owner = func.value.id if isinstance(func.value, ast.Name) else None
        if owner == "shutil" and func.attr in ("copy", "copy2", "copyfile", "move"):
            return f"shutil.{func.attr}"
        if owner == "os" and func.attr in ("replace", "rename"):
            return f"os.{func.attr}"
        if not (owner == "os" and func.attr == "fdopen"):
            return None
    elif not (isinstance(func, ast.Name) and func.id == "open"):
        return None
    mode = None
    if len(call.args) > mode_arg and isinstance(call.args[mode_arg], ast.Constant):
        mode = call.args[mode_arg].value
    for kw in call.keywords:
        if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
            mode = kw.value.value
    if isinstance(mode, str) and any(ch in mode for ch in "wax+"):
        return "open"
    return None


def _direct_writes() -> dict[tuple[str, str, str], list[int]]:
    found: dict[tuple[str, str, str], list[int]] = {}

    def walk(node: ast.AST, rel: str, function: str) -> None:
        for child in ast.iter_child_nodes(node):
            name = child.name if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) else function
            if isinstance(child, ast.Call):
                kind = _write_kind(child)
                if kind:
                    found.setdefault((rel, name, kind), []).append(child.lineno)
            walk(child, rel, name)

    for path in sorted(APP_DIR.rglob("*.py")):
        rel = path.relative_to(APP_DIR).as_posix()
        walk(ast.parse(path.read_text()), rel, "<module>")
    return found


def test_every_direct_file_write_is_known_not_to_be_a_model():
    """A new direct write must use write_model_source, or say why it needn't."""
    unknown = {k: v for k, v in _direct_writes().items() if k not in NOT_MODEL_WRITES}
    assert not unknown, (
        "Direct file writes not known to be safe. A write of a model file must "
        "go through file_writer.write_model_source so the file watcher knows "
        "the app wrote it (#450); any other write belongs in NOT_MODEL_WRITES "
        "with its reason:\n"
        + "\n".join(f"  app/{f} {fn}() {kind} line {lines}" for (f, fn, kind), lines in sorted(unknown.items()))
    )


def test_the_known_list_has_no_stale_entries():
    """An entry whose write is gone is dropped, so the list stays honest."""
    stale = set(NOT_MODEL_WRITES) - set(_direct_writes())
    assert not stale, f"NOT_MODEL_WRITES names writes that no longer exist: {sorted(stale)}"


STAR_MODEL = """\
from psyneulink import *

a = TransferMechanism(name='a')
c = Composition(name='c')
c.add_node(a)
"""


def _await_message(socket, wanted: str, limit: int = 5) -> dict:
    for _ in range(limit):
        message = socket.receive_json()
        if message.get("type") == wanted:
            return message
    raise AssertionError(f"no {wanted!r} message within {limit} messages")


def test_opening_a_watched_star_import_model_is_not_an_outside_change(tmp_path, monkeypatch):
    """The case that was broken: a window watches a star-import model, it is
    opened (again), and the app's conversion is heard as an outside edit."""
    from fastapi.testclient import TestClient

    from app.main import app

    heard: list[str] = []
    noticed = threading.Event()
    on_changed = ws_module._on_file_changed

    def noting(path):
        heard.append(path)
        noticed.set()
        on_changed(path)

    monkeypatch.setattr(ws_module, "_on_file_changed", noting)

    model = tmp_path / "star_model.py"
    model.write_text(STAR_MODEL)

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as socket:
            socket.send_json({"type": "watch_file", "filePath": str(model)})
            assert _await_message(socket, "watching")
            # Let the mtime move on from the fixture write.
            time.sleep(0.3)

            response = client.post("/api/model/load", json={"file_path": str(model)})
            assert response.status_code == 200, response.text
            assert "from psyneulink import *" not in model.read_text(), "the model was converted"

            # Past the watcher's 500 ms settle window, with room to spare.
            assert not noticed.wait(2.0), f"the app's own rewrite was heard as an outside change: {heard}"

            # And the watch is still live: a real outside edit is heard.
            model.write_text(model.read_text() + "\nb = pnl.TransferMechanism(name='b')\nc.add_node(b)\n")
            assert noticed.wait(5.0), "an outside edit after opening is still reported"
            assert _await_message(socket, "file_changed")["filePath"] == str(model)
