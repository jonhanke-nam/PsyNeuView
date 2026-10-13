"""Introspect unsaved edits without writing the user's model file (#1029).

The canvas is rebuilt by executing a model file, so showing you the graph for
code you are still typing has always meant writing that code to disk first —
and the file it was written to was your ``model.py``. That is fine when
PsyNeuView is the only tool open. It is not fine when an IDE has the same file
open, because the app then rewrites your file on a timer, unprompted, including
every half-finished intermediate state.

The fix is to separate the two things that were conflated: *what to execute*
and *what the user's file is*. Unsaved buffers are written to a private preview
file, and that is what gets executed. ``model.py`` changes only when the user
saves.

Preview files live under the app's state directory, never beside the model —
the whole point is that nothing appears in the folder an IDE is watching. The
basename is preserved so tracebacks, ``sys.argv[0]`` and error messages still
name the file the user recognises.
"""

import hashlib
import os
import shutil
from pathlib import Path


def preview_root() -> Path:
    """Where preview files live.

    Overridable via ``PSYNEUVIEW_PREVIEW_ROOT`` so tests can pin a tmp
    directory rather than writing into the developer's real state dir —
    same convention as ``clone_root()``.
    """
    override = os.environ.get("PSYNEUVIEW_PREVIEW_ROOT")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".psyneuview" / "previews"


def _slot(model_path: str | Path) -> Path:
    """A stable per-model directory.

    Keyed by a hash of the resolved path so two models with the same basename
    in different folders never share a slot, and so the directory name can
    never collide with anything meaningful on disk.
    """
    resolved = str(Path(model_path).expanduser().resolve())
    digest = hashlib.sha256(resolved.encode("utf-8")).hexdigest()[:16]
    return preview_root() / digest


def preview_path(model_path: str | Path) -> Path:
    """The preview file for ``model_path`` (not necessarily existing yet)."""
    return _slot(model_path) / Path(model_path).name


def write_preview(model_path: str | Path, source: str) -> Path:
    """Write ``source`` to this model's preview file and return its path."""
    path = preview_path(model_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source)
    return path


def clear_preview(model_path: str | Path) -> None:
    """Drop a model's preview. Called once its edits reach the real file.

    Best-effort: a preview left behind is stale data in a scratch directory,
    never a correctness problem, because a preview is only ever executed when
    the client explicitly asks for one.
    """
    slot = _slot(model_path)
    if slot.exists():
        shutil.rmtree(slot, ignore_errors=True)
