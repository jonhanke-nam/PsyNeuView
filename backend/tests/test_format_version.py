"""Tests for format versioning — header parsing and version warnings."""

import tempfile
import pytest
from pathlib import Path
from app.services.introspector import load_and_introspect

TEST_MODEL = str(Path(__file__).parent.parent / "test_model.py")


def test_header_parsed_from_standard_file():
    result = load_and_introspect(TEST_MODEL, use_sandbox=False)
    assert "header" in result
    assert result["header"]["format_version"] == "1.0"
    # Tolerate four-part versions ("0.18.0.0") and setuptools-scm suffixes
    # ("0.18.0.0+227.ge814fc5aad") from editable installs.
    assert result["header"]["psyneulink_version"].startswith("0.18.")
    assert result["header"]["model_name"] == "simple_stroop"


def test_header_empty_for_file_without_header():
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(
            "import psyneulink as pnl\n"
            "a = pnl.TransferMechanism(input_shapes=[1], name='a')\n"
            "c = pnl.Composition(name='c')\n"
            "c.add_node(a)\n"
        )
        f.flush()
        path = f.name

    try:
        result = load_and_introspect(path, use_sandbox=False)
        assert result["header"] == {}
    finally:
        Path(path).unlink(missing_ok=True)


def test_version_mismatch_produces_warning():
    """A file written for a different PsyNeuLink version should produce a warning."""
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(
            "# PsyNeuLink Model File\n"
            "# Format Version: 1.0\n"
            "# PsyNeuLink: 0.0.1\n"  # Very old version — guaranteed mismatch
            "# Model: test\n"
            "\n"
            "import psyneulink as pnl\n"
            "a = pnl.TransferMechanism(input_shapes=[1], name='a')\n"
            "c = pnl.Composition(name='c')\n"
            "c.add_node(a)\n"
        )
        f.flush()
        path = f.name

    try:
        result = load_and_introspect(path, use_sandbox=False)
        assert "warnings" in result
        assert len(result["warnings"]) >= 1
        assert "0.0.1" in result["warnings"][0]
    finally:
        Path(path).unlink(missing_ok=True)


def test_matching_version_no_warning():
    """A file matching the current PsyNeuLink version should produce no warning."""
    import psyneulink as pnl
    current_version = getattr(pnl, "__version__", "unknown")

    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(
            "# PsyNeuLink Model File\n"
            "# Format Version: 1.0\n"
            f"# PsyNeuLink: {current_version}\n"
            "# Model: test\n"
            "\n"
            "import psyneulink as pnl\n"
            "a = pnl.TransferMechanism(input_shapes=[1], name='a')\n"
            "c = pnl.Composition(name='c')\n"
            "c.add_node(a)\n"
        )
        f.flush()
        path = f.name

    try:
        result = load_and_introspect(path, use_sandbox=False)
        assert "warnings" not in result or len(result.get("warnings", [])) == 0
    finally:
        Path(path).unlink(missing_ok=True)


def test_partial_header_parsed():
    """A file with only some header fields still parses what's there."""
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(
            "# Format Version: 2.0\n"
            "# Model: partial_test\n"
            "\n"
            "import psyneulink as pnl\n"
            "a = pnl.TransferMechanism(input_shapes=[1], name='a')\n"
            "c = pnl.Composition(name='c')\n"
            "c.add_node(a)\n"
        )
        f.flush()
        path = f.name

    try:
        result = load_and_introspect(path, use_sandbox=False)
        assert result["header"]["format_version"] == "2.0"
        assert result["header"]["model_name"] == "partial_test"
        assert "psyneulink_version" not in result["header"]
    finally:
        Path(path).unlink(missing_ok=True)
