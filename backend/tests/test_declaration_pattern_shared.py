"""The two declaration scans must stay identical (#1140).

`introspector` and `sandbox_worker` each scan source for `<var> = Thing(`.
The worker runs as a subprocess and cannot rely on importing from `app`
(#1090), so the pattern is deliberately duplicated rather than shared.

Duplication is only safe if drift is caught. These read both files and compare
the pattern text, so widening one and forgetting the other fails here instead
of silently making the canvas refuse edits it can perform.
"""

import re
from pathlib import Path

SERVICES = Path(__file__).resolve().parents[1] / "app" / "services"
DECL = re.compile(r're\.match\((r"\^\\s\*\(\\w\+\)[^"]*"),')


def pattern_in(filename: str) -> str:
    text = (SERVICES / filename).read_text()
    found = DECL.findall(text)
    assert found, f"no declaration pattern found in {filename}"
    return found[0]


def test_both_files_use_the_same_pattern():
    assert pattern_in("introspector.py") == pattern_in("sandbox_worker.py")


def test_the_pattern_accepts_the_shapes_the_writer_accepts():
    """Whatever the writer can rewrite, the index must be able to find.

    This is the bug in #1140: the index required a `pnl.` prefix while the
    writer accepted any dotted path, so editable nodes were reported as
    uneditable.
    """
    pattern = re.compile(eval(pattern_in("introspector.py")))
    for src in (
        "hidden = pnl.TransferMechanism(name='h')",
        "hidden = TransferMechanism(name='h')",
        "hidden = psyneulink.TransferMechanism(name='h')",
        "hidden = pnl.core.TransferMechanism(name='h')",
        "    hidden = pnl.TransferMechanism(name='h')",  # function-scoped
    ):
        m = pattern.match(src)
        assert m, f"should index: {src}"
        assert m.group(1) == "hidden"


def test_the_pattern_does_not_index_ordinary_function_calls():
    """A plain call assigned to a name is not a node declaration.

    The index maps variable name to line number, so a spurious entry can point
    an edit at the wrong line. Requiring a capitalized callable keeps helper
    calls out without needing a list of every PsyNeuLink class.
    """
    pattern = re.compile(eval(pattern_in("introspector.py")))
    for src in (
        "x = compute(3)",
        "result = build_model()",
        "total = sum(values)",
    ):
        assert not pattern.match(src), f"should not index: {src}"
