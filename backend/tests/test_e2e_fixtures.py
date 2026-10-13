"""Verifies each E2E fixture model (#148) introspects cleanly.

These fixtures live in frontend/e2e/fixtures/ rather than backend/demos/
because the demo lifecycle test (#155) mutates demos. Keeping the
fixtures alongside the tests that consume them gives us a stable surface
that's independent of whatever the demo working copies look like.

This test catches regressions early: if a future PsyNeuLink change
breaks one of the fixture shapes, we'd rather find out from this fast
unit test than from a flaky Playwright spec.
"""

from pathlib import Path

import pytest

from app.services.introspector import load_and_introspect

FIXTURES_DIR = Path(__file__).resolve().parent.parent.parent / "frontend" / "e2e" / "fixtures"

# (fixture name, expected node count, expected projection count, notes)
FIXTURE_EXPECTATIONS = [
    ("single_transfer", 1, 0),
    ("two_mech_projection", 2, 1),
    ("with_controller", 1, 0),       # controller is comp.controller, not a node
    ("recurrent_self", 1, 0),        # auto/hetero live on the mechanism
    ("nested_minimal", 3, 2),        # outer composition counts inner as 1 node
]


@pytest.mark.parametrize("name,nodes,projections", FIXTURE_EXPECTATIONS)
def test_fixture_introspects(name: str, nodes: int, projections: int):
    path = FIXTURES_DIR / f"{name}.py"
    assert path.exists(), f"missing fixture file: {path}"

    result = load_and_introspect(str(path))

    assert "error" not in result, f"introspect failed: {result.get('error')}"
    assert "compositions" in result, f"no compositions key in result: {result}"
    assert len(result["compositions"]) >= 1, f"no compositions found in {name}"

    # Pick the outer (top-level) composition by name — matches the file stem.
    outer = next(
        (c for c in result["compositions"] if c["name"] == name),
        result["compositions"][0],
    )
    assert len(outer["nodes"]) == nodes, (
        f"{name}: expected {nodes} nodes, got {len(outer['nodes'])} "
        f"({[n['name'] for n in outer['nodes']]})"
    )
    assert len(outer["projections"]) == projections, (
        f"{name}: expected {projections} projections, got {len(outer['projections'])}"
    )


def test_all_fixtures_have_canonical_header():
    """Every fixture file starts with the PsyNeuLink Model File header."""
    for name, *_ in FIXTURE_EXPECTATIONS:
        path = FIXTURES_DIR / f"{name}.py"
        first_line = path.read_text().splitlines()[0]
        assert first_line == "# PsyNeuLink Model File", (
            f"{name}.py: first line should be '# PsyNeuLink Model File', got {first_line!r}"
        )
