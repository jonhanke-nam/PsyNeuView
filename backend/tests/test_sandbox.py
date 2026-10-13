"""Tests for subprocess sandbox execution."""

import tempfile
import pytest
from pathlib import Path
from app.services.sandbox import run_in_sandbox
from app.services.introspector import load_and_introspect
from app.services.executor import run_model, get_input_nodes
from tests.conftest import clean_name, find_node

TEST_MODEL = str(Path(__file__).parent.parent / "test_model.py")


def test_sandbox_introspect():
    """Introspection works through the sandbox."""
    result = load_and_introspect(TEST_MODEL, use_sandbox=True)
    assert "compositions" in result
    assert len(result["compositions"]) == 1
    names = [clean_name(n["name"]) for n in result["compositions"][0]["nodes"]]
    assert "colors_input" in names
    assert "response" in names


def test_sandbox_introspect_has_params():
    """Sandboxed introspection returns real parameter values."""
    result = load_and_introspect(TEST_MODEL, use_sandbox=True)
    response = find_node(result["compositions"][0]["nodes"], "response")
    assert response["function"]["type"] == "Logistic"
    assert "gain" in response["function"]["params"]


def test_sandbox_introspect_has_header():
    """Sandboxed introspection returns header metadata."""
    result = load_and_introspect(TEST_MODEL, use_sandbox=True)
    assert "header" in result
    assert result["header"]["format_version"] == "1.0"
    assert result["header"]["model_name"] == "simple_stroop"


def test_sandbox_run_model():
    """Model execution works through the sandbox."""
    result = run_model(
        TEST_MODEL, "stroop_model",
        {"colors_input": [[1.0, 0.0, 0.0]], "words_input": [[0.0, 0.0, 1.0]]},
        use_sandbox=True,
    )
    assert "error" not in result
    assert result["numTrials"] == 1
    assert len(result["results"]) == 1


def test_sandbox_get_input_nodes():
    """Input node detection works through the sandbox."""
    result = get_input_nodes(TEST_MODEL, "stroop_model", use_sandbox=True)
    assert "inputNodes" in result
    names = [n["varName"] for n in result["inputNodes"]]
    assert "colors_input" in names


def test_sandbox_timeout():
    """Scripts that take too long are killed."""
    # Create a script with an infinite loop
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write("import time\nwhile True:\n    time.sleep(0.1)\n")
        f.flush()
        path = f.name

    try:
        result = run_in_sandbox("introspect", {"file_path": path}, timeout=2)
        assert "error" in result
        assert "timed out" in result["error"]
    finally:
        Path(path).unlink(missing_ok=True)


def test_sandbox_crash_recovery():
    """A crashing script returns an error without killing the server."""
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write("raise RuntimeError('intentional crash')\n")
        f.flush()
        path = f.name

    try:
        result = run_in_sandbox("introspect", {"file_path": path})
        assert "error" in result
        assert "intentional crash" in result["error"] or "failed" in result["error"].lower()
    finally:
        Path(path).unlink(missing_ok=True)


def test_sandbox_invalid_composition():
    """Requesting a nonexistent composition returns an error."""
    result = run_model(
        TEST_MODEL, "nonexistent", {}, use_sandbox=True,
    )
    assert "error" in result


# A dangling projection placed BEFORE the Composition is assembled — the worst
# case, since a normal exec aborts there and never builds the Composition.
_DANGLING_BEFORE_COMP = """import psyneulink as pnl
a = pnl.ProcessingMechanism(input_shapes=2, name='a')
b = pnl.TransferMechanism(input_shapes=2, name='b')
a_to_b = pnl.MappingProjection(sender=a, receiver=b, name='a_to_b')
bad = pnl.MappingProjection(sender=LC, receiver=b, name='bad')
comp = pnl.Composition(name='comp')
comp.add_node(a)
comp.add_node(b)
comp.add_projection(a_to_b)
"""


def test_sandbox_dangling_projection_degrades_gracefully():
    """A dangling projection no longer collapses the whole model (#615).

    Before the fix the NameError aborted the script before the Composition was
    built, so introspection returned 0 compositions / 0 mechanisms. The model
    should still render its valid mechanisms + Composition, flagged partial,
    with the broken statement reported in skippedStatements (and clean,
    un-suffixed node names — the registry is cleared before the resilient
    re-run).
    """
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(_DANGLING_BEFORE_COMP)
        f.flush()
        path = f.name
    try:
        result = load_and_introspect(path, use_sandbox=True)
        assert len(result["compositions"]) == 1
        names = sorted(clean_name(n["name"]) for n in result["compositions"][0]["nodes"])
        assert names == ["a", "b"]
        assert result.get("partialExecution") is True
        skipped_lines = [s["line"] for s in result.get("skippedStatements", [])]
        assert 5 in skipped_lines  # the dangling `bad = ...` projection
    finally:
        Path(path).unlink(missing_ok=True)
