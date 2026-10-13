"""The Hebbian demo learns what the course's walkthrough says it does (#48).

The walkthrough runs a triangle alone through the untrained layer (nothing
else comes on), then trains the notebook's three objects with that triangle
added as a fourth trial, and quotes what it sees: the weight change falls as
1, 1/2, 1/3 ... (every epoch adds the same amount), co-occurring features end
wired together at 1.0 and the rest stay at 0, and on the last pass the
triangle alone brings back the whole large blue triangle. This pins those
numbers, so a PsyNeuLink change that alters them fails here, by name.
"""

import importlib.util
from pathlib import Path

import numpy as np
import psyneulink as pnl
import pytest

from app.services import pathway_learning
from app.services.executor import learn_model

DEMO = Path(__file__).parent.parent / "demos" / "hebbian_learning.py"

SMALL_RED_CIRCLE = [1, 0, 0, 1, 0, 0, 1, 0, 0]
MEDIUM_YELLOW_RECTANGLE = [0, 1, 0, 0, 1, 0, 0, 1, 0]
LARGE_BLUE_TRIANGLE = [0, 0, 1, 0, 0, 1, 0, 0, 1]
TRIANGLE = [0, 0, 0, 0, 0, 0, 0, 0, 1]
OBJECTS = [SMALL_RED_CIRCLE, MEDIUM_YELLOW_RECTANGLE, LARGE_BLUE_TRIANGLE]
WITH_CUE = OBJECTS + [TRIANGLE]


def _module():
    spec = importlib.util.spec_from_file_location("hebbian_learning_check", DEMO)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_untrained_a_triangle_brings_back_nothing_else():
    m = _module()
    out = m.hebbian_learning.run(inputs={m.feature_layer: [TRIANGLE]})
    assert np.allclose(np.asarray(out).ravel(), TRIANGLE)


def test_the_weight_change_falls_as_one_over_the_epoch():
    result = learn_model(str(DEMO), "hebbian_learning", {"feature_layer": WITH_CUE}, {}, epochs=20, use_sandbox=False)
    assert "error" not in result, result
    values = result["epochLosses"]
    assert values == pytest.approx([1 / n for n in range(1, 21)])
    assert values[-1] == pytest.approx(0.05)


def test_on_the_last_pass_the_triangle_alone_recalls_the_large_blue_triangle():
    result = learn_model(str(DEMO), "hebbian_learning", {"feature_layer": WITH_CUE}, {}, epochs=20, use_sandbox=False)
    outputs = [np.asarray(t["output"], dtype=float).ravel() for t in result["results"]]
    assert len(outputs) == 4
    # Each object comes back at 3: itself (1) plus its two partners (1.0 each).
    for shown, out in zip(OBJECTS, outputs[:3]):
        assert np.allclose(out, 3 * np.asarray(shown))
    # The partial cue is completed: large and blue come on with it, nothing else.
    assert np.allclose(outputs[3], LARGE_BLUE_TRIANGLE)


def test_features_that_occur_together_are_wired_together_and_no_others():
    m = _module()
    comp = m.hebbian_learning
    profile = pathway_learning.learning_profile(comp, is_autodiff=False)
    inputs = {m.feature_layer: [np.array(v, dtype=float) for v in WITH_CUE]}
    pathway_learning.train(
        comp, inputs, {}, epochs=20, learning_rate=None,
        exec_mode=pnl.ExecutionMode.Python, profile=profile,
    )
    [proj] = pathway_learning._learned_projections(comp)
    w = pathway_learning._matrix(proj, comp)
    together = sum(np.outer(o, o) for o in OBJECTS)
    np.fill_diagonal(together, 0)
    # 0.05 per trial x 20 epochs; the lone triangle adds nothing (no partner).
    assert np.allclose(w, together * 1.0)
