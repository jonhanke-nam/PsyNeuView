"""The page draws projections, self-loops and control nodes as show_graph does (#425).

Gilzenrat, opened from the Library, differed from show_graph in three ways
the backend decides:

- its LC (an LCControlMechanism, a node of the composition, not its
  controller) came with no role saying it controls, so the canvas drew it
  black, where show_graph draws any ControlMechanism in its control colour;
- the recurrent projections of RESPONSE and DECISION LAYER (each an LCA's
  projection to itself) were dropped as "self-loops", so the canvas had none;
- nothing said how show_graph draws each projection (a box at the end of a
  control projection, an arrow on the rest). Each load now sends show_graph's
  own edges, read from its description (``showGraphEdges``).
"""

import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import show_graph_cache
from app.services.sandbox_worker import show_graph_edge_looks

client = TestClient(app, raise_server_exceptions=False)

BACKEND = Path(__file__).resolve().parent.parent


@pytest.fixture(autouse=True)
def empty_cache():
    show_graph_cache.clear()
    yield
    show_graph_cache.clear()


def load(tmp_path, rel, **extra):
    path = tmp_path / Path(rel).name
    shutil.copy(BACKEND / rel, path)
    resp = client.post("/api/model/load", json={"file_path": str(path), **extra})
    assert resp.status_code == 200, resp.text
    return resp.json()["model"]


def test_reads_each_edges_look_from_show_graphs_description():
    dot = "\n".join([
        'digraph "Composition-0" {',
        "\tnode [color=black fontname=arial fontsize=12 penwidth=1 shape=record]",
        "\tedge [fontname=arial fontsize=10]",
        '\t"DECISION LAYER" -> "DECISION LAYER" [label="" arrowhead=normal color=black penwidth=1]',
        '\tLC -> RESPONSE [label="" arrowhead=box color=blue penwidth=1]',
        '\t"say \\"hi\\"":"OutputPort-x" -> LC:"InputPort-y" [color=purple style=dashed]',
        '\tLC [color=blue penwidth=3 rank=max shape=octagon]',
        '\t"INPUT LAYER" -> LC [arrowhead=none constraint=true style=invis weight=100]',
        "}",
    ])
    assert show_graph_edge_looks(dot) == [
        {"sender": "DECISION LAYER", "receiver": "DECISION LAYER",
         "arrowhead": "normal", "color": "black", "penwidth": "1"},
        {"sender": "LC", "receiver": "RESPONSE", "arrowhead": "box", "color": "blue", "penwidth": "1"},
        {"sender": 'say "hi"', "receiver": "LC", "color": "purple", "style": "dashed"},
    ]
    assert show_graph_edge_looks("") == []
    assert show_graph_edge_looks(None) == []


# Each model's nodes with a projection to themselves.
SELF_LOOPS = {
    "reference_models/GilzenratModel.py": {"DECISION LAYER", "RESPONSE"},
    "reference_models/Nieuwenhuis2005Model.py": {"DECISION LAYER", "RESPONSE LAYER"},
}


def projections(model):
    return [p for c in model["compositions"] for p in c["projections"]]


@pytest.mark.parametrize("flat", [False, True])
@pytest.mark.parametrize("rel", sorted(SELF_LOOPS))
def test_a_nodes_projection_to_itself_reaches_the_page(tmp_path, rel, flat):
    model = load(tmp_path, rel, flat=flat)
    loops = {p["sender"]["mechanism"] for p in projections(model)
             if p["sender"]["mechanism"] == p["receiver"]["mechanism"]}
    assert loops == SELF_LOOPS[rel]
    # show_graph draws the same loops.
    drawn = {e["sender"] for e in model["showGraphEdges"] if e["sender"] == e["receiver"]}
    assert drawn == SELF_LOOPS[rel]


def test_a_composition_without_self_loops_has_none(tmp_path):
    model = load(tmp_path, "reference_models/stroop_reference_basic.py")
    assert not [p for p in projections(model) if p["sender"]["mechanism"] == p["receiver"]["mechanism"]]


@pytest.mark.parametrize("rel", [
    "reference_models/GilzenratModel.py",
    "reference_models/Nieuwenhuis2005Model.py",
    "reference_models/stroop_reference_with_lc.py",
])
def test_a_control_mechanism_node_has_the_control_role(tmp_path, rel):
    model = load(tmp_path, rel)
    nodes = {n["name"]: n for c in model["compositions"] for n in c["nodes"]}
    assert "CONTROL" in nodes["LC"]["roles"]
    # Its control projections are show_graph's: solid, blue, a box at the end.
    controls = [e for e in model["showGraphEdges"] if e["sender"] == "LC"]
    assert controls
    assert all(e["arrowhead"] == "box" and e["color"] == "blue" and "style" not in e for e in controls)
    # Nothing else is a control node.
    assert [n for n in nodes if "CONTROL" in nodes[n]["roles"]] == ["LC"]
