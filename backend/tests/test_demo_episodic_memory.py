"""The episodic-memory demo draws the nodes its walkthrough names (#54).

The walkthrough follows a query through the EMComposition by selecting nodes
by name: [QUERY], [FIELD_MEMORY], [WEIGHTED SCORES], COMBINED SCORES,
[RETRIEVED]. Those names come from PsyNeuLink, and they have changed before:
the course notebook still describes STORE and MATCH nodes that 0.19 no longer
builds. If a PsyNeuLink bump renames them again, this fails here, with the
names, rather than as a walkthrough step that can't find its node.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

NAMED_BY_THE_WALKTHROUGH = {
    "1 [QUERY]", "1 [FIELD_MEMORY]", "1 [WEIGHTED SCORES]", "COMBINED SCORES", "1 [RETRIEVED]",
}


@pytest.fixture
def model(tmp_path, monkeypatch):
    # /demos/reset writes a working copy; keep it out of backend/ (#1134).
    monkeypatch.setenv("PSYNEWVIEW_WORKING_DIR", str(tmp_path))
    resp = client.post("/api/demos/reset", json={"demo_name": "episodic_memory"})
    assert resp.status_code == 200, resp.text
    return resp.json()["model"]


def test_demo_is_listed_under_a_readable_label():
    labels = {d["name"]: d["label"] for d in client.get("/api/demos").json()["demos"]}
    assert labels.get("episodic_memory") == "Episodic Memory"


def test_the_nodes_the_walkthrough_names_exist(model):
    names = {n.get("id") or n.get("name") for c in model["compositions"] for n in c["nodes"]}
    missing = NAMED_BY_THE_WALKTHROUGH - names
    assert not missing, f"walkthrough names nodes the model no longer has: {sorted(missing)}; it has {sorted(names)}"


def test_three_fields(model):
    names = {n.get("id") or n.get("name") for c in model["compositions"] for n in c["nodes"]}
    assert {f"{i} [QUERY]" for i in (1, 2, 3)} <= names
    assert {f"{i} [RETRIEVED]" for i in (1, 2, 3)} <= names
