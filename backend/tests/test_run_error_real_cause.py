"""Run says why a model couldn't be built, not just that it's missing (#1235).

Reported on Stroop — Basic: change a node's ``input_shapes`` so it no longer
matches its neighbour, press Run, and all it said was
"Composition 'stroop_model' not found", whichever node was changed. The model
file had raised while building the Composition, the error was tolerated (#796)
and thrown away. PsyNeuLink's own message names the projection and the sizes,
so that's what the user now sees, with the line of their file that failed.
"""

import re
from pathlib import Path

import pytest

from app.services.executor import get_input_nodes, run_model

STROOP = Path(__file__).resolve().parent.parent / "reference_models" / "stroop_reference_basic.py"


def _with_shape(tmp_path, node, shape):
    source = STROOP.read_text()
    pattern = rf"({node} = pnl\.\w+\(\s*input_shapes=)2"
    assert re.search(pattern, source), node
    path = tmp_path / f"stroop_{node}.py"
    path.write_text(re.sub(pattern, rf"\g<1>{shape}", source, count=1))
    return str(path)


@pytest.mark.parametrize(
    "node, projection",
    [
        ("color_input", "color_input_to_hidden"),
        ("color_hidden", "color_input_to_hidden"),
        ("output", "color_hidden_to_output"),
    ],
)
def test_a_shape_mismatch_names_the_projection_and_the_line(tmp_path, node, projection):
    path = _with_shape(tmp_path, node, 3)
    result = run_model(path, "stroop_model", {}, use_sandbox=True)
    error = result.get("error", "")
    assert "not found" not in error
    assert projection in error
    assert "(3)" in error or "length (3)" in error
    assert result.get("errorLine"), "the error should give the line of the model file"
    assert f"line {result['errorLine']}" in error


def test_the_run_panel_input_lookup_says_the_same(tmp_path):
    path = _with_shape(tmp_path, "color_hidden", 3)
    result = get_input_nodes(path, "stroop_model", use_sandbox=True)
    assert "color_input_to_hidden" in result.get("error", "")


def test_a_model_without_the_composition_still_says_not_found(tmp_path):
    path = tmp_path / "plain.py"
    path.write_text("import psyneulink as pnl\nA = pnl.TransferMechanism(name='A')\n")
    result = run_model(str(path), "nowhere", {}, use_sandbox=True)
    assert result["error"] == "Composition 'nowhere' not found"
