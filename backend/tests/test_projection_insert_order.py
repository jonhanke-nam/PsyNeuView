"""A dragged connection's `comp.add_projection(...)` goes after the statement
that adds its ends to the composition (#404).

It used to go after the last `add_node`/`add_projection` line, or straight
after the constructor, so in a model whose nodes come from
`add_linear_processing_pathway(...)` (or any other pathway call) it landed
before that call and the model failed to build.
"""

import pytest

from app.services.file_writer import _add_projection

HEAD = """import psyneulink as pnl

a = pnl.ProcessingMechanism(name='a')
b = pnl.ProcessingMechanism(name='b')
c = pnl.ProcessingMechanism(name='c')

"""

# Each way of adding nodes to a composition, and the line that adds `a` and `c`.
MODELS = {
    "add_node": (
        "comp = pnl.Composition(name='comp')\n"
        "comp.add_node(b)\n"
        "comp.add_node(a)\n"
        "comp.add_node(c)\n",
        "comp.add_node(c)",
    ),
    "add_nodes": (
        "comp = pnl.Composition(name='comp')\n"
        "comp.add_nodes([a, b, c])\n",
        "comp.add_nodes([a, b, c])",
    ),
    "add_linear_processing_pathway": (
        "comp = pnl.Composition(name='comp')\n"
        "comp.add_linear_processing_pathway([a, b, c])\n",
        "comp.add_linear_processing_pathway([a, b, c])",
    ),
    "add_node then pathway": (
        "comp = pnl.Composition(name='comp')\n"
        "comp.add_node(b)\n"
        "comp.add_linear_processing_pathway([a, b, c])\n",
        "comp.add_linear_processing_pathway([a, b, c])",
    ),
    "multi-line pathway": (
        "comp = pnl.Composition(name='comp')\n"
        "comp.add_linear_processing_pathway(\n"
        "    [a, b, c],\n"
        ")\n",
        ")",
    ),
    "pathway held in a variable": (
        "pathway = [a, b, c]\n"
        "comp = pnl.Composition(name='comp')\n"
        "comp.add_linear_processing_pathway(pathway)\n",
        "comp.add_linear_processing_pathway(pathway)",
    ),
    "add_backpropagation_learning_pathway": (
        "comp = pnl.Composition(name='comp')\n"
        "learning = comp.add_backpropagation_learning_pathway([a, b, c])\n",
        "learning = comp.add_backpropagation_learning_pathway([a, b, c])",
    ),
    "add_reinforcement_learning_pathway": (
        # Single-layer only, so `a` is added on its own, before it.
        "comp = pnl.Composition(name='comp')\n"
        "comp.add_node(a)\n"
        "comp.add_reinforcement_learning_pathway([b, c])\n",
        "comp.add_reinforcement_learning_pathway([b, c])",
    ),
    "add_pathways": (
        "comp = pnl.Composition(name='comp')\n"
        "comp.add_pathways([[a, b], [c]])\n",
        "comp.add_pathways([[a, b], [c]])",
    ),
    "constructor pathways=": (
        "comp = pnl.Composition(pathways=[[a, b, c]], name='comp')\n",
        "comp = pnl.Composition(pathways=[[a, b, c]], name='comp')",
    ),
    "constructor nodes=": (
        "comp = pnl.Composition(\n"
        "    nodes=[a, b, c],\n"
        "    name='comp',\n"
        ")\n",
        ")",
    ),
}


def _add(source: str) -> str:
    return _add_projection(source, {
        "action": "add_projection", "var_name": "a_to_c", "sender": "a", "receiver": "c",
        "composition": "comp", "type": "MappingProjection",
    })


@pytest.mark.parametrize("how", list(MODELS))
def test_the_new_line_comes_after_the_adding_statement(how):
    body, adder = MODELS[how]
    lines = _add(HEAD + body).splitlines()
    adds = max(i for i, l in enumerate(lines) if l == adder)
    use = lines.index("comp.add_projection(a_to_c)")
    assert use > adds


@pytest.mark.parametrize("how", list(MODELS))
def test_the_model_builds(how):
    body, _ = MODELS[how]
    namespace: dict = {}
    exec(compile(_add(HEAD + body), "<model>", "exec"), namespace)
    comp = namespace["comp"]
    assert any(p.name == "a_to_c" for p in comp.projections)


def test_it_stays_before_the_run():
    """'After the adding statement' isn't 'at the end of the file': a run
    below the construction block still sees the projection."""
    source = HEAD + (
        "comp = pnl.Composition(name='comp')\n"
        "comp.add_linear_processing_pathway([a, b, c])\n"
        "\n"
        "comp.run(inputs={a: [[1]]})\n"
    )
    lines = _add(source).splitlines()
    assert lines.index("comp.add_projection(a_to_c)") < lines.index("comp.run(inputs={a: [[1]]})")


def test_when_it_cannot_tell_it_goes_at_the_end_of_the_construction_block():
    """The pathway comes from a function call it can't see into: the line goes
    after the composition's last node-adding statement."""
    source = HEAD + (
        "def make_pathway():\n"
        "    return [a, b, c]\n"
        "\n"
        "comp = pnl.Composition(name='comp')\n"
        "comp.add_node(b)\n"
        "comp.add_linear_processing_pathway(make_pathway())\n"
    )
    new = _add(source)
    lines = new.splitlines()
    assert lines.index("comp.add_projection(a_to_c)") > lines.index(
        "comp.add_linear_processing_pathway(make_pathway())"
    )
    namespace: dict = {}
    exec(compile(new, "<model>", "exec"), namespace)
    assert any(p.name == "a_to_c" for p in namespace["comp"].projections)
