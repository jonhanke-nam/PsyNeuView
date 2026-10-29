"""The Pretrained Stroop demo computes what PsyNeuLink Tutorials lesson 5 says (#9).

The demo is the Tutorial notebook's pre-trained Stroop model. The
walkthrough says the notebook's input (red ink, the word blue, name the ink)
gives Output [0.55, -0.55]; and that over all eight combinations, naming the
ink gives 1.53 congruent and 0.55 incongruent, reading the word 2.34 and
1.97. This pins those numbers, and that Task [1, 0] selects the ink's units
(the notebook's text says the reverse).
"""

from pathlib import Path

import numpy as np
import pytest

from app.services.executor import run_model
from app.services.model_dirs import _format_label

DEMO = Path(__file__).parent.parent / "demos" / "pretrained_stroop.py"
T = [[1, 0]] * 4 + [[0, 1]] * 4
W = [[1, 0], [1, 0], [0, 1], [0, 1]] * 2
I = [[1, 0], [0, 1], [1, 0], [0, 1]] * 2


def _run(ink, word, task):
    result = run_model(str(DEMO), "stroop_model", {"Ink_Color": ink, "Word": word, "Task": task}, use_sandbox=False)
    assert "error" not in result, result
    return [np.ravel(t["output"]).tolist() for t in result["results"]], result["logs"]


def test_the_menu_calls_it_pretrained_stroop():
    assert _format_label(DEMO.stem) == "Pretrained Stroop"


def test_the_notebooks_input_answers_red_weakly():
    [output], _ = _run([[1, 0]], [[0, 1]], [[1, 0]])
    assert output == pytest.approx([0.55, -0.55], abs=1e-3)


def test_all_eight_show_the_asymmetry():
    outputs, logs = _run(I, W, T)
    red = [o[0] for o in outputs]
    assert red == pytest.approx([1.532, -0.55, 0.55, -1.532, 2.336, 1.973, -1.973, -2.336], abs=1e-3)
    # Task [1, 0] turns on the ink's pair of hidden units, not the word's.
    hidden = np.ravel(logs["Hidden"]["values"][0])
    assert hidden[:2].sum() > 0.9 and hidden[2:].sum() < 0.25
