"""Control, gating and learning projections by dragging (#253, stage 3).

The type follows the sender: a control mechanism dropped on a mechanism
offers its parameters (a ControlProjection), a gating mechanism its input and
output ports (a GatingProjection), and a learning mechanism dropped on an
arrow trains that arrow's matrix (a LearningProjection). Each written
projection must load through PsyNeuView's own path and run in PsyNeuLink.
"""

import tempfile
from pathlib import Path

import pytest

from app.services.file_writer import apply_structural_change
from app.services.introspector import load_and_introspect
from app.services.sandbox import run_in_sandbox

MODEL = """import psyneulink as pnl

# Mechanisms
a = pnl.TransferMechanism(name='a', input_shapes=2)
b = pnl.TransferMechanism(name='b', input_shapes=2, function=pnl.Logistic)
c = pnl.TransferMechanism(name='c', input_shapes=2)
d = pnl.TransferMechanism(name='d', input_shapes=3)
ctrl = pnl.ControlMechanism(name='ctrl')
gate = pnl.GatingMechanism(name='gate')

# Projections
ab = pnl.MappingProjection(sender=a, receiver=b, name='ab')
ac = pnl.MappingProjection(sender=a, receiver=c, name='ac')
ad = pnl.MappingProjection(sender=a, receiver=d, name='ad')

# Compositions
comp = pnl.Composition(name='comp')
comp.add_node(a)
comp.add_node(b)
comp.add_node(c)
comp.add_node(d)
comp.add_node(ctrl)
comp.add_node(gate)
comp.add_projection(ab)
comp.add_projection(ac)
comp.add_projection(ad)
pathway = comp.add_backpropagation_learning_pathway([a, ab, b])
lm = pathway.learning_components[pnl.LEARNING_MECHANISMS][0]
"""


@pytest.fixture
def model_file():
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(MODEL)
        path = f.name
    yield path
    Path(path).unlink(missing_ok=True)


def _options(path, sender, receiver):
    return run_in_sandbox("connection_options", {"file_path": path, "sender": sender, "receiver": receiver})


def _write(path, sender, receiver, option):
    """What the canvas sends for a picked option (GraphCanvas.makeDraggedConnection)."""
    changes = {
        "action": "add_projection", "var_name": option["var_name"], "sender": option.get("sender", sender),
        "receiver": option.get("receiver", receiver), "type": option["type"],
        "receiver_port": option["receiver_port"], "receiver_port_kind": option["receiver_port_kind"],
        "composition": option["composition"],
    }
    if option.get("sender_port"):
        changes["sender_port"] = option["sender_port"]
    return apply_structural_change(path, changes)


def _loads_and_runs(path):
    """Loads through PsyNeuView's own path, then builds and runs in PsyNeuLink."""
    model = load_and_introspect(path)
    assert not model.get("error"), model.get("error")
    namespace: dict = {}
    exec(compile(Path(path).read_text(), path, "exec"), namespace)
    return namespace


# --- Control ---------------------------------------------------------------

def test_a_control_mechanism_offers_the_receivers_parameters(model_file):
    result = _options(model_file, "ctrl", "b")
    assert "refused" not in result, result
    assert result["ask"] == "parameter"
    assert {o["type"] for o in result["options"]} == {"ControlProjection"}
    ports = [o["receiver_port"] for o in result["options"]]
    assert "gain" in ports and "noise" in ports
    gain = next(o for o in result["options"] if o["receiver_port"] == "gain")
    assert gain["receiver_port_kind"] == "parameter"
    assert gain["composition"] == "comp"
    assert gain["var_name"] == "ctrl_controls_b_gain"
    # A parameter both the mechanism and its function have reads plainly.
    labels = {o["receiver_port"]: o["label"] for o in result["options"]}
    assert all("-" not in label for label in labels.values()), labels


def test_the_written_control_projection_loads_and_controls_the_parameter(model_file):
    option = next(o for o in _options(model_file, "ctrl", "b")["options"] if o["receiver_port"] == "gain")
    source = _write(model_file, "ctrl", "b", option)
    assert "pnl.ControlProjection(" in source
    assert "receiver=b.parameter_ports['gain']" in source
    assert "comp.add_projection(ctrl_controls_b_gain)" in source
    ns = _loads_and_runs(model_file)
    proj = ns["ctrl_controls_b_gain"]
    assert proj.receiver is ns["b"].parameter_ports["gain"]
    assert proj.sender.owner is ns["ctrl"]
    assert proj in ns["comp"].projections
    # Controlled now, so it isn't offered again.
    again = [o["receiver_port"] for o in _options(model_file, "ctrl", "b")["options"]]
    assert "gain" not in again


def test_a_control_mechanism_can_control_the_learning_mechanisms_learning_rate(model_file):
    # Dropped on the node the canvas shows as "Learning Mechanism for ab",
    # which the file names `lm`: its learning rate can be controlled.
    result = _options(model_file, "ctrl", "Learning Mechanism for ab")
    [option] = result["options"]
    assert option["receiver"] == "lm"
    assert option["receiver_port"] == "learning_rate"
    source = _write(model_file, "ctrl", "Learning Mechanism for ab", option)
    assert "receiver=lm.parameter_ports['learning_rate']" in source
    ns = _loads_and_runs(model_file)
    assert ns[option["var_name"]].receiver is ns["lm"].parameter_ports["learning_rate"]


