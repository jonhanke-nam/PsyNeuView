"""Learning a plain Composition through its learning pathways (#997).

The Learn tab used to train only an AutodiffComposition under PyTorch, because
its only loss source was ``comp.torch_losses``. A Composition with learning
pathways (TD, backprop) or learning mechanisms (Hebbian) now trains under
Python, and each epoch reports a metric that says what it is:

* TD pathway → "Prediction error" (mean squared TD error)
* other target pathway → "Error at target" (mean squared error)
* no target (Hebbian) → "Weight change" (relative ‖ΔW‖ / ‖W‖) — not a loss

These pin both demos' training, the per-composition learnability, the metric
fields, and streaming + cancel on the Python path.
"""

import textwrap
import time
from pathlib import Path

import psyneulink as pnl
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.executor import _resolve_learn_execution_mode, learn_model
from app.services.pathway_learning import learning_profile

client = TestClient(app)

DEMOS = Path(__file__).parent.parent / "demos"
HEBBIAN = str(DEMOS / "hebbian_learning.py")
TD = str(DEMOS / "td_learning.py")
AUTODIFF = str(DEMOS / "autodiff_feedforward.py")
PLAIN = str(Path(__file__).parent.parent / "test_model.py")

OBJECTS = [
    [1, 0, 0, 1, 0, 0, 1, 0, 0],
    [0, 1, 0, 0, 1, 0, 0, 1, 0],
    [0, 0, 1, 0, 0, 1, 0, 0, 1],
]
CUE = [1.0] * 10
REWARD = [1.0 if t == 7 else 0.0 for t in range(10)]

HEBBIAN_REQUEST = ({"feature_layer": OBJECTS}, {})
TD_REQUEST = ({"cue": [CUE] * 5}, {"value_estimate": [REWARD] * 5})


def _load(path, name):
    import importlib.util
    import sys

    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(name, None)
    return module


# ── The two demos train, and their metric behaves ──────────────────────────


def test_hebbian_demo_trains_and_reports_weight_change_not_loss():
    inputs, targets = HEBBIAN_REQUEST
    result = learn_model(HEBBIAN, "hebbian_learning", inputs, targets, epochs=20, use_sandbox=False)
    assert "error" not in result, result
    assert result["learningKind"] == "pathway"
    assert result["executionMode"] == "Python"
    assert result["executionModeReason"] is None
    assert result["metric"]["id"] == "weight_change"
    assert result["metric"]["label"] == "Weight change"

    values = result["epochLosses"]
    assert len(values) == 20
    assert result["finalLoss"] == values[-1]
    # First epoch moves the weights from zero, so the relative change is 1.
    assert values[0] == pytest.approx(1.0)
    # It falls every epoch, towards zero.
    assert all(b < a for a, b in zip(values, values[1:]))
    assert values[-1] < 0.1

    # The absolute change is reported too, and it does NOT go to zero —
    # Hebbian learning has no fixed point; that's why relative is the metric.
    # Every epoch adds the same amount, so the last is as large as the first.
    absolute = result["epochWeightChangeAbsolute"]
    assert len(absolute) == 20
    assert absolute[-1] > 0.1
    assert absolute[-1] == pytest.approx(absolute[0])
    assert result["numTrials"] == 3 and len(result["results"]) == 3


def test_td_demo_trains_and_prediction_error_falls():
    inputs, targets = TD_REQUEST
    result = learn_model(TD, "td_learning", inputs, targets, epochs=20, use_sandbox=False)
    assert "error" not in result, result
    assert result["executionMode"] == "Python"
    assert result["metric"]["id"] == "prediction_error"
    assert result["metric"]["label"] == "Prediction error"

    values = result["epochLosses"]
    assert len(values) == 20
    assert values[-1] < values[0] / 1000
    assert values[-1] < 1e-4
    assert "epochWeightChangeAbsolute" not in result
    assert result["numTrials"] == 5


