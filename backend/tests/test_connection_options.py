"""What a drag from one node to another connects, asked of PsyNeuLink (#253)."""

import tempfile
from pathlib import Path

from app.services.sandbox import run_in_sandbox

MODEL = """import psyneulink as pnl
a = pnl.ProcessingMechanism(name='a')
b = pnl.ProcessingMechanism(name='b')
two = pnl.ProcessingMechanism(name='two', input_ports=['left', 'right'])
ctrl = pnl.ControlMechanism(name='ctrl')
gate = pnl.GatingMechanism(name='gate')
comp = pnl.Composition(name='comp', pathways=[a, b])
comp.add_node(two)
comp.add_node(ctrl)
"""


def _options(sender, receiver):
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(MODEL)
        path = f.name
    try:
        return run_in_sandbox("connection_options", {"file_path": path, "sender": sender, "receiver": receiver})
    finally:
        Path(path).unlink(missing_ok=True)


def test_two_processing_mechanisms_give_a_mapping_projection():
    result = _options("b", "two")
    assert "refused" not in result, result
    assert [o["type"] for o in result["options"]] == ["MappingProjection", "MappingProjection"]
    # One choice per input port of the receiver.
    assert [o["receiver_port"] for o in result["options"]] == ["left", "right"]
    # From the sender's primary output port, whatever PsyNeuLink names it.
    assert len({o["sender_port"] for o in result["options"]}) == 1


def test_a_single_input_port_is_a_single_option():
    result = _options("two", "a")
    assert len(result["options"]) == 1


def test_an_existing_connection_is_not_made_twice():
    assert "already connected" in _options("a", "b")["refused"]


def test_a_node_to_itself_is_refused():
    assert "itself" in _options("a", "a")["refused"]


def test_control_and_gating_senders_wait_for_the_second_stage():
    assert "control mechanism" in _options("ctrl", "a")["refused"]
    assert "gating mechanism" in _options("gate", "a")["refused"]


def test_something_that_is_not_a_mechanism_is_refused():
    assert "mechanism" in _options("comp", "a")["refused"]
    assert "mechanism" in _options("nothing_here", "a")["refused"]
