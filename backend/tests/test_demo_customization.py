"""The Customization demo computes what PsyNeuLink Tutorials lesson 14 says (#9).

The demo is the Basics and Primer's my_sinusoidal_fct, a Python function
assigned as a ProcessingMechanism's function. The walkthrough says it is
wrapped as a UserDefinedFunction with phase and amplitude as parameters and
two input ports, fed by FREQUENCY and TIME; that frequency 1 at times 0.25, 0.5 and 0.75 gives 1, about
0 and -1; and that with amplitude=2 it gives 2, about 0 and -2. This pins
those numbers.
"""

import shutil
from pathlib import Path

import numpy as np
import pytest

from app.services.executor import run_model
from app.services.introspector import load_and_introspect
from app.services.model_dirs import _format_label

DEMO = Path(__file__).parent.parent / "demos" / "customization.py"
QUARTERS = {"FREQUENCY": [[1], [1], [1]], "TIME": [[0.25], [0.5], [0.75]]}


def _run(path):
    result = run_model(str(path), "wave_comp", QUARTERS, use_sandbox=False)
    assert "error" not in result, result
    return [float(np.ravel(t["output"])[0]) for t in result["results"]]


def test_the_menu_calls_it_customization():
    assert _format_label(DEMO.stem) == "Customization"


def test_the_python_function_is_wrapped_with_its_parameters():
    nodes = {n["name"]: n for n in load_and_introspect(str(DEMO))["compositions"][0]["nodes"]}
    node = nodes["my_wave_mech"]
    assert node["function"]["type"] == "UserDefinedFunction"
    assert {"phase", "amplitude"} <= set(node["function"]["params"])
    assert len(node["inputPorts"]) == 2
    assert {"FREQUENCY", "TIME"} <= set(nodes)


def test_three_points_of_the_wave():
    assert _run(DEMO) == pytest.approx([1.0, 0.0, -1.0], abs=1e-9)


def test_amplitude_2_doubles_it(tmp_path):
    path = tmp_path / DEMO.name
    shutil.copy(DEMO, path)
    path.write_text(path.read_text().replace("amplitude=1):", "amplitude=2):"))
    assert _run(path) == pytest.approx([2.0, 0.0, -2.0], abs=1e-9)
