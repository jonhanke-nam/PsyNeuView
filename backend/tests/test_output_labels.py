"""Run responses carry a friendly label per output vector (#632).

Each row of ``comp.results`` is the ``output_CIM`` port values in port order;
``outputLabels`` names each one by its source node (prefixed with the containing
composition when nested). Covers the normal scheduler path, the autodiff path,
and the nested-composition case (EGO's EM retrievals).
"""

from pathlib import Path

import pytest

pytest.importorskip("psyneulink")

from app.services.executor import run_model

STROOP = str(Path(__file__).parent.parent / "test_model.py")
FEEDFORWARD = str(Path(__file__).parent.parent / "demos" / "autodiff_feedforward.py")
EGO = str(Path(__file__).parent.parent / "reference_models" / "Giallanza2024_ego_study2.py")


def test_labels_parallel_output_vectors_normal_path():
    r = run_model(
        STROOP,
        "stroop_model",
        {"colors_input": [[1.0, 0.0, 0.0]], "words_input": [[0.0, 0.0, 1.0]]},
        use_sandbox=False,
    )
    assert "error" not in r, r
    labels = r["outputLabels"]
    # One label per output vector, named by the single OUTPUT node.
    assert labels == ["response"]
    assert len(labels) == len(r["results"][0]["output"])


def test_labels_autodiff_single_output():
    pytest.importorskip("torch")
    r = run_model(
        FEEDFORWARD, "autodiff_comp", {"input_layer": [[1.0, 0.0], [0.0, 1.0]]}, use_sandbox=False
    )
    assert "error" not in r, r
    assert r["outputLabels"] == ["output_layer"]


def test_labels_nested_composition_ego():
    """EGO has 3 output vectors: two EM-internal retrievals (prefixed by the
    nested composition name) and the top-level PREDICTION."""
    pytest.importorskip("torch")
    states = [
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    ]
    r = run_model(EGO, "EGO_comp", {"state_input_layer": states}, use_sandbox=False)
    assert "error" not in r, r
    labels = r["outputLabels"]
    assert labels == [
        "EM: PREVIOUS STATE [RETRIEVED]",
        "EM: CONTEXT [RETRIEVED]",
        "PREDICTION",
    ]
    assert len(labels) == len(r["results"][0]["output"])
