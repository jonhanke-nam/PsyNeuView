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


# /api/model/input-nodes reports every port's shape, not only the first (#358).
EXPECTED_PORTS = [{"name": "RED_task", "shape": [2]}, {"name": "WORD_task", "shape": [1]}]


def _task_demand(result):
    assert "error" not in result, result.get("error")
    return next(n for n in result["inputNodes"] if n["name"] == "task_demand")


def test_input_nodes_lists_every_port_in_process():
    from app.services.executor import get_input_nodes

    node = _task_demand(get_input_nodes(MODEL, "two_port_input", use_sandbox=False))
    assert node["ports"] == EXPECTED_PORTS
    assert node["shape"] == [2]  # the first port's, unchanged


def test_input_nodes_lists_every_port_through_the_api():
    from fastapi.testclient import TestClient
    from app.main import app

    resp = TestClient(app).post(
        "/api/model/input-nodes", json={"file_path": MODEL, "composition_name": "two_port_input"}
    )
    assert resp.status_code == 200, resp.text
    node = _task_demand(resp.json())
    assert node["ports"] == EXPECTED_PORTS
    color = next(n for n in resp.json()["inputNodes"] if n["name"] == "color_input")
    assert [p["shape"] for p in color["ports"]] == [[2]]
