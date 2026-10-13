"""Moving My Project Folder, and the one-time offer to move it (#1295).

My Project Folder used to default to a hidden place (``~/.psyneuview/models``
in the Mac app; the checkout's ``models/`` otherwise). New installs on a Mac
now get a visible folder under ``~/Documents`` (:mod:`model_dirs`). Someone
with models in a legacy folder keeps it, and Settings offers **once** to move
them; "Not now" is remembered here. Settings ▸ General also has **Move…** at
any time. Both go through :func:`move_project_folder`, the one migration.

What a move promises:

- Everything in the folder goes together: the models, their sidecars beside
  them, and the hidden ``.psyneuview/`` folders that hold the rest
  (docs/file-conventions.md). The whole tree is copied as it is.
- Nothing is deleted until the copy is complete and verified file by file.
  If anything fails partway, what was copied is taken back out, the old
  folder is untouched and the setting is unchanged.
- A destination that already has files is merged into only when no name
  collides; otherwise the move is refused with the colliding names.
- The preferences are updated together: the project folder, and any catalog
  that pointed inside it. The page updates its own recent-files list.
- The outcome is recorded (``project_folder_last_move``) so Report a Problem
  can include it.
- Moving back is just another move.

Refused outright when ``PSYNEWVIEW_MODELS_DIR`` fixes the folder: the
environment wins, as it always has.
"""

from __future__ import annotations

import filecmp
import logging
import os
import shutil
import time
from pathlib import Path

from app.services import app_settings, deployment_mode
from app.services.app_config import app_config_path
from app.services.catalogs import CATALOGS_KEY, _stored
from app.services.model_dirs import (
    MODELS_DIR_ENV,
    get_model_dirs,
    legacy_models_dirs,
    visible_default_applies,
    visible_default_models_dir,
)

logger = logging.getLogger(__name__)

LAST_MOVE_KEY = "project_folder_last_move"
OFFER_DISMISSED_KEY = "project_folder_move_offer_dismissed"

#: How many colliding names a refusal lists before "and N more".
_MAX_LISTED_COLLISIONS = 10


class MoveError(ValueError):
    """A move that can't be made, with a plain reason to show the user."""


def _read() -> dict:
    return app_settings._read_config(app_config_path())


def _write(config: dict) -> None:
    app_settings._write_config_atomic(app_config_path(), config)


def _fixed_by_env() -> bool:
    return bool(os.environ.get(MODELS_DIR_ENV))


# ── The one-time offer ────────────────────────────────────────────────


def move_offer() -> dict | None:
    """The offer to move from a legacy folder to the visible default, or None
    when there is nothing to offer: the folder is fixed by the environment,
    this deployment doesn't get the visible default, the folder is already
    somewhere the user chose, or the offer was declined before."""
    if _fixed_by_env() or not visible_default_applies():
        return None
    if deployment_mode.current_mode() == deployment_mode.HOSTED:
        return None
    with app_settings._lock:
        if _read().get(OFFER_DISMISSED_KEY):
            return None
    current = get_model_dirs()[0]
    legacy = {p.resolve() for p in legacy_models_dirs()}
    if current.resolve() not in legacy:
        return None
    target = visible_default_models_dir()
    if target.resolve() == current.resolve():
        return None
    return {"from": str(current), "to": str(target)}


def dismiss_move_offer() -> None:
    """"Not now": remembered, so the offer is made once."""
    with app_settings._lock:
        config = _read()
        config[OFFER_DISMISSED_KEY] = True
        _write(config)


def last_move() -> dict | None:
    """The outcome of the last move, for Report a Problem; None if never moved."""
    with app_settings._lock:
        record = _read().get(LAST_MOVE_KEY)
    return record if isinstance(record, dict) else None


# ── The move ──────────────────────────────────────────────────────────


def _copy_file(src: Path, dst: Path) -> None:
    """One file, metadata included; a symlink is copied as a symlink. A
    module-level function so a test can make the copy fail partway."""
    if src.is_symlink():
        os.symlink(os.readlink(src), dst)
    else:
        shutil.copy2(src, dst)


def _walk(root: Path) -> tuple[list[Path], list[Path]]:
    """Every directory and file under ``root`` as paths relative to it.
    Symlinks are listed as files and never followed, so a link out of the
    folder can't pull anything else in."""
    dirs: list[Path] = []
    files: list[Path] = []
    for current, subdirs, names in os.walk(root, followlinks=False):
        rel_dir = Path(current).relative_to(root)
        linked = [d for d in subdirs if (Path(current) / d).is_symlink()]
        subdirs[:] = [d for d in subdirs if d not in linked]
        for d in subdirs:
            dirs.append(rel_dir / d)
        for name in [*linked, *names]:
            files.append(rel_dir / name)
    return dirs, files