def test_backprop_pathway_reports_error_at_target(tmp_path):
    path = tmp_path / "bp.py"
    path.write_text(textwrap.dedent("""
        import psyneulink as pnl
        a = pnl.TransferMechanism(name='a', input_shapes=2)
        b = pnl.TransferMechanism(name='b', input_shapes=2, function=pnl.Logistic)
        bp = pnl.Composition(name='bp')
        bp.add_backpropagation_learning_pathway([a, b], learning_rate=1.0)
    """))
    result = learn_model(
        str(path), "bp", {"a": [[1, 0], [0, 1]]}, {"b": [[1, 0], [0, 1]]},
        epochs=10, use_sandbox=False,
    )
    assert "error" not in result, result
    assert result["metric"]["id"] == "target_error"
    assert result["metric"]["label"] == "Error at target"
    assert result["epochLosses"][-1] < result["epochLosses"][0]


def test_the_autodiff_response_names_its_metric_too():
    result = learn_model(
        AUTODIFF, "autodiff_comp",
        {"input_layer": [[1.0, 0.0], [0.0, 1.0]]}, {"output_layer": [[1.0, 0.0], [0.0, 1.0]]},
        epochs=3, use_sandbox=False,
    )
    assert "error" not in result, result
    assert result["learningKind"] == "autodiff"
    assert result["metric"]["id"] == "loss"
    assert result["executionMode"] == "PyTorch"


# ── Request validation on the Python path ──────────────────────────────────


def test_hebbian_refuses_targets_it_cannot_use():
    result = learn_model(
        HEBBIAN, "hebbian_learning", {"feature_layer": OBJECTS}, {"feature_layer": OBJECTS},
        epochs=2, use_sandbox=False,
    )
    assert "learns without targets" in result["error"]


def test_td_needs_its_target():
    result = learn_model(TD, "td_learning", {"cue": [CUE]}, {}, epochs=2, use_sandbox=False)
    assert "needs targets" in result["error"]
    assert "value_estimate" in result["error"]


def test_a_composition_with_no_learning_is_refused_with_a_reason():
    result = learn_model(
        PLAIN, "stroop_model",
        {"colors_input": [[1.0, 0.0, 0.0]], "words_input": [[0.0, 0.0, 1.0]]},
        {"response": [[1.0, 0.0]]},
        use_sandbox=False,
    )
    assert result.get("notLearnable") is True
    assert "not learning-capable" in result["error"]
    assert "no learning pathways" in result["error"]


# ── Per-composition learnability ───────────────────────────────────────────


def test_learning_profile_per_composition():
    hebb = _load(HEBBIAN, "hebb_profile").hebbian_learning
    td = _load(TD, "td_profile").td_learning
    auto = _load(AUTODIFF, "auto_profile").autodiff_comp
    plain = _load(PLAIN, "plain_profile").stroop_model

    p = learning_profile(hebb, is_autodiff=False)
    assert p["kind"] == "pathway"
    assert p["metric"]["id"] == "weight_change"
    assert p["targetNodes"] == []

    p = learning_profile(td, is_autodiff=False)
    assert p["kind"] == "pathway"
    assert p["metric"]["id"] == "prediction_error"
    assert p["targetNodes"] == ["value_estimate"]
    # The TARGET mechanism is an INPUT node to PsyNeuLink, but it is not an
    # input a person types — the Learn tab leaves generated nodes out.
    assert any(name.startswith("TARGET") for name in p["generatedNodes"])
    assert "cue" not in p["generatedNodes"]

    assert learning_profile(auto, is_autodiff=True)["kind"] == "autodiff"

    p = learning_profile(plain, is_autodiff=False)
    assert p["kind"] == "none"
    assert "nothing to train" in p["reason"]


def test_resolver_trains_a_pathway_composition_under_python():
    pathway = dict(is_autodiff=False, has_learning=True)
    mode, effective, reason = _resolve_learn_execution_mode(pnl, None, **pathway)
    assert (effective, reason) == ("Python", None)
    assert mode is pnl.ExecutionMode.Python

    mode, effective, reason = _resolve_learn_execution_mode(pnl, "Python", **pathway)
    assert (effective, reason) == ("Python", None)

    for asked in ("PyTorch", "LLVM"):
        mode, effective, reason = _resolve_learn_execution_mode(pnl, asked, **pathway)
        assert effective == "Python"
        assert reason and "train under Python" in reason


