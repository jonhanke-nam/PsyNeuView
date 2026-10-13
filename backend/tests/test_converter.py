"""Tests for the free-form file converter."""

import tempfile
import pytest
from pathlib import Path
from app.services.converter import (
    is_standardized_format,
    detect_format_issues,
    convert_to_standard_format,
)
from app.services.introspector import load_and_introspect
from tests.conftest import clean_name, find_node

TEST_MODEL = str(Path(__file__).parent.parent / "test_model.py")

FREE_FORM_MODEL = """\
from psyneulink import *
import numpy as np

a = TransferMechanism(input_shapes=[3], function=Linear(), name='a')
b = TransferMechanism(input_shapes=[2], function=Logistic(gain=2.0), name='b')
p = MappingProjection(sender=a, receiver=b, name='p')
c = Composition(name='c')
c.add_node(a)
c.add_node(b)
c.add_projection(p)
"""


@pytest.fixture
def tmp_standard():
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(Path(TEST_MODEL).read_text())
        f.flush()
        yield f.name
    Path(f.name).unlink(missing_ok=True)


@pytest.fixture
def tmp_freeform():
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(FREE_FORM_MODEL)
        f.flush()
        yield f.name
    for suffix in [".py", ".original.py"]:
        Path(f.name).with_suffix(suffix).unlink(missing_ok=True)


def test_is_standardized_detects_standard(tmp_standard):
    source = Path(tmp_standard).read_text()
    assert is_standardized_format(source) is True


def test_is_standardized_detects_freeform(tmp_freeform):
    source = Path(tmp_freeform).read_text()
    assert is_standardized_format(source) is False


def test_detect_issues_on_freeform(tmp_freeform):
    source = Path(tmp_freeform).read_text()
    issues = detect_format_issues(source)
    assert len(issues) >= 1
    assert any("header" in i.lower() for i in issues)


def test_detect_no_issues_on_standard(tmp_standard):
    source = Path(tmp_standard).read_text()
    issues = detect_format_issues(source)
    assert len(issues) == 0


def test_convert_creates_backup(tmp_freeform):
    convert_to_standard_format(tmp_freeform, backup=True)
    backup = Path(tmp_freeform).with_suffix(".original.py")
    assert backup.exists()
    # Backup should contain the original content
    assert "from psyneulink import *" in backup.read_text()


def test_convert_produces_standard_format(tmp_freeform):
    new_source = convert_to_standard_format(tmp_freeform)
    assert is_standardized_format(new_source)
    assert "import psyneulink as pnl" in new_source
    assert "# Mechanisms" in new_source
    assert "# Projections" in new_source
    assert "# Compositions" in new_source


def test_convert_produces_valid_model(tmp_freeform):
    convert_to_standard_format(tmp_freeform)
    result = load_and_introspect(tmp_freeform, use_sandbox=False)
    assert len(result["compositions"]) >= 1
    nodes = [clean_name(n["name"]) for n in result["compositions"][0]["nodes"]]
    assert "a" in nodes
    assert "b" in nodes


def test_convert_preserves_function_params(tmp_freeform):
    new_source = convert_to_standard_format(tmp_freeform)
    # The Logistic function had gain=2.0 which differs from default (#94 task 2)
    assert "Logistic" in new_source
    assert "gain=2.0" in new_source, new_source


def test_convert_strips_default_function_kwargs(tmp_freeform):
    """Default-valued function kwargs should not appear in the output (#94 task 2).

    The fixture uses ``Linear()`` (all defaults). The standardized output
    should render that as ``pnl.Linear()``, not ``pnl.Linear(slope=1.0, ...)``.
    """
    new_source = convert_to_standard_format(tmp_freeform)
    # ``a`` has Linear() with all defaults — no slope/intercept should leak in.
    assert "pnl.Linear()" in new_source, new_source
    assert "slope=1.0" not in new_source
    assert "intercept=0.0" not in new_source


