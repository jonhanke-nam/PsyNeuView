"""Tests for the static-analysis dangling-projection detector."""

from app.services.dangling_check import find_dangling_projections


def test_no_dangling_when_all_endpoints_defined():
    source = """
import psyneulink as pnl
a = pnl.TransferMechanism(name='a')
b = pnl.TransferMechanism(name='b')
proj = pnl.MappingProjection(sender=a, receiver=b)
"""
    assert find_dangling_projections(source) == []


def test_receiver_dangling_when_target_deleted():
    source = """
import psyneulink as pnl
a = pnl.TransferMechanism(name='a')
proj_ab = pnl.MappingProjection(sender=a, receiver=b)
"""
    results = find_dangling_projections(source)
    assert len(results) == 1
    r = results[0]
    assert r["varName"] == "proj_ab"
    assert r["type"] == "MappingProjection"
    assert r["senderRef"] == "a"
    assert r["receiverRef"] == "b"
    assert r["missing"] == ["b"]
    assert r["missingSide"] == "receiver"


def test_sender_dangling_when_source_deleted():
    source = """
import psyneulink as pnl
b = pnl.TransferMechanism(name='b')
proj_ab = pnl.MappingProjection(sender=a, receiver=b)
"""
    r = find_dangling_projections(source)[0]
    assert r["missingSide"] == "sender"
    assert r["missing"] == ["a"]


def test_both_endpoints_dangling():
    source = """
import psyneulink as pnl
proj = pnl.MappingProjection(sender=ghost1, receiver=ghost2)
"""
    r = find_dangling_projections(source)[0]
    assert r["missingSide"] == "both"
    assert set(r["missing"]) == {"ghost1", "ghost2"}


def test_handles_port_subscript_reference():
    source = """
import psyneulink as pnl
a = pnl.TransferMechanism(name='a')
proj = pnl.MappingProjection(sender=a, receiver=b['InputPort-0'])
"""
    r = find_dangling_projections(source)[0]
    assert r["receiverRef"] == "b"
    assert r["missingSide"] == "receiver"


def test_handles_attribute_reference():
    source = """
import psyneulink as pnl
a = pnl.TransferMechanism(name='a')
proj = pnl.MappingProjection(sender=a, receiver=b.input_ports[0])
"""
    r = find_dangling_projections(source)[0]
    assert r["receiverRef"] == "b"


def test_positional_args_also_checked():
    source = """
import psyneulink as pnl
a = pnl.TransferMechanism(name='a')
proj = pnl.MappingProjection(a, b)
"""
    r = find_dangling_projections(source)[0]
    assert r["senderRef"] == "a"
    assert r["receiverRef"] == "b"
    assert r["missingSide"] == "receiver"


def test_non_projection_classes_ignored():
    source = """
import psyneulink as pnl
b = pnl.SomeRandomClass(sender=a, receiver=b)
"""
    assert find_dangling_projections(source) == []


def test_works_on_control_and_learning_projections():
    source = """
import psyneulink as pnl
a = pnl.TransferMechanism(name='a')
ctrl = pnl.ControlProjection(sender=a, receiver=missing_target)
learn = pnl.LearningProjection(sender=missing_src, receiver=a)
"""
    results = find_dangling_projections(source)
    assert len(results) == 2
    by_var = {r["varName"]: r for r in results}
    assert by_var["ctrl"]["type"] == "ControlProjection"
    assert by_var["ctrl"]["missingSide"] == "receiver"
    assert by_var["learn"]["type"] == "LearningProjection"
    assert by_var["learn"]["missingSide"] == "sender"


def test_literal_endpoints_not_flagged():
    """Non-name references like dicts, lists, or literals aren't flagged —
    only named references can be 'orphaned by deletion'."""
    source = """
import psyneulink as pnl
a = pnl.TransferMechanism(name='a')
proj = pnl.MappingProjection(sender=a, receiver=[1, 2, 3])
"""
    assert find_dangling_projections(source) == []


def test_function_scope_names_count_as_defined():
    source = """
import psyneulink as pnl
def build():
    a = pnl.TransferMechanism(name='a')
    b = pnl.TransferMechanism(name='b')
    return pnl.MappingProjection(sender=a, receiver=b)
"""
    assert find_dangling_projections(source) == []


def test_syntax_error_returns_empty_list():
    source = "def broken(:\n  pass\n"
    assert find_dangling_projections(source) == []


def test_line_number_reported():
    source = """import psyneulink as pnl
a = pnl.TransferMechanism(name='a')
proj_ab = pnl.MappingProjection(sender=a, receiver=b)
"""
    r = find_dangling_projections(source)[0]
    assert r["line"] == 3
