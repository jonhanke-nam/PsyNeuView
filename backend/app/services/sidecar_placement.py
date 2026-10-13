"""Decide *where* a model's sidecars live: laterally next to the ``.py`` or
tucked into a hidden ``.psyneuview/`` dot-folder beside it (#927).

Two on-disk layouts, one policy:

  * **Lateral (keep-together)** — ``model.pnlview.json`` etc. sit right next to
    ``model.py``. Everything bundled and visible; the historical behavior.
  * **Dot-folder (declutter)** — the same files live under ``<dir>/.psyneuview/``
    so an external-IDE project view (PyCharm) isn't cluttered with companions.

**Decided policy** (see #927): *lateral files win when present; the dot-folder is
the home for new sidecars.*

  * **Discovery is lateral-first, dot-folder fallback.** If a lateral sidecar
    exists it is used; otherwise the dot-folder copy is. A **visible** file is
    never silently ignored in favor of a **hidden** one — so there's never a
    "why isn't this file being used?" mystery.
  * **New sidecars default to the dot-folder** — but only for a model that has no
    lateral sidecars yet. A model that already carries lateral companions keeps
    writing lateral, so a single model's sidecars never split across both places.
  * ``PSYNEUVIEW_SIDECAR_PLACEMENT`` (``auto`` | ``lateral`` | ``dotfolder``)
    overrides the *new-file* default globally; ``auto`` is the policy above.
    Existing lateral files are honored regardless of the setting.

**Read-only PsyNeuLink files are exempt.** For a model inside a PsyNeuLink that
PsyNeuView manages — a managed clone, a ``git+`` or PyPI install in
site-packages — ``managed_layouts.redirect_path`` redirects companions out of
the install to ``~/.psyneuview/layouts/<source>/<path>`` (#349, #1321). They're
hidden there, so the dot-folder buys nothing: those paths stay lateral within
the redirected tree.

All three sidecar modules (``layout``, ``labels``, ``sidecar_index``) route their
path building through :func:`resolve_path` / :func:`sidecar_dirs` so the decision
lives here, not at each call site.
"""

from __future__ import annotations

import os
from pathlib import Path

from app.services.clone_manager import artifact_path
from app.services.managed_layouts import is_managed as _in_read_only_pnl

DOT_DIRNAME = ".psyneuview"

# The sidecar kinds a model can own. Used to decide whether a model "already
# uses lateral placement" — i.e. carries any visible companion next to its .py.
SIDECAR_SUFFIXES = (".pnlview.json", ".labels.yaml", ".psyneuview.json")

_PLACEMENT_ENV = "PSYNEUVIEW_SIDECAR_PLACEMENT"
AUTO, LATERAL, DOTFOLDER = "auto", "lateral", "dotfolder"
_AUTO, _LATERAL, _DOTFOLDER = AUTO, LATERAL, DOTFOLDER
# Values a *per-model* override or global default may take. ``auto`` is the
# built-in fallback rule; a per-model override is only ever LATERAL/DOTFOLDER
# (absent = inherit the default).
CONCRETE = (LATERAL, DOTFOLDER)
VALID_DEFAULTS = (AUTO, LATERAL, DOTFOLDER)


def _env_mode() -> str | None:
    """Placement forced by ``PSYNEUVIEW_SIDECAR_PLACEMENT`` (ops/testing), or
    ``None`` if unset/invalid."""
    mode = os.environ.get(_PLACEMENT_ENV, "").strip().lower()
    return mode if mode in VALID_DEFAULTS else None


def _global_default() -> str:
    """The persisted global default, or ``auto`` when unset/invalid."""
    from app.services.app_settings import get_default_placement

    return get_default_placement() or AUTO


def _effective_mode(
    model_path: str, consult_index: bool = True, placement: str | None = None
) -> str:
    """The new-file placement mode for this model, resolving the precedence:
    per-model override → env var → global default → built-in ``auto``.

    ``consult_index=False`` skips the per-model lookup — used when resolving the
    index file's *own* path, since reading the per-model value requires locating
    the index and that must not recurse. ``placement`` (``lateral`` /
    ``dotfolder``) stands in for the per-model override when the model's index
    isn't on disk yet — a copy being made of another model (#1244) takes the
    original's choice.
    """
    if placement in CONCRETE:
        return placement
    if consult_index:
        from app.services.sidecar_index import get_placement

        per_model = get_placement(model_path)
        if per_model in CONCRETE:
            return per_model
    return _env_mode() or _global_default()


def _is_managed(model_path: str) -> bool:
    """Whether the model lives inside a read-only PsyNeuLink — a managed clone,
    or a ``git+`` / PyPI install in site-packages — so ``artifact_path``
    redirects its companions out of the install (#349, #1321). The dot-folder
    doesn't apply there."""
    return _in_read_only_pnl(model_path)


def _lateral(model_path: str, filename: str) -> Path:
    """The lateral path for ``filename`` — next to the ``.py`` (redirected out of
    tree for a managed clone, per #349)."""
    return artifact_path(Path(model_path).with_name(filename))


def _dotted(model_path: str, filename: str) -> Path:
    """The dot-folder path for ``filename`` — under ``<dir>/.psyneuview/``."""
    return artifact_path(Path(model_path).parent / DOT_DIRNAME / filename)


def _model_uses_lateral(model_path: str) -> bool:
    """Whether the model already carries any lateral sidecar. Once it does, new
    companions stay lateral so a model's sidecars are never split."""
    p = Path(model_path)
    d = _lateral(model_path, p.name).parent  # the (possibly redirected) .py dir
    if not d.exists():
        return False
    stem = p.stem
    for suffix in SIDECAR_SUFFIXES:
        if (d / (stem + suffix)).exists():
            return True
        if any(True for _ in d.glob(stem + ".*" + suffix)):
            return True
    return False


