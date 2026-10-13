"""Validation of the simple_stroop_learn demo (#542).

The Learn scenario from #542: word-pathway dominance must EMERGE from
training frequency (Cohen, Dunbar & McClelland, 1990), not be hand-set
as in simple_stroop.py.
"""

import importlib.util
import sys
from pathlib import Path

import numpy as np
import psyneulink as pnl

from app.services.executor import learn_model

MODEL = str(Path(__file__).parent.parent / "demos" / "simple_stroop_learn.py")

ZERO = [0.0, 0.0, 0.0]
RED, GREEN = [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]
SAY_RED, SAY_GREEN = [1.0, 0.0], [0.0, 1.0]

# Word-reading trials outnumber color-naming trials 4:1 — the asymmetry
# is in the training diet, not the architecture.
WORD_TRIALS = [(ZERO, RED, SAY_RED), (ZERO, GREEN, SAY_GREEN)] * 4
COLOR_TRIALS = [(RED, ZERO, SAY_RED), (GREEN, ZERO, SAY_GREEN)]
TRIALS = WORD_TRIALS + COLOR_TRIALS


def _dataset():
    return (
        {"colors_input": [t[0] for t in TRIALS], "words_input": [t[1] for t in TRIALS]},
        {"response": [t[2] for t in TRIALS]},
    )


def test_learn_endpoint_trains_stroop_learn():
    """The #534 learn service must drive the demo end to end."""
    inputs, targets = _dataset()
    result = learn_model(
        MODEL, "stroop_learn_model", inputs, targets,
        epochs=30, use_sandbox=False,
    )
    assert "error" not in result, result
    assert result["numTrials"] == len(TRIALS)
    assert len(result["epochLosses"]) == 30
    assert result["epochLosses"][-1] < result["epochLosses"][0]


def test_word_dominance_emerges_from_training_frequency():
    spec = importlib.util.spec_from_file_location("stroop_learn_test", MODEL)
    module = importlib.util.module_from_spec(spec)
    sys.modules["stroop_learn_test"] = module
    try:
        spec.loader.exec_module(module)
        comp = module.stroop_learn_model

        colors = [np.array(t[0]) for t in TRIALS]
        words = [np.array(t[1]) for t in TRIALS]
        targets = [np.array(t[2]) for t in TRIALS]
        comp.learn(
            inputs={
                "inputs": {module.colors_input: colors, module.words_input: words},
                "targets": {module.response: targets},
                "epochs": 50,
            },
            execution_mode=pnl.ExecutionMode.PyTorch,
            minibatch_size=1,
        )

        color_w = np.array(module.colors_to_response.parameters.matrix.get(comp))
        word_w = np.array(module.words_to_response.parameters.matrix.get(comp))

        # Word pathway trained 4x as often -> larger weights (rows 0-1;
        # row 2 is the untrained "blue" distractor channel).
        assert np.abs(word_w[:2]).mean() > np.abs(color_w[:2]).mean()
        # Both pathways actually learned something from near-zero init.
        assert np.abs(color_w[:2]).mean() > 0.5
        # The distractor channel was never taught a mapping.
        assert np.abs(word_w[2]).max() < 0.1
        assert np.abs(color_w[2]).max() < 0.1

        # Behavioral Stroop interference on an incongruent probe
        # (color=red, word=green): the more-practiced word pathway wins.
        def respond(color_vec, word_vec):
            net = color_vec @ color_w + word_vec @ word_w
            return 1.0 / (1.0 + np.exp(-net))  # Logistic(gain=1)

        say_red, say_green = respond(np.array(RED), np.array(GREEN))
        assert say_green > say_red
    finally:
        del sys.modules["stroop_learn_test"]
