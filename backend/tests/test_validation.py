"""Tests for file validation, error handling, and diagnostics."""

import tempfile
import pytest
from pathlib import Path
from app.services.introspector import load_and_introspect
from app.services.converter import convert_star_imports


def _write_temp(source: str) -> str:
    """Write source to a temp .py file and return the path."""
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False)
    f.write(source)
    f.close()
    return f.name


class TestSyntaxErrors:
    def test_syntax_error_returns_line_number(self):
        path = _write_temp("import psyneulink as pnl\nx = pnl.TransferMechanism(\n")
        result = load_and_introspect(path)
        assert "error" in result
        assert result.get("errorLine") is not None

    def test_syntax_error_returns_message(self):
        path = _write_temp("def foo(\n")
        result = load_and_introspect(path)
        assert "error" in result
        assert "Syntax error" in result["error"] or "SyntaxError" in str(result.get("error", ""))


class TestEmptyAndMissing:
    def test_empty_file(self):
        path = _write_temp("")
        result = load_and_introspect(path)
        assert len(result.get("compositions", [])) == 0

    def test_no_compositions(self):
        path = _write_temp("import psyneulink as pnl\na = pnl.TransferMechanism(name='a')\n")
        result = load_and_introspect(path)
        assert len(result.get("compositions", [])) == 0
        # Should have a helpful error message
        assert "error" in result
        assert "Composition" in result["error"]

    def test_valid_model_no_error(self):
        path = _write_temp("""\
import psyneulink as pnl
a = pnl.TransferMechanism(name='a')
comp = pnl.Composition(name='test')
comp.add_node(a)
""")
        result = load_and_introspect(path)
        assert len(result.get("compositions", [])) == 1
        assert result.get("error") is None


class TestDiagnostics:
    def test_diagnostics_present(self):
        path = _write_temp("""\
import psyneulink as pnl
a = pnl.TransferMechanism(name='a')
comp = pnl.Composition(name='test')
comp.add_node(a)
""")
        result = load_and_introspect(path)
        diag = result.get("diagnostics")
        assert diag is not None
        assert diag["compositionCount"] == 1
        assert diag["mechanismCount"] >= 1

    def test_editable_vars_detected(self):
        path = _write_temp("""\
import psyneulink as pnl
a = pnl.TransferMechanism(name='a')
comp = pnl.Composition(name='test')
comp.add_node(a)
""")
        result = load_and_introspect(path)
        diag = result.get("diagnostics", {})
        assert "a" in diag.get("editableVars", [])

    def test_orphan_mechanism_warned(self):
        path = _write_temp("""\
import psyneulink as pnl
a = pnl.TransferMechanism(name='a')
b = pnl.TransferMechanism(name='b')
comp = pnl.Composition(name='test')
comp.add_node(a)
""")
        result = load_and_introspect(path)
        diag = result.get("diagnostics", {})
        warnings = diag.get("warnings", [])
        assert any("not in any composition" in w for w in warnings)

    def test_pnl_version_in_diagnostics(self):
        path = _write_temp("""\
import psyneulink as pnl
comp = pnl.Composition(name='test')
""")
        result = load_and_introspect(path)
        diag = result.get("diagnostics", {})
        assert diag.get("pnlVersion") is not None
        assert diag["pnlVersion"] != "unknown"

    def test_import_style_detected(self):
        path = _write_temp("""\
import psyneulink as pnl
comp = pnl.Composition(name='test')
""")
        result = load_and_introspect(path)
        diag = result.get("diagnostics", {})
        assert diag.get("importStyle") == "standard"


class TestFunctionScopeDetection:
    def test_mechanism_in_function_noticed(self):
        path = _write_temp("""\
import psyneulink as pnl

def make_model():
    a = pnl.TransferMechanism(name='a')
    return a

comp = pnl.Composition(name='test')
""")
        result = load_and_introspect(path)
        diag = result.get("diagnostics", {})
        # Function-scope is an informational *notice*, not a warning — the
        # nodes are editable, so it must not surface as an error (#423 follow-up).
        notices = diag.get("notices", [])
        func_notices = [n for n in notices if "inside a function" in n.lower()]
        assert func_notices
        assert not any("not accessible" in n.lower() for n in func_notices)
        # It must stay out of the warnings channel that flips the panel yellow.
        assert not any(
            "inside a function" in w.lower() for w in diag.get("warnings", [])
        )


class TestStarImportE2E:
    def test_star_import_converts_and_introspects(self):
        """End-to-end: star-import file → convert → introspect → valid graph."""
        source = """\
from psyneulink import *
import numpy as np

a = TransferMechanism(input_shapes=[2], name='a')
b = TransferMechanism(input_shapes=[2], name='b')
proj = MappingProjection(sender=a, receiver=b, name='a_to_b')
comp = Composition(name='test')
comp.add_node(a)
comp.add_node(b)
comp.add_projection(proj)
"""
        # Convert
        converted, was_converted = convert_star_imports(source)
        assert was_converted
        assert "import psyneulink as pnl" in converted
        assert "pnl.TransferMechanism" in converted
        assert "pnl.Composition" in converted

        # Write and introspect (use_sandbox=False to avoid shared subprocess state)
        path = _write_temp(converted)
        result = load_and_introspect(path, use_sandbox=False)
        assert len(result.get("compositions", [])) == 1
        comp_data = result["compositions"][0]
        assert comp_data["name"] == "test"
        node_names = [n["name"] for n in comp_data["nodes"]]
        assert any("a" in n for n in node_names)
        assert any("b" in n for n in node_names)
        assert len(comp_data["projections"]) >= 1

    def test_star_import_with_constants(self):
        """Star import file using PNL constants like IDENTITY_MATRIX."""
        source = """\
from psyneulink import *
a = TransferMechanism(name='a')
b = TransferMechanism(name='b')
comp = Composition(name='test')
comp.add_node(a)
comp.add_node(b)
"""
        converted, was_converted = convert_star_imports(source)
        assert was_converted
        path = _write_temp(converted)
        result = load_and_introspect(path, use_sandbox=False)
        assert len(result.get("compositions", [])) == 1


class TestParameterValidation:
    def test_valid_number(self):
        from app.services.file_writer import _validate_param_value
        assert _validate_param_value("1.5") is None

    def test_valid_list(self):
        from app.services.file_writer import _validate_param_value
        assert _validate_param_value("[1, 2, 3]") is None

    def test_valid_string(self):
        from app.services.file_writer import _validate_param_value
        assert _validate_param_value("'hello'") is None

    def test_valid_expression(self):
        from app.services.file_writer import _validate_param_value
        assert _validate_param_value("pnl.Linear()") is None

    def test_invalid_syntax(self):
        from app.services.file_writer import _validate_param_value
        result = _validate_param_value("1.5 +")
        assert result is not None
        assert "Invalid" in result

    def test_empty_value(self):
        from app.services.file_writer import _validate_param_value
        result = _validate_param_value("")
        assert result is not None
        assert "empty" in result.lower()

    def test_unbalanced_parens(self):
        from app.services.file_writer import _validate_param_value
        result = _validate_param_value("pnl.Linear(")
        assert result is not None
