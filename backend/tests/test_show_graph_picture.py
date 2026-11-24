"""The show_graph tab's picture draws its colours as show_graph's PDF does (#190, #424).

Graphviz keeps show_graph's colour names in its SVG, and a browser reads
"green" as #008000 where the PDF draws #00ff00, "purple" as #800080 where
the PDF draws #a020f0, grey as #808080 where it draws #c0c0c0. The worker
redraws every colour name with Graphviz's X11 value before the tab gets it, and the cache key of a picture carries the redraw's
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


def test_nodes_named_for_a_colour_are_left_alone():
    svg = (
        '<text fill="black">green</text>'
        '<title>purple</title>'
        '<g id="node1" class="node"><text>grey</text></g>'
    )
    assert as_graphviz_draws_it(svg) == svg.replace('fill="black"', 'fill="#000000"')


def test_every_name_in_graphvizs_table_is_redrawn():
    """The full X11 table Graphviz draws with (#424), not just the names
    show_graph uses by default."""
    assert len(GRAPHVIZ_COLOURS) > 600
    for name, value in GRAPHVIZ_COLOURS.items():
        assert as_graphviz_draws_it(f'<path stroke="{name}"/>') == f'<path stroke="{value}"/>'


@pytest.mark.parametrize(
    ("name", "x11"),
    [
        # The names whose X11 value differs from the browser's CSS one.
        ("green", "#00ff00"),
        ("purple", "#a020f0"),
        ("gray", "#c0c0c0"),
        ("grey", "#c0c0c0"),
        ("maroon", "#b03060"),
        # Numbered variants, and grey spelt both ways.
        ("gray50", "#7f7f7f"),
        ("grey50", "#7f7f7f"),
        ("green4", "#008b00"),
        ("lightgrey", "#d3d3d3"),
        # Names that read the same in both tables still come out as hex.
        ("red", "#ff0000"),
        ("black", "#000000"),
    ],
)
def test_names_take_graphvizs_x11_value(name, x11):
    assert GRAPHVIZ_COLOURS[name] == x11
    assert as_graphviz_draws_it(f'<ellipse stroke="{name}"/>') == f'<ellipse stroke="{x11}"/>'


def test_names_match_whatever_their_case():
    """Graphviz keeps a name as written, so color=GREEN arrives as "GREEN"."""
    assert as_graphviz_draws_it('<ellipse stroke="GREEN" fill="Gray50"/>') == (
        '<ellipse stroke="#00ff00" fill="#7f7f7f"/>'
    )


def test_fill_stroke_color_and_stop_color_attributes():
    svg = (
        '<ellipse fill="purple" stroke=\'green\'/>'
        '<g color="maroon"/>'
        '<stop offset="0" stop-color="grey"/>'
    )
    assert as_graphviz_draws_it(svg) == (
        '<ellipse fill="#a020f0" stroke=\'#00ff00\'/>'
        '<g color="#b03060"/>'
        '<stop offset="0" stop-color="#c0c0c0"/>'
    )


def test_inline_style_declarations():
    """Graphviz writes a gradient's stops as style="stop-color:...;"."""
    svg = (
        '<stop offset="0" style="stop-color:green;stop-opacity:1.0;"/>'
        '<path style="fill: purple; stroke:Gray50 !important"/>'
    )
    assert as_graphviz_draws_it(svg) == (
        '<stop offset="0" style="stop-color:#00ff00;stop-opacity:1.0;"/>'
        '<path style="fill: #a020f0; stroke:#7f7f7f !important"/>'
    )


def test_hex_none_transparent_and_gradients_are_left_alone():
    svg = (
        '<ellipse fill="none" stroke="#00FF00"/>'
        '<polygon fill="transparent" stroke="#a020f080"/>'
        '<path fill="url(#l_1)" stroke="currentColor"/>'
        '<path fill-opacity="0.5" stroke-width="2"/>'
        '<stop style="stop-color:#123456;stop-opacity:0;"/>'
        '<path fill="notacolour"/>'
    )
    assert as_graphviz_draws_it(svg) == svg


@pytest.mark.skipif(shutil.which("dot") is None, reason="needs the Graphviz programs")
def test_graphviz_output_for_a_green_node_is_redrawn():
    """What Graphviz actually writes for ``color=green`` comes out #00ff00."""
    import graphviz as gv

    svg = gv.Source("digraph { a [color=green fontcolor=green]; b [color=red] }").pipe(format="svg").decode()
    assert 'stroke="green"' in svg, "the Graphviz SVG no longer names the colour; is the redraw still needed?"
    redrawn = as_graphviz_draws_it(svg)
    assert '"green"' not in redrawn
    assert redrawn.count('"#00ff00"') == svg.count('"green"')
    assert 'stroke="#ff0000"' in redrawn


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


# A model with every kind of node the issue names: INPUT (green), OUTPUT
# (red), a controller (purple), and ordinary nodes drawn grey through the
# composition's own show_graph settings.
EVERY_ROLE = (
    "import psyneulink as pnl\n"
    'stimulus = pnl.TransferMechanism(name="stimulus")\n'
    'hidden = pnl.TransferMechanism(name="hidden")\n'
    'decision = pnl.TransferMechanism(name="decision")\n'
    'comp = pnl.Composition(name="every_role",\n'
    '    show_graph_attributes={"default_node_color": "grey", "control_color": "Gray50"})\n'
    "comp.add_linear_processing_pathway([stimulus, hidden, decision])\n"
    "comp.add_controller(pnl.OptimizationControlMechanism(\n"
    '    name="controller",\n'
    "    agent_rep=comp,\n"
    "    state_features=[stimulus.input_port],\n"
    "    objective_mechanism=pnl.ObjectiveMechanism(monitor=[decision]),\n"
    "    function=pnl.GridSearch(),\n"
    "    control_signals=[pnl.ControlSignal(\n"
    '        modulates=("slope", hidden), allocation_samples=[1.0, 2.0])],\n'
    "))\n"
)


@pytest.mark.skipif(shutil.which("dot") is None, reason="needs the Graphviz programs")
def test_a_model_with_every_role_has_no_colour_names_left(tmp_path):
    """#424: the picture the tab gets names no colour, only X11 hex values."""
    import re

    model = tmp_path / "every_role.py"
    model.write_text(EVERY_ROLE)
    response = TestClient(app).post(
        "/api/model/show-graph",
        json={"file_path": str(model), "composition_name": "every_role", "options": {"show_controller": True}},
    )
    assert response.status_code == 200, response.text
    svg = response.json()["svg"]
    values = re.findall(r'(?<![\w-])(?:fill|stroke|color|stop-color)="([^"]*)"', svg)
    values += re.findall(r'(?<![\w-])(?:fill|stroke|color|stop-color)\s*:\s*([^;"]+)', svg)
    named = {v for v in values if v.lower() in GRAPHVIZ_COLOURS or not (v.startswith("#") or v in ("none", "transparent"))}
    assert named == set(), f"colour names left in the SVG: {named}"
    assert '"#00ff00"' in svg  # INPUT
    assert '"#ff0000"' in svg  # OUTPUT
    assert '"#a020f0"' in svg  # the controller
    assert '"#c0c0c0"' in svg  # grey, as Graphviz draws it (CSS grey would be #808080)
    for css_only in ("#008000", "#800080", "#808080"):
        assert css_only not in svg


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
