"""Manage sidecar .pnlview.json files for GUI layout metadata.

Each .py model file can have a companion <model>.pnlview.json that stores
node positions, viewport state, and other GUI-only metadata. A model may also
carry named layout variants <model>.<name>.pnlview.json (#479); pass
``variant`` to address one — ``None``/``"Default"`` is the unsuffixed file.
"""

import json
from pathlib import Path

from app.services.sidecar_index import DEFAULT_NAME, variant_filename
from app.services.sidecar_placement import ensure_parent, resolve_path

SIDECAR_VERSION = 1
LAYOUT_SUFFIX = ".pnlview.json"


def sidecar_path(model_path: str, variant: str | None = None) -> Path:
    """Get the sidecar file path for a model (optionally a named variant).

    Resolved through :mod:`sidecar_placement`: lateral next to the ``.py`` when a
    lateral file exists, else the hidden ``.psyneuview/`` dot-folder (#927), and
    redirected out of tree when the model lives inside a managed clone (#349).
    """
    p = Path(model_path)
    return resolve_path(model_path, variant_filename(p.stem, LAYOUT_SUFFIX, variant))


def load_layout(model_path: str, variant: str | None = None) -> dict | None:
    """Load layout metadata from the sidecar file, if it exists."""
    path = sidecar_path(model_path, variant)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
        return data
    except (json.JSONDecodeError, OSError):
        return None


def save_layout(
    model_path: str,
    positions: dict | None = None,
    viewport: dict | None = None,
    variant: str | None = None,
    flat_positions: dict | None = None,
    port_positions: dict | None = None,
    edge_routes: dict | None = None,
    flat_edge_routes: dict | None = None,
    edit_lock: str | None = None,
    value_views: dict | None = None,
) -> None:
    """Save layout metadata to the sidecar file.

    Args:
        model_path: Path to the .py model file.
        positions: Dict of {node_name: {x, y}} positions for the per-composition
            (nested) view. Pass ``None`` to leave the saved nested positions
            untouched.
        viewport: Optional {x, y, zoom} viewport state.
        variant: Optional named variant; ``None`` writes the default sidecar.
        flat_positions: Dict of {node_name: {x, y}} positions for the flat /
            PyTorch (clustered) view (#719). Stored in a separate namespace so
            its frame-relative coordinates never collide with the nested view's.
            Pass ``None`` to leave the saved flat positions untouched.
        edit_lock: ``"viewOnly"`` to mark the model view-only, ``""`` to clear
            the mark, ``None`` to leave it as it is (#1116).
        value_views: Dict of {node_name: {"as": "list" | "grid", "width": n}},
            how each node's values are shown in Run results, Run State and the
            value pill (#1387). Pass ``None`` to leave them untouched.
    """
    path = sidecar_path(model_path, variant)
    existing = load_layout(model_path, variant) or {}
    data: dict = {"version": SIDECAR_VERSION}
    # Carry forward both position namespaces; the caller updates only the one it
    # passes, so a flat-view save never clobbers nested positions and vice versa.
    if "positions" in existing:
        data["positions"] = existing["positions"]
    if "flatPositions" in existing:
        data["flatPositions"] = existing["flatPositions"]
    # #282: per-node/per-port angular placement overrides (dragged ports). Keyed
    # by node varName (like positions) → {port_name: angle_rad}. View-independent
    # (a port's angle on its oval doesn't depend on the node's placement).
    if "portPositions" in existing:
        data["portPositions"] = existing["portPositions"]
    # #1162: per-edge routing the user shaped by hand — waypoints the edge is
    # dragged through, and per-edge attachment angles. Keyed by endpoint rather
    # than by projection name, so renaming a projection does not lose its shape.
    # Same namespacing as positions: the flat view's coordinates are frame
    # relative and must not clobber the nested view's.
    if "edgeRoutes" in existing:
        data["edgeRoutes"] = existing["edgeRoutes"]
    if "flatEdgeRoutes" in existing:
        data["flatEdgeRoutes"] = existing["flatEdgeRoutes"]
    if existing.get("viewport"):
        data["viewport"] = existing["viewport"]
    # Preserve demo_origin (set by /demos/reset, issue #40) so the
    # "Reset to Demo" affordance survives subsequent layout saves.
    if "demo_origin" in existing:
        data["demo_origin"] = existing["demo_origin"]
    # Preserve the view-only lock (#1116) for the same reason. This function
    # rebuilds the sidecar from a whitelist, so a key that is not carried
    # forward here is silently dropped — and a lock that vanishes the first
    # time someone drags a node is worse than no lock at all.
    if "editLock" in existing:
        data["editLock"] = existing["editLock"]
    # #1387: per-node value display (as a list, or as a grid of a given width).
    # View-independent, like portPositions.
    if "valueViews" in existing:
        data["valueViews"] = existing["valueViews"]

    if positions is not None:
        data["positions"] = positions
    if flat_positions is not None:
        data["flatPositions"] = flat_positions
    if port_positions is not None:
        data["portPositions"] = port_positions
    if edge_routes is not None:
        data["edgeRoutes"] = edge_routes
    if flat_edge_routes is not None:
        data["flatEdgeRoutes"] = flat_edge_routes
    if value_views is not None:
        data["valueViews"] = value_views
    if viewport:
        data["viewport"] = viewport
    if edit_lock is not None:
        # "" clears it; any other value sets it.
        if edit_lock:
            data["editLock"] = edit_lock
        else:
            data.pop("editLock", None)
    # A named variant carries its own name so a shared file is self-describing
    # (#479); the default sidecar stays minimal (and exact, for #40 callers).
    if variant is not None and variant != DEFAULT_NAME:
        data["name"] = variant
    ensure_parent(path).write_text(json.dumps(data, indent=2) + "\n")


def stamp_demo_origin(model_path: str, demo_name: str) -> None:
    """Mark a working copy as derived from a named demo (issue #40).

    Called by /demos/reset after copying the pristine source. Writes a fresh
    sidecar containing only the origin pointer — layout positions are reset
    alongside the source, but the origin survives so the user can find their
    way back to "Reset to Demo" after closing and re-opening the file.
    """
    path = sidecar_path(model_path)
    data = {"version": SIDECAR_VERSION, "demo_origin": demo_name}
    ensure_parent(path).write_text(json.dumps(data, indent=2) + "\n")
