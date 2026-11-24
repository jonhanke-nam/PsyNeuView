"""Live run progress and Learn's per-trial times (#357).

While a run is going, the worker reports each finished trial; the Run panel
polls ``/api/model/run/progress/{id}`` and shows "Trial 3 of 10 · 0.42 s".
Learn returns the per-trial times the Run panel already has (#334), each
trial's mean over the epochs.
"""

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.services import run_progress
from app.services.executor import learn_model, run_model
from app.services.pathway_learning import mean_trial_seconds
from app.services.sandbox_worker import add_trial_timing

client = TestClient(app)

BACKEND = Path(__file__).parent.parent
TEST_MODEL = str(BACKEND / "test_model.py")
TD = str(BACKEND / "demos" / "td_learning.py")
THREE_TRIALS = {
    "colors_input": [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]],
    "words_input": [[0.0, 0.0, 1.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]],
}


def test_the_timing_hook_reports_each_finished_trial():
    seen = []
    kwargs = {}
    secs = add_trial_timing(kwargs, on_trial=lambda n, s: seen.append((n, s)))
    for _ in range(3):
        kwargs["call_before_trial"]()
        kwargs["call_after_trial"]()
    assert [n for n, _ in seen] == [1, 2, 3]
    assert [s for _, s in seen] == secs


def test_a_failing_progress_callback_never_fails_the_run():
    kwargs = {}
    secs = add_trial_timing(kwargs, on_trial=lambda n, s: 1 / 0)
    kwargs["call_before_trial"]()
    kwargs["call_after_trial"]()
    assert len(secs) == 1


def test_the_sandboxed_run_streams_one_event_per_trial():
    events = []
    result = run_model(TEST_MODEL, "stroop_model", THREE_TRIALS, on_progress=events.append)
    assert "error" not in result, result
    assert [e["trial"] for e in events] == [1, 2, 3]
    # The streamed times are the ones the response carries.
    assert [e["seconds"] for e in events] == result["trial_seconds"]


def test_progress_entries_live_only_while_their_run_does():
    run_progress.start("abc", 10)
    run_progress.update("abc", {"trial": 3, "seconds": 0.42})
    resp = client.get("/api/model/run/progress/abc")
    assert resp.status_code == 200
    assert resp.json() == {"trial": 3, "total": 10, "seconds": 0.42}
    run_progress.finish("abc")
    assert client.get("/api/model/run/progress/abc").status_code == 404


def test_a_run_with_a_progress_id_succeeds_and_cleans_up():
    resp = client.post("/api/model/run", json={
        "file_path": TEST_MODEL, "composition_name": "stroop_model",
        "inputs": THREE_TRIALS, "progress_id": "run-357",
    })
    assert resp.status_code == 200, resp.text
    assert run_progress.get("run-357") is None


def test_mean_trial_seconds_averages_each_trial_over_the_epochs():
    assert mean_trial_seconds([1, 2, 3, 3, 4, 5], num_trials=3, epochs=2) == [2.0, 3.0, 4.0]
    assert mean_trial_seconds([1, 2, 3], num_trials=2, epochs=2) == []


def test_learn_returns_one_time_per_trial():
    result = client.post("/api/model/learn", json={
        "file_path": TD, "composition_name": "td_learning",
        "inputs": {"cue": [[1.0] * 10] * 4},
        "targets": {"value_estimate": [[1.0 if t == 7 else 0.0 for t in range(10)]] * 4},
        "epochs": 3,
    })
    assert result.status_code == 200, result.text
    secs = result.json()["trial_seconds"]
    assert len(secs) == 4 and all(s > 0 for s in secs)


def test_autodiff_learn_returns_one_time_per_trial():
    result = learn_model(
        str(BACKEND / "demos" / "autodiff_feedforward.py"), "autodiff_comp",
        {"input_layer": [[1.0, 0.0], [0.0, 1.0]]}, {"output_layer": [[1.0, 0.0], [0.0, 1.0]]},
        epochs=3,
    )
    assert "error" not in result, result
    assert len(result["trial_seconds"]) == 2
