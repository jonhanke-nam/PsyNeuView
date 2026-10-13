"""Tests for the file writer service."""

import ast
import pytest
import tempfile
from pathlib import Path
from app.services.file_writer import (
    apply_function_change,
    apply_node_rename,
    apply_parameter_change,
    apply_port_add,
    apply_port_remove,
    apply_port_rename,
    save_source,
)
from tests.conftest import clean_name, find_node

TEST_MODEL = str(Path(__file__).parent.parent / "test_model.py")


@pytest.fixture
def tmp_model():
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(Path(TEST_MODEL).read_text())
        f.flush()
        yield f.name
    Path(f.name).unlink(missing_ok=True)


def test_change_mechanism_param(tmp_model):
    result = apply_parameter_change(
        tmp_model, "response", "input_shapes", "[5]", "mechanism"
    )
    assert "input_shapes=[5]" in result


def test_change_function_param(tmp_model):
    result = apply_parameter_change(
        tmp_model, "response", "gain", "2.5", "function"
    )
    assert "gain=2.5" in result


def test_original_code_preserved(tmp_model):
    result = apply_parameter_change(
        tmp_model, "response", "gain", "2.5", "function"
    )
    assert "colors_input = pnl.TransferMechanism(" in result
    assert "words_input = pnl.TransferMechanism(" in result


def test_invalid_var_name(tmp_model):
    with pytest.raises(ValueError, match="Could not find declaration"):
        apply_parameter_change(tmp_model, "nonexistent", "gain", "2.0", "mechanism")


def test_param_not_in_source_is_inserted(tmp_model):
    # Per e7f1e9f, _replace_direct_param inserts the param when it isn't already
    # present in the constructor instead of raising. Pin that contract here.
    result = apply_parameter_change(
        tmp_model, "response", "noise", "0.1", "mechanism"
    )
    assert "noise=0.1" in result


def test_change_param_on_indented_declaration():
    """Function-scoped nodes are declared indented inside a def body (#422).
    The writer must find and edit them while preserving indentation."""
    src = (
        "import psyneulink as pnl\n"
        "\n"
        "def build():\n"
        "    a = pnl.TransferMechanism(\n"
        "        name='A', function=pnl.Logistic(gain=1.0)\n"
        "    )\n"
        "    return a\n"
    )
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(src)
        f.flush()
        path = f.name
    try:
        result = apply_parameter_change(path, "a", "gain", "2.5", "function")
        assert "gain=2.5" in result
        # indentation of the declaration line is preserved
        assert "    a = pnl.TransferMechanism(" in result
        assert "gain=1.0" not in result
    finally:
        Path(path).unlink(missing_ok=True)


def test_save_source(tmp_model):
    new_source = "# modified\nimport psyneulink as pnl\n"
    save_source(tmp_model, new_source)
    assert Path(tmp_model).read_text() == new_source


def test_apply_function_change_swaps_class(tmp_model):
    # response currently has function=pnl.Logistic(gain=1.0); swap to Linear
    # with defaults. Old function-specific params must be dropped.
    result = apply_function_change(tmp_model, "response", "Linear")
    assert "function=pnl.Linear()" in result
    assert "Logistic" not in result.split("response = ")[1].split(")", 2)[0]


def test_apply_function_change_preserves_other_params(tmp_model):
    # Mechanism-level params (input_shapes, name) must survive the swap.
    result = apply_function_change(tmp_model, "response", "Linear")
    assert "input_shapes=[2]" in result
    assert "name='response'" in result


def test_apply_function_change_rejects_bad_class_name(tmp_model):
    with pytest.raises(ValueError, match="Invalid function class name"):
        apply_function_change(tmp_model, "response", "Linear; import os")


def test_apply_function_change_unknown_var(tmp_model):
    with pytest.raises(ValueError, match="Could not find declaration"):
        apply_function_change(tmp_model, "nonexistent", "Linear")


def test_apply_function_change_inserts_when_missing():
    # Mechanism with no explicit function= → swap should insert one.
    src = "import psyneulink as pnl\nm = pnl.TransferMechanism(input_shapes=3, name='m')\n"
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(src)
        path = f.name
    try:
        result = apply_function_change(path, "m", "Logistic")
        assert "function=pnl.Logistic()" in result
        assert "input_shapes=3" in result
    finally:
        Path(path).unlink(missing_ok=True)


