"""A statement that defines the model is a real error even when the rest builds (#254).

Reported by a PsyNeuLink developer: ``comp.scheduler.add_condition(C,
pnl.BeforeNode(AN_UNDEFINED_VAR))`` showed no error. The resilient load (#615)
skipped the statement and the model built without that condition; the error
went only to the calm "module-level driver" notice (#796, #848), which is for
scripts reading the results of a run the introspector skipped.
"""

import tempfile
from pathlib import Path

import pytest

from app.services.dangling_check import find_skipped_definitions
from app.services.introspector import load_and_introspect


def _skipped(source: str, *lines: int) -> list[dict]:
    return [{"line": n, "error": f"error on line {n}"} for n in lines]


# ── Which skipped statements are definitions ─────────────────────────────

_SOURCE = """import psyneulink as pnl
A = pnl.ProcessingMechanism(name='A')
B = pnl.ProcessingMechanism(name=UNDEFINED)
comp = pnl.Composition(name='comp', pathways=[A])
comp.scheduler.add_condition(A, pnl.BeforeNode(UNDEFINED))
comp.add_node(UNDEFINED)
p = pnl.MappingProjection(sender=A, receiver=UNDEFINED)
comp.run(inputs={A: [[1]]})
print(comp.results[0])
x = comp.results[0][0]
comp.show_graph()
"""


@pytest.mark.parametrize("line, why", [
    (3, "a mechanism construction"),
    (5, "a scheduler condition"),
    (6, "a Composition add_* call"),
])
def test_definitions_are_reported(line, why):
    found = find_skipped_definitions(_SOURCE, _skipped(_SOURCE, line))
    assert [f["line"] for f in found] == [line], why


@pytest.mark.parametrize("line, why", [
    (7, "a projection: shown on the graph instead (#615, #1235)"),
    (8, "a run: a driver"),
    (9, "printing results: a driver"),
    (10, "reading results: a driver"),
    (11, "show_graph: a driver"),
])
def test_drivers_and_projections_are_not(line, why):
    assert find_skipped_definitions(_SOURCE, _skipped(_SOURCE, line)) == [], why


def test_the_error_text_is_kept():
    found = find_skipped_definitions(_SOURCE, [{"line": 5, "error": "name 'UNDEFINED' is not defined"}])
    assert found == [{"line": 5, "error": "name 'UNDEFINED' is not defined"}]


def test_nothing_skipped_or_unparsable_finds_nothing():
    assert find_skipped_definitions(_SOURCE, []) == []
    assert find_skipped_definitions(_SOURCE, None) == []
    assert find_skipped_definitions("def (:", _skipped("", 1)) == []


# ── The whole load, in the sandbox ───────────────────────────────────────

# The reporter's model, with the undefined name in the condition.
_REPORTED = """import psyneulink as pnl

A = pnl.ProcessingMechanism(name='A')
B = pnl.ProcessingMechanism(name='B')
C = pnl.ProcessingMechanism(name='C')

comp = pnl.Composition(name='comp', pathways=[A, B, C])

comp.scheduler.add_condition(C, pnl.BeforeNode(AN_UNDEFINED_VAR))
"""

# A verbatim PsyNeuLink script whose driver reads results of the skipped run:
# that must stay a calm notice (#796, #848).
_DRIVER = """import psyneulink as pnl

A = pnl.ProcessingMechanism(name='A')
comp = pnl.Composition(name='comp', pathways=[A])
comp.run(inputs={A: [[1]]})
first = comp.results[0][0]
"""


def _load(source: str) -> dict:
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(source)
        path = f.name
    try:
        return load_and_introspect(path, use_sandbox=True)
    finally:
        Path(path).unlink(missing_ok=True)


def test_an_undefined_name_in_a_condition_is_an_error_with_its_line():
    result = _load(_REPORTED)
    assert result.get("error") == "name 'AN_UNDEFINED_VAR' is not defined"
    assert result.get("errorLine") == 9
    # The graph still shows what did build.
    assert len(result["compositions"]) == 1
    assert len(result["compositions"][0]["nodes"]) == 3
    # And not as a calm driver notice.
    assert not any("driver" in n for n in result.get("notices", []))


def test_it_is_reported_every_time():
    """The reporter saw the error only sometimes. Same input, same answer."""
    errors = {(_load(_REPORTED).get("error"), _load(_REPORTED).get("errorLine")) for _ in range(2)}
    assert errors == {("name 'AN_UNDEFINED_VAR' is not defined", 9)}


def test_a_driver_reading_results_stays_a_notice():
    result = _load(_DRIVER)
    assert not result.get("error")
    assert any("driver" in n for n in result.get("notices", []))
