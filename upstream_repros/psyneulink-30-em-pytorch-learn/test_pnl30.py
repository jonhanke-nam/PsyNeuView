"""Regression sentinels for PsyNeuLink#30 (EM / nested-composition PyTorch learn).

Pure PsyNeuLink — imports nothing from PsyNeuView, so this file can be run
standalone or dropped into PsyNeuLink's own ``tests/composition/``:

    pytest test_pnl30.py -q                 # this folder, standalone
    pytest test_pnl30.py -q -o addopts=""   # inside a PsyNeuLink checkout
                                            # (its pyproject requires extra plugins)

Expected today (bug present): ``2 passed, 2 xfailed``.

The xfail sentinels are ``strict=True``: the day upstream fixes #30, ``.learn()``
stops raising, the sentinels XPASS, and strict-xfail turns that XPASS into a
loud FAILURE — the signal to drop the xfails, un-block EGO, and close
PsyNeuView#578. ``test_minimal_error_signature`` fails the same day, pinning the
exact current error so a coincidental ``AttributeError`` can't masquerade as #30.
"""

import re

import pytest

import psyneulink as pnl

from repro_bundled import _load_composition, _one_hot
from repro_minimal import build as build_minimal

PNL30 = "EGO / nested-composition PyTorch .learn() blocked by PsyNeuLink#30"
SIGNATURE = re.escape("'list' object has no attribute 'owner'")


def _learn_minimal():
    outer, inp = build_minimal()
    outer.learn(
        inputs={inp: [[1.0, 0.0]]},
        execution_mode=pnl.ExecutionMode.PyTorch,
        minibatch_size=1,
    )
    return outer


def test_minimal_constructs_without_learning():
    """Construction is fine — the bug is specific to the PyTorch learn build."""
    outer, _inp = build_minimal()
    assert isinstance(outer, pnl.AutodiffComposition)


def test_minimal_error_signature():
    """Pin the exact current failure so only genuine #30 counts as #30.

    Green while the bug is present; fails the day it is fixed (a second,
    signature-level flip signal alongside the strict-xfail sentinels).
    """
    with pytest.raises(AttributeError, match=SIGNATURE):
        _learn_minimal()


@pytest.mark.xfail(strict=True, raises=AttributeError, reason=PNL30)
def test_minimal_pytorch_learn_completes():
    """Minimal, EM-free trigger: nested comp + loss SAMPLE with >1 afferent."""
    _learn_minimal()


@pytest.mark.xfail(strict=True, raises=AttributeError, reason=PNL30)
def test_bundled_ego_pytorch_learn_completes():
    """Real EMComposition path (Giallanza 2024 EGO) — same crash via EM wrappers."""
    comp, state = _load_composition()
    comp.learn(
        inputs={state: [_one_hot(0), _one_hot(1), _one_hot(2)]},
        execution_mode=pnl.ExecutionMode.PyTorch,
        minibatch_size=1,
    )