def _collisions(src: Path, dst: Path, dirs: list[Path], files: list[Path]) -> list[str]:
    """Names that exist in both and can't be merged: a file either side, or a
    file where the other has a folder. A folder in both is a merge."""
    out: list[str] = []
    for rel in files:
        if (dst / rel).exists() or (dst / rel).is_symlink():
            out.append(str(rel))
    for rel in dirs:
        target = dst / rel
        if (target.exists() or target.is_symlink()) and not target.is_dir():
            out.append(str(rel))
    return sorted(out)


def _same_content(a: Path, b: Path) -> bool:
    if a.is_symlink() or b.is_symlink():
        return a.is_symlink() and b.is_symlink() and os.readlink(a) == os.readlink(b)
    return filecmp.cmp(a, b, shallow=False)


def _record(record: dict) -> None:
    with app_settings._lock:
        config = _read()
        config[LAST_MOVE_KEY] = record
        _write(config)


def _rewrite_under(path: str, old: Path, new: Path) -> str:
    """``path`` with ``old`` swapped for ``new`` when it is ``old`` or inside it."""
    try:
        rel = Path(path).expanduser().resolve().relative_to(old)
    except (ValueError, OSError):
        return path
    return str(new / rel)


def move_project_folder(destination: str) -> dict:
    """Move My Project Folder and everything in it to ``destination``.

    Returns the record of the move (``from``, ``to``, ``at``, ``ok``,
    ``files``, ``warning``). Raises :class:`MoveError` with the reason when
    nothing can or should move; then nothing has changed.
    """
    if deployment_mode.current_mode() == deployment_mode.HOSTED:
        raise MoveError("The project folder can't be moved on the shared hosted PsyNeuView.")
    if _fixed_by_env():
        raise MoveError(
            f"The project folder is set by {MODELS_DIR_ENV}, so it can't be moved from here."
        )
    if not (destination or "").strip():
        raise MoveError("Choose where to move the folder to.")
    src = get_model_dirs()[0].resolve()
    dst = Path(destination).expanduser().resolve()
    if not src.is_dir():
        raise MoveError(f"There's no folder at {src} to move.")
    if dst == src:
        raise MoveError("That is already the project folder.")
    if dst.is_relative_to(src):
        raise MoveError("The new folder can't be inside the current one.")
    if src.is_relative_to(dst):
        raise MoveError("The new folder can't contain the current one.")
    if dst.exists() and not dst.is_dir():
        raise MoveError(f"{dst} is a file, not a folder.")

    dirs, files = _walk(src)
    collisions = _collisions(src, dst, dirs, files) if dst.exists() else []
    if collisions:
        shown = ", ".join(collisions[:_MAX_LISTED_COLLISIONS])
        more = len(collisions) - _MAX_LISTED_COLLISIONS
        raise MoveError(
            f"{dst} already has {len(collisions)} of these names: {shown}"
            + (f", and {more} more" if more > 0 else "")
            + ". Nothing was moved. Choose an empty folder, or one without those names."
        )

    started = time.time()
    created_dirs: list[Path] = []
    created_files: list[Path] = []
    dst_was_missing = not dst.exists()

    def take_back() -> None:
        # Only what this move created: a destination that had files keeps them.
        for f in reversed(created_files):
            try:
                f.unlink()
            except OSError:
                pass
        for d in reversed(created_dirs):
            try:
                d.rmdir()
            except OSError:
                pass

    try:
        if dst_was_missing:
            dst.mkdir(parents=True)
            created_dirs.append(dst)
        for rel in dirs:
            target = dst / rel
            if not target.exists():
                target.mkdir()
                created_dirs.append(target)
        for rel in files:
            _copy_file(src / rel, dst / rel)
            created_files.append(dst / rel)
        # Verify before anything is removed: every file, byte for byte.
        for rel in files:
            if not _same_content(src / rel, dst / rel):
                raise OSError(f"{rel} didn't copy correctly")
    except Exception as e:  # noqa: BLE001 — any failure means: put it back
        take_back()
        _record({
            "from": str(src), "to": str(dst), "at": started, "ok": False,
            "files": 0, "error": f"{e}",
        })
        raise MoveError(
            f"Couldn't move the folder: {e}. The old folder is untouched and the setting is unchanged."
        ) from e

    # The copy is complete and verified: point everything at the new folder.
    with app_settings._lock:
        config = _read()
        stored_dirs = [p for p in (config.get("model_dirs") or []) if isinstance(p, str)]
        rest = [_rewrite_under(p, src, dst) for p in stored_dirs[1:]]
        config["model_dirs"] = [str(dst), *[p for p in rest if Path(p) != dst]]
        catalogs = _stored(config)
        for c in catalogs:
            c["path"] = _rewrite_under(c["path"], src, dst)
        config[CATALOGS_KEY] = [c for c in catalogs if Path(c["path"]).resolve() != dst]
        _write(config)

    warning = None
    try:
        shutil.rmtree(src)
    except OSError as e:
        warning = f"The old folder couldn't be removed: {e}. Its files are safe to delete by hand."
        logger.warning("project folder move: %s", warning)

    record = {
        "from": str(src), "to": str(dst), "at": started, "ok": True,
        "files": len(files), "error": None, "warning": warning,
    }
    _record(record)
    return record
