"""Hand-shaped edges must survive a reload (#1162).

Waypoints and per-edge attachment angles are work the user did — the same
category as dragging a node, and until now the only one the sidecar dropped.
The store said as much: "session-scoped for now".

These cover the sidecar contract. The rule that matters is the one every other
key in this file already follows: a save that touches one namespace must not
clobber another, because the flat and nested views are saved independently and
a round trip between them would otherwise lose whichever was not last written.
"""

from pathlib import Path

from app.services.layout import load_layout, save_layout

ROUTE = {"a|out|b|in": {"waypoints": [{"x": 10, "y": 20}], "ends": {"s": 1.5}}}
OTHER = {"b|out|c|in": {"waypoints": [{"x": 1, "y": 2}]}}


def _model(tmp_path: Path) -> Path:
    p = tmp_path / "model.py"
    p.write_text("x = 1\n")
    return p


def test_edge_routes_round_trip(tmp_path):
    p = _model(tmp_path)
    save_layout(str(p), {"a": {"x": 0, "y": 0}}, edge_routes=ROUTE)
    assert load_layout(str(p))["edgeRoutes"] == ROUTE


def test_saving_positions_does_not_drop_routes(tmp_path):
    """A node drag must not wipe the shaping of every edge."""
    p = _model(tmp_path)
    save_layout(str(p), None, edge_routes=ROUTE)
    save_layout(str(p), {"a": {"x": 5, "y": 5}})

    assert load_layout(str(p))["edgeRoutes"] == ROUTE


def test_flat_and_nested_routes_are_separate(tmp_path):
    p = _model(tmp_path)
    save_layout(str(p), None, edge_routes=ROUTE)
    save_layout(str(p), None, flat_edge_routes=OTHER)

    saved = load_layout(str(p))
    assert saved["edgeRoutes"] == ROUTE
    assert saved["flatEdgeRoutes"] == OTHER


def test_routes_survive_a_port_position_save(tmp_path):
    p = _model(tmp_path)
    save_layout(str(p), None, edge_routes=ROUTE)
    save_layout(str(p), None, port_positions={"a": {"out": 0.5}})

    saved = load_layout(str(p))
    assert saved["edgeRoutes"] == ROUTE
    assert saved["portPositions"] == {"a": {"out": 0.5}}


def test_omitting_routes_leaves_them_untouched(tmp_path):
    """None means "no opinion", not "clear" — as for every other namespace."""
    p = _model(tmp_path)
    save_layout(str(p), None, edge_routes=ROUTE)
    save_layout(str(p), None, edge_routes=None)

    assert load_layout(str(p))["edgeRoutes"] == ROUTE


def test_routes_can_be_cleared_explicitly(tmp_path):
    """"Reset route" on every edge must be able to leave nothing behind."""
    p = _model(tmp_path)
    save_layout(str(p), None, edge_routes=ROUTE)
    save_layout(str(p), None, edge_routes={})

    assert load_layout(str(p))["edgeRoutes"] == {}
