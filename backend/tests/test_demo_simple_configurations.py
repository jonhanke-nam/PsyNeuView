"""The Simple Configurations demo computes what PsyNeuLink Tutorials lesson 7 says (#9).

The demo is the Basics and Primer's 5-2-5 network, made from a pathway list
with no projection written. The walkthrough says PsyNeuLink adds a
MappingProjection between each pair, sized 5 by 2 and 2 by 5 and full of 1s;
that the Primer's input [1, 4.7, 3.2, 6, 2] gives 0.881 on every output; that
all zeros give 0.5 on both hidden units and 0.731 on every output; and that a
matrix written into the pathway list makes the two hidden units differ. This
pins those numbers, so a PsyNeuLink change fails here by name.
"""

import shutil
from pathlib import Path

import numpy as np
import pytest

from app.services.executor import run_model
from app.services.introspector import load_and_introspect
from app.services.model_dirs import _format_label

DEMO = Path(__file__).parent.parent / "demos" / "simple_configurations.py"
PRIMER_INPUT = [[1, 4.7, 3.2, 6, 2]]
PATHWAY = "[[input_layer, hidden_layer, output_layer]]"
WITH_MATRIX = "[[input_layer, [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]], hidden_layer, output_layer]]"


def _run(path, rows):
    result = run_model(str(path), "my_network", {"Input": rows}, use_sandbox=False)
    assert "error" not in result, result
    logs = {name.split("-")[0]: np.asarray(log["values"][0], dtype=float).ravel() for name, log in result["logs"].items()}
    return logs["hidden"], logs["output"]


def test_the_menu_calls_it_simple_configurations():
    # The walkthrough opens it by this label.
    assert _format_label(DEMO.stem) == "Simple Configurations"


def test_no_projection_is_written_in_the_file():
    code = DEMO.read_text().split("# Mechanisms", 1)[1]
    assert "MappingProjection(" not in code
    assert PATHWAY in code


def test_the_pathway_makes_two_full_projections_of_ones():
    comp = load_and_introspect(str(DEMO))["compositions"][0]
    shapes = {n["name"]: n["inputPorts"][0]["shape"] for n in comp["nodes"]}
    assert shapes == {"Input": [5], "hidden": [2], "output": [5]}
    matrices = {
        (p["sender"]["mechanism"], p["receiver"]["mechanism"]): p["params"]["matrix"]["value"]
        for p in comp["projections"]
    }
    assert matrices == {
        ("Input", "hidden"): [[1.0, 1.0]] * 5,
        ("hidden", "output"): [[1.0] * 5] * 2,
    }
    names = {p["name"] for p in comp["projections"]}
    assert "MappingProjection from Input[OutputPort-0] to hidden[InputPort-0]" in names


def test_the_primers_input_gives_0_881_on_every_output():
    hidden, output = _run(DEMO, PRIMER_INPUT)
    # Each hidden unit gets the sum, 16.9: Logistic(16.9) is 1 to 7 places.
    assert hidden == pytest.approx([1.0, 1.0], abs=1e-7)
    # Each output unit gets 1 + 1 = 2: Logistic(2).
    assert output == pytest.approx([0.8807971] * 5, abs=1e-7)


def test_all_zeros_give_one_half_then_0_731():
    hidden, output = _run(DEMO, [[0, 0, 0, 0, 0]])
    assert hidden == pytest.approx([0.5, 0.5])
    assert output == pytest.approx([0.7310586] * 5, abs=1e-7)


@pytest.fixture
def with_matrix(tmp_path):
    path = tmp_path / DEMO.name
    shutil.copy(DEMO, path)
    path.write_text(path.read_text().replace(PATHWAY, WITH_MATRIX))
    return path


def test_a_matrix_in_the_pathway_becomes_the_first_projection(with_matrix):
    comp = load_and_introspect(str(with_matrix))["compositions"][0]
    matrices = {
        (p["sender"]["mechanism"], p["receiver"]["mechanism"]): p["params"]["matrix"]["value"]
        for p in comp["projections"]
    }
    assert matrices[("Input", "hidden")] == [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]]
    assert matrices[("hidden", "output")] == [[1.0] * 5] * 2


def test_with_the_matrix_the_hidden_units_differ(with_matrix):
    hidden, output = _run(with_matrix, PRIMER_INPUT)
    # 1 - 4.7 = -3.7 and 3.2 - 6 = -2.8.
    assert hidden == pytest.approx([0.0241270, 0.0573242], abs=1e-6)
    assert output == pytest.approx([0.5203515] * 5, abs=1e-6)
