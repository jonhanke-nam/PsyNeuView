"""The page gets the shape show_graph draws each node in (#385).

show_graph draws a node on a cycle as a double circle, which Graphviz makes
as wide as it is tall, and the canvas drew it as an oval. Each load now reads
the shape of every node from show_graph's own description and sends it with
the model (``showGraphShapes``), so the canvas draws the same shape.
"""

import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import show_graph_cache
from app.services.sandbox_worker import show_graph_node_shapes

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


def test_reads_each_nodes_shape_from_show_graphs_description():
    dot = "\n".join([
        "digraph Model {",
        "\tgraph [label=Model overlap=False rankdir=BT]",
        "\tnode [color=black fontname=arial fontsize=12 penwidth=1 shape=record]",
        '\t"COLOR HIDDEN" [label="COLOR HIDDEN" color=black penwidth=1 rank=same shape=doublecircle]',
        "\tTASK [color=green penwidth=3 rank=source shape=oval]",
        '\t"say \\"hi\\"" [shape=octagon]',
        '\t"COLOR HIDDEN" -> TASK [color=black arrowhead=normal]',
        "\tsubgraph cluster_EM {",
        "\t\tEM_node [shape=oval]",
        "\t}",
        "}",
    ])
    assert show_graph_node_shapes(dot) == {
        "COLOR HIDDEN": "doublecircle",
        "TASK": "oval",
        'say "hi"': "octagon",
        "EM_node": "oval",
    }
    assert show_graph_node_shapes("") == {}
    assert show_graph_node_shapes(None) == {}


# Each model's nodes show_graph draws as circles: its nodes on a cycle.
CIRCLES = {
    "reference_models/Cohen_Huston1994.py": {"COLOR HIDDEN", "WORD HIDDEN", "TASK DEMAND", "RESPONSE"},
    "reference_models/GilzenratModel.py": {"DECISION LAYER", "RESPONSE"},
    "demos/hopfield_network.py": {"hopfield"},
}


@pytest.mark.parametrize("model", sorted(CIRCLES))
def test_the_load_sends_show_graphs_circles(tmp_path, model):
    shapes = load(tmp_path, model)["showGraphShapes"]
    circles = {name for name, shape in shapes.items() if shape in ("circle", "doublecircle")}
    assert circles == CIRCLES[model]
    # Every other node of these models is one of show_graph's ovals or octagons.
    assert set(shapes.values()) <= {"oval", "doublecircle", "octagon"}


def test_other_shapes_reach_the_page_too(tmp_path):
    # Gilzenrat's LC sends feedback: show_graph's octagon. A controller is a
    # double octagon.
    assert load(tmp_path, "reference_models/GilzenratModel.py")["showGraphShapes"]["LC"] == "octagon"
    assert load(tmp_path, "demos/stroop_with_control.py")["showGraphShapes"]["CONTROL"] == "doubleoctagon"


@pytest.mark.parametrize("flat", [False, True])
def test_shapes_come_with_a_show_graph_load_and_every_view(tmp_path, flat):
    """A load that asks for the Like show_graph layout reuses its answer, in
    the nested and the flattened view; EGO's octagon is inside a nested
    composition, and its learning picture (a PyTorch one) isn't used."""
    model = load(
        tmp_path, "reference_models/Giallanza2024_ego_study2.py", flat=flat,
        show_graph={"show_controller": True, "show_learning": True},
    )
    assert model["showGraphShapes"]["COMBINED SCORES"] == "octagon"
