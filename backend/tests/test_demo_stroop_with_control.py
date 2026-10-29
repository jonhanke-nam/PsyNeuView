"""The Stroop with Control demo computes what PsyNeuLink Tutorials lesson 10 says (#9).

The demo is the Basics and Primer's Stroop model with control: an
LCAMechanism TASK whose gain a ControlMechanism, CONTROL, sets from the
conflict a Conflict Monitor measures in OUTPUT (an Energy function with the
matrix [[0, -2.5], [-2.5, 0]]). The walkthrough says that over the script's
four incongruent trials the conflict is 0.49, 0.52, 0.55 and 0.57 and the
chance of answering red rises only from 0.024 to 0.088; and that with the
Energy weight doubled to -5, the chance of red goes 0.024, 0.136, 0.462,
0.682: control wins. This pins those numbers, so a PsyNeuLink change fails
here by name.

Lesson 11 uses the same demo: with OUTPUT's Logistic gain set to 2, the
conflict falls to 0.26 to 0.29 and the chance of red stays near 0.002.
"""

import shutil
from pathlib import Path

import numpy as np
import pytest

from app.services.executor import run_model
from app.services.introspector import load_and_introspect
from app.services.model_dirs import _format_label

DEMO = Path(__file__).parent.parent / "demos" / "stroop_with_control.py"
WEIGHT = "matrix=[[0, -2.5], [-2.5, 0]]"
DOUBLED = "matrix=[[0, -5], [-5, 0]]"


def _run(path):
    result = run_model(
        str(path), "Stroop_model",
        {"COLOR INPUT": [[1, 0]] * 4, "WORD INPUT": [[0, 1]] * 4, "TASK INPUT": [[1, 0]] * 4},
        use_sandbox=False,
    )
    assert "error" not in result, result
    logs = result["logs"]
    conflict = [float(np.ravel(v)[0]) for v in logs["Conflict Monitor"]["values"]]
    # The DDM's values: decision, time, then the chance of the upper (red) threshold.
    red = [float(np.ravel(v)[2]) for v in logs["DECISION"]["values"]]
    return conflict, red


def test_the_menu_calls_it_stroop_with_control():
    assert _format_label(DEMO.stem) == "Stroop With Control"


def test_control_sets_the_task_gain_from_the_conflict_monitor():
    comp = load_and_introspect(str(DEMO))["compositions"][0]
    names = {n["name"] for n in comp["nodes"]}
    assert {"TASK", "Conflict Monitor", "DECISION"} <= names
    controller = comp["controller"]["mechanism"]
    assert controller["name"] == "CONTROL"
    assert [p["name"] for p in controller["outputPorts"]] == ["TASK[gain] ControlSignal"]
    assert WEIGHT in DEMO.read_text()


def test_the_scripts_four_trials_control_too_slowly():
    conflict, red = _run(DEMO)
    assert conflict == pytest.approx([0.490, 0.523, 0.552, 0.571], abs=1e-3)
    assert red == pytest.approx([0.024, 0.038, 0.061, 0.088], abs=1e-3)


def test_with_the_weight_doubled_control_wins(tmp_path):
    path = tmp_path / DEMO.name
    shutil.copy(DEMO, path)
    path.write_text(path.read_text().replace(WEIGHT, DOUBLED))
    conflict, red = _run(path)
    assert conflict == pytest.approx([0.979, 1.183, 1.250, 1.239], abs=1e-3)
    assert red == pytest.approx([0.024, 0.136, 0.462, 0.682], abs=1e-3)


def test_a_steeper_output_reads_less_conflict(tmp_path):
    path = tmp_path / DEMO.name
    shutil.copy(DEMO, path)
    plain = "function=pnl.Logistic)"
    assert plain in path.read_text()
    path.write_text(path.read_text().replace(plain, "function=pnl.Logistic(gain=2))", 1))
    conflict, red = _run(path)
    assert conflict == pytest.approx([0.259, 0.251, 0.268, 0.287], abs=1e-3)
    assert red == pytest.approx([0.002, 0.002, 0.002, 0.003], abs=1e-3)
