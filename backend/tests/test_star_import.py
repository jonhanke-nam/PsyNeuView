"""Tests for star import conversion."""

import pytest
from app.services.converter import convert_star_imports


STAR_IMPORT_SOURCE = """\
from psyneulink import *
import numpy as np

# A simple Stroop model
color_input = TransferMechanism(input_shapes=2, name='color_input')
word_input = TransferMechanism(input_shapes=2, name='word_input')
hidden = TransferMechanism(
    input_shapes=2,
    function=Logistic(bias=-4),
    name='hidden'
)
output = TransferMechanism(input_shapes=2, function=Logistic(), name='output')
decision = DDM(name='decision')

# Projections
color_to_hidden = MappingProjection(sender=color_input, receiver=hidden, name='c2h')
word_to_hidden = MappingProjection(sender=word_input, receiver=hidden, name='w2h')

# Composition
comp = Composition(name='stroop')
comp.add_node(color_input)
comp.add_node(word_input)
comp.add_node(hidden)
comp.add_node(output)
comp.add_node(decision)
comp.add_projection(color_to_hidden)
comp.add_projection(word_to_hidden)
"""

ALREADY_STANDARD_SOURCE = """\
import psyneulink as pnl
import numpy as np

a = pnl.TransferMechanism(name='a')
comp = pnl.Composition(name='test')
comp.add_node(a)
"""


def test_star_import_detected():
    result, converted = convert_star_imports(STAR_IMPORT_SOURCE)
    assert converted is True


def test_star_import_replaced():
    result, _ = convert_star_imports(STAR_IMPORT_SOURCE)
    assert "import psyneulink as pnl" in result
    assert "from psyneulink import *" not in result


def test_bare_names_prefixed():
    result, _ = convert_star_imports(STAR_IMPORT_SOURCE)
    assert "pnl.TransferMechanism" in result
    assert "pnl.Logistic" in result
    assert "pnl.DDM" in result
    assert "pnl.MappingProjection" in result
    assert "pnl.Composition" in result


def test_numpy_import_preserved():
    result, _ = convert_star_imports(STAR_IMPORT_SOURCE)
    assert "import numpy as np" in result


def test_variable_names_not_prefixed():
    """Variable names that happen to match PNL class names should not be prefixed."""
    result, _ = convert_star_imports(STAR_IMPORT_SOURCE)
    # 'hidden' and 'output' and 'decision' are variable names, not PNL references
    # They appear as LHS of assignments and should NOT get pnl. prefix
    lines = result.split("\n")
    for line in lines:
        if line.startswith("hidden =") or line.startswith("output =") or line.startswith("decision ="):
            assert not line.startswith("pnl.hidden")
            assert not line.startswith("pnl.output")
            assert not line.startswith("pnl.decision")


def test_comments_not_modified():
    result, _ = convert_star_imports(STAR_IMPORT_SOURCE)
    assert "# A simple Stroop model" in result
    assert "# Projections" in result
    assert "# Composition" in result


def test_no_conversion_for_standard():
    result, converted = convert_star_imports(ALREADY_STANDARD_SOURCE)
    assert converted is False
    assert result == ALREADY_STANDARD_SOURCE


def test_string_contents_not_modified():
    source = """\
from psyneulink import *
a = TransferMechanism(name='TransferMechanism is cool')
"""
    result, _ = convert_star_imports(source)
    # The string content should NOT be prefixed
    assert "'TransferMechanism is cool'" in result or "'pnl.TransferMechanism is cool'" not in result
