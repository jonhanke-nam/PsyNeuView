"""Integration tests using fixture files that exercise every import/validate scenario.

Each fixture file tests a specific real-world pattern. These tests verify
that the full pipeline (load → introspect → diagnostics) handles them correctly.
"""

import shutil
import pytest
from pathlib import Path
from app.services.introspector import load_and_introspect
from app.services.converter import convert_star_imports

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _load(name: str) -> dict:
    """Load a fixture file and return the introspection result.

    Uses the sandbox worker (use_sandbox=True) to exercise the full
    production pipeline including diagnostics computation.
    """
    path = FIXTURES_DIR / name
    assert path.exists(), f"Fixture not found: {path}"
    return load_and_introspect(str(path), use_sandbox=True)


class TestStandardSimple:
    """Standard format file with header, sections, simple model."""

    def test_loads_successfully(self):
        result = _load("standard_simple.py")
        assert result.get("error") is None

    def test_finds_composition(self):
        result = _load("standard_simple.py")
        assert len(result["compositions"]) == 1
        assert "standard_simple" in result["compositions"][0]["name"]

    def test_finds_nodes_and_projections(self):
        result = _load("standard_simple.py")
        comp = result["compositions"][0]
        assert len(comp["nodes"]) == 2
        assert len(comp["projections"]) >= 1

    def test_diagnostics_all_editable(self):
        result = _load("standard_simple.py")
        diag = result["diagnostics"]
        assert diag["mechanismCount"] == 2
        assert len(diag["editableVars"]) >= 2
        assert len(diag["readOnlyVars"]) == 0

    def test_diagnostics_standardized(self):
        result = _load("standard_simple.py")
        diag = result["diagnostics"]
        assert diag["isStandardized"] is True
        assert diag["importStyle"] == "standard"

    def test_no_warnings(self):
        result = _load("standard_simple.py")
        diag = result["diagnostics"]
        assert len(diag["warnings"]) == 0


class TestStarImportStroop:
    """Star import file — needs conversion before editing works."""

    def test_star_import_detected(self):
        source = (FIXTURES_DIR / "star_import_stroop.py").read_text()
        _, was_converted = convert_star_imports(source)
        assert was_converted

    def test_conversion_produces_valid_code(self):
        source = (FIXTURES_DIR / "star_import_stroop.py").read_text()
        converted, _ = convert_star_imports(source)
        assert "import psyneulink as pnl" in converted
        assert "pnl.TransferMechanism" in converted
        assert "pnl.DDM" in converted
        assert "pnl.Composition" in converted
        # Verify it compiles
        compile(converted, "<test>", "exec")

    def test_converted_file_introspects(self):
        source = (FIXTURES_DIR / "star_import_stroop.py").read_text()
        converted, _ = convert_star_imports(source)
        # Write to temp file and introspect
        import tempfile
        f = tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False)
        f.write(converted)
        f.close()
        result = load_and_introspect(f.name, use_sandbox=False)
        assert len(result["compositions"]) == 1
        comp = result["compositions"][0]
        assert comp["name"] == "stroop"
        assert len(comp["nodes"]) == 6
        assert len(comp["projections"]) >= 5


class TestFreeformNoSections:
    """Free-form file without section banners."""

    def test_loads_successfully(self):
        result = _load("freeform_no_sections.py")
        assert result.get("error") is None

    def test_finds_model(self):
        result = _load("freeform_no_sections.py")
        assert len(result["compositions"]) == 1
        assert "freeform_model" in result["compositions"][0]["name"]

    def test_diagnostics_not_standardized(self):
        result = _load("freeform_no_sections.py")
        diag = result["diagnostics"]
        assert diag["isStandardized"] is False

    def test_nodes_editable(self):
        result = _load("freeform_no_sections.py")
        diag = result["diagnostics"]
        assert len(diag["editableVars"]) >= 2


class TestOrphanMechanisms:
    """File with mechanisms not added to any composition."""

    def test_loads_with_warning(self):
        result = _load("orphan_mechanisms.py")
        diag = result["diagnostics"]
        warnings = diag["warnings"]
        assert any("not in any composition" in w for w in warnings)

    def test_orphans_named_in_warning(self):
        result = _load("orphan_mechanisms.py")
        diag = result["diagnostics"]
        orphan_warning = [w for w in diag["warnings"] if "not in any composition" in w][0]
        assert "orphan" in orphan_warning or "also_orphan" in orphan_warning

    def test_suggestion_provided(self):
        result = _load("orphan_mechanisms.py")
        diag = result["diagnostics"]
        orphan_warning = [w for w in diag["warnings"] if "not in any composition" in w][0]
        assert "add_node" in orphan_warning


class TestSyntaxError:
    """File with a deliberate syntax error."""

    def _load_syntax_error(self):
        """Load the syntax error fixture, catching the RuntimeError."""
        try:
            return _load("syntax_error.py")
        except RuntimeError as e:
            # The introspector raises RuntimeError for catastrophic failures
            return {"error": str(e), "compositions": []}

    def test_returns_error(self):
        result = self._load_syntax_error()
        assert result.get("error") is not None

    def test_error_mentions_syntax(self):
        result = self._load_syntax_error()
        assert "syntax" in result["error"].lower() or "Syntax" in result["error"]

    def test_no_compositions(self):
        result = self._load_syntax_error()
        assert len(result.get("compositions", [])) == 0


class TestFunctionScope:
    """File with PNL objects inside a function."""

    def test_notices_about_function_scope(self):
        result = _load("function_scope.py")
        diag = result["diagnostics"]
        # Function-scope is surfaced as an informational notice (calm/blue),
        # not a yellow-panel warning (#423 follow-up).
        notices = diag.get("notices", [])
        assert any("function" in n.lower() for n in notices)

    def test_visible_mechanism_found(self):
        result = _load("function_scope.py")
        assert len(result["compositions"]) == 1
        comp = result["compositions"][0]
        node_names = [n["name"] for n in comp["nodes"]]
        assert any("visible" in n for n in node_names)


class TestEmptyFile:
    """Empty file with no PNL code."""

    def test_returns_no_compositions(self):
        result = _load("empty_file.py")
        assert len(result.get("compositions", [])) == 0

    def test_returns_helpful_error(self):
        result = _load("empty_file.py")
        assert result.get("error") is not None
        assert "Composition" in result["error"]


class TestNestedCompositions:
    """File with nested compositions."""

    def test_loads_with_nesting(self):
        result = _load("nested_compositions.py")
        assert result.get("error") is None

    def test_finds_outer_composition(self):
        result = _load("nested_compositions.py")
        comp_names = [c["name"] for c in result["compositions"]]
        assert any("outer_comp" in n for n in comp_names)

    def test_nesting_depth_detected(self):
        result = _load("nested_compositions.py")
        diag = result["diagnostics"]
        assert diag["complexity"]["nestingDepth"] >= 1

    def test_multiple_composition_warning(self):
        result = _load("nested_compositions.py")
        diag = result["diagnostics"]
        # Should detect 2 top-level compositions (inner_comp + outer_comp)
        assert diag["compositionCount"] >= 2
