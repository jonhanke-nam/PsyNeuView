"""Per-trial run times (#334).

The runner times each trial with PsyNeuLink's ``call_before_trial`` /
``call_after_trial`` hooks and returns ``trial_seconds`` beside ``results``,
so the Run panel can show "Trial 3 · 0.41 s".
"""

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.services.executor import _run_model_inprocess
from app.services.sandbox_worker import add_trial_timing

client = TestClient(app)

TEST_MODEL = str(Path(__file__).parent.parent / "test_model.py")
THREE_TRIALS = {
    "colors_input": [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]],
    "words_input": [[0.0, 0.0, 1.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]],
}


def _assert_trial_seconds(data, total_seconds):
    secs = data["trial_seconds"]
    assert len(secs) == 3 == len(data["results"])
    assert all(s > 0 for s in secs)
    assert sum(secs) <= total_seconds


def test_three_trial_run_returns_three_trial_times():
    """The served run path (sandbox worker) returns one time per trial."""
    resp = client.post(
        "/api/model/run",
        json={"file_path": TEST_MODEL, "composition_name": "stroop_model", "inputs": THREE_TRIALS},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    _assert_trial_seconds(data, data["timings"]["run_ms"] / 1000)


def test_in_process_run_returns_trial_times_too():
    import time

    t0 = time.perf_counter()
    data = _run_model_inprocess(TEST_MODEL, "stroop_model", THREE_TRIALS)
    _assert_trial_seconds(data, time.perf_counter() - t0)


def test_existing_trial_callbacks_are_chained_not_replaced():
    """A callback already passed to run() still fires, with its context."""
    calls = []
    kwargs = {
        "call_before_trial": lambda context: calls.append(("before", context)),
        "call_after_trial": lambda: calls.append(("after", None)),
    }
    secs = add_trial_timing(kwargs)
    for _ in range(2):
        kwargs["call_before_trial"](context="ctx")
        kwargs["call_after_trial"](context="ctx")
    assert calls == [("before", "ctx"), ("after", None)] * 2
    assert len(secs) == 2 and all(s >= 0 for s in secs)
