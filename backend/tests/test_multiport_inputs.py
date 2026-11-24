"""An input node with several input ports gets one array per port (#332).

The Run panel sends a two-port node's trial as ``[[1, 0], [1]]``: one array
per port, as ``Composition.run`` takes it. The ports differ in size, so the
trial is a ragged list that numpy can't make one array of; the backend must
pass it through as one array per port, in the worker and in process alike.
"""

from pathlib import Path
from unittest import mock

import numpy as np
from app.services.executor import run_model
from app.services.sandbox_worker import trial_array

MODEL = str(Path(__file__).parent / "fixtures" / "two_port_input.py")
INPUTS = {
    "color_input": [[1.0, 0.0], [0.0, 1.0]],
    "task_demand": [[[1.0, 0.0], [1.0]], [[0.0, 1.0], [0.0]]],
}


def test_trial_array_single_port_stays_one_array():
    out = trial_array([1, 0])
    assert isinstance(out, np.ndarray)
    assert out.tolist() == [1.0, 0.0]


def test_trial_array_ragged_ports_become_one_array_each():
    out = trial_array([[1, 0], [1]])
    assert isinstance(out, list)
    assert [p.tolist() for p in out] == [[1.0, 0.0], [1.0]]


def test_two_port_inputs_reach_composition_run_in_process():
    import psyneulink as pnl

    seen = {}
    real_run = pnl.Composition.run

    def spy(self, *args, **kwargs):
        if "inputs" in kwargs and isinstance(kwargs["inputs"], dict):
            seen.update({getattr(k, "name", k): v for k, v in kwargs["inputs"].items()})
        return real_run(self, *args, **kwargs)

    with mock.patch.object(pnl.Composition, "run", spy):
        result = run_model(MODEL, "two_port_input", INPUTS, use_sandbox=False)
    assert "error" not in result, result.get("error")
    assert result["numTrials"] == 2
    task = seen["task_demand"]
    assert [[np.asarray(p).tolist() for p in trial] for trial in task] == INPUTS["task_demand"]
    assert [np.asarray(t).tolist() for t in seen["color_input"]] == INPUTS["color_input"]


def test_two_port_inputs_run_in_the_sandbox():
    result = run_model(MODEL, "two_port_input", INPUTS)
    assert "error" not in result, result.get("error")
    assert result["numTrials"] == 2
