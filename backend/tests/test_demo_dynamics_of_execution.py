"""The Dynamics of Execution demo computes what PsyNeuLink Tutorials lesson 9 says (#9).

The demo is the Basics and Primer's Stroop model with its decision changed
to a DriftDiffusionIntegrator (noise 0.5, threshold 20), and a trial that
ends when the decision is finished. The walkthrough says the decision stops
at +20 or -20 after a number of steps that, with noise, changes from run to
run; that with no noise, the incongruent trial takes 59 steps and the
congruent one 25; and that with the task an LCAMechanism, which settles for
10 executions before the hidden layers run, the task unit settles to 0.61
against 0.39 and the incongruent trial answers green, -20, in 57 steps.
This pins those numbers, so a PsyNeuLink change fails here by name.
"""

import shutil
from pathlib import Path

import numpy as np
import pytest

from app.services.executor import run_model
from app.services.introspector import load_and_introspect
from app.services.model_dirs import _format_label

DEMO = Path(__file__).parent.parent / "demos" / "dynamics_of_execution.py"
RED, GREEN = [1, 0], [0, 1]
COLOR_TASK = [1, 0]

NO_NOISE = ("noise=0.5", "noise=0.0")
LCA = (
    "task_input = pnl.ProcessingMechanism(name='TASK INPUT', input_shapes=2)",
    "task_input = pnl.LCAMechanism(name='TASK INPUT', input_shapes=2)",
)
CONDITIONS = (
    "# A trial ends when the decision is finished.",
    "Stroop_model.scheduler.add_condition(color_hidden, pnl.EveryNCalls(task_input, 10))\n"
    "Stroop_model.scheduler.add_condition(word_hidden, pnl.EveryNCalls(task_input, 10))\n"
    "# A trial ends when the decision is finished.",
)


def _edited(tmp_path, *edits):
    path = tmp_path / DEMO.name
    shutil.copy(DEMO, path)
    source = path.read_text()
    for find, replace in edits:
        assert find in source, find
        source = source.replace(find, replace, 1)
    path.write_text(source)
    return path


def _run(path, word):
    result = run_model(
        str(path), "Stroop_model", {"COLOR INPUT": [RED], "WORD INPUT": [word], "TASK INPUT": [COLOR_TASK]},
        use_sandbox=False,
    )
    assert "error" not in result, result
    where, steps = (float(np.ravel(v)[0]) for v in result["results"][0]["output"])
    return where, steps, result["logs"]


def test_the_menu_calls_it_dynamics_of_execution():
    assert _format_label(DEMO.stem) == "Dynamics of Execution"


def test_a_trial_ends_when_the_decision_is_finished():
    comp = load_and_introspect(str(DEMO))["compositions"][0]
    trial = comp["terminationConditions"]["ENVIRONMENT_STATE_UPDATE"]
    assert trial["type"] == "WhenFinished"
    assert trial["args"]["positional"] == [{"_node": "DECISION"}]


def test_with_noise_the_decision_reaches_the_threshold():
    where, steps, _ = _run(DEMO, GREEN)
    assert abs(where) == 20
    assert steps >= 1 and steps == int(steps)


def test_without_noise_incongruent_takes_59_steps_and_congruent_25(tmp_path):
    path = _edited(tmp_path, NO_NOISE)
    assert _run(path, GREEN)[:2] == (20.0, 59.0)
    assert _run(path, RED)[:2] == (20.0, 25.0)


def test_with_the_task_settling_first_the_word_wins(tmp_path):
    path = _edited(tmp_path, NO_NOISE, LCA, CONDITIONS)
    where, steps, logs = _run(path, GREEN)
    assert (where, steps) == (-20.0, 57.0)
    # The task unit ran 10 times; the competition leaves it at 0.61 / 0.39.
    task = logs["TASK INPUT"]["values"]
    assert np.ravel(task[-1]) == pytest.approx([0.6099, 0.3901], abs=1e-4)
