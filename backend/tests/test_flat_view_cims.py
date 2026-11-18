"""The flat view keeps the outer composition's CIMs (#257).

Flattening removes inner compositions' interface nodes, but it also dropped
the outer one's, so "Interface nodes (CIMs)" showed nothing in the flat view,
the page's default.
"""

import tempfile
from pathlib import Path

from app.services.sandbox import run_in_sandbox

STROOP = str(Path(__file__).resolve().parents[1] / "reference_models" / "stroop_reference_basic.py")

NESTED = """import psyneulink as pnl
a = pnl.ProcessingMechanism(name='a')
b = pnl.ProcessingMechanism(name='b')
inner = pnl.Composition(name='inner', pathways=[b])
outer = pnl.Composition(name='outer', pathways=[a, inner])
"""


def _cim(file_path: str, flat: bool, composition: str | None = None) -> dict:
    result = run_in_sandbox("introspect", {"file_path": file_path, "flat": flat})
    comps = result["compositions"]
    comp = next(c for c in comps if c["name"] == composition) if composition else comps[0]
    return comp.get("cim") or {}


def _ends(cim: dict) -> set[tuple[str, str]]:
    return {(p["sender"]["mechanism"], p["receiver"]["mechanism"]) for p in cim.get("projections", [])}


def test_flat_and_nested_show_the_same_outer_cims_for_a_single_level_model():
    nested, flat = _cim(STROOP, False), _cim(STROOP, True)
    assert [n["name"] for n in flat["nodes"]] == [n["name"] for n in nested["nodes"]]
    assert _ends(flat) == _ends(nested)
    assert _ends(flat), "Stroop's input and output nodes connect to its CIMs"


def test_the_flat_view_connects_the_outer_cims_through_an_inner_composition():
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(NESTED)
        path = f.name
    try:
        flat = _cim(path, True, "outer")
        names = [n["name"] for n in flat["nodes"]]
        assert all(name.startswith("outer ") for name in names), names
        ends = _ends(flat)
        # In: outer's input CIM reaches a; out: b (inside `inner`) reaches
        # outer's output CIM, through inner's own CIM, which isn't shown.
        assert ("outer Input_CIM", "a") in ends, ends
        assert ("b", "outer Output_CIM") in ends, ends
        assert not any("inner" in s or "inner" in r for s, r in ends), ends
    finally:
        Path(path).unlink(missing_ok=True)
