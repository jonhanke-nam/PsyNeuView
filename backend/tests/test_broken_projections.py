"""The graph learns which connections PsyNeuLink refused to make (#1235).

With a shape mismatch the projection's statement raises, the resilient load
skips it (#615), and the edge used to just vanish. The model now carries a
``brokenProjections`` record so the graph can draw it, broken, with the reason.
"""

import re
from pathlib import Path

from app.services.dangling_check import find_broken_projections
from app.services.introspector import load_and_introspect

STROOP = Path(__file__).resolve().parent.parent / "reference_models" / "stroop_reference_basic.py"


def test_a_skipped_projection_is_reported_with_its_endpoints_and_reason():
    source = "import psyneulink as pnl\nA = 1\nB = 2\np = pnl.MappingProjection(sender=A, receiver=B)\n"
    broken = find_broken_projections(source, [{"line": 4, "error": "Width (2) does not match (3)"}])
    assert broken == [{
        "varName": "p", "type": "MappingProjection", "line": 4,
        "senderRef": "A", "receiverRef": "B", "error": "Width (2) does not match (3)",
    }]


def test_other_skipped_statements_are_not_projections():
    source = "x = undefined_thing()\n"
    assert find_broken_projections(source, [{"line": 1, "error": "NameError"}]) == []


def test_stroop_with_a_shape_mismatch_reports_the_broken_connection(tmp_path):
    src = re.sub(r"(color_hidden = pnl\.\w+\(\s*input_shapes=)2", r"\g<1>3", STROOP.read_text(), count=1)
    path = tmp_path / "stroop_mismatch.py"
    path.write_text(src)
    model = load_and_introspect(str(path))
    broken = model.get("brokenProjections") or []
    names = {b["varName"] for b in broken}
    assert "color_input_to_hidden" in names
    b = next(b for b in broken if b["varName"] == "color_input_to_hidden")
    assert (b["senderRef"], b["receiverRef"]) == ("color_input", "color_hidden")
    assert "(3)" in b["error"]
