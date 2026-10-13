"""Index + convention discovery for a model's named layouts / settings (479a).

A model's GUI sidecars are per-file modular (#479): besides the single
``<stem>.pnlview.json`` layout and ``<stem>.labels.yaml`` settings file, a
model may carry named variants ``<stem>.<name>.pnlview.json`` /
``<stem>.<name>.labels.yaml``. This module exposes the *merged* view a caller
needs: every variant present on disk, in a deliberate order, with one marked
active.

Two sources are reconciled:

  * **Convention discovery is authoritative.** Any sidecar file present on
    disk is a variant — so a file dropped in by a collaborator shows up with
    no index edit (the social/exchange property #479 is built around).
  * **The index file is an overlay.** ``<stem>.psyneuview.json`` records only
    what convention can't express: the order, which variant is active, and
    (future) pointers to files outside the conventional folder. It never
    *gates* discovery: convention-found-but-unindexed files are appended in
    name order, and index entries whose file is gone surface as ``missing``
    rather than being dropped, so drift is visible instead of silently lost.

Delete the index and you lose only ordering + active selection, never the
variants themselves.

Like the layout/labels sidecars, the index is redirected out of tree via
``artifact_path`` when the model lives inside a managed clone, so it can't
dirty the clone's git working tree (#349).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from app.services.sidecar_placement import (
    CONCRETE as _PLACEMENT_CONCRETE,
    effective_placement,
    ensure_parent,
    resolve_path,
    sidecar_dirs,
)

LAYOUT_SUFFIX = ".pnlview.json"
SETTINGS_SUFFIX = ".labels.yaml"
INDEX_SUFFIX = ".psyneuview.json"
INDEX_VERSION = 1

DEFAULT_NAME = "Default"

# A variant name is used verbatim as the filename token (#481 discovery
# derives the display name straight from the token), so it must be
# filesystem-safe and unambiguous against the suffix split.
_VARIANT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def variant_filename(stem: str, suffix: str, variant: str | None = None) -> str:
    """Filename for a model's named variant of a given sidecar kind.

    ``None`` / ``"Default"`` map to the unsuffixed ``<stem><suffix>`` (the
    single sidecar today — back-compat). A named variant becomes
    ``<stem>.<name><suffix>``; the name *is* the on-disk token so #481's
    discovery recovers it exactly.
    """
    if variant is None or variant == DEFAULT_NAME:
        return stem + suffix
    return f"{stem}.{variant}{suffix}"


def is_valid_variant_name(name: str) -> bool:
    """Whether ``name`` is a usable variant name (letters/digits/_/-, not the
    reserved ``Default``). ``Default`` is implicit — the unsuffixed file."""
    return bool(name) and name != DEFAULT_NAME and _VARIANT_RE.match(name) is not None


def index_path(model_path: str) -> Path:
    """Path to the model's sidecar index — lateral or dot-folder per placement
    (#927), redirected out of tree for managed clones (#349).

    Resolved with ``consult_index=False``: the index carries the per-model
    placement value, so locating it must not depend on that value (#933)."""
    p = Path(model_path)
    return resolve_path(model_path, p.stem + INDEX_SUFFIX, consult_index=False)


def get_placement(model_path: str) -> str | None:
    """The model's explicit per-model placement override (``lateral`` /
    ``dotfolder``), or ``None`` when unset — i.e. inherit the default (#933)."""
    idx = load_index(model_path)
    value = idx.get("placement") if idx else None
    return value if value in _PLACEMENT_CONCRETE else None


def set_placement(model_path: str, value: str | None) -> None:
    """Set (or, with ``None``, clear → inherit) the per-model placement override.

    Writes only the overlay field; does **not** move existing files — the caller
    pairs this with :func:`sidecar_placement.migrate` when an explicit target
    should relocate the model's sidecars (#933)."""
    if value is not None and value not in _PLACEMENT_CONCRETE:
        raise ValueError(f"invalid placement: {value!r} (expected one of {_PLACEMENT_CONCRETE} or null)")
    idx = load_index(model_path) or {
        "layouts": [], "activeLayout": None, "settings": [], "activeSetting": None,
    }
    if value is None:
        idx.pop("placement", None)
    else:
        idx["placement"] = value
    save_index(model_path, idx)


def load_index(model_path: str) -> dict | None:
    """Load the index overlay if present, else ``None``.

    A malformed index never raises — it's an overlay, so a broken file
    degrades to pure convention discovery rather than breaking model load.
    """
    path = index_path(model_path)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def save_index(model_path: str, index: dict) -> None:
    """Persist the index overlay.

    Stores only the overlay fields (``layouts``/``settings`` entries plus the
    active pointers). An index with no entries is deleted rather than left as
    an empty file polluting the project directory, mirroring ``save_labels``.
    """
    path = index_path(model_path)
    layouts = index.get("layouts") or []
    settings = index.get("settings") or []
    placement = index.get("placement")
    placement = placement if placement in _PLACEMENT_CONCRETE else None
    # An index with no variants *and* no placement override carries nothing worth
    # keeping — delete it rather than leave an empty file. A placement-only index
    # is meaningful (it records the per-model choice), so it survives.
    if not layouts and not settings and placement is None:
        if path.exists():
            path.unlink()
        return
    data = {
        "version": INDEX_VERSION,
        "layouts": [_clean_entry(e) for e in layouts],
        "activeLayout": index.get("activeLayout"),
        "settings": [_clean_entry(e) for e in settings],
        "activeSetting": index.get("activeSetting"),
    }
    if placement is not None:
        data["placement"] = placement
    ensure_parent(path).write_text(json.dumps(data, indent=2) + "\n")


def list_layouts(model_path: str) -> list[dict]:
    """Merged, ordered list of the model's layout variants (one active)."""
    idx = load_index(model_path)
    return _disambiguate(_merge(
        _indexed(idx, "layouts"),
        _discover(model_path, LAYOUT_SUFFIX, embedded_names=True),
        _active(idx, "activeLayout"),
    ))


def list_settings(model_path: str) -> list[dict]:
    """Merged, ordered list of the model's settings variants (one active)."""
    idx = load_index(model_path)
    return _disambiguate(_merge(
        _indexed(idx, "settings"),
        _discover(model_path, SETTINGS_SUFFIX, embedded_names=False),
        _active(idx, "activeSetting"),
    ))


def list_sidecars(model_path: str) -> dict:
    """The full merged view a model-load response needs (479b consumes this)."""
    layouts = list_layouts(model_path)
    settings = list_settings(model_path)
    return {
        "layouts": layouts,
        "activeLayout": next((e["name"] for e in layouts if e["active"]), None),
        "settings": settings,
        "activeSetting": next((e["name"] for e in settings if e["active"]), None),
        # Placement state (#933): effective mode + inherited-vs-explicit override,
        # so the client renders the toggle without a second round-trip.
        "placement": effective_placement(model_path),
    }


def _clean_entry(entry: dict) -> dict:
    out = {"name": entry.get("name"), "file": entry.get("file")}
    if "order" in entry:
        out["order"] = entry["order"]
    return out


def _indexed(index: dict | None, key: str) -> list[dict]:
    return (index or {}).get(key) or []


def _active(index: dict | None, key: str) -> str | None:
    return (index or {}).get(key)


def _discover(model_path: str, suffix: str, embedded_names: bool) -> dict:
    """Glob the sidecar directories for this model's variants of one kind.

    Returns ``{basename: {"name", "file"}}``. The unsuffixed
    ``<stem><suffix>`` is the ``Default`` variant; ``<stem>.<token><suffix>``
    files take their display name from the token (or, for JSON layouts, an
    embedded ``name`` field if present).

    Placement (#927) can spread a model's sidecars across two directories — the
    lateral one next to the ``.py`` and the hidden ``.psyneuview/`` dot-folder.
    Both are searched, **lateral first**: a lateral file wins over a dot-folder
    file of the same basename, so a visible file is never shadowed by a hidden
    one (the same lateral-first rule the path resolver follows).
    """
    p = Path(model_path)
    stem = p.stem
    out: dict[str, dict] = {}

    for d in sidecar_dirs(model_path):  # lateral first, then the dot-folder
        default = d / (stem + suffix)
        if default.exists() and default.name not in out:
            out[default.name] = {"name": DEFAULT_NAME, "file": default.name}

        for f in sorted(d.glob(stem + ".*" + suffix)):
            if f.name == default.name or f.name in out:
                continue
            token = f.name[len(stem) + 1 : -len(suffix)]
            name = (_embedded_name(f) if embedded_names else None) or token
            out[f.name] = {"name": name, "file": f.name}
    return out


def _embedded_name(path: Path) -> str | None:
    """A self-describing JSON layout may carry its own ``name`` (479b writes
    these). Best-effort: a malformed file just falls back to the filename."""
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    name = data.get("name") if isinstance(data, dict) else None
    return name if isinstance(name, str) and name else None


def _fallback_name(file: str) -> str:
    """Display name for an index entry whose file is missing from disk."""
    for suf in (LAYOUT_SUFFIX, SETTINGS_SUFFIX, INDEX_SUFFIX):
        if file.endswith(suf):
            base = file[: -len(suf)]
            return base.split(".")[-1] if "." in base else DEFAULT_NAME
    return file


def _merge(indexed: list[dict], discovered: dict, active_name: str | None) -> list[dict]:
    """Index order first (with missing entries kept), then unindexed
    convention-found files appended in name order. One entry marked active."""
    result: list[dict] = []
    used: set[str] = set()
    order = 0

    for entry in indexed:
        file = entry.get("file")
        if not file:
            continue
        present = file in discovered
        # Convention discovery is authoritative for a present file's name —
        # the index's stored name is only a hint, used when the file is gone
        # (#491: a stale index name must never override the embedded name, or
        # a resolved collision would keep its disambiguating suffix forever).
        name = (
            discovered[file]["name"] if present
            else entry.get("name") or _fallback_name(file)
        )
        result.append(
            {"name": name, "file": file, "order": order,
             "missing": not present, "active": False}
        )
        used.add(file)
        order += 1

    extras = sorted(
        (d for f, d in discovered.items() if f not in used),
        key=lambda d: d["name"].lower(),
    )
    for d in extras:
        result.append(
            {"name": d["name"], "file": d["file"], "order": order,
             "missing": False, "active": False}
        )
        order += 1

    _apply_active(result, active_name)
    return result


def _disambiguate(entries: list[dict]) -> list[dict]:
    """Guarantee unique display names in the merged view (#491).

    Two files can resolve to the same name — e.g. a dropped-in layout whose
    embedded ``name`` matches an existing variant's. Since the dropdown and
    the management ops address a variant by its (display) name, a collision
    would make the entries indistinguishable. Later colliders get a ``(2)``,
    ``(3)`` suffix so every entry is distinctly labeled and addressable; the
    on-disk ``file`` stays the stable identity the ops actually act on."""
    seen: dict[str, int] = {}
    for e in entries:
        base = e["name"]
        n = seen.get(base, 0) + 1
        seen[base] = n
        if n > 1:
            e["name"] = f"{base} ({n})"
    return entries


def _apply_active(entries: list[dict], active: str | None) -> None:
    """Mark the active entry: the one whose file (or, for back-compat, name)
    matches ``active`` if present, else ``Default`` if present (today's single
    sidecar is the default), else the first present entry. Missing entries are
    never auto-activated. ``active`` is a file basename for indexes written
    since #491; older indexes stored a name, so both are accepted."""
    chosen = None
    if active:
        chosen = next(
            (e for e in entries
             if not e["missing"] and (e["file"] == active or e["name"] == active)),
            None,
        )
    if chosen is None:
        chosen = next(
            (e for e in entries if e["name"] == DEFAULT_NAME and not e["missing"]),
            None,
        )
    if chosen is None:
        chosen = next((e for e in entries if not e["missing"]), None)
    if chosen is not None:
        chosen["active"] = True


# --- variant management (479b) -------------------------------------------
#
# Mutations operate on one kind ("layout" | "settings") at a time, writing
# the payload file and re-persisting that kind's slice of the index (order +
# active) while preserving the other kind's slice. Each returns the full
# merged view (``list_sidecars``) so a caller refreshes in one round-trip.

LAYOUT_KIND = "layout"
SETTINGS_KIND = "settings"


class VariantError(Exception):
    """A variant operation was rejected (bad name, missing/duplicate, etc.).

    Route handlers surface the message as a 400 — it's always a client-side
    mistake (unknown variant, name collision, malformed name)."""


def _require_kind(kind: str) -> None:
    if kind not in (LAYOUT_KIND, SETTINGS_KIND):
        raise VariantError(f"Unknown sidecar kind: {kind!r}")


def _suffix(kind: str) -> str:
    return LAYOUT_SUFFIX if kind == LAYOUT_KIND else SETTINGS_SUFFIX


def _entries_key(kind: str) -> str:
    return "layouts" if kind == LAYOUT_KIND else "settings"


def _active_key(kind: str) -> str:
    return "activeLayout" if kind == LAYOUT_KIND else "activeSetting"


def _list_for(model_path: str, kind: str) -> list[dict]:
    return list_layouts(model_path) if kind == LAYOUT_KIND else list_settings(model_path)


def _active_file_for(model_path: str, kind: str) -> str | None:
    """Basename of the active variant's file — the stable identity the index
    stores for ``active`` since #491 (a name isn't unique under collisions)."""
    return next((e["file"] for e in _list_for(model_path, kind) if e["active"]), None)


def _find(entries: list[dict], name: str, *, present_only: bool = True) -> dict | None:
    """The entry addressed by (unique) display ``name``, or ``None``."""
    return next(
        (e for e in entries if e["name"] == name and (not present_only or not e["missing"])),
        None,
    )


def _variant_path(model_path: str, kind: str, name: str) -> Path:
    p = Path(model_path)
    variant = None if name == DEFAULT_NAME else name
    return resolve_path(model_path, variant_filename(p.stem, _suffix(kind), variant))


def _resolved_path(model_path: str, file: str) -> Path:
    """Path to a sidecar by its on-disk basename — resolved through placement
    (lateral-first, dot-folder fallback; redirected for managed clones), used
    wherever an op must act on an *existing* file, since the basename (not the
    display name) is the variant's stable identity (#491)."""
    return resolve_path(model_path, file)


def _placeholder(kind: str, name: str) -> str:
    """Initial content for a freshly created variant — a valid-but-empty file
    so it's discovered (and a layout carries its self-describing name)."""
    if kind == LAYOUT_KIND:
        return json.dumps({"version": INDEX_VERSION, "positions": {}, "name": name}, indent=2) + "\n"
    return "{}\n"


def _rename_embedded_name(content: str, new_name: str) -> str:
    """Best-effort: update a JSON layout's embedded ``name`` after copy/rename
    so the file stays self-describing. Malformed content is left untouched."""
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return content
    if isinstance(data, dict):
        data["name"] = new_name
        return json.dumps(data, indent=2) + "\n"
    return content


def _persist_kind(model_path: str, kind: str, entries: list[dict], active: str | None) -> None:
    """Write this kind's slice of the index (order + active), preserving the
    other kind's slice."""
    idx = load_index(model_path) or {
        "layouts": [], "activeLayout": None, "settings": [], "activeSetting": None,
    }
    idx[_entries_key(kind)] = [
        {"name": e["name"], "file": e["file"], "order": i}
        for i, e in enumerate(entries)
    ]
    idx[_active_key(kind)] = active
    save_index(model_path, idx)


def set_active(model_path: str, kind: str, name: str) -> dict:
    """Mark the variant addressed by ``name`` active. Stored by file basename
    so the pointer stays valid even when two variants share a name (#491)."""
    _require_kind(kind)
    entries = _list_for(model_path, kind)
    match = _find(entries, name)
    if match is None:
        raise VariantError(f"No such {kind} variant: {name!r}")
    _persist_kind(model_path, kind, entries, match["file"])
    return list_sidecars(model_path)


def create_variant(model_path: str, kind: str, name: str) -> dict:
    """Create an empty named variant and make it active."""
    _require_kind(kind)
    if not is_valid_variant_name(name):
        raise VariantError(f"Invalid variant name: {name!r}")
    if any(e["name"] == name for e in _list_for(model_path, kind)):
        raise VariantError(f"{kind} variant already exists: {name!r}")
    path = _variant_path(model_path, kind, name)
    if path.exists():
        raise VariantError(f"{kind} file already exists: {path.name!r}")
    ensure_parent(path).write_text(_placeholder(kind, name))
    _persist_kind(model_path, kind, _list_for(model_path, kind), active=path.name)
    return list_sidecars(model_path)


def duplicate_variant(model_path: str, kind: str, name: str, new_name: str) -> dict:
    """Copy ``name``'s payload to a new ``new_name`` variant (active unchanged)."""
    _require_kind(kind)
    if not is_valid_variant_name(new_name):
        raise VariantError(f"Invalid variant name: {new_name!r}")
    entries = _list_for(model_path, kind)
    src = _find(entries, name)
    if src is None:
        raise VariantError(f"No such {kind} variant: {name!r}")
    if any(e["name"] == new_name for e in entries):
        raise VariantError(f"{kind} variant already exists: {new_name!r}")
    content = _resolved_path(model_path, src["file"]).read_text()
    if kind == LAYOUT_KIND:
        content = _rename_embedded_name(content, new_name)
    dest = _variant_path(model_path, kind, new_name)
    if dest.exists():
        raise VariantError(f"{kind} file already exists: {dest.name!r}")
    ensure_parent(dest).write_text(content)
    _persist_kind(model_path, kind, _list_for(model_path, kind), _active_file_for(model_path, kind))
    return list_sidecars(model_path)


def rename_variant(model_path: str, kind: str, name: str, new_name: str) -> dict:
    """Rename a named variant (the ``Default`` variant can't be renamed)."""
    _require_kind(kind)
    if name == DEFAULT_NAME:
        raise VariantError("Cannot rename the Default variant")
    if not is_valid_variant_name(new_name):
        raise VariantError(f"Invalid variant name: {new_name!r}")
    entries = _list_for(model_path, kind)
    match = _find(entries, name)
    if match is None:
        raise VariantError(f"No such {kind} variant: {name!r}")
    if any(e["name"] == new_name for e in entries):
        raise VariantError(f"{kind} variant already exists: {new_name!r}")
    # Capture active by file before the move — afterwards the old file is gone
    # and active resolution would have already fallen back off it.
    active = _active_file_for(model_path, kind)
    src = _resolved_path(model_path, match["file"])
    dest = _variant_path(model_path, kind, new_name)
    if dest.exists() and dest != src:
        raise VariantError(f"{kind} file already exists: {dest.name!r}")
    content = src.read_text()
    if kind == LAYOUT_KIND:
        content = _rename_embedded_name(content, new_name)
    ensure_parent(dest).write_text(content)
    src.unlink(missing_ok=True)
    if active == match["file"]:
        active = dest.name
    # Drop the old file's now-stale index entry (its file is gone).
    remaining = [e for e in _list_for(model_path, kind) if e["file"] != match["file"]]
    _persist_kind(model_path, kind, remaining, active)
    return list_sidecars(model_path)


def delete_variant(model_path: str, kind: str, name: str) -> dict:
    """Delete a variant: remove its file (if present) and drop it from the
    index. A missing (already-gone) entry is simply unlinked from the index."""
    _require_kind(kind)
    entries = _list_for(model_path, kind)
    match = _find(entries, name, present_only=False)
    if match is None:
        raise VariantError(f"No such {kind} variant: {name!r}")
    active = _active_file_for(model_path, kind)
    path = _resolved_path(model_path, match["file"])
    if path.exists():
        path.unlink()
    remaining = [e for e in _list_for(model_path, kind) if e["file"] != match["file"]]
    if active == match["file"]:
        active = None  # let _apply_active fall back to Default/first on next read
    _persist_kind(model_path, kind, remaining, active)
    return list_sidecars(model_path)


def reorder(model_path: str, kind: str, names: list[str]) -> dict:
    """Set the variant order for ``kind`` to ``names`` (a permutation of the
    model's current variant names)."""
    _require_kind(kind)
    entries = _list_for(model_path, kind)
    by_name = {e["name"]: e for e in entries}
    if set(names) != set(by_name):
        raise VariantError("reorder list must be a permutation of current variants")
    ordered = [by_name[n] for n in names]
    _persist_kind(model_path, kind, ordered, _active_file_for(model_path, kind))
    return list_sidecars(model_path)
