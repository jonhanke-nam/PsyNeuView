"""Read/write ``.pnlproject`` bundles and manage their working directories.

A ``.pnlproject`` is a zip with a ``manifest.json`` inventory plus the model
source, an optional layout sidecar, an optional MDF mirror, and reserved
slots for weights / run data. See ``docs/file-handling.md`` for the spec.

The functions here are deliberately pure file/zip operations. MDF generation
(which needs the sandbox) is orchestrated by the route layer and the rendered
text is handed in via ``mdf_text``.
"""

from __future__ import annotations

import hashlib
import json
import os
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from app.services.layout import load_layout, save_layout, sidecar_path

# Bumped from "1.0": adds the named ``runData`` / ``mdf`` manifest slots and a
# documented round-trip contract. v1 bundles still load (missing fields are
# tolerated on read).
BUNDLE_FORMAT_VERSION = "2.0"

# Zip member names (stable inside the archive regardless of model name).
_SOURCE_MEMBER = "model.py"
_LAYOUT_MEMBER = "layout.json"
_MANIFEST_MEMBER = "manifest.json"


def bundles_root() -> Path:
    """Where opened bundles are extracted to work on. Overridable via
    ``PSYNEUVIEW_BUNDLES_ROOT`` so tests don't touch the real home dir."""
    override = os.environ.get("PSYNEUVIEW_BUNDLES_ROOT")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".psyneuview" / "bundles"


def working_dir_for(bundle_path: str | Path) -> Path:
    """Deterministic working directory for a given bundle path, so reopening
    the same ``.pnlproject`` reuses (and refreshes) the same extract location.

    Named ``<stem>-<hash8>`` where the hash is over the absolute bundle path —
    keeps the directory human-readable while avoiding collisions between
    same-named bundles in different folders.
    """
    p = Path(bundle_path)
    digest = hashlib.sha1(str(p.resolve()).encode("utf-8")).hexdigest()[:8]
    return bundles_root() / f"{p.stem}-{digest}"


def _read_manifest(zf: zipfile.ZipFile) -> dict:
    if _MANIFEST_MEMBER not in zf.namelist():
        raise ValueError("missing manifest.json")
    return json.loads(zf.read(_MANIFEST_MEMBER))


def build_manifest(
    *,
    model_name: str,
    pnl_version: str,
    has_layout: bool,
    has_mdf: bool,
    description: str = "",
    created: str | None = None,
) -> dict:
    """Assemble a v2 manifest. ``weights`` / ``runData`` are reserved slots
    (declared so readers know the shape, not yet populated)."""
    now = datetime.now(timezone.utc).isoformat()
    return {
        "formatVersion": BUNDLE_FORMAT_VERSION,
        "psyneulink": pnl_version,
        "model": {"name": model_name, "description": description},
        "created": created or now,
        "modified": now,
        "files": {
            "source": _SOURCE_MEMBER,
            "layout": _LAYOUT_MEMBER if has_layout else None,
            "weights": [],
            "runData": None,
            "mdf": f"{model_name}.mdf.yaml" if has_mdf else None,
        },
    }


def build_bundle_bytes(
    source_py_path: str | Path,
    *,
    model_name: str,
    pnl_version: str,
    mdf_text: str | None = None,
    description: str = "",
    created: str | None = None,
) -> tuple[bytes, dict]:
    """Build a ``.pnlproject`` zip in memory from a working ``.py`` and its
    layout sidecar (+ optional MDF mirror). Returns ``(zip_bytes, manifest)``.

    The layout is read from the working file's ``.pnlview.json`` sidecar so a
    save-back captures whatever the user has dragged since opening.
    """
    import io

    source = Path(source_py_path).read_text()
    layout_data = load_layout(str(source_py_path))
    mdf_member = f"{model_name}.mdf.yaml" if mdf_text else None

    manifest = build_manifest(
        model_name=model_name,
        pnl_version=pnl_version,
        has_layout=layout_data is not None,
        has_mdf=mdf_member is not None,
        description=description,
        created=created,
    )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(_MANIFEST_MEMBER, json.dumps(manifest, indent=2))
        zf.writestr(_SOURCE_MEMBER, source)
        if layout_data is not None:
            zf.writestr(_LAYOUT_MEMBER, json.dumps(layout_data, indent=2))
        if mdf_member:
            zf.writestr(mdf_member, mdf_text)
    return buf.getvalue(), manifest


def write_bundle(
    bundle_path: str | Path,
    source_py_path: str | Path,
    *,
    model_name: str,
    pnl_version: str,
    mdf_text: str | None = None,
    description: str = "",
    created: str | None = None,
) -> dict:
    """Write a ``.pnlproject`` to ``bundle_path`` atomically. Returns the
    manifest written."""
    bundle_path = Path(bundle_path)
    data, manifest = build_bundle_bytes(
        source_py_path,
        model_name=model_name,
        pnl_version=pnl_version,
        mdf_text=mdf_text,
        description=description,
        created=created,
    )
    bundle_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = bundle_path.with_suffix(bundle_path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, bundle_path)
    return manifest


def extract_bundle(bundle_path: str | Path) -> dict:
    """Extract a bundle into its deterministic working directory and return
    ``{working_py_path, manifest, source}``. The layout sidecar is written
    next to the working ``.py`` so the rest of the app treats it like any
    on-disk model.

    Raises ``ValueError`` for a structurally invalid bundle.
    """
    bundle_path = Path(bundle_path)
    try:
        with zipfile.ZipFile(bundle_path, "r") as zf:
            manifest = _read_manifest(zf)
            source_member = manifest.get("files", {}).get("source", _SOURCE_MEMBER)
            if source_member not in zf.namelist():
                raise ValueError(f"missing {source_member}")
            source = zf.read(source_member).decode("utf-8")

            layout_member = manifest.get("files", {}).get("layout")
            layout_data = None
            if layout_member and layout_member in zf.namelist():
                layout_data = json.loads(zf.read(layout_member))
    except zipfile.BadZipFile as e:
        raise ValueError("not a valid zip file") from e

    model_name = manifest.get("model", {}).get("name") or bundle_path.stem
    work = working_dir_for(bundle_path)
    work.mkdir(parents=True, exist_ok=True)
    working_py = work / f"{model_name}.py"
    working_py.write_text(source)

    if layout_data is not None:
        save_layout(
            str(working_py),
            layout_data.get("positions", {}),
            layout_data.get("viewport"),
        )
    else:
        # Clear any stale sidecar from a previous open of this bundle.
        stale = sidecar_path(str(working_py))
        if stale.exists():
            stale.unlink()

    # Persist the manifest in the working dir so save-back can preserve
    # ``created`` and the description without re-reading the zip.
    (work / _MANIFEST_MEMBER).write_text(json.dumps(manifest, indent=2))

    return {
        "working_py_path": str(working_py),
        "manifest": manifest,
        "source": source,
    }


def working_manifest(working_py_path: str | Path) -> dict | None:
    """Read the manifest cached alongside an extracted working file, if any."""
    manifest_file = Path(working_py_path).parent / _MANIFEST_MEMBER
    if not manifest_file.exists():
        return None
    try:
        return json.loads(manifest_file.read_text())
    except (json.JSONDecodeError, OSError):
        return None
