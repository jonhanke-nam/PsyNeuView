"""Tests for the PyTorch (autodiff) flattened view (#230).

`serialize_composition(..., pytorch=True)` serializes an AutodiffComposition's
PytorchCompositionWrapper — PNL's authoritative gradient-computation graph:
nested comps inlined, exclude_in_autodiff projections absent,
exclude_from_gradient_calc nodes tagged, in feedforward execution order.
Non-autodiff compositions fall back to the structural view.
"""

from pathlib import Path

import pytest

from app.services.sandbox_worker import serialize_composition
from tests.conftest import clean_name

FIXTURES = Path(__file__).parent / "fixtures"
REFERENCE_MODELS = Path(__file__).parent.parent / "reference_models"


def _load_comp(path: Path, var_name: str):
    import psyneulink as pnl

    ns: dict = {}
    exec(path.read_text(), ns)
    if var_name in ns:
        return ns[var_name]
    comps = [(k, v) for k, v in ns.items() if isinstance(v, pnl.Composition)]
    return max(comps, key=lambda kv: len(list(kv[1].nodes)))[1]


# ─────────────────────────── EGO / EM autodiff baseline ─────────────────────


@pytest.fixture(scope="module")
def ego():
    model = REFERENCE_MODELS / "Giallanza2024_ego_study2.py"
    if not model.exists():
        pytest.skip("EGO reference model not present")
    return _load_comp(model, "EGO_comp")


def test_pytorch_view_is_applied(ego):
    res = serialize_composition("EGO_comp", ego, {}, {}, {}, pytorch=True)
    assert res["pytorchView"] is True
    assert res["flattened"] is True
    assert len(res["nodes"]) > 0


def test_pytorch_node_count_matches_wrapper(ego):
    res = serialize_composition("EGO_comp", ego, {}, {}, {}, pytorch=True)
    rep = ego._build_pytorch_representation(context=None)
    assert len(res["nodes"]) == len(rep.nodes_map)


def test_exclude_from_gradient_calc_tagged(ego):
    # The 0.19 EMComposition restructure removed the standalone EM STORE node this
    # asserted — EGO on 0.19 has no exclude_from_gradient_calc node at all. Re-
    # establishing gradient-exclusion coverage on a 0.19-compatible model is #805.
    pytest.skip("EM STORE node removed in the 0.19 EMComposition restructure (#805)")
    res = serialize_composition("EGO_comp", ego, {}, {}, {}, pytorch=True)
    # Clean PsyNeuLink's -N instance suffix: a prior test that exec'd the model
    # leaves "STORE" in the registry, so a re-exec names it "STORE-1".
    excluded = {clean_name(n["name"]) for n in res["nodes"] if n.get("excludeFromGradientCalc")}
    # The EM STORE node runs but is excluded from the gradient calculation.
    assert "STORE" in excluded


def test_pytorch_nodes_have_execution_order(ego):
    res = serialize_composition("EGO_comp", ego, {}, {}, {}, pytorch=True)
    assert all("executionOrder" in n for n in res["nodes"])


def test_pytorch_edges_land_on_real_nodes(ego):
    res = serialize_composition("EGO_comp", ego, {}, {}, {}, pytorch=True)
    names = {n["name"] for n in res["nodes"]}
    for e in res["projections"]:
        assert e["sender"]["mechanism"] in names
        assert e["receiver"]["mechanism"] in names


def test_pytorch_inlines_nested_em(ego):
    res = serialize_composition("EGO_comp", ego, {}, {}, {}, pytorch=True)
    # Nodes pulled out of the nested EM composition carry it in their path.
    assert any(n.get("compPath") for n in res["nodes"])


def test_pytorch_view_has_no_isolated_nodes(ego):
    # #704: a CIM-sourced projection (EM Output_CIM -> PREDICTION) was dropped,
    # leaving PREDICTION with no edges. Every node should be connected.
    res = serialize_composition("EGO_comp", ego, {}, {}, {}, pytorch=True)
    connected = set()
    for e in res["projections"]:
        connected.add(e["sender"]["mechanism"])
        connected.add(e["receiver"]["mechanism"])
    isolated = [n["name"] for n in res["nodes"] if n["name"] not in connected]
    assert isolated == [], f"isolated pytorch nodes: {isolated}"


def test_pytorch_prediction_is_connected(ego):
    # #704: PREDICTION receives the retrieved value through the EM output CIM.
    res = serialize_composition("EGO_comp", ego, {}, {}, {}, pytorch=True)
    into_prediction = [
        clean_name(e["sender"]["mechanism"])
        for e in res["projections"]
        if clean_name(e["receiver"]["mechanism"]) == "PREDICTION"
    ]
    assert "STATE [RETRIEVED]" in into_prediction


def test_pytorch_edge_count_matches_show_pytorch_baseline(ego):
    # #704 / #249: the native view draws one real->real edge per wrapper projection
    # (CIM endpoints resolved, none dropped). The 0.19 EMComposition restructure
    # inlines more of EM, so the EGO/EM baseline is 28 (was 23) — verified correct:
    # every edge lands on a real node and none is isolated (sibling tests guard
    # this). Re-baselined for 0.19 (#805). 31 since #66: COMBINED SCORES sends
    # each FIELD_MEMORY two projections, on different ports, and show_graph
    # draws all 31.
    res = serialize_composition("EGO_comp", ego, {}, {}, {}, pytorch=True)
    assert len(res["projections"]) == 31


@pytest.mark.parametrize("view", ["pytorch", "flat"])
def test_parallel_projections_on_different_ports_are_kept(ego, view):
    # #66: COMBINED SCORES projects to each FIELD_MEMORY twice, to two
    # different ports. Both are drawn, and nothing else is doubled.
    from collections import Counter

    res = serialize_composition("EGO_comp", ego, {}, {}, {}, **{view: True})
    pairs = Counter(
        (clean_name(e["sender"]["mechanism"]), clean_name(e["receiver"]["mechanism"]))
        for e in res["projections"]
    )
    doubled = sorted(pair for pair, n in pairs.items() if n > 1)
    assert doubled == [
        ("COMBINED SCORES", f"{field} [FIELD_MEMORY]")
        for field in ("CONTEXT", "PREVIOUS STATE", "STATE")
    ]
    assert all(n <= 2 for n in pairs.values())


# ─────────────────────────── non-autodiff fallback ─────────────────────────


def test_non_autodiff_falls_back_to_structural():
    comp = _load_comp(FIXTURES / "nested_compositions.py", "outer_comp")
    res = serialize_composition("outer_comp", comp, {}, {}, {}, pytorch=True)
    # Plain Composition can't build a pytorch rep → no pytorch view.
    assert res["pytorchView"] is False
    # Falls back to the default (nested) serialization.
    assert res["flattened"] is False
    kinds = {n["name"].split("-")[0]: n["kind"] for n in res["nodes"]}
    assert kinds.get("inner_comp") == "composition"