def test_round_trip_preserves_validity(tmp_model):
    """Change a param, then verify the file still loads in PsyNeuLink."""
    from app.services.introspector import load_and_introspect

    apply_parameter_change(tmp_model, "response", "gain", "3.0", "function")
    result = load_and_introspect(tmp_model, use_sandbox=False)
    assert len(result["compositions"]) == 1
    response = find_node(result["compositions"][0]["nodes"], "response")
    assert response["function"]["type"] == "Logistic"


def test_input_shape_change_round_trip(tmp_model):
    """Changing input_shapes via the param-update writer must produce a file
    that PNL re-introspects with the new port shape.

    Uses a standalone mechanism (no projections) so the shape change doesn't
    invalidate downstream matrices. Pins the contract that backs the
    inspector's editable port-shape affordance (#195)."""
    from app.services.introspector import load_and_introspect

    src = (
        "import psyneulink as pnl\n"
        "m = pnl.TransferMechanism(input_shapes=[3], name='m')\n"
        "comp = pnl.Composition(name='comp')\n"
        "comp.add_node(m)\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(src)
        path = f.name
    try:
        apply_parameter_change(path, "m", "input_shapes", "[7]", "mechanism")
        result = load_and_introspect(path, use_sandbox=False)
        m_node = find_node(result["compositions"][0]["nodes"], "m")
        assert m_node["inputPorts"][0]["shape"] == [7]
    finally:
        Path(path).unlink(missing_ok=True)


def test_input_shape_change_scalar_round_trip():
    """Scalar shape spec (no brackets) is also a valid PNL input_shapes value
    and must round-trip with the same effect as the list form."""
    from app.services.introspector import load_and_introspect

    src = (
        "import psyneulink as pnl\n"
        "m = pnl.TransferMechanism(input_shapes=3, name='m')\n"
        "comp = pnl.Composition(name='comp')\n"
        "comp.add_node(m)\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(src)
        path = f.name
    try:
        apply_parameter_change(path, "m", "input_shapes", "5", "mechanism")
        result = load_and_introspect(path, use_sandbox=False)
        m_node = find_node(result["compositions"][0]["nodes"], "m")
        assert m_node["inputPorts"][0]["shape"] == [5]
    finally:
        Path(path).unlink(missing_ok=True)


# ============================================================
# Port management
# ============================================================


def test_rename_input_port_inserts_kwarg(tmp_model):
    # The test model has no explicit input_ports=, so renaming the default
    # 'InputPort-0' should insert the kwarg with the new name.
    result = apply_port_rename(
        tmp_model, "colors_input", "input", ["InputPort-0"], "InputPort-0", "MY_INPUT"
    )
    assert "input_ports=['MY_INPUT']" in result
    # Other mechanisms must not be touched.
    assert "words_input = pnl.TransferMechanism(" in result
    assert "response = pnl.TransferMechanism(" in result


def test_rename_output_port_inserts_kwarg(tmp_model):
    result = apply_port_rename(
        tmp_model, "response", "output", ["RESULT"], "RESULT", "MY_OUTPUT"
    )
    assert "output_ports=['MY_OUTPUT']" in result


def test_rename_port_replaces_existing_string_list():
    src = (
        "import psyneulink as pnl\n"
        "m = pnl.TransferMechanism(input_ports=['a', 'b'], name='m')\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(src)
        path = f.name
    try:
        result = apply_port_rename(path, "m", "input", ["a", "b"], "a", "z")
        assert "input_ports=['z', 'b']" in result
    finally:
        Path(path).unlink(missing_ok=True)


def test_rename_port_refuses_unsupported_dict_form():
    # If the existing source uses dict specs, the GUI rename must refuse
    # rather than silently corrupting the file.
    src = (
        "import psyneulink as pnl\n"
        "m = pnl.TransferMechanism(input_ports=[{'NAME': 'a'}], name='m')\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(src)
        path = f.name
    try:
        with pytest.raises(ValueError, match="unsupported form"):
            apply_port_rename(path, "m", "input", ["a"], "a", "z")
    finally:
        Path(path).unlink(missing_ok=True)


def test_rename_port_rejects_unknown_port(tmp_model):
    with pytest.raises(ValueError, match="not in current input ports"):
        apply_port_rename(
            tmp_model, "colors_input", "input", ["InputPort-0"], "nope", "z"
        )


def test_rename_port_rejects_name_collision():
    src = (
        "import psyneulink as pnl\n"
        "m = pnl.TransferMechanism(input_ports=['a', 'b'], name='m')\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(src)
        path = f.name
    try:
        with pytest.raises(ValueError, match="already exists"):
            apply_port_rename(path, "m", "input", ["a", "b"], "a", "b")
    finally:
        Path(path).unlink(missing_ok=True)


def test_rename_port_rejects_invalid_name(tmp_model):
    with pytest.raises(ValueError, match="invalid port name"):
        apply_port_rename(
            tmp_model, "colors_input", "input", ["InputPort-0"], "InputPort-0", "1bad"
        )


def test_rename_port_rejects_unknown_kind(tmp_model):
    with pytest.raises(ValueError, match="port_kind"):
        apply_port_rename(
            tmp_model, "colors_input", "parameter", ["x"], "x", "y"
        )


def test_add_input_port_appends(tmp_model):
    result = apply_port_add(
        tmp_model, "colors_input", "input", ["InputPort-0"], "EXTRA_IN"
    )
    assert "input_ports=['InputPort-0', 'EXTRA_IN']" in result


def test_add_output_port_appends(tmp_model):
    result = apply_port_add(
        tmp_model, "response", "output", ["RESULT"], "EXTRA_OUT"
    )
    assert "output_ports=['RESULT', 'EXTRA_OUT']" in result


def test_add_port_rejects_duplicate(tmp_model):
    with pytest.raises(ValueError, match="already exists"):
        apply_port_add(
            tmp_model, "colors_input", "input", ["InputPort-0"], "InputPort-0"
        )


def test_remove_port_drops_from_list():
    src = (
        "import psyneulink as pnl\n"
        "m = pnl.TransferMechanism(input_ports=['a', 'b', 'c'], name='m')\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(src)
        path = f.name
    try:
        result = apply_port_remove(path, "m", "input", ["a", "b", "c"], "b")
        assert "input_ports=['a', 'c']" in result
    finally:
        Path(path).unlink(missing_ok=True)


def test_remove_port_refuses_last(tmp_model):
    # The default test model has a single input port per mechanism — remove
    # must refuse since mechanisms must have at least one of each kind.
    with pytest.raises(ValueError, match="cannot remove the last"):
        apply_port_remove(
            tmp_model, "colors_input", "input", ["InputPort-0"], "InputPort-0"
        )


def test_remove_port_rejects_unknown(tmp_model):
    with pytest.raises(ValueError, match="not in current"):
        apply_port_remove(
            tmp_model, "colors_input", "input", ["InputPort-0"], "nope"
        )


def test_port_ops_reject_unknown_var(tmp_model):
    with pytest.raises(ValueError, match="could not find declaration"):
        apply_port_rename(
            tmp_model, "nonexistent", "input", ["InputPort-0"], "InputPort-0", "x"
        )


def test_rename_input_port_round_trip_loads(tmp_model):
    """The file with a renamed input port must still load in PsyNeuLink, and
    the introspector must report the new name."""
    from app.services.introspector import load_and_introspect

    apply_port_rename(
        tmp_model, "colors_input", "input", ["InputPort-0"], "InputPort-0", "MY_INPUT"
    )
    result = load_and_introspect(tmp_model, use_sandbox=False)
    colors = find_node(result["compositions"][0]["nodes"], "colors_input")
    names = [p["name"] for p in colors["inputPorts"]]
    assert "MY_INPUT" in names


def test_rename_output_port_round_trip_loads(tmp_model):
    from app.services.introspector import load_and_introspect

    apply_port_rename(
        tmp_model, "response", "output", ["RESULT"], "RESULT", "MY_OUTPUT"
    )
    result = load_and_introspect(tmp_model, use_sandbox=False)
    response = find_node(result["compositions"][0]["nodes"], "response")
    names = [p["name"] for p in response["outputPorts"]]
    assert "MY_OUTPUT" in names


def _write_tmp(source: str) -> str:
    f = tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w")
    f.write(source)
    f.flush()
    return f.name


# --- #300: constructor-call matchers must not hardcode the `pnl.` prefix ---
# A model can reference PsyNeuLink classes without the `pnl.` prefix (via
# `from psyneulink import *` or `from psyneulink import Linear`). Editing a
# function param on such a node used to raise "Could not find parameter … in
# function context" because the nested-function regex required `pnl.`.

_BARE_FUNC_MODEL = (
    "import psyneulink as pnl\n"
    "from psyneulink import Linear\n\n"
    "word_input = pnl.ProcessingMechanism(\n"
    "    input_shapes=2,\n"
    "    name='word_input',\n"
    "    function=Linear(offset=1),\n"
    ")\n"
)

_STAR_IMPORT_MODEL = (
    "from psyneulink import *\n\n"
    "word_input = ProcessingMechanism(\n"
    "    input_shapes=2,\n"
    "    name='word_input',\n"
    "    function=Linear(offset=1),\n"
    ")\n"
)


def test_function_param_edit_on_unprefixed_function_call():
    path = _write_tmp(_BARE_FUNC_MODEL)
    try:
        result = apply_parameter_change(
            path, "word_input", "intercept", "0.5", "function"
        )
        assert "function=Linear(offset=1, intercept=0.5)" in result
    finally:
        Path(path).unlink(missing_ok=True)


def test_mechanism_and_function_edit_on_star_import_model():
    path = _write_tmp(_STAR_IMPORT_MODEL)
    try:
        # declaration finder must locate `word_input = ProcessingMechanism(`
        result = apply_parameter_change(
            path, "word_input", "slope", "2.0", "function"
        )
        assert "function=Linear(offset=1, slope=2.0)" in result
    finally:
        Path(path).unlink(missing_ok=True)


def test_prefixed_function_call_still_edits():
    # Regression guard: relaxing the prefix must not break the common
    # fully-`pnl.`-qualified form.
    path = _write_tmp(
        "import psyneulink as pnl\n\n"
        "word_input = pnl.ProcessingMechanism(\n"
        "    name='word_input',\n"
        "    function=pnl.Linear(offset=1),\n"
        ")\n"
    )
    try:
        result = apply_parameter_change(
            path, "word_input", "slope", "2.0", "function"
        )
        assert "function=pnl.Linear(offset=1, slope=2.0)" in result
    finally:
        Path(path).unlink(missing_ok=True)


# --- apply_node_rename: rename a node's display name (#612) ---

_EXISTING = ["colors_input", "words_input", "response", "stroop_model"]


def test_rename_node_replaces_name(tmp_model):
    result = apply_node_rename(tmp_model, "response", "Response Layer", _EXISTING, "response")
    assert "name='Response Layer'" in result
    assert "name='response'" not in result


def test_rename_node_allows_spaces_and_brackets(tmp_model):
    # Display names aren't Python identifiers — this is why we rename name=,
    # not the variable.
    result = apply_node_rename(tmp_model, "response", "STATE [VALUE]", _EXISTING, "response")
    assert "name='STATE [VALUE]'" in result


def test_rename_node_inserts_name_when_absent():
    src = "import psyneulink as pnl\nA = pnl.TransferMechanism()\n"
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(src)
        f.flush()
        path = f.name
    try:
        result = apply_node_rename(path, "A", "Alpha", [], None)
        assert "name='Alpha'" in result
    finally:
        Path(path).unlink(missing_ok=True)


def test_rename_node_collision_blocked(tmp_model):
    with pytest.raises(ValueError, match="already exists"):
        apply_node_rename(tmp_model, "response", "colors_input", _EXISTING, "response")


def test_rename_node_empty_rejected(tmp_model):
    with pytest.raises(ValueError, match="empty"):
        apply_node_rename(tmp_model, "response", "   ", _EXISTING, "response")


def test_rename_node_same_name_is_noop(tmp_model):
    result = apply_node_rename(tmp_model, "response", "response", _EXISTING, "response")
    assert "name='response'" in result


# --- #1200: editing an inherited function parameter -------------------------
#
# A mechanism added from the palette is written bare — `pnl.DDM(name='x')` —
# with no `function=`. The Inspector still shows the default function's
# parameters, so the row looked editable and then failed with "Could not find
# parameter … in function context". Chapter 2 of the course is about varying a
# DDM's threshold, so this sat directly on the path for the guided walkthroughs.


def test_function_param_materialises_default_function(tmp_path):
    """Editing an inherited function param writes the function in."""
    f = tmp_path / "m.py"
    f.write_text(
        "import psyneulink as pnl\n\nNew_DDM_1 = pnl.DDM(\n    name='New_DDM_1'\n)\n"
    )
    out = apply_parameter_change(
        str(f), "New_DDM_1", "threshold", "2",
        context="function", function_class="DriftDiffusionAnalytical",
    )
    assert "function=pnl.DriftDiffusionAnalytical(threshold=2)" in out
    ast.parse(out)
    assert "name='New_DDM_1'" in out


def test_function_param_respects_the_source_import_style(tmp_path):
    """A star-imported file gets `DriftDiffusionAnalytical(...)`, not `pnl.`."""
    f = tmp_path / "m.py"
    f.write_text("from psyneulink import *\n\nd = DDM(\n    name='d'\n)\n")
    out = apply_parameter_change(
        str(f), "d", "threshold", "2",
        context="function", function_class="DriftDiffusionAnalytical",
    )
    assert "function=DriftDiffusionAnalytical(threshold=2)" in out
    assert "pnl." not in out
    ast.parse(out)


def test_existing_function_is_edited_not_replaced(tmp_path):
    """An explicit function= is still edited in place, not clobbered."""
    f = tmp_path / "m.py"
    f.write_text(
        "import psyneulink as pnl\n\nh = pnl.TransferMechanism(\n"
        "    function=pnl.Logistic(bias=-4, gain=1.1),\n    name='h'\n)\n"
    )
    out = apply_parameter_change(
        str(f), "h", "gain", "2.5",
        context="function", function_class="Logistic",
    )
    assert "gain=2.5" in out
    assert "bias=-4" in out          # sibling parameter survives
    assert out.count("function=") == 1  # no second function= appended
    ast.parse(out)


def test_function_param_without_a_class_still_errors(tmp_path):
    """No function= and no class to materialise -> refuse, don't guess."""
    f = tmp_path / "m.py"
    f.write_text("import psyneulink as pnl\n\nd = pnl.DDM(\n    name='d'\n)\n")
    with pytest.raises(ValueError, match="Could not find parameter"):
        apply_parameter_change(str(f), "d", "threshold", "2", context="function")


def test_setting_a_function_param_to_its_current_value_is_a_no_op(tmp_path):
    """The regression that broke devel.

    `updated_block == block` is not the same as "there is no function=": it is
    also true for a no-op set, when the parameter already holds the requested
    value. Materialising then appended a SECOND function= and produced
    `keyword argument repeated: function` — a file that no longer parses.

    Walkthroughs and specs re-run against the same working copy, so the second
    run hit it every time.
    """
    f = tmp_path / "m.py"
    f.write_text(
        "import psyneulink as pnl\n\nh = pnl.TransferMechanism(\n"
        "    function=pnl.Logistic(bias=-4, gain=2.5),\n    name='h'\n)\n"
    )
    out = apply_parameter_change(
        str(f), "h", "gain", "2.5",
        context="function", function_class="Logistic",
    )
    assert out.count("function=") == 1, "a second function= was appended"
    ast.parse(out)  # would raise: keyword argument repeated
    assert "gain=2.5" in out


def test_no_op_set_on_a_bare_mechanism_still_materialises_once(tmp_path):
    """Repeating the same edit must not stack function= arguments either."""
    f = tmp_path / "m.py"
    f.write_text("import psyneulink as pnl\n\nd = pnl.DDM(\n    name='d'\n)\n")
    first = apply_parameter_change(
        str(f), "d", "threshold", "2",
        context="function", function_class="DriftDiffusionAnalytical",
    )
    assert first.count("function=") == 1
    # Same edit again, now against the materialised source.
    second = apply_parameter_change(
        str(f), "d", "threshold", "2",
        context="function", function_class="DriftDiffusionAnalytical",
    )
    assert second.count("function=") == 1
    ast.parse(second)
