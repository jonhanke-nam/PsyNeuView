"""The show_graph tab's picture draws green and purple as show_graph's PDF does (#190).

Graphviz keeps show_graph's colour names in its SVG, and a browser reads
"green" as #008000 where the PDF draws #00ff00, and "purple" as #800080 where
the PDF draws #a020f0. The worker redraws the SVG
before the tab gets it, and the cache key of a picture carries the redraw's
version, so a picture kept before the change is not shown again.
"""

import shutil

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import show_graph_cache, show_graph_picture
from app.services.show_graph_picture import GRAPHVIZ_COLOURS, as_graphviz_draws_it


def test_green_attributes_take_the_x11_value():
    svg = (
        '<ellipse fill="none" stroke="green" cx="27" cy="-18" rx="27" ry="18"/>\n'
        '<text fill="green">input</text>'
    )
    assert as_graphviz_draws_it(svg) == (
        '<ellipse fill="none" stroke="#00ff00" cx="27" cy="-18" rx="27" ry="18"/>\n'
        '<text fill="#00ff00">input</text>'
    )


def test_purple_attributes_take_the_x11_value():
    svg = (
        '<polygon fill="none" stroke="purple" points="0,0"/>\n'
        '<text fill="purple">controller</text>'
    )
    assert as_graphviz_draws_it(svg) == (
        '<polygon fill="none" stroke="#a020f0" points="0,0"/>\n'
        '<text fill="#a020f0">controller</text>'
    )


def test_other_colours_and_nodes_named_for_a_colour_are_left_alone():
    svg = (
        '<ellipse fill="none" stroke="red"/>'
        '<ellipse fill="none" stroke="blue"/>'
        '<ellipse fill="none" stroke="orange"/>'
        '<ellipse fill="none" stroke="pink"/>'
        '<ellipse fill="none" stroke="brown"/>'
        '<ellipse fill="none" stroke="black"/>'
        '<ellipse fill="none" stroke="mediumpurple"/>'
        '<text fill="black">green</text>'
        '<title>purple</title>'
    )
    assert as_graphviz_draws_it(svg) == svg


def test_only_green_and_purple_are_redrawn():
    """The two names show_graph uses that a browser reads differently from its
    PDF. Its other colours read the same both ways."""
    assert GRAPHVIZ_COLOURS == {"green": "#00ff00", "purple": "#a020f0"}


@pytest.mark.skipif(shutil.which("dot") is None, reason="needs the Graphviz programs")
def test_graphviz_output_for_a_green_node_is_redrawn():
    """What Graphviz actually writes for ``color=green`` comes out #00ff00."""
    import graphviz as gv

    svg = gv.Source("digraph { a [color=green fontcolor=green]; b [color=red] }").pipe(format="svg").decode()
    assert 'stroke="green"' in svg, "the Graphviz SVG no longer names the colour; is the redraw still needed?"
    redrawn = as_graphviz_draws_it(svg)
    assert '"green"' not in redrawn
    assert redrawn.count('"#00ff00"') == svg.count('"green"')
    assert 'stroke="red"' in redrawn


def test_the_tab_gets_the_redrawn_picture_of_a_real_model(tmp_path):
    """The route the tab calls hands it an INPUT node drawn #00ff00."""
    model = tmp_path / "three_layer.py"
    model.write_text(
        "import psyneulink as pnl\n"
        'colour = pnl.TransferMechanism(name="colour")\n'
        'response = pnl.TransferMechanism(name="response")\n'
        'comp = pnl.Composition(name="three_layer")\n'
        "comp.add_linear_processing_pathway([colour, response])\n"
    )
    response = TestClient(app).post(
        "/api/model/show-graph",
        json={"file_path": str(model), "composition_name": "three_layer", "options": {}},
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert '"#00ff00"' in result["svg"]
    assert '"green"' not in result["svg"]


def test_the_tab_draws_a_controller_in_the_x11_purple(tmp_path):
    """The route the tab calls hands it a controller drawn #a020f0."""
    model = tmp_path / "with_controller.py"
    model.write_text(
        "import psyneulink as pnl\n"
        'stimulus = pnl.TransferMechanism(name="stimulus")\n'
        'decision = pnl.TransferMechanism(name="decision")\n'
        'comp = pnl.Composition(name="with_controller")\n'
        "comp.add_linear_processing_pathway([stimulus, decision])\n"
        "comp.add_controller(pnl.OptimizationControlMechanism(\n"
        '    name="controller",\n'
        "    agent_rep=comp,\n"
        "    state_features=[stimulus.input_port],\n"
        "    objective_mechanism=pnl.ObjectiveMechanism(monitor=[decision]),\n"
        "    function=pnl.GridSearch(),\n"
        "    control_signals=[pnl.ControlSignal(\n"
        '        modulates=("slope", decision), allocation_samples=[1.0, 2.0])],\n'
        "))\n"
    )
    response = TestClient(app).post(
        "/api/model/show-graph",
        json={"file_path": str(model), "composition_name": "with_controller", "options": {"show_controller": True}},
    )
    assert response.status_code == 200, response.text
    svg = response.json()["svg"]
    assert '"#a020f0"' in svg
    assert '"purple"' not in svg


def test_a_picture_kept_before_the_redraw_changed_is_not_shown_again(tmp_path, monkeypatch):
    model = tmp_path / "model.py"
    model.write_text("comp = None\n")
    before = show_graph_cache.cache_key(str(model), "comp", {}, "svg")
    dot_before = show_graph_cache.cache_key(str(model), "comp", {}, "dot")
    monkeypatch.setattr(show_graph_picture, "PICTURE_VERSION", show_graph_picture.PICTURE_VERSION + 1)
    monkeypatch.setattr(show_graph_cache, "PICTURE_VERSION", show_graph_picture.PICTURE_VERSION)
    assert show_graph_cache.cache_key(str(model), "comp", {}, "svg") != before
    # A description is laid out by the page with its own colours: unaffected.
    assert show_graph_cache.cache_key(str(model), "comp", {}, "dot") == dot_before
