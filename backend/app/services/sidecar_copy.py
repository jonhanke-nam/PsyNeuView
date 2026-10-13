"""Carry a model's sidecars along to a copy of it (#1244).

**Save a copy as…** (``/api/models/save-as``, and ``/api/model/save-copy``
for ``py``) wrote only the ``.py`` and then opened the copy. Everything
PsyNeuView keeps *beside* a model — the layout (``.pnlview.json``), the
labels (``.labels.yaml``), the index of named variants (``.psyneuview.json``)
— stayed with the original, so the copy opened with a default layout and no
labels, and from then on its layout changes went to files the original never
used. The copy should open looking like the model it was copied from.

Two steps, so the route can refuse before writing anything:

- :func:`plan` lists every sidecar the original has and where each one's
  copy would go. A target that already exists is flagged, and the route
  treats it exactly as it treats an existing ``.py``: a 409 unless the
  caller said ``overwrite`` — the same confirmation, for the same reason.
- :func:`apply` writes the copies.

Where the copies go follows the placement rules
(:mod:`sidecar_placement`): an existing lateral file at the destination
wins, then an existing dot-folder file; for a new file, the destination's
rules decide — the original's own per-model choice (its index's
``placement``) carries over to the copy, then the global default, then
``auto``. A copy inside a read-only PsyNeuLink is refused by
``pnl_source_guard`` before this runs, and the original's sidecars are read
from wherever they are, the redirected layouts folder included.

What changes on the way:

- the stem: ``m.1.pnlview.json`` becomes ``copy.1.pnlview.json``, and the
  index's entries are renamed to match;
- a layout's **view-only lock** is dropped: a copy starts unlocked, as
  documented (``edit_lock``), since the lock is for the model someone chose
  to protect, not for a copy they made to work on;
- a layout's **demo origin** is dropped: the copy is the user's file, not a
  demo working copy, so it must not offer *Reset to Original*.

Labels are copied as they are.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path

from app.services.edit_lock import LOCK_KEY
from app.services.sidecar_index import INDEX_SUFFIX, LAYOUT_SUFFIX, get_placement
from app.services.sidecar_placement import (
    ensure_parent,
    model_sidecar_files,
    resolve_path,
)

#: Layout keys that belong to the original, not to a copy of it.
_LAYOUT_KEYS_NOT_COPIED = (LOCK_KEY, "demo_origin")


@dataclass(frozen=True)
class SidecarCopy:
    """One sidecar of the original and where its copy goes."""

    source: Path
    target: Path

    @property
    def exists(self) -> bool:
        """Whether something is already at the target."""
        return self.target.exists()


def _renamed(filename: str, src_stem: str, dst_stem: str) -> str:
    """``m.1.pnlview.json`` → ``copy.1.pnlview.json``; a name that doesn't
    start with the original's stem is left alone."""
    if filename == src_stem or filename.startswith(src_stem + "."):
        return dst_stem + filename[len(src_stem):]
    return filename


def plan(src_model: str | Path, dst_model: str | Path) -> list[SidecarCopy]:
    """Every sidecar of ``src_model`` and the path its copy takes for
    ``dst_model``. Empty when the original has none, or when the copy *is*
    the original (saving a model over itself carries nothing)."""
    src = Path(src_model)
    dst = Path(dst_model)
    if not src.is_file():
        return []
    try:
        if src.resolve() == dst.resolve():
            return []
    except OSError:
        pass
    # The original's own placement choice follows it to the copy, whose
    # index isn't on disk yet when the targets are resolved.
    placement = get_placement(str(src))
    out: list[SidecarCopy] = []
    for file in model_sidecar_files(str(src)):
        name = _renamed(file.name, src.stem, dst.stem)
        consult = not name.endswith(INDEX_SUFFIX)  # the index never consults itself
        target = resolve_path(str(dst), name, consult_index=consult, placement=placement)
        out.append(SidecarCopy(source=file, target=target))
    return out


def existing_targets(copies: list[SidecarCopy]) -> list[Path]:
    """The targets something already sits at — what an overwrite would replace."""
    return [c.target for c in copies if c.exists]


def _copy_layout(src: Path, dst: Path) -> None:
    try:
        data = json.loads(src.read_text())
    except (json.JSONDecodeError, OSError):
        shutil.copyfile(src, dst)  # not ours to repair; the copy is as faithful as it can be
        return
    if not isinstance(data, dict):
        shutil.copyfile(src, dst)
        return
    for key in _LAYOUT_KEYS_NOT_COPIED:
        data.pop(key, None)
    dst.write_text(json.dumps(data, indent=2) + "\n")


def _copy_index(src: Path, dst: Path, src_stem: str, dst_stem: str) -> None:
    try:
        data = json.loads(src.read_text())
    except (json.JSONDecodeError, OSError):
        shutil.copyfile(src, dst)
        return
    if not isinstance(data, dict):
        shutil.copyfile(src, dst)
        return
    for key in ("layouts", "settings"):
        entries = data.get(key)
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if isinstance(entry, dict) and isinstance(entry.get("file"), str):
                entry["file"] = _renamed(entry["file"], src_stem, dst_stem)
    # The active pointers are file basenames too (#491); an older index
    # stored a variant name, which the rename leaves alone.
    for key in ("activeLayout", "activeSetting"):
        if isinstance(data.get(key), str):
            data[key] = _renamed(data[key], src_stem, dst_stem)
    dst.write_text(json.dumps(data, indent=2) + "\n")


def apply(copies: list[SidecarCopy], src_model: str | Path, dst_model: str | Path) -> list[Path]:
    """Write the planned copies. The caller has already decided about
    targets that exist (see :func:`existing_targets`); this overwrites them.
    Returns the paths written."""
    src_stem = Path(src_model).stem
    dst_stem = Path(dst_model).stem
    written: list[Path] = []
    for c in copies:
        ensure_parent(c.target)
        if c.source.name.endswith(LAYOUT_SUFFIX):
            _copy_layout(c.source, c.target)
        elif c.source.name.endswith(INDEX_SUFFIX):
            _copy_index(c.source, c.target, src_stem, dst_stem)
        else:
            shutil.copyfile(c.source, c.target)
        written.append(c.target)
    return written


def copy_sidecars(src_model: str | Path, dst_model: str | Path) -> list[Path]:
    """Plan and apply in one go, overwriting whatever is at the targets. For
    callers that have already settled the overwrite question."""
    return apply(plan(src_model, dst_model), src_model, dst_model)
