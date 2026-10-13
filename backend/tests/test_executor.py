"""Tests for the executor service."""

import pytest
from pathlib import Path
from app.services.executor import run_model, get_input_nodes
from tests.conftest import clean_name

TEST_MODEL = str(Path(__file__).parent.parent / "test_model.py")
EGO_MODEL = str(
    Path(__file__).parent.parent / "reference_models" / "Giallanza2024_ego_study2.py"
)


def test_get_input_nodes():
    result = get_input_nodes(TEST_MODEL, "stroop_model", use_sandbox=False)
    assert "inputNodes" in result
    names = [n["varName"] for n in result["inputNodes"]]
    assert "colors_input" in names
    assert "words_input" in names
    assert "response" not in names


def test_input_nodes_have_shapes():
    result = get_input_nodes(TEST_MODEL, "stroop_model", use_sandbox=False)
    for node in result["inputNodes"]:
        assert "shape" in node
        assert len(node["shape"]) > 0


def test_input_nodes_skip_bias_on_ego():
    """EGO has a BIAS node; input detection must surface STATE, not [BIAS] (#363).

    The old 'no incoming projection' heuristic returned only ``CONTEXT [BIAS]``
    because the real input (``STATE``) receives a projection from the learning
    machinery. NodeRole.INPUT classifies it correctly.
    """
    result = get_input_nodes(EGO_MODEL, "EGO_comp", use_sandbox=False)
    assert "error" not in result, result
    # Normalize PsyNeuLink's -N instance suffix: EGO is constructed many times
    # across the suite in one process, so STATE arrives as e.g. "STATE-8".
    names = [clean_name(n["name"]) for n in result["inputNodes"]]
    assert "STATE" in names
    assert "CONTEXT [BIAS]" not in names


def test_run_autodiff_ego_via_learn():
    """EGO is an AutodiffComposition; the executor must drive it via .learn()
    in PyTorch mode (plain .run() fails inside the EM machinery, #363)."""
    states = [[float(j == i) for j in range(10)] for i in (8, 0, 2, 4, 6)]
    result = run_model(EGO_MODEL, "EGO_comp", {"STATE": states}, use_sandbox=False)
    assert "error" not in result, result
    assert result["numTrials"] == len(states)
    flat = [v for trial in result["results"] for row in trial["output"] for v in _flat(row)]
    assert flat, "expected non-empty results"
    assert all(isinstance(v, float) for v in flat)


def test_run_ego_via_introspector_handle():
    """The Run panel keys inputs by the introspector's varName handle, not the
    node's PNL name. For EGO that handle is ``state_input_layer`` (the
    function-local var behind ``name=STATE``); the run path must resolve it (#572)."""
    states = [[float(j == i) for j in range(10)] for i in (8, 0, 2, 4, 6)]
    result = run_model(
        EGO_MODEL, "EGO_comp", {"state_input_layer": states}, use_sandbox=False
    )
    assert "error" not in result, result
    assert result["numTrials"] == len(states)


def _flat(x):
    if isinstance(x, list):
        out = []
        for v in x:
            out.extend(_flat(v))
        return out
    return [x]


def test_run_model_basic():
    inputs = {
        "colors_input": [[1.0, 0.0, 0.0]],
        "words_input": [[0.0, 0.0, 1.0]],
    }
    result = run_model(TEST_MODEL, "stroop_model", inputs, use_sandbox=False)
    assert "error" not in result
    assert "results" in result
    assert result["numTrials"] == 1
    assert len(result["results"]) == 1


def test_run_model_multiple_trials():
    inputs = {
        "colors_input": [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        "words_input": [[0.0, 0.0, 1.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]],
    }
    result = run_model(TEST_MODEL, "stroop_model", inputs, use_sandbox=False)
    assert "error" not in result
    assert result["numTrials"] == 3
    assert len(result["results"]) == 3


def test_run_model_has_logs():
    inputs = {
        "colors_input": [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
        "words_input": [[0.0, 0.0, 1.0], [0.0, 1.0, 0.0]],
    }
    result = run_model(TEST_MODEL, "stroop_model", inputs, use_sandbox=False)
    assert "logs" in result
    assert len(result["logs"]) > 0
    # Node names may have -N suffix
    log_base_names = [clean_name(n) for n in result["logs"]]
    assert "colors_input" in log_base_names
    assert "response" in log_base_names


def test_run_model_results_are_numeric():
    inputs = {
        "colors_input": [[1.0, 2.0, 3.0]],
        "words_input": [[0.5, 0.5, 0.5]],
    }
    result = run_model(TEST_MODEL, "stroop_model", inputs, use_sandbox=False)
    trial = result["results"][0]
    assert trial["trial"] == 0
    assert isinstance(trial["output"], list)
    assert all(isinstance(v, float) for row in trial["output"] for v in row)


def test_run_model_invalid_composition():
    result = run_model(TEST_MODEL, "nonexistent_comp", {}, use_sandbox=False)
    assert "error" in result


def test_run_model_invalid_input_node():
    inputs = {"nonexistent_node": [[1.0, 0.0, 0.0]]}
    result = run_model(TEST_MODEL, "stroop_model", inputs, use_sandbox=False)
    assert "error" in result
