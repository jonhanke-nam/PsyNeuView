"""The semantic-network demo learns what the course says it learns (#53).

The Rumelhart walkthrough trains this demo on all 24 noun-relation pairs and
quotes what the network then says a robin is, then trains the notebook's
Exercise 3 variant and quotes how the irrelevant answers change. If the demo
stopped learning that, the walkthrough would still pass its steps while
teaching the wrong thing, so this pins the losses and the answers, not just
that training runs.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

COMPOSITION = "rumelhart_semantic_network"
NOUNS = ["oak", "pine", "rose", "daisy", "canary", "robin", "salmon", "sunfish"]
IS = ["living", "living thing", "plant", "animal", "tree", "flower", "bird", "fish",
      "big", "green", "red", "yellow"]
HAS = ["roots", "leaves", "bark", "branches", "skin", "feathers", "wings", "gills", "scales"]
ROBIN_IS = 5 * 3 + 0  # trial index of (robin, is) in the training sets
OUT_I, OUT_IS, OUT_HAS, OUT_CAN = range(4)


@pytest.fixture
def loaded(tmp_path, monkeypatch):
    # /demos/reset writes a working copy; keep it out of backend/ (#1134).
    monkeypatch.setenv("PSYNEWVIEW_WORKING_DIR", str(tmp_path))
    resp = client.post("/api/demos/reset", json={"demo_name": "rumelhart_semantic_network"})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _sets(loaded):
    return {s["name"]: s for s in loaded["model"]["inputSets"]}


def _train(file_path, training_set):
    resp = client.post(
        "/api/model/learn",
        json={
            "file_path": file_path,
            "composition_name": COMPOSITION,
            "inputs": training_set["inputs"],
            "targets": training_set["targets"],
            "epochs": training_set["epochs"],
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "error" not in data, data.get("error")
    assert data["epochs"] == 100
    return data


def _answers(data, trial):
    """The four output vectors of one trial of the training's last pass."""
    return [[float(v) for v in vec] for vec in data["results"][trial]["output"]]


def test_demo_is_listed_under_a_readable_label():
    labels = {d["name"]: d["label"] for d in client.get("/api/demos").json()["demos"]}
    assert labels.get("rumelhart_semantic_network") == "Rumelhart Semantic Network"


def test_the_sets_are_declared(loaded):
    """Two training sets and two questions, picked by name in the app."""
    sets = _sets(loaded)
    assert [(n, s["kind"]) for n, s in sets.items()] == [
        ("all_relations", "learn"),
        ("all_relations_discounted", "learn"),
        ("robin_is", "run"),
        ("salmon_can", "run"),
    ]
    assert sets["all_relations"]["epochs"] == 100
    assert len(sets["all_relations"]["inputs"]["input_nouns"]) == 24


def test_untrained_it_says_yes_to_everything(loaded):
    resp = client.post(
        "/api/model/run",
        json={
            "file_path": loaded["file_path"],
            "composition_name": COMPOSITION,
            "inputs": _sets(loaded)["robin_is"]["inputs"],
        },
    )
    assert resp.status_code == 200, resp.text
    outputs = [float(v) for v in _flatten(resp.json()["results"][0]["output"])]
    assert len(outputs) == 8 + 12 + 9 + 9
    assert min(outputs) > 0.99


def test_it_learns_what_a_robin_is(loaded):
    data = _train(loaded["file_path"], _sets(loaded)["all_relations"])
    assert data["epochLosses"][0] == pytest.approx(3.49, abs=0.1)
    assert data["finalLoss"] == pytest.approx(0.041, abs=0.01)
    out = _answers(data, ROBIN_IS)
    assert NOUNS[max(range(8), key=out[OUT_I].__getitem__)] == "robin"
    is_ = dict(zip(IS, out[OUT_IS]))
    assert is_["living"] == pytest.approx(0.97, abs=0.03)
    assert is_["animal"] == pytest.approx(0.88, abs=0.05)
    assert is_["bird"] == pytest.approx(0.80, abs=0.05)
    assert is_["yellow"] == pytest.approx(0.82, abs=0.05)
    assert is_["fish"] == pytest.approx(0.14, abs=0.05)
    # The relations not asked about stay quiet.
    assert max(out[OUT_HAS]) < 0.15
    assert max(out[OUT_CAN]) < 0.15


def test_discounting_keeps_the_irrelevant_answers(loaded):
    """Exercise 3: with the irrelevant outputs' targets halved rather than
    zeroed, robin + is also says skin, feathers and wings at about 0.5."""
    data = _train(loaded["file_path"], _sets(loaded)["all_relations_discounted"])
    assert data["finalLoss"] == pytest.approx(0.013, abs=0.01)
    out = _answers(data, ROBIN_IS)
    has = dict(zip(HAS, out[OUT_HAS]))
    for feature in ("skin", "feathers", "wings"):
        assert has[feature] == pytest.approx(0.5, abs=0.08)
    assert has["gills"] < 0.1
    assert dict(zip(IS, out[OUT_IS]))["bird"] > 0.75


def _flatten(value):
    if isinstance(value, str):
        yield from (float(v) for v in value.strip("[]").split())
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _flatten(item)
    else:
        yield float(value)