def test_convert_refuses_function_scoped_model(tmp_path):
    """Function-scoped models must be refused, not silently emptied (#421).

    Only the outer composition is a module-level variable; every mechanism is
    built inside ``construct_model()``. Converting would drop them all, so the
    converter must raise and leave the original file untouched.
    """
    src = (
        "import psyneulink as pnl\n"
        "def construct_model():\n"
        "    a = pnl.TransferMechanism(name='a')\n"
        "    b = pnl.TransferMechanism(name='b')\n"
        "    comp = pnl.Composition(name='comp')\n"
        "    comp.add_node(a)\n"
        "    comp.add_node(b)\n"
        "    comp.add_projection(pnl.MappingProjection(sender=a, receiver=b))\n"
        "    return comp\n"
        "comp = construct_model()\n"
    )
    target = tmp_path / "funcscope_model.py"
    target.write_text(src)

    with pytest.raises(ValueError, match="inside a function"):
        convert_to_standard_format(str(target), backup=False)
    # Original file must be preserved verbatim.
    assert target.read_text() == src


def test_convert_preserves_composition_subclass(tmp_path):
    """The composition subclass (e.g. AutodiffComposition) is preserved (#421)."""
    src = (
        "import psyneulink as pnl\n"
        "a = pnl.TransferMechanism(name='a')\n"
        "b = pnl.TransferMechanism(name='b')\n"
        "adc = pnl.AutodiffComposition(name='adc')\n"
        "adc.add_node(a)\n"
        "adc.add_node(b)\n"
        "adc.add_projection(pnl.MappingProjection(sender=a, receiver=b))\n"
    )
    target = tmp_path / "autodiff_model.py"
    target.write_text(src)

    out = convert_to_standard_format(str(target), backup=False)
    assert "adc = pnl.AutodiffComposition(name='adc')" in out, out
    assert "adc = pnl.Composition(name='adc')" not in out, out


def test_convert_drops_autoname_suffixes(tmp_path):
    """``_<N>`` session-counter suffixes get dropped to canonical names (#94 task 3).

    Pre-occupies names in the global registry, then runs a script whose
    components collide with those names, so PsyNeuLink hands them out as
    ``a_1`` / ``b_1`` / ``tiny_model_1``. The standardized output should
    rename back to the canonical form.
    """
    import psyneulink as pnl

    # Pre-occupy the registry so the next instantiations get suffixed.
    pnl.TransferMechanism(name='a')
    pnl.TransferMechanism(name='b')
    pnl.Composition(name='tiny_model')

    src = (
        "import psyneulink as pnl\n"
        "a_1 = pnl.TransferMechanism(name='a_1', function=pnl.Linear())\n"
        "b_1 = pnl.TransferMechanism(name='b_1', function=pnl.Linear())\n"
        "tiny_model_1 = pnl.Composition(name='tiny_model_1', pathways=[a_1, b_1])\n"
    )
    target = tmp_path / "suffix_model.py"
    target.write_text(src)

    out = convert_to_standard_format(str(target), backup=False)
    assert "a = pnl.TransferMechanism" in out, out
    assert "b = pnl.TransferMechanism" in out, out
    assert "tiny_model = pnl.Composition(name='tiny_model')" in out, out
    # Suffixed forms should be gone from var declarations.
    assert "a_1 = pnl.TransferMechanism" not in out, out
    assert "tiny_model_1 = pnl.Composition" not in out, out


def test_convert_synthesizes_inline_projections(tmp_path):
    """Projections constructed inline inside ``add_projection(...)`` — the
    style ``generate_script_from_mdf`` emits — get synthesized module-scope
    ``proj_<sender>_<receiver>`` variables instead of being silently
    dropped (#101)."""
    src = (
        "import psyneulink as pnl\n"
        "tiny = pnl.Composition(name='tiny')\n"
        "a = pnl.TransferMechanism(name='a', function=pnl.Linear())\n"
        "b = pnl.TransferMechanism(name='b', function=pnl.Linear())\n"
        "tiny.add_node(a)\n"
        "tiny.add_node(b)\n"
        "tiny.add_projection(\n"
        "    projection=pnl.MappingProjection(\n"
        "        name='MappingProjection_from_a_RESULT__to_b_InputPort_0_'),\n"
        "    sender=a, receiver=b)\n"
    )
    target = tmp_path / "inline_proj_model.py"
    target.write_text(src)

    out = convert_to_standard_format(str(target), backup=False)
    assert "proj_a_b = pnl.MappingProjection(" in out, out
    assert "tiny.add_projection(proj_a_b)" in out, out

    # Converted file must reload with the same projection topology.
    result = load_and_introspect(str(target), use_sandbox=False)
    comp = result["compositions"][0]
    pairs = {
        (clean_name(p["sender"]["mechanism"]), clean_name(p["receiver"]["mechanism"]))
        for p in comp["projections"]
    }
    assert ("a", "b") in pairs, comp["projections"]
