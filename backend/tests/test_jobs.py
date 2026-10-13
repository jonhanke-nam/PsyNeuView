"""Tests for the async job layer (#535, L2)."""

import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.services.jobs import job_manager

client = TestClient(app)

AUTODIFF_MODEL = str(Path(__file__).parent.parent / "demos" / "autodiff_feedforward.py")

INPUTS = {"input_layer": [[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]]}
TARGETS = {"output_layer": [[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]]}


def _submit(epochs=5, learning_rate=0.05):
    return client.post("/api/jobs", json={
        "kind": "learn",
        "file_path": AUTODIFF_MODEL,
        "composition_name": "autodiff_comp",
        "inputs": INPUTS,
        "targets": TARGETS,
        "epochs": epochs,
        "learning_rate": learning_rate,
    })


def _poll_until_terminal(job_id, deadline_s=120):
    deadline = time.time() + deadline_s
    while time.time() < deadline:
        snap = client.get(f"/api/jobs/{job_id}").json()
        if snap["status"] in ("done", "error", "canceled"):
            return snap
        time.sleep(0.3)
    raise AssertionError(f"job {job_id} did not finish within {deadline_s}s: {snap}")


def test_learn_job_completes_with_progress_and_provenance():
    resp = _submit(epochs=5)
    assert resp.status_code == 200, resp.text
    job = resp.json()

    # Provenance is embedded at submission time.
    prov = job["provenance"]
    assert prov["model"]["sha256"]
    assert prov["config"]["epochs"] == 5
    assert prov["config"]["executionMode"] == "PyTorch"

    snap = _poll_until_terminal(job["id"])
    assert snap["status"] == "done", snap.get("error")
    assert len(snap["progress"]) == 5
    assert [p["epoch"] for p in snap["progress"]] == [1, 2, 3, 4, 5]
    assert all(isinstance(p["loss"], float) for p in snap["progress"])
    assert snap["result"]["numTrials"] == 3
    assert len(snap["result"]["epochLosses"]) == 5


def test_requested_backend_recorded_and_non_learnable_falls_back():
    # A learnable request (PyTorch) is recorded verbatim in provenance...
    resp = client.post("/api/jobs", json={
        "kind": "learn",
        "file_path": AUTODIFF_MODEL,
        "composition_name": "autodiff_comp",
        "inputs": INPUTS,
        "targets": TARGETS,
        "epochs": 2,
        "execution_mode": "Python",
    })
    assert resp.status_code == 200, resp.text
    job = resp.json()
    # Provenance keeps what the user asked for (audit trail)...
    assert job["provenance"]["config"]["executionMode"] == "Python"

    snap = _poll_until_terminal(job["id"])
    assert snap["status"] == "done", snap.get("error")
    # ...but the result reports the backend that actually trained: Python can't
    # drive autodiff gradients, so the worker falls back to PyTorch (#537).
    assert snap["result"]["executionMode"] == "PyTorch"


def test_sse_events_replay_through_terminal():
    resp = _submit(epochs=3)
    assert resp.status_code == 200, resp.text
    job_id = resp.json()["id"]
    _poll_until_terminal(job_id)

    # Stream after completion: replay must carry all progress + terminal.
    events = []
    with client.stream("GET", f"/api/jobs/{job_id}/events") as stream:
        for line in stream.iter_lines():
            if line.startswith("data: "):
                events.append(line[len("data: "):])
    assert len(events) == 4  # 3 progress + terminal
    assert '"type": "progress"' in events[0]
    assert '"type": "done"' in events[-1]


def test_one_job_at_a_time_then_cancel_frees_slot():
    resp = _submit(epochs=5000)  # long enough to still be running
    assert resp.status_code == 200, resp.text
    job_id = resp.json()["id"]

    second = _submit(epochs=2)
    assert second.status_code == 409

    canceled = client.delete(f"/api/jobs/{job_id}")
    assert canceled.status_code == 200
    snap = _poll_until_terminal(job_id, deadline_s=30)
    assert snap["status"] == "canceled"

    third = _submit(epochs=2)
    assert third.status_code == 200, third.text
    snap = _poll_until_terminal(third.json()["id"])
    assert snap["status"] == "done", snap.get("error")


def test_unknown_job_is_404():
    assert client.get("/api/jobs/nope").status_code == 404
    assert client.delete("/api/jobs/nope").status_code == 404


def test_unknown_kind_is_400():
    resp = client.post("/api/jobs", json={
        "kind": "dance",
        "file_path": AUTODIFF_MODEL,
        "composition_name": "autodiff_comp",
        "inputs": INPUTS,
        "targets": TARGETS,
    })
    assert resp.status_code == 400


def test_job_error_status_on_bad_composition():
    resp = client.post("/api/jobs", json={
        "kind": "learn",
        "file_path": AUTODIFF_MODEL,
        "composition_name": "no_such_comp",
        "inputs": INPUTS,
        "targets": TARGETS,
        "epochs": 2,
    })
    assert resp.status_code == 200
    snap = _poll_until_terminal(resp.json()["id"])
    assert snap["status"] == "error"
    assert "no_such_comp" in snap["error"]
