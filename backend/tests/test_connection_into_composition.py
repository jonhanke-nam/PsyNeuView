"""Dragging a mechanism onto a collapsed composition (#253, stage 2).

It connects into one of the composition's input nodes, asked of PsyNeuLink:
one option per input port of each input mechanism, and the written projection
builds and runs, routed through the composition's input interface. Also the
per-sender target map that lights up valid drops while dragging.
"""

import tempfile
from pathlib import Path

from app.services.file_writer import _add_projection
from app.services.sandbox import run_in_sandbox

MODEL = """import psyneulink as pnl

a = pnl.ProcessingMechanism(name='a')
x = pnl.ProcessingMechanism(name='x')
z = pnl.ProcessingMechanism(name='z')
inner = pnl.Composition(name='inner', pathways=[[x, z]])
y = pnl.ProcessingMechanism(name='y', input_ports=['p', 'q'])
w = pnl.ProcessingMechanism(name='w')
two_in = pnl.Composition(name='two_in', pathways=[[y, w]])
ctrl = pnl.ControlMechanism(name='ctrl')
outer = pnl.Composition(name='outer')
outer.add_node(a)
outer.add_node(inner)
outer.add_node(two_in)
outer.add_node(ctrl)
"""


def _run(task, **params):
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(MODEL)
        path = f.name
    try:
        return run_in_sandbox(task, {"file_path": path, **params})
    finally:
        Path(path).unlink(missing_ok=True)


def test_into_a_composition_with_one_input_node_is_one_option():
    result = _run("connection_options", sender="a", receiver="inner")
    assert "refused" not in result, result
    [option] = result["options"]
    assert option["type"] == "MappingProjection"
    assert option["receiver"] == "x"
    assert option["composition"] == "outer"
    assert option["label"] == "x"


def test_an_input_node_with_several_ports_asks_which():
    result = _run("connection_options", sender="a", receiver="two_in")
    assert [o["receiver_port"] for o in result["options"]] == ["p", "q"]
    assert {o["receiver"] for o in result["options"]} == {"y"}
    assert [o["label"] for o in result["options"]] == ["y: p", "y: q"]


def test_a_node_inside_the_composition_is_refused():
    assert "inside" in _run("connection_options", sender="x", receiver="inner")["refused"]


def test_a_control_sender_still_waits():
    assert "control mechanism" in _run("connection_options", sender="ctrl", receiver="inner")["refused"]


def test_the_written_projection_builds_and_runs():
    option = _run("connection_options", sender="a", receiver="inner")["options"][0]
    new = _add_projection(MODEL, {
        "action": "add_projection", "var_name": "a_to_inner", "sender": "a",
        "receiver": option["receiver"], "sender_port": option["sender_port"],
        "receiver_port": option["receiver_port"], "composition": option["composition"],
        "type": option["type"],
    })
    namespace: dict = {}
    exec(compile(new, "<model>", "exec"), namespace)
    outer, a, inner = namespace["outer"], namespace["a"], namespace["inner"]
    # PsyNeuLink routes it through inner's input interface.
    assert any(p.sender.owner is a and p.receiver.owner is inner.input_CIM for p in outer.projections)
    # a now feeds inner, so only a takes input; two_in is still an input of its own.
    result = outer.run(inputs={a: [[3.0]], namespace["two_in"]: [[0.0], [0.0]]})
    assert float(result[0][0]) == 3.0


def test_targets_light_up_mechanisms_and_compositions_and_say_why_not():
    targets = _run("connection_targets", sender="a")["targets"]
    assert targets["x"] is None
    assert targets["inner"] is None
    assert targets["two_in"] is None
    assert "itself" in targets["a"]
    # outer holds a: no composition holds both.
    assert targets["outer"]


def test_a_control_sender_has_no_valid_target():
    targets = _run("connection_targets", sender="ctrl")["targets"]
    assert all(reason for reason in targets.values())


BUILT_IN_A_FUNCTION = """import psyneulink as pnl

STATE = 'STATE'

def build():
    s = pnl.ProcessingMechanism(name=STATE)
    p = pnl.ProcessingMechanism(name='PREDICTION')
    return pnl.Composition(name='model', pathways=[[s, p]])

model = build()
"""


def _run_on(source, task, **params):
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(source)
        path = f.name
    try:
        return run_in_sandbox(task, {"file_path": path, **params})
    finally:
        Path(path).unlink(missing_ok=True)


def test_a_node_built_inside_a_function_is_refused_with_why():
    # As in the EGO model: the nodes have names but no variable in the file.
    result = _run_on(BUILT_IN_A_FUNCTION, "connection_options", sender="STATE", receiver="PREDICTION")
    assert "inside a function" in result["refused"]


def test_a_node_built_inside_a_function_is_found_by_its_local_name_too():
    # The canvas knows such a node by the local variable it was assigned to (#422).
    result = _run_on(BUILT_IN_A_FUNCTION, "connection_options", sender="s", receiver="p")
    assert "inside a function" in result["refused"]


def test_nodes_built_inside_a_function_show_why_while_dragging():
    targets = _run_on(BUILT_IN_A_FUNCTION, "connection_targets", sender="s")["targets"]
    assert "inside a function" in targets["PREDICTION"]
    assert "inside a function" in targets["p"]
