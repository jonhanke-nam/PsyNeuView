"""The XOR Learning demo computes what PsyNeuLink Tutorials lesson 13 says (#9).

The demo is the Basics and Primer's XOR network with backpropagation, its
starting weights seeded. The walkthrough says that at the default learning
rate, 250 epochs leave every output near 0.5 (error at target 0.255), and
that with learning_rate=3, 300 epochs give 0.035, 0.96, 0.963 and 0.044
(error 0.0015). This pins those numbers, so a PsyNeuLink change fails here
by name.
"""

import shutil
from pathlib import Path

import numpy as np
import pytest

from app.services.executor import learn_model
from app.services.introspector import load_and_introspect
from app.services.model_dirs import _format_label

DEMO = Path(__file__).parent.parent / "demos" / "xor_learning.py"
X = [[0, 0], [0, 1], [1, 0], [1, 1]]
Y = [[0], [1], [1], [0]]
PATHWAY = "pathway=[input, input_weights, hidden, output_weights, output])"


def _learn(path, epochs):
    result = learn_model(str(path), "xor_comp", {"input": X}, {"output": Y}, epochs=epochs, use_sandbox=False)
    assert "error" not in result, result
    outputs = [float(np.ravel(t.get("output", t))[0]) for t in result["results"]]
    return result["finalLoss"], outputs


def test_the_menu_calls_it_xor_learning():
    assert _format_label(DEMO.stem) == "XOR Learning"


def test_the_call_adds_the_learning_components():
    names = {n["name"] for n in load_and_introspect(str(DEMO))["compositions"][0]["nodes"]}
    assert {"Input", "Hidden", "Output", "Comparator", "TARGET for Output"} <= names


def test_at_the_default_rate_it_hardly_learns():
    loss, outputs = _learn(DEMO, 250)
    assert loss == pytest.approx(0.2551, abs=1e-3)
    assert outputs == pytest.approx([0.503, 0.505, 0.492, 0.513], abs=2e-3)


def test_at_rate_3_it_learns_xor(tmp_path):
    path = tmp_path / DEMO.name
    shutil.copy(DEMO, path)
    path.write_text(path.read_text().replace(PATHWAY, PATHWAY[:-1] + ",\n    learning_rate=3)"))
    loss, outputs = _learn(path, 300)
    assert loss == pytest.approx(0.0015, abs=2e-4)
    assert outputs == pytest.approx([0.035, 0.96, 0.963, 0.044], abs=2e-3)
