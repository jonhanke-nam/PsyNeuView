"""Tests for the flat-view serialization mode (#657).

`serialize_composition(..., flat=True)` inlines every nested composition into a
single node/edge set: descendant mechanisms are hoisted to one level, and
projections that cross a composition boundary are re-resolved through the
CompositionInterfaceMechanisms to their true inner sender/receiver.
"""

from pathlib import Path

import pytest

from app.services.sandbox_worker import serialize_composition
from tests.conftest import clean_name, find_node

FIXTURES = Path(__file__).parent / "fixtures"
REFERENCE_MODELS = Path(__file__).parent.parent / "reference_models"


def _load_comp(path: Path, var_name: str):
    """Exec a model file and return one of its Composition objects."""
    import psyneulink as pnl

    ns: dict = {}
    exec(path.read_text(), ns)
    if var_name in ns:
        return ns[var_name], ns
    comps = [(k, v) for k, v in ns.items() if isinstance(v, pnl.Composition)]
    # Outermost = the composition with the most nodes.
    name, comp = max(comps, key=lambda kv: len(list(kv[1].nodes)))
    return comp, ns


def _serialize(comp, var_name, flat):
    return serialize_composition(var_name, comp, {}, {}, {}, flat=flat)


def _count_mechanisms(node):
    """Recursively count mechanism nodes in a (possibly nested) serialized node."""
    if node.get("kind") == "mechanism":
        return 1
    return sum(_count_mechanisms(n) for n in node.get("nodes", []))


# ─────────────────────────── nested_compositions ───────────────────────────


@pytest.fixture(scope="module")
def nested():
    comp, _ = _load_comp(FIXTURES / "nested_compositions.py", "outer_comp")
    return comp


def test_flat_hoists_all_mechanisms(nested):
    flat = _serialize(nested, "outer_comp", flat=True)
    assert flat["flattened"] is True
    names = {clean_name(n["name"]) for n in flat["nodes"]}
    assert names == {"outer_input", "inner_a", "inner_b", "outer_output"}
    # No nested composition group node survives in flat mode.
    assert all(n["kind"] == "mechanism" for n in flat["nodes"])


def test_flat_tags_provenance_path(nested):
    flat = _serialize(nested, "outer_comp", flat=True)
    # Clean PsyNeuLink's -N instance suffix: another test exec'ing the same
    # model first leaves "inner_comp" registered, so a re-exec names it
    # "inner_comp-1".
    def path(name):
        return [clean_name(c) for c in find_node(flat["nodes"], name)["compPath"]]

    assert path("inner_a") == ["inner_comp"]
    assert path("inner_b") == ["inner_comp"]
    assert path("outer_input") == []
    assert path("outer_output") == []


def test_flat_stitches_cim_bridged_edges(nested):
    flat = _serialize(nested, "outer_comp", flat=True)
    edges = {
        (e["sender"]["mechanism"], e["receiver"]["mechanism"]): e
        for e in flat["projections"]
    }
    keys = {(clean_name(s), clean_name(r)) for (s, r) in edges}
    assert keys == {
        ("outer_input", "inner_a"),
        ("inner_a", "inner_b"),
        ("inner_b", "outer_output"),
    }
    # Every flat edge connects two real, hoisted nodes.
    names = {clean_name(n["name"]) for n in flat["nodes"]}
    for s, r in keys:
        assert s in names and r in names


def test_flat_marks_cim_crossings(nested):
    flat = _serialize(nested, "outer_comp", flat=True)
    by_pair = {
        (clean_name(e["sender"]["mechanism"]), clean_name(e["receiver"]["mechanism"])): e
        for e in flat["projections"]
    }
    # The intra-composition edge is direct; the two boundary crossings are viaCim.
    assert by_pair[("inner_a", "inner_b")]["viaCim"] is False
    assert by_pair[("outer_input", "inner_a")]["viaCim"] is True
    assert by_pair[("inner_b", "outer_output")]["viaCim"] is True


def test_non_flat_path_unchanged(nested):
    """Regression: default (flat=False) still yields the nested group node."""
    res = _serialize(nested, "outer_comp", flat=False)
    assert res["flattened"] is False
    kinds = {clean_name(n["name"]): n["kind"] for n in res["nodes"]}
    assert kinds["inner_comp"] == "composition"
    assert all("compPath" not in n for n in res["nodes"])


# ─────────────────────────── EM baseline (EGO) ─────────────────────────────


def test_flat_em_baseline_node_count_and_edges():
    """The standing EM baseline (#249): flattening the EGO reference model
    should surface exactly the total descendant mechanisms, and every stitched
    edge must land on a real flat node."""
    model = REFERENCE_MODELS / "Giallanza2024_ego_study2.py"
    if not model.exists():
        pytest.skip("EGO reference model not present")
    comp, _ = _load_comp(model, "EGO_comp")

    nested = _serialize(comp, "EGO_comp", flat=False)
    flat = _serialize(comp, "EGO_comp", flat=True)

    total_mechanisms = sum(_count_mechanisms(n) for n in nested["nodes"])
    assert len(flat["nodes"]) == total_mechanisms
    assert total_mechanisms > len(nested["nodes"])  # nesting actually flattened

    flat_names = {n["name"] for n in flat["nodes"]}
    for e in flat["projections"]:
        assert e["sender"]["mechanism"] in flat_names
        assert e["receiver"]["mechanism"] in flat_names

    # Nodes pulled out of the EM sub-composition carry it in their path.
    assert any(n.get("compPath") for n in flat["nodes"])


def test_flat_em_crossings_follow_their_own_port():
    """#33: an edge that crosses EM's interface joins only the node behind the
    port it arrives on, as show_graph draws it — not every node behind the
    interface. Each edge name is unique, so the canvas gets one edge per id."""
    model = REFERENCE_MODELS / "Giallanza2024_ego_study2.py"
    if not model.exists():
        pytest.skip("EGO reference model not present")
    comp, _ = _load_comp(model, "EGO_comp")
    flat = _serialize(comp, "EGO_comp", flat=True)

    crossings = {
        (clean_name(e["sender"]["mechanism"]), clean_name(e["receiver"]["mechanism"]))
        for e in flat["projections"]
        if "CIM" in e["name"]
    }
    assert crossings == {
        ("STATE", "STATE [VALUE]"),
        ("PREVIOUS STATE", "PREVIOUS STATE [QUERY]"),
        ("CONTEXT [NORMALIZED]", "CONTEXT [QUERY]"),
        ("STATE [RETRIEVED]", "PREDICTION"),
    }
    names = [e["name"] for e in flat["projections"]]
    assert len(names) == len(set(names))


def test_child_compositions_listed_in_every_view(nested):
    """#48: the flat view inlines nested compositions out of `nodes`, so each
    composition also names its direct children for the frontend."""
    for flat in (False, True):
        out = _serialize(nested, "outer_comp", flat=flat)
        assert [clean_name(c) for c in out["childCompositions"]] == ["inner_comp"]
