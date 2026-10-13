"""The TD demo learns what the course's walkthrough says it does (#52).

The walkthrough trains the demo's conditioning set (cue on from the start of
the trial, reward late in it) and quotes the prediction error falling to
zero. It then has the learner train one trial with the cue coming on part-way
through, and quotes the error falling, then climbing back to about 0.1: it
did not go away, it moved to the cue's onset (Montague, Dayan & Sejnowski
1996). The Learn tab shows only the total per epoch, so the walkthrough tells
the learner where in the trial the error is; this pins that too.
"""

import importlib.util
from pathlib import Path

import numpy as np
import psyneulink as pnl
import pytest

from app.services import pathway_learning
from app.services.executor import learn_model

DEMO = Path(__file__).parent.parent / "demos" / "td_learning.py"
TIMESTEPS, REWARD_AT, LATE_ONSET = 10, 7, 3
REWARD = [1.0 if t == REWARD_AT else 0.0 for t in range(TIMESTEPS)]
CUE_FROM_START = [1.0] * TIMESTEPS
CUE_LATE = [1.0 if t >= LATE_ONSET else 0.0 for t in range(TIMESTEPS)]


def _module():
    spec = importlib.util.spec_from_file_location("td_learning_check", DEMO)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _deltas_per_epoch(cue, trials, epochs):
    """The PredictionErrorMechanism's δ over the timesteps, after each epoch."""
    m = _module()
    comp = m.td_learning
    profile = pathway_learning.learning_profile(comp, is_autodiff=False)
    [pe] = [n for n in comp.nodes if isinstance(n, pnl.PredictionErrorMechanism)]
    deltas = []
    pathway_learning.train(
        comp,
        {m.cue: [np.array(cue)] * trials},
        {m.value_estimate: [np.array(REWARD)] * trials},
        epochs=epochs, learning_rate=None, exec_mode=pnl.ExecutionMode.Python, profile=profile,
        on_epoch=lambda *_: deltas.append(np.asarray(pe.parameters.value.get(comp), dtype=float)[0]),
    )
    return deltas


def test_conditioning_the_error_falls_to_zero():
    result = learn_model(
        str(DEMO), "td_learning", {"cue": [CUE_FROM_START] * 5}, {"value_estimate": [REWARD] * 5},
        epochs=20, use_sandbox=False,
    )
    values = result["epochLosses"]
    assert values[0] == pytest.approx(0.059, abs=0.001)
    assert values[-1] < 1e-6
    # The trained value estimate predicts the reward from the start of the trial.
    value = np.asarray(result["results"][-1]["output"], dtype=float).ravel()
    assert np.allclose(value[:REWARD_AT], 1.01, atol=0.01)
    assert np.allclose(value[REWARD_AT:], 0.01, atol=0.01)


def test_conditioning_the_error_moves_earlier_before_it_vanishes():
    deltas = _deltas_per_epoch(CUE_FROM_START, trials=5, epochs=15)
    # Where in the trial the error sits: the centre of mass of |δ|.
    where = [float(np.sum(np.arange(TIMESTEPS) * np.abs(d)) / np.sum(np.abs(d))) for d in deltas[:10]]
    # From just before the reward back to the start of the trial.
    assert where[0] > REWARD_AT - 2
    assert all(b < a for a, b in zip(where, where[1:]))
    assert where[-1] < 1
    assert np.abs(deltas[-1]).max() < 0.01


def test_a_late_cue_the_error_moves_to_the_cue_and_stays():
    result = learn_model(
        str(DEMO), "td_learning", {"cue": [CUE_LATE]}, {"value_estimate": [REWARD]},
        epochs=50, use_sandbox=False,
    )
    values = result["epochLosses"]
    # All of it at the reward to start with: one error of 1 in ten timesteps.
    assert values[0] == pytest.approx(0.1)
    # Spread out over several timesteps while it moves, so the total dips...
    assert min(values) == pytest.approx(0.0225, abs=0.001)
    # ...then it gathers at the cue's onset, as big as it began.
    assert values[-1] == pytest.approx(0.0987, abs=0.001)

    deltas = _deltas_per_epoch(CUE_LATE, trials=1, epochs=50)
    assert int(np.argmax(deltas[0])) == REWARD_AT - 1
    assert int(np.argmax(deltas[-1])) == LATE_ONSET - 1
    assert deltas[-1][LATE_ONSET - 1] == pytest.approx(1.0, abs=0.02)