def test_introspection_reports_profile_and_target_less_training_set(tmp_path, monkeypatch):
    monkeypatch.setenv("PSYNEWVIEW_WORKING_DIR", str(tmp_path))
    hebb = client.post("/api/demos/reset", json={"demo_name": "hebbian_learning"}).json()["model"]
    comp = hebb["compositions"][0]
    assert comp["learningProfile"]["metric"]["id"] == "weight_change"
    assert any(m["id"] == "Python" and m["learnable"] for m in comp["executionModes"])
    [only] = hebb["inputSets"]
    assert (only["name"], only["kind"], only["targets"], only["epochs"]) == (
        "three_objects", "learn", {}, 20,
    )

    td = client.post("/api/demos/reset", json={"demo_name": "td_learning"}).json()["model"]
    comp = td["compositions"][0]
    assert comp["learningProfile"]["targetNodes"] == ["value_estimate"]
    [only] = td["inputSets"]
    assert only["name"] == "conditioning" and list(only["targets"]) == ["value_estimate"]


def test_demo_labels():
    demos = {d["name"]: d["label"] for d in client.get("/api/demos").json()["demos"]}
    assert demos["hebbian_learning"] == "Hebbian Learning"
    assert demos["td_learning"] == "TD Learning"


# ── Through the API: sync route, then streaming + cancel as a job ──────────


def test_learn_route_trains_td_in_the_sandbox():
    inputs, targets = TD_REQUEST
    resp = client.post("/api/model/learn", json={
        "file_path": TD, "composition_name": "td_learning",
        "inputs": inputs, "targets": targets, "epochs": 5,
    })
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["metric"]["id"] == "prediction_error"
    assert len(data["epochLosses"]) == 5


def _poll(job_id, deadline_s=120, until=lambda s: s["status"] in ("done", "error", "canceled")):
    deadline = time.time() + deadline_s
    snap = None
    while time.time() < deadline:
        snap = client.get(f"/api/jobs/{job_id}").json()
        if until(snap):
            return snap
        time.sleep(0.2)
    raise AssertionError(f"job {job_id} did not reach the condition in {deadline_s}s: {snap}")


def test_hebbian_job_streams_weight_change_per_epoch():
    resp = client.post("/api/jobs", json={
        "kind": "learn", "file_path": HEBBIAN, "composition_name": "hebbian_learning",
        "inputs": {"feature_layer": OBJECTS}, "epochs": 5, "execution_mode": "Python",
    })
    assert resp.status_code == 200, resp.text
    snap = _poll(resp.json()["id"])
    assert snap["status"] == "done", snap.get("error")
    assert [p["epoch"] for p in snap["progress"]] == [1, 2, 3, 4, 5]
    assert all(p["metric"] == "weight_change" for p in snap["progress"])
    assert all(isinstance(p["loss"], float) and "absolute" in p for p in snap["progress"])
    assert snap["result"]["metric"]["id"] == "weight_change"
    assert snap["provenance"]["effectiveExecutionMode"] == "Python"


def test_td_job_can_be_cancelled_mid_training():
    inputs, targets = TD_REQUEST
    resp = client.post("/api/jobs", json={
        "kind": "learn", "file_path": TD, "composition_name": "td_learning",
        "inputs": inputs, "targets": targets, "epochs": 5000, "execution_mode": "Python",
    })
    assert resp.status_code == 200, resp.text
    job_id = resp.json()["id"]
    # Wait for real progress first, so this cancels training, not start-up.
    snap = _poll(
        job_id,
        until=lambda s: len(s["progress"]) >= 2 or s["status"] in ("done", "error", "canceled"),
    )
    assert snap["status"] == "running", snap.get("error")
    assert snap["progress"][0]["metric"] == "prediction_error"

    assert client.delete(f"/api/jobs/{job_id}").status_code == 200
    snap = _poll(job_id, deadline_s=30)
    assert snap["status"] == "canceled"
    assert len(snap["progress"]) < 5000
