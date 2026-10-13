"""Tests for the introspector service."""

import pytest
from pathlib import Path
from app.services.introspector import load_and_introspect, _load_and_introspect_inprocess
from tests.conftest import clean_name, find_node, find_projection

TEST_MODEL = str(Path(__file__).parent.parent / "test_model.py")


def test_load_and_introspect_returns_compositions():
    result = load_and_introspect(TEST_MODEL, use_sandbox=False)
    assert "compositions" in result
    assert len(result["compositions"]) == 1


def test_composition_has_correct_name():
    result = load_and_introspect(TEST_MODEL, use_sandbox=False)
    comp = result["compositions"][0]
    assert clean_name(comp["name"]) == "stroop_model"
    assert comp["varName"] == "stroop_model"
    assert comp["kind"] == "composition"


def test_composition_has_correct_nodes():
    result = load_and_introspect(TEST_MODEL, use_sandbox=False)
    comp = result["compositions"][0]
    names = [clean_name(n["name"]) for n in comp["nodes"]]
    assert "colors_input" in names
    assert "words_input" in names
    assert "response" in names
    assert len(comp["nodes"]) == 3


def test_mechanism_has_type_and_function():
    result = load_and_introspect(TEST_MODEL, use_sandbox=False)
    comp = result["compositions"][0]
    response = find_node(comp["nodes"], "response")
    assert response["type"] == "TransferMechanism"
    assert response["kind"] == "mechanism"
    assert response["function"]["type"] == "Logistic"


def test_mechanism_has_real_params():
    result = load_and_introspect(TEST_MODEL, use_sandbox=False)
    comp = result["compositions"][0]
    response = find_node(comp["nodes"], "response")
    assert "noise" in response["params"]
    assert "integration_rate" in response["params"]
    assert "gain" in response["function"]["params"]


def test_mechanism_has_ports():
    result = load_and_introspect(TEST_MODEL, use_sandbox=False)
    comp = result["compositions"][0]
    colors = find_node(comp["nodes"], "colors_input")
    assert len(colors["inputPorts"]) >= 1
    assert len(colors["outputPorts"]) >= 1
    assert colors["inputPorts"][0]["shape"] == [3]


def test_mechanism_has_parameter_ports():
    """Parameter ports surface in the serialized payload so the frontend
    can render parameter port dots (issue #184)."""
    result = load_and_introspect(TEST_MODEL, use_sandbox=False)
    comp = result["compositions"][0]
    colors = find_node(comp["nodes"], "colors_input")
    assert "parameterPorts" in colors
    # Any TransferMechanism with a Linear function exposes at least the
    # function's slope/intercept parameters as parameter_ports.
    assert len(colors["parameterPorts"]) >= 1
    names = {p["name"] for p in colors["parameterPorts"]}
    assert {"slope", "intercept"}.issubset(names)


def test_projections_are_correct():
    result = load_and_introspect(TEST_MODEL, use_sandbox=False)
    comp = result["compositions"][0]
    proj_names = [clean_name(p["name"]) for p in comp["projections"]]
    assert "colors_to_response" in proj_names
    assert "words_to_response" in proj_names
    assert len(comp["projections"]) == 2


def test_projection_has_sender_receiver():
    result = load_and_introspect(TEST_MODEL, use_sandbox=False)
    comp = result["compositions"][0]
    proj = find_projection(comp["projections"], "colors_to_response")
    assert clean_name(proj["sender"]["mechanism"]) == "colors_input"
    assert clean_name(proj["receiver"]["mechanism"]) == "response"
    assert proj["type"] == "MappingProjection"


def test_line_map_is_populated():
    result = load_and_introspect(TEST_MODEL, use_sandbox=False)
    line_map = result["lineMap"]
    assert "colors_input" in line_map
    assert "words_input" in line_map
    assert "response" in line_map
    assert "stroop_model" in line_map
    assert all(isinstance(v, int) and v > 0 for v in line_map.values())


# ── function-scoped handle synthesis (#422) ─────────────────────────────

FUNC_SCOPE_MODEL = str(
    Path(__file__).parent / "fixtures" / "function_scope_composition.py"
)


def test_function_scoped_nodes_get_handles():
    """Nodes built inside a function but exposed via a module-level
    composition still resolve a varName + line, so the GUI can edit them.
    The handle is recovered from the `name=` kwarg — both a literal
    ('hidden_layer') and a module constant (STIMULUS='stimulus')."""
    result = load_and_introspect(FUNC_SCOPE_MODEL, use_sandbox=False)
    comp = result["compositions"][0]

    stim = find_node(comp["nodes"], "stimulus")
    assert stim["varName"] == "stim"
    assert stim["line"] == 12

    hidden = find_node(comp["nodes"], "hidden_layer")
    assert hidden["varName"] == "hidden"
    assert hidden["line"] == 16


# ── developer_mode flag (#273 / #249) ───────────────────────────────────


def _script_that_records_run(tmp_path):
    """A tiny model whose module body calls .run() and writes a sentinel
    file when run actually executes. Lets us assert from outside the
    process whether the run was noop'd or not."""
    sentinel = tmp_path / "ran.flag"
    script = tmp_path / "ran.py"
    script.write_text(
        f"""
import psyneulink as pnl

input_node = pnl.TransferMechanism(name='input_node')
output_node = pnl.TransferMechanism(name='output_node')
my_model = pnl.Composition(name='my_model')
my_model.add_node(input_node)
my_model.add_node(output_node)
my_model.add_projection(pnl.MappingProjection(sender=input_node, receiver=output_node))

result = my_model.run(inputs={{input_node: [[1.0]]}})
if result is not None:
    open(r"{sentinel}", "w").write("ran")
"""
    )
    return script, sentinel


def test_developer_mode_false_skips_run(tmp_path):
    """Default behavior: Composition.run is patched to a no-op, so the
    sentinel from the run-only block is never written. The graph still
    introspects normally."""
    script, sentinel = _script_that_records_run(tmp_path)
    result = load_and_introspect(str(script), use_sandbox=False)
    assert not sentinel.exists()
    assert len(result["compositions"]) == 1


def test_developer_mode_true_actually_runs(tmp_path):
    """With developer_mode=True the patch is skipped — Composition.run
    fires for real and the sentinel gets written. The graph still
    introspects in the same call."""
    script, sentinel = _script_that_records_run(tmp_path)
    result = load_and_introspect(str(script), use_sandbox=False, developer_mode=True)
    assert sentinel.exists(), "Composition.run should have actually executed"
    assert len(result["compositions"]) == 1


def test_developer_mode_restores_patched_methods(tmp_path):
    """After a dev-mode load, the Composition class methods must be back to
    normal — otherwise a follow-up non-dev-mode load would leak state.
    (Currently the in-process path doesn't patch under dev mode, but we
    still want the regular path to leave no residue.)"""
    import psyneulink as pnl
    script, _ = _script_that_records_run(tmp_path)

    pristine_run = pnl.Composition.run
    load_and_introspect(str(script), use_sandbox=False, developer_mode=False)
    assert pnl.Composition.run is pristine_run
    load_and_introspect(str(script), use_sandbox=False, developer_mode=True)
    assert pnl.Composition.run is pristine_run
