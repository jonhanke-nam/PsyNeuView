"""The bistable-attractor demo behaves as the course says it does (#50).

The Dynamic Systems walkthrough opens this demo, types the course's kick into
the Run panel (2 and 6 on the first trial, then nine trials of zero) and runs
it. If the model stopped settling where the notebook says, the walkthrough would
still pass its own steps while teaching the wrong thing. So this pins the
numbers, not just that the demo loads.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

KICK = {
    "node_attract1": [[2.0]] + [[0.0]] * 9,
    "node_attract2": [[6.0]] + [[0.0]] * 9,
}


@pytest.fixture
def loaded(tmp_path, monkeypatch):
    # /demos/reset writes a working copy; keep it out of backend/ (#1134).
    monkeypatch.setenv("PSYNEWVIEW_WORKING_DIR", str(tmp_path))
    resp = client.post("/api/demos/reset", json={"demo_name": "bistable_attractor"})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_demo_is_listed_under_a_readable_label():
    demos = client.get("/api/demos").json()["demos"]
    labels = {d["name"]: d["label"] for d in demos}
    assert labels.get("bistable_attractor") == "Bistable Attractor"


def test_both_nodes_take_input(loaded):
    """In a loop, PsyNeuLink treats both nodes as inputs. The walkthrough
    fills both, so the Run panel has to offer both."""
    resp = client.post(
        "/api/model/input-nodes",
        json={"file_path": loaded["file_path"], "composition_name": "bistable_attractor"},
    )
    assert resp.status_code == 200, resp.text
    names = sorted(n["name"] for n in resp.json()["inputNodes"])
    assert names == ["node_attract1", "node_attract2"]


def test_the_kick_settles_where_the_notebook_says(loaded):
    resp = client.post(
        "/api/model/run",
        json={
            "file_path": loaded["file_path"],
            "composition_name": "bistable_attractor",
            "inputs": KICK,
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["numTrials"] == 10
    last = [float(v) for v in _flatten(data["results"][-1]["output"])]
    # The notebook's run of the same model, same inputs.
    assert last == pytest.approx([0.398, 0.404], abs=2e-3)


def _flatten(value):
    if isinstance(value, (list, tuple)):
        for item in value:
            yield from _flatten(item)
    else:
        yield value
