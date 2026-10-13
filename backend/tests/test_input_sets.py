"""A model can declare its own run inputs and training sets (#1216).

No new format: a module-level dict in the shape ``Composition.run`` takes
(``{input_node: [trial, …]}``) is offered to the Run tab, and one in the shape
``AutodiffComposition.learn`` takes (``{"inputs": …, "targets": …, "epochs": n}``)
to the Learn tab, named by its variable. That is how the course notebooks
already write their data. Anything else is ignored rather than guessed at.
"""

import textwrap

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

HEADER = """
import numpy as np
import psyneulink as pnl

a = pnl.TransferMechanism(name='a', input_shapes=1)
b = pnl.TransferMechanism(name='b', input_shapes=2)
comp = pnl.Composition(name='comp', pathways=[[a], [b]])
"""


def _sets(tmp_path, body):
    path = tmp_path / "model.py"
    path.write_text(textwrap.dedent(HEADER) + textwrap.dedent(body))
    resp = client.post("/api/model/load", json={"file_path": str(path)})
    assert resp.status_code == 200, resp.text
    return {s["name"]: s for s in resp.json()["model"].get("inputSets", [])}


def test_a_run_dict_is_offered_by_its_variable_name(tmp_path):
    sets = _sets(tmp_path, """
        pulse = {a: [1, 0, 0], b: [[1, 0], [0, 1], [0, 0]]}
    """)
    assert sets["pulse"]["kind"] == "run"
    assert sets["pulse"]["composition"] == "comp"
    assert sets["pulse"]["inputs"] == {"a": [[1.0], [0.0], [0.0]], "b": [[1, 0], [0, 1], [0, 0]]}


def test_declaration_order_is_kept(tmp_path):
    sets = _sets(tmp_path, """
        second_but_first = {a: [1], b: [[0, 0]]}
        then_this = {a: [2], b: [[1, 1]]}
    """)
    assert list(sets) == ["second_but_first", "then_this"]


def test_numpy_arrays_and_per_port_nesting_are_accepted(tmp_path):
    sets = _sets(tmp_path, """
        arrays = {a: np.array([[1], [2]]), b: [[[1, 0]], [[0, 1]]]}
    """)
    assert sets["arrays"]["inputs"] == {"a": [[1.0], [2.0]], "b": [[1.0, 0.0], [0.0, 1.0]]}


def test_a_learn_dict_is_offered_with_its_epochs(tmp_path):
    sets = _sets(tmp_path, """
        training = {"inputs": {a: [1, 0]}, "targets": {b: [[1, 0], [0, 1]]}, "epochs": 20}
    """)
    assert sets["training"]["kind"] == "learn"
    assert sets["training"]["targets"] == {"b": [[1.0, 0.0], [0.0, 1.0]]}
    assert sets["training"]["epochs"] == 20


@pytest.mark.parametrize("body", [
    "settings = {'rate': 0.5}",                              # keys aren't nodes
    "ragged = {a: [1, 0, 0], b: [[1, 0]]}",                  # trial counts differ
    "stranger = {pnl.TransferMechanism(name='x'): [1]}",     # node in no composition
    "half = {'inputs': {a: [1]}, 'targets': {'b': [1]}}",    # targets not keyed by nodes
    "empty = {}",
])
def test_anything_else_is_ignored(tmp_path, body):
    assert _sets(tmp_path, body) == {}


def test_a_model_without_sets_reports_none(tmp_path):
    path = tmp_path / "model.py"
    path.write_text(textwrap.dedent(HEADER))
    model = client.post("/api/model/load", json={"file_path": str(path)}).json()["model"]
    assert "inputSets" not in model


def test_the_course_demos_declare_their_experiments(tmp_path, monkeypatch):
    monkeypatch.setenv("PSYNEWVIEW_WORKING_DIR", str(tmp_path))
    dyn = client.post("/api/demos/reset", json={"demo_name": "bistable_attractor"}).json()["model"]
    assert [s["name"] for s in dyn["inputSets"]] == ["kick", "steady_difference"]
    gates = client.post("/api/demos/reset", json={"demo_name": "logic_gate_network"}).json()["model"]
    assert [(s["name"], s["kind"], s.get("epochs")) for s in gates["inputSets"]] == [
        ("and_gate", "learn", 50), ("or_gate", "learn", 50), ("xor_gate", "learn", 50),
    ]
