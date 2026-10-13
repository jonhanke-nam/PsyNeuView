"""The ISC-CI demo is the notebook's model, and trains as the walkthrough says (#58).

The ISC-CI walkthrough runs the notebook's test (an owl and a falcon, then a
cat or a penguin) on the untrained network and quotes that it knows nothing
yet, then trains the demo's 24 episodes and quotes the loss and what the last
pass shows: every answer right, the context still unsure. This pins those
numbers, the slice of the Leuven data the demo carries, and that the
episodes follow the notebook's recipe.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

COMPOSITION = "iscci_model"
CONTEXT_LABEL, RESPONSE = range(2)


@pytest.fixture
def loaded(tmp_path, monkeypatch):
    # /demos/reset writes a working copy; keep it out of backend/ (#1134).
    monkeypatch.setenv("PSYNEWVIEW_WORKING_DIR", str(tmp_path))
    resp = client.post("/api/demos/reset", json={"demo_name": COMPOSITION})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _sets(loaded):
    return {s["name"]: s for s in loaded["model"]["inputSets"]}


def _module():
    import importlib.util
    from pathlib import Path

    path = Path(__file__).parent.parent / "demos" / "iscci_model.py"
    spec = importlib.util.spec_from_file_location("iscci_model_check", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_demo_is_listed_under_a_readable_label():
    labels = {d["name"]: d["label"] for d in client.get("/api/demos").json()["demos"]}
    assert labels.get(COMPOSITION) == "ISC-CI Model"


def test_the_sets_are_declared(loaded):
    sets = _sets(loaded)
    assert [(n, s["kind"]) for n, s in sets.items()] == [
        ("owl_falcon_test", "run"),
        ("episodes", "learn"),
    ]
    assert sets["episodes"]["epochs"] == 30
    assert len(sets["episodes"]["inputs"]["query"]) == 24
    assert len(sets["owl_falcon_test"]["inputs"]["query"]) == 2


def test_the_data_slice():
    """24 objects with 64-number embeddings; 10 contexts. Owl and falcon
    share five of them, and eats mice, the smallest, is the one the cat
    is in and the penguin isn't (the notebook's Exercise 1)."""
    m = _module()
    assert len(m.OBJECTS) == 24
    assert all(len(v) == 64 for v in m.EMBEDDINGS.values())
    assert m.N_CONTEXT == 10
    shared = [c for c in m.CONTEXTS if {"owl", "falcon"} <= set(m.MEMBERS[c])]
    assert shared == ["eats mice", "is a bird", "can fly", "has feathers", "builds nests"]
    assert m.MEMBERS["eats mice"] == ["owl", "falcon", "cat", "viper"]
    assert "penguin" in m.MEMBERS["is a bird"]


def test_the_episodes_follow_the_notebooks_recipe():
    m = _module()
    for e in m._episodes:
        context = m.CONTEXTS[e["context_label"].index(1)]
        members = [o for o in m.OBJECTS if m.EMBEDDINGS[o] in (e["support_1"], e["support_2"])]
        assert set(members) <= set(m.MEMBERS[context])
        query = next(o for o in m.OBJECTS if m.EMBEDDINGS[o] == e["query"])
        assert (query in m.MEMBERS[context]) == (e["response"] == [1, 0])


def test_untrained_it_knows_nothing(loaded):
    resp = client.post(
        "/api/model/run",
        json={
            "file_path": loaded["file_path"],
            "composition_name": COMPOSITION,
            "inputs": _sets(loaded)["owl_falcon_test"]["inputs"],
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert not data.get("error"), data.get("error")
    assert data["outputLabels"] == ["context_label", "response"]
    for trial in data["results"]:
        label = [float(v) for v in trial["output"][CONTEXT_LABEL]]
        answer = [float(v) for v in trial["output"][RESPONSE]]
        assert label == pytest.approx([0.1] * 10, abs=0.005)
        assert answer == pytest.approx([0.5, 0.5], abs=0.005)


def test_training_brings_the_loss_down(loaded):
    s = _sets(loaded)["episodes"]
    resp = client.post(
        "/api/model/learn",
        json={
            "file_path": loaded["file_path"],
            "composition_name": COMPOSITION,
            "inputs": s["inputs"],
            "targets": s["targets"],
            "epochs": s["epochs"],
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "error" not in data, data.get("error")
    assert data["epochLosses"][0] == pytest.approx(0.34, abs=0.02)
    assert data["finalLoss"] == pytest.approx(0.08, abs=0.03)

    # The walkthrough's point about what it learned: on the last pass every
    # answer is right, at 0.94 or better, while the context label stays
    # unsure (never above 0.42). It memorized; it didn't infer a context.
    targets = s["targets"]["response"]
    right, surest = [], []
    for trial, target in zip(data["results"], targets):
        label = [float(v) for v in trial["output"][CONTEXT_LABEL]]
        answer = [float(v) for v in trial["output"][RESPONSE]]
        right.append(answer[0] if target[0] == 1 else answer[1])
        surest.append(max(label))
    assert len(right) == 24
    assert min(right) == pytest.approx(0.94, abs=0.03)
    assert max(surest) == pytest.approx(0.42, abs=0.05)