def test_control_on_a_composition_says_it_needs_a_parameter(model_file):
    result = _options(model_file, "ctrl", "comp")
    assert "needs a parameter to control" in result["refused"]


# --- Gating ----------------------------------------------------------------

def test_a_gating_mechanism_offers_input_and_output_ports(model_file):
    result = _options(model_file, "gate", "c")
    assert result["ask"] == "port"
    kinds = {(o["receiver_port_kind"], o["receiver_port"]) for o in result["options"]}
    assert ("input", "InputPort-0") in kinds
    assert ("output", "RESULT") in kinds
    assert {o["type"] for o in result["options"]} == {"GatingProjection"}


@pytest.mark.parametrize("kind,port,attr", [("input", "InputPort-0", "input_ports"), ("output", "RESULT", "output_ports")])
def test_the_written_gating_projection_loads_and_gates_the_port(model_file, kind, port, attr):
    option = next(o for o in _options(model_file, "gate", "c")["options"]
                  if o["receiver_port_kind"] == kind and o["receiver_port"] == port)
    source = _write(model_file, "gate", "c", option)
    assert f"receiver=c.{attr}['{port}']" in source
    ns = _loads_and_runs(model_file)
    proj = ns[option["var_name"]]
    assert type(proj).__name__ == "GatingProjection"
    assert proj.receiver is getattr(ns["c"], attr)[port]


def test_gating_on_a_composition_says_it_needs_a_port(model_file):
    assert "needs a port to gate" in _options(model_file, "gate", "comp")["refused"]


# --- Learning --------------------------------------------------------------

def test_a_learning_mechanism_dropped_on_an_arrow_trains_its_matrix(model_file):
    result = _options(model_file, "lm", "ac")
    assert "refused" not in result, result
    [option] = result["options"]
    assert option["type"] == "LearningProjection"
    assert option["receiver_port"] == "matrix"
    assert option["receiver_port_kind"] == "parameter"
    assert option["sender_port"] == "LearningSignal"


def test_the_learning_mechanism_is_found_by_the_name_the_canvas_knows_it_by(model_file):
    # The canvas keys a pathway's learning mechanism by its PsyNeuLink name;
    # the file names it `lm`, and that is what's written.
    [option] = _options(model_file, "Learning Mechanism for ab", "ac")["options"]
    assert option["sender"] == "lm"


def test_the_written_learning_projection_loads_and_trains_the_arrow(model_file):
    import numpy as np

    [option] = _options(model_file, "lm", "ac")["options"]
    source = _write(model_file, "lm", "ac", option)
    assert "sender=lm.output_ports['LearningSignal']" in source
    assert "receiver=ac.parameter_ports['matrix']" in source
    # Declared after `lm` (below the composition), and added after that.
    assert source.index("lm = pathway") < source.index(f"{option['var_name']} = pnl.LearningProjection")
    assert source.index(f"{option['var_name']} = pnl") < source.index(f"comp.add_projection({option['var_name']})")
    ns = _loads_and_runs(model_file)
    comp, a, ac = ns["comp"], ns["a"], ns["ac"]
    before = ac.matrix.base.copy()
    for _ in range(3):
        comp.learn(inputs={a: [[1.0, 1.0]], ns["pathway"].target: [[0.0, 1.0]]})
    assert not np.allclose(before, ac.matrix.base)


def test_a_learning_mechanism_on_a_mechanism_says_drop_on_an_arrow(model_file):
    assert "drop lm on an arrow" in _options(model_file, "lm", "c")["refused"].lower() or \
        "on an arrow" in _options(model_file, "lm", "c")["refused"]


def test_an_arrow_of_another_shape_is_refused_with_why(model_file):
    assert "same shape" in _options(model_file, "lm", "ad")["refused"]


def test_an_arrow_the_mechanism_already_trains_is_refused(model_file):
    assert "already trains" in _options(model_file, "lm", "ab")["refused"]


def test_a_non_learning_sender_on_an_arrow_is_refused(model_file):
    assert "Only a learning mechanism" in _options(model_file, "a", "ac")["refused"]


def test_while_dragging_a_learning_mechanism_arrows_are_the_targets(model_file):
    targets = run_in_sandbox("connection_targets", {"file_path": model_file, "sender": "lm"})["targets"]
    assert targets["ac"] is None
    assert "same shape" in targets["ad"]
    assert "on an arrow" in targets["c"]


def test_while_dragging_a_control_mechanism_mechanisms_light_up(model_file):
    targets = run_in_sandbox("connection_targets", {"file_path": model_file, "sender": "ctrl"})["targets"]
    assert targets["b"] is None
    assert "needs a parameter" in targets["comp"]
    # The named learning mechanism, under the name the canvas shows it by.
    assert targets["Learning Mechanism for ab"] is None
    # The pathway's comparator has no name in the file, and says why.
    assert "made by a learning pathway" in targets["Comparator"]
    # Arrows are only targets for a learning mechanism.
    assert "ab" not in targets


def test_an_unnamed_learning_mechanism_says_the_pathway_makes_it(tmp_path):
    # Without `lm = ...` the file has no name for it; it isn't made inside a
    # function, so the reason says what does make it.
    path = tmp_path / "unnamed.py"
    path.write_text(MODEL.replace("lm = pathway.learning_components[pnl.LEARNING_MECHANISMS][0]\n", ""))
    result = _options(str(path), "Learning Mechanism for ab", "ac")
    assert "made by a learning pathway" in result["refused"]
