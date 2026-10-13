"""The logic-gate demo learns what the course says it learns (#47).

The Perceptron walkthrough trains this demo on AND and then on XOR. The point
of the module is the contrast: a single layer of weights learns AND but can't
learn XOR, because XOR isn't linearly separable. If the demo stopped showing
that contrast, the walkthrough would still pass its steps while teaching the
wrong thing, so this pins the losses, not just that training runs.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

PATTERNS = [[0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 1]]  # A, B, constant bias input


@pytest.fixture
def demo_path(tmp_path, monkeypatch):
    # /demos/reset writes a working copy; keep it out of backend/ (#1134).
    monkeypatch.setenv("PSYNEWVIEW_WORKING_DIR", str(tmp_path))
    resp = client.post("/api/demos/reset", json={"demo_name": "logic_gate_network"})
    assert resp.status_code == 200, resp.text
    return resp.json()["file_path"]


def _train(file_path, targets):
    resp = client.post(
        "/api/model/learn",
        json={
            "file_path": file_path,
            "composition_name": "logic_gate_network",
            "inputs": {"in_layer": PATTERNS},
            "targets": {"out_layer": [[t] for t in targets]},
            "epochs": 50,
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "error" not in data, data.get("error")
    assert data["epochs"] == 50
    return data["finalLoss"]


def test_demo_is_listed_under_a_readable_label():
    labels = {d["name"]: d["label"] for d in client.get("/api/demos").json()["demos"]}
    assert labels.get("logic_gate_network") == "Logic Gate Network"


def test_it_learns_and(demo_path):
    assert _train(demo_path, [0, 0, 0, 1]) < 0.01


def test_it_learns_or(demo_path):
    assert _train(demo_path, [0, 1, 1, 1]) < 0.01


def test_it_cannot_learn_xor(demo_path):
    """The lesson. 0.25 is the loss of answering 0.5 to all four patterns."""
    assert _train(demo_path, [0, 1, 1, 0]) > 0.2
