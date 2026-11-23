"""The model-equivalence helper sees what differs, and only that (#319).

`tests/model_equivalence.py` decides whether a model built in the graph is
the model typed as code (e2e/ui-text-equivalence.spec.ts). These pin it from
both sides: the code the graph writes for each kind of projection matches the
way a modeller would type the same thing, and a model that differs in one
receiver, one parameter or one projection does not.
"""

from pathlib import Path

import pytest

from tests import model_equivalence as eq

# What the graph writes for each kind (the form drag-to-connect produces,
# #253), and the same model typed the way PsyNeuLink's docs put it.
PAIRS = {
    "mapping": (
        """import psyneulink as pnl
a = pnl.ProcessingMechanism(input_shapes=[2], name='a')
b = pnl.TransferMechanism(input_shapes=[2], function=pnl.Linear(), name='b')
a_to_b = pnl.MappingProjection(sender=a.output_ports['OutputPort-0'], receiver=b.input_ports['InputPort-0'], name='a_to_b')
comp = pnl.Composition(name='comp')
comp.add_node(a)
comp.add_node(b)
comp.add_projection(a_to_b)
""",
        """import psyneulink as pnl
a = pnl.ProcessingMechanism(name='a', input_shapes=2)
b = pnl.TransferMechanism(name='b', input_shapes=2)
comp = pnl.Composition(name='comp', pathways=[[a, b]])
""",
    ),
    "control": (
        """import psyneulink as pnl
a = pnl.TransferMechanism(name='a', function=pnl.Logistic)
ctrl = pnl.ControlMechanism(name='ctrl')
ctrl_controls_a_gain = pnl.ControlProjection(sender=ctrl, receiver=a.parameter_ports['gain'], name='ctrl_controls_a_gain')
comp = pnl.Composition(name='comp')
comp.add_node(a)
comp.add_node(ctrl)
comp.add_projection(ctrl_controls_a_gain)
""",
        """import psyneulink as pnl
a = pnl.TransferMechanism(name='a', function=pnl.Logistic)
ctrl = pnl.ControlMechanism(name='ctrl', control=[(pnl.GAIN, a)])
comp = pnl.Composition(name='comp')
comp.add_node(a)
comp.add_node(ctrl)
""",
    ),
    "gating": (
        """import psyneulink as pnl
a = pnl.TransferMechanism(name='a')
b = pnl.TransferMechanism(name='b')
gate = pnl.GatingMechanism(name='gate')
gate_gates_b = pnl.GatingProjection(sender=gate, receiver=b.input_ports['InputPort-0'], name='gate_gates_b')
comp = pnl.Composition(name='comp', pathways=[[a, b]])
comp.add_node(gate)
comp.add_projection(gate_gates_b)
""",
        """import psyneulink as pnl
a = pnl.TransferMechanism(name='a')
b = pnl.TransferMechanism(name='b')
gate = pnl.GatingMechanism(name='gate', gate=[b.input_port])
comp = pnl.Composition(name='comp', pathways=[[a, b]])
comp.add_node(gate)
""",
    ),
    "nested": (
        """import psyneulink as pnl
a = pnl.ProcessingMechanism(name='a')
x = pnl.ProcessingMechanism(name='x')
a_to_x = pnl.MappingProjection(sender=a.output_ports['OutputPort-0'], receiver=x.input_ports['InputPort-0'], name='a_to_x')
z = pnl.ProcessingMechanism(name='z')
inner = pnl.Composition(name='inner', pathways=[[x, z]])
outer = pnl.Composition(name='outer')
outer.add_node(a)
outer.add_node(inner)
outer.add_projection(a_to_x)
""",
        """import psyneulink as pnl
a = pnl.ProcessingMechanism(name='a')
x = pnl.ProcessingMechanism(name='x')
z = pnl.ProcessingMechanism(name='z')
inner = pnl.Composition(name='inner', pathways=[[x, z]])
outer = pnl.Composition(name='outer', pathways=[[a, inner]])
""",
    ),
}

_described: dict[str, dict] = {}


def describe(tmp_path: Path, source: str) -> dict:
    """One model's description, made once per source text for the whole module."""
    if source not in _described:
        f = tmp_path / f"m{len(_described)}.py"
        f.write_text(source)
        _described[source] = eq.describe_fresh(str(f))
    return _described[source]


@pytest.mark.parametrize("kind", sorted(PAIRS))
def test_what_the_graph_writes_is_what_a_modeller_types(kind, tmp_path):
    built, typed = PAIRS[kind]
    assert eq.differences(describe(tmp_path, built), describe(tmp_path, typed)) == []


@pytest.mark.parametrize(
    "kind, change, expect",
    [
        # Connected into the wrong node.
        ("nested", ("pathways=[[a, inner]]", "pathways=[[a]]); outer.add_node(inner"), "projection only in the first"),
        # Controls a different parameter: a different port, and different results.
        ("control", ("pnl.GAIN", "pnl.BIAS"), "receiver_port"),
        # One parameter changed.
        ("control", ("function=pnl.Logistic)", "function=pnl.Logistic(gain=2))"), "params"),
        # A projection missing altogether.
        ("gating", ("gate=[b.input_port]", "gate=[]"), "projection only in the first"),
    ],
)
def test_a_model_that_differs_is_reported(kind, change, expect, tmp_path):
    built, typed = PAIRS[kind]
    changed = typed.replace(*change)
    assert changed != typed
    diffs = eq.differences(describe(tmp_path, built), describe(tmp_path, changed))
    assert diffs and any(expect in d for d in diffs), diffs
