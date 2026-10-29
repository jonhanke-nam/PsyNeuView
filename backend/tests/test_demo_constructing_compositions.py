"""The Constructing Compositions demo computes what PsyNeuLink Tutorials lesson 6 says (#9).

The demo is one composition the walkthrough reshapes into the Tutorial
notebook's four. With the input [1, 2, 3, 4]: a line passes it unchanged
(identity projections between same-size layers); the loop gives outputs
[1, 1, 1, 1], then [2, 3, 4, 5] twice, with hidden_layer_a growing to
[3, 5, 7, 9]; three parallel layers give [3, 6, 9, 12]. This pins those
numbers, applying the walkthrough's own code edits.
"""

import shutil
from pathlib import Path

import numpy as np
import pytest

from app.services.executor import run_model
from app.services.model_dirs import _format_label

DEMO = Path(__file__).parent.parent / "demos" / "constructing_compositions.py"
LINE2 = "pathway=[input_layer, output_layer])"
LINE3 = "pathway=[input_layer, hidden_layer_a, output_layer])"
LOOP = (
    "pathway=[input_layer, hidden_layer_a, hidden_layer_b, output_layer])\n"
    "comp.add_linear_processing_pathway(pathway=[hidden_layer_b, hidden_layer_a])"
)
PARALLEL = (
    "pathway=[input_layer, hidden_layer_a, output_layer])\n"
    "comp.add_linear_processing_pathway(pathway=[input_layer, hidden_layer_b, output_layer])\n"
    "comp.add_linear_processing_pathway(pathway=[input_layer, hidden_layer_c, output_layer])"
)


def _shape(tmp_path, *edits):
    path = tmp_path / DEMO.name
    shutil.copy(DEMO, path)
    source = path.read_text()
    for find, replace in edits:
        assert find in source
        source = source.replace(find, replace, 1)
    path.write_text(source)
    return path


def _run(path, trials=1):
    result = run_model(str(path), "comp", {"input_layer": [[1, 2, 3, 4]] * trials}, use_sandbox=False)
    assert "error" not in result, result
    return [np.ravel(t["output"]).tolist() for t in result["results"]], result["logs"]


def test_the_menu_calls_it_constructing_compositions():
    assert _format_label(DEMO.stem) == "Constructing Compositions"


def test_lines_pass_the_input_through(tmp_path):
    assert _run(DEMO)[0] == [[1, 2, 3, 4]]
    assert _run(_shape(tmp_path, (LINE2, LINE3)))[0] == [[1, 2, 3, 4]]


def test_the_loop_takes_a_trial_to_come_round(tmp_path):
    outputs, logs = _run(_shape(tmp_path, (LINE2, LINE3), (LINE3, LOOP)), trials=3)
    assert outputs == [[1, 1, 1, 1], [2, 3, 4, 5], [2, 3, 4, 5]]
    assert np.ravel(logs["hidden_layer_a"]["values"][2]).tolist() == [3, 5, 7, 9]


def test_parallel_layers_add_up(tmp_path):
    path = _shape(tmp_path, (LINE2, LINE3), (LINE3, LOOP), (LOOP, PARALLEL))
    assert _run(path)[0] == [pytest.approx([3, 6, 9, 12])]