def resolve_path(
    model_path: str,
    filename: str,
    consult_index: bool = True,
    placement: str | None = None,
) -> Path:
    """The single canonical path for one sidecar ``filename`` — used for both
    reads and writes so load/save always agree.

    Lateral-first: an existing lateral file wins, then an existing dot-folder
    file. For a *new* file (neither exists), the placement mode decides —
    ``auto`` puts it in the dot-folder unless the model already uses lateral.

    ``consult_index=False`` skips the per-model override lookup (see
    :func:`_effective_mode`) — the index file resolves its own path this way to
    avoid recursing through its own placement value. ``placement`` supplies
    that override directly, for a model whose index isn't written yet.

    Pure (no directory creation); writers call :func:`ensure_parent` first.
    """
    lat = _lateral(model_path, filename)
    dot = _dotted(model_path, filename)

    # A visible/existing file always wins, regardless of mode — the whole point
    # of lateral-first is that nothing on disk is silently shadowed.
    if lat.exists():
        return lat
    if dot.exists():
        return dot

    # Managed clones stay lateral (already out of tree; dot-folder is moot).
    if _is_managed(model_path):
        return lat

    mode = _effective_mode(model_path, consult_index=consult_index, placement=placement)
    if mode == _LATERAL:
        return lat
    if mode == _DOTFOLDER:
        return dot
    # auto: new sidecars go to the dot-folder unless the model is already lateral.
    return lat if _model_uses_lateral(model_path) else dot


def sidecar_dirs(model_path: str) -> list[Path]:
    """Directories to search when discovering a model's sidecars, in precedence
    order (lateral first, then the dot-folder). Only existing dirs are returned.

    For a managed clone there's a single redirected dir — the dot-folder doesn't
    apply — so discovery there is unchanged.
    """
    lat_dir = _lateral(model_path, Path(model_path).name).parent
    if _is_managed(model_path):
        return [lat_dir] if lat_dir.exists() else []
    dot_dir = _dotted(model_path, Path(model_path).name).parent
    return [d for d in (lat_dir, dot_dir) if d.exists()]


def ensure_parent(path: Path) -> Path:
    """Create ``path``'s parent directory (e.g. a fresh ``.psyneuview/``) so a
    writer can commit immediately. Idempotent — a lateral parent already exists.
    Returns ``path`` for call-site convenience."""
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def effective_placement(model_path: str) -> dict:
    """Placement state for the model-load payload (#933): the resolved
    ``effective`` mode used for new sidecars, the ``default`` that ``inherit``
    resolves to (env/global, excluding the per-model override), and the
    ``perModel`` override itself (``None`` = inherit)."""
    if _is_managed(model_path):
        # Companions are redirected out of tree; placement is not user-selectable.
        return {"perModel": None, "default": LATERAL, "effective": LATERAL, "managed": True}
    from app.services.sidecar_index import get_placement

    per_model = get_placement(model_path)
    per_model = per_model if per_model in CONCRETE else None
    # Resolve to a *concrete* location so the UI shows where new sidecars land,
    # not the abstract ``auto`` rule (which a user can't act on).
    mode = _effective_mode(model_path, consult_index=True)
    if mode == AUTO:
        mode = LATERAL if _model_uses_lateral(model_path) else DOTFOLDER
    return {
        "perModel": per_model,
        "default": _env_mode() or _global_default(),
        "effective": mode,
        "managed": False,
    }


def model_sidecar_files(model_path: str) -> list[Path]:
    """Every existing sidecar file for the model, across both directories
    (lateral first, then the dot-folder; the redirected folder for a model
    inside a read-only PsyNeuLink): the default and every named variant of
    each kind, and the index."""
    stem = Path(model_path).stem
    out: list[Path] = []
    for d in sidecar_dirs(model_path):
        for suffix in SIDECAR_SUFFIXES:
            exact = d / (stem + suffix)
            if exact.exists():
                out.append(exact)
            out.extend(sorted(d.glob(stem + ".*" + suffix)))
    return out


def migrate(model_path: str, target: str) -> dict:
    """Move the model's existing sidecars into the ``target`` layout
    (``lateral`` | ``dotfolder``), the teeth behind a per-model placement change:
    lateral-first discovery means a flip does nothing until the files actually
    move.

    Returns ``{"moved": [...], "conflicts": [...], "managed": bool}``. A file
    already present at the destination (both-locations drift) is **not**
    clobbered — it's reported in ``conflicts`` and the source is left in place,
    to be surfaced/resolved by the lineage UI (#929).
    """
    if target not in CONCRETE:
        raise ValueError(f"migrate target must be one of {CONCRETE}, got {target!r}")
    if _is_managed(model_path):
        # Clone companions are already redirected out of tree — nothing to move.
        return {"moved": [], "conflicts": [], "managed": True}

    name = Path(model_path).name
    target_dir = (_lateral if target == LATERAL else _dotted)(model_path, name).parent

    moved: list[str] = []
    conflicts: list[str] = []
    for src in model_sidecar_files(model_path):
        if src.parent == target_dir:
            continue  # already where it belongs
        dest = target_dir / src.name
        if dest.exists():
            conflicts.append(src.name)
            continue
        ensure_parent(dest)
        src.replace(dest)  # atomic move within the same filesystem
        moved.append(src.name)
    return {"moved": moved, "conflicts": conflicts, "managed": False}
