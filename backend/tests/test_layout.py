"""Tests for the sidecar layout file service."""

import json
import tempfile
import pytest
from pathlib import Path
from app.services.layout import (
    load_layout,
    save_layout,
    sidecar_path,
    stamp_demo_origin,
)


@pytest.fixture
def tmp_model():
    """Create a temporary .py file to test sidecar behavior."""
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write("# test model\n")
        f.flush()
        yield f.name
    Path(f.name).unlink(missing_ok=True)
    # Also clean up sidecar
    sidecar = Path(f.name).with_suffix(".pnlview.json")
    sidecar.unlink(missing_ok=True)


def test_sidecar_path_format(tmp_model):
    path = sidecar_path(tmp_model)
    assert str(path).endswith(".pnlview.json")
    assert path.stem.startswith(Path(tmp_model).stem.split(".")[0])


def test_load_layout_returns_none_when_no_sidecar(tmp_model):
    result = load_layout(tmp_model)
    assert result is None


def test_save_and_load_positions(tmp_model):
    positions = {
        "node_a": {"x": 100, "y": 200},
        "node_b": {"x": 300, "y": 400},
    }
    save_layout(tmp_model, positions)
    result = load_layout(tmp_model)
    assert result is not None
    assert result["version"] == 1
    assert result["positions"]["node_a"] == {"x": 100, "y": 200}
    assert result["positions"]["node_b"] == {"x": 300, "y": 400}


def test_save_and_load_with_viewport(tmp_model):
    positions = {"node_a": {"x": 50, "y": 60}}
    viewport = {"x": -10, "y": -20, "zoom": 1.5}
    save_layout(tmp_model, positions, viewport)
    result = load_layout(tmp_model)
    assert result["viewport"] == {"x": -10, "y": -20, "zoom": 1.5}


def test_save_overwrites_previous(tmp_model):
    save_layout(tmp_model, {"a": {"x": 1, "y": 2}})
    save_layout(tmp_model, {"b": {"x": 3, "y": 4}})
    result = load_layout(tmp_model)
    assert "a" not in result["positions"]
    assert result["positions"]["b"] == {"x": 3, "y": 4}


def test_flat_positions_kept_in_separate_namespace(tmp_model):
    # #719: a flat-view save must not clobber the nested `positions` map.
    save_layout(tmp_model, {"outer": {"x": 1, "y": 2}})
    save_layout(tmp_model, flat_positions={"inner": {"x": 5, "y": 6}})
    result = load_layout(tmp_model)
    assert result["positions"]["outer"] == {"x": 1, "y": 2}
    assert result["flatPositions"]["inner"] == {"x": 5, "y": 6}


def test_nested_save_preserves_flat_positions(tmp_model):
    # ...and the reverse: a nested save leaves the flat namespace intact.
    save_layout(tmp_model, flat_positions={"inner": {"x": 5, "y": 6}})
    save_layout(tmp_model, {"outer": {"x": 1, "y": 2}})
    result = load_layout(tmp_model)
    assert result["flatPositions"]["inner"] == {"x": 5, "y": 6}
    assert result["positions"]["outer"] == {"x": 1, "y": 2}


def test_sidecar_is_valid_json(tmp_model):
    save_layout(tmp_model, {"node": {"x": 0, "y": 0}})
    path = sidecar_path(tmp_model)
    data = json.loads(path.read_text())
    assert isinstance(data, dict)
    assert "version" in data
    assert "positions" in data


def test_load_layout_handles_corrupt_file(tmp_model):
    path = sidecar_path(tmp_model)
    path.write_text("not valid json {{{")
    result = load_layout(tmp_model)
    assert result is None


def test_stamp_demo_origin_writes_minimal_sidecar(tmp_model):
    stamp_demo_origin(tmp_model, "scheduling_demo")
    result = load_layout(tmp_model)
    assert result == {"version": 1, "demo_origin": "scheduling_demo"}


def test_save_layout_preserves_demo_origin(tmp_model):
    """Layout saves after a demo reset must keep the origin pointer alive."""
    stamp_demo_origin(tmp_model, "scheduling_demo")
    save_layout(tmp_model, {"node_a": {"x": 1, "y": 2}})
    result = load_layout(tmp_model)
    assert result["demo_origin"] == "scheduling_demo"
    assert result["positions"] == {"node_a": {"x": 1, "y": 2}}


def test_save_layout_no_origin_when_none_present(tmp_model):
    """Plain user models never gain a spurious demo_origin field."""
    save_layout(tmp_model, {"node_a": {"x": 1, "y": 2}})
    result = load_layout(tmp_model)
    assert "demo_origin" not in result


def test_sidecar_redirected_out_of_clone(monkeypatch, tmp_path):
    """Models inside a managed clone get their sidecar written out of tree,
    leaving the clone's working tree clean (#349)."""
    root = tmp_path / "clones"
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(root))
    model = root / "PsyNeuLink-owner" / "scripts" / "m.py"
    model.parent.mkdir(parents=True)
    model.write_text("# model\n")

    save_layout(str(model), {"node_a": {"x": 1, "y": 2}})

    # Nothing written next to the model inside the clone.
    assert not model.with_suffix(".pnlview.json").exists()
    # Sidecar lives out of tree and round-trips.
    assert sidecar_path(str(model)).exists()
    assert load_layout(str(model))["positions"]["node_a"] == {"x": 1, "y": 2}


def test_port_positions_round_trip(tmp_model):
    """#282: dragged-port angular overrides persist in their own namespace."""
    ports = {"color_input": {"OutputPort-0": 1.57}, "decision": {"InputPort-0": -0.3}}
    save_layout(tmp_model, port_positions=ports)
    loaded = load_layout(tmp_model)
    assert loaded["portPositions"] == ports


def test_port_positions_preserved_across_position_save(tmp_model):
    """A later node-position save must not drop existing port overrides."""
    save_layout(tmp_model, port_positions={"n": {"p": 0.5}})
    save_layout(tmp_model, positions={"n": {"x": 1, "y": 2}})  # different namespace
    loaded = load_layout(tmp_model)
    assert loaded["portPositions"] == {"n": {"p": 0.5}}
    assert loaded["positions"] == {"n": {"x": 1, "y": 2}}


def test_value_views_round_trip(tmp_model):
    """#1387: how each node's values are shown (list or grid) persists."""
    views = {"hopfield": {"as": "grid", "width": 5}}
    save_layout(tmp_model, value_views=views)
    assert load_layout(tmp_model)["valueViews"] == views


def test_value_views_preserved_across_other_saves(tmp_model):
    """A position or port save must not drop the value views, nor they those."""
    save_layout(tmp_model, value_views={"n": {"as": "grid", "width": 3}})
    save_layout(tmp_model, positions={"n": {"x": 1, "y": 2}})
    save_layout(tmp_model, port_positions={"n": {"p": 0.5}})
    loaded = load_layout(tmp_model)
    assert loaded["valueViews"] == {"n": {"as": "grid", "width": 3}}
    assert loaded["positions"] == {"n": {"x": 1, "y": 2}}
    assert loaded["portPositions"] == {"n": {"p": 0.5}}
