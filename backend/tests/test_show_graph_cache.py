"""show_graph answers are reused until the model, its folder or PsyNeuLink changes (#22)."""

import os

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import sandbox, show_graph_cache

client = TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def runner(monkeypatch):
    """Stand-in for the model runner that counts how often it is asked."""
    calls = []

    def fake_run(task, params, timeout=None):
        calls.append(params)
        if params["composition_name"] == "refused":
            return {"error": "show_graph failed: use show_pytorch=True"}
        if params["composition_name"] == "crashed":
            return {"error": "Worker communication error: broken pipe"}
        return {"dot": f"digraph {{ /* call {len(calls)} */ }}"}

    monkeypatch.setattr(sandbox, "run_in_sandbox", fake_run)
    show_graph_cache.clear()
    yield calls
    show_graph_cache.clear()


@pytest.fixture
def model(tmp_path):
    path = tmp_path / "model.py"
    path.write_text("comp = None\n")
    return path


def ask(path, composition="comp", **options):
    return client.post("/api/model/show-graph", json={
        "file_path": str(path),
        "composition_name": composition,
        "options": options,
        "format": "dot",
    })


def test_unchanged_model_is_not_reloaded(runner, model):
    first = ask(model)
    second = ask(model)
    assert first.status_code == second.status_code == 200
    assert second.json() == first.json()
    assert len(runner) == 1


def test_different_options_or_composition_are_asked_separately(runner, model):
    ask(model)
    ask(model, show_learning=True)
    ask(model, composition="other")
    assert len(runner) == 3


def test_edited_model_is_reloaded(runner, model):
    ask(model)
    model.write_text("comp = 1\n")
    ask(model)
    assert len(runner) == 2


def test_edited_helper_module_next_to_the_model_is_noticed(runner, model):
    helper = model.parent / "helpers.py"
    helper.write_text("X = 1\n")
    ask(model)
    helper.write_text("X = 22\n")
    st = helper.stat()
    os.utime(helper, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))
    ask(model)
    assert len(runner) == 2


def test_show_graph_refusal_is_kept(runner, model):
    # Same model, same refusal: no need to reload it to hear it again.
    first = ask(model, composition="refused")
    second = ask(model, composition="refused")
    assert first.status_code == second.status_code == 400
    assert second.json() == first.json()
    assert len(runner) == 1


def test_runner_failures_are_retried(runner, model):
    assert ask(model, composition="crashed").status_code == 400
    assert ask(model, composition="crashed").status_code == 400
    assert len(runner) == 2


def test_restarting_the_runner_forgets_answers(runner, model):
    # A restart is how a new PsyNeuLink takes effect.
    ask(model)
    sandbox.restart_warm_worker()
    ask(model)
    assert len(runner) == 2


def test_cache_stays_bounded(monkeypatch):
    monkeypatch.setattr(show_graph_cache, "MAX_ENTRIES", 3)
    show_graph_cache.clear()
    for i in range(5):
        show_graph_cache.put(f"k{i}", {"dot": str(i)})
    assert show_graph_cache.get("k0") is None
    assert show_graph_cache.get("k4") == {"dot": "4"}
    show_graph_cache.clear()
