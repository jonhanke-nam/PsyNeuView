"""Tests for the synchronous learn endpoint/service (#534, L1)."""

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.services.executor import learn_model

AUTODIFF_MODEL = str(Path(__file__).parent.parent / "demos" / "autodiff_feedforward.py")
TEST_MODEL = str(Path(__file__).parent.parent / "test_model.py")

INPUTS = {
    "input_layer": [[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]],
}
TARGETS = {
    "output_layer": [[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]],
}


def test_learn_autodiff_feedforward():
    result = learn_model(
        AUTODIFF_MODEL, "autodiff_comp", INPUTS, TARGETS,
        epochs=20, learning_rate=0.05, use_sandbox=False,
    )
    assert "error" not in result, result
    assert result["epochs"] == 20
    assert result["numTrials"] == 3
    assert len(result["epochLosses"]) == 20
    assert isinstance(result["finalLoss"], float)
    assert result["finalLoss"] == result["epochLosses"][-1]
    # Identity-style mapping with a modest learning rate: loss must decrease.
    assert result["epochLosses"][-1] < result["epochLosses"][0]
    # Final-epoch outputs: one per trial.
    assert len(result["results"]) == 3
    assert result["results"][0]["trial"] == 0


def test_learn_rejects_non_autodiff():
    result = learn_model(
        TEST_MODEL, "stroop_model",
        {"colors_input": [[1.0, 0.0, 0.0]], "words_input": [[0.0, 0.0, 1.0]]},
        {"response": [[1.0, 0.0]]},
        use_sandbox=False,
    )
    assert result.get("notLearnable") is True
    assert "not learning-capable" in result["error"]


def test_learn_rejects_mismatched_trial_counts():
    result = learn_model(
        AUTODIFF_MODEL, "autodiff_comp",
        {"input_layer": [[1.0, 0.0], [0.0, 1.0]]},
        {"output_layer": [[1.0, 0.0]]},
        use_sandbox=False,
    )
    assert "error" in result
    assert "same number of trials" in result["error"]


def test_learn_rejects_missing_target_node():
    result = learn_model(
        AUTODIFF_MODEL, "autodiff_comp",
        INPUTS,
        {"no_such_node": [[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]]},
        use_sandbox=False,
    )
    assert "error" in result
    assert "no_such_node" in result["error"]


def test_learn_endpoint_via_api():
    """End-to-end through the route + sandbox warm worker."""
    client = TestClient(app)
    resp = client.post("/api/model/learn", json={
        "file_path": AUTODIFF_MODEL,
        "composition_name": "autodiff_comp",
        "inputs": INPUTS,
        "targets": TARGETS,
        "epochs": 5,
        "learning_rate": 0.05,
    })
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert len(data["epochLosses"]) == 5
    assert data["numTrials"] == 3


def test_learn_endpoint_non_learnable_is_422():
    client = TestClient(app)
    resp = client.post("/api/model/learn", json={
        "file_path": TEST_MODEL,
        "composition_name": "stroop_model",
        "inputs": {"colors_input": [[1.0, 0.0, 0.0]], "words_input": [[0.0, 0.0, 1.0]]},
        "targets": {"response": [[1.0, 0.0]]},
    })
    assert resp.status_code == 422
    assert "not learning-capable" in resp.json()["detail"]
