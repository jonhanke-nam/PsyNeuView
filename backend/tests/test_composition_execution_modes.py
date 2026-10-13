"""Per-composition execution-mode capability matrix (#763).

`test_execution_modes.py` covers install-level availability ("is torch
importable"). This covers the other axis: what a *specific* composition can
structurally do, and the conjunction the UI actually gates on.

The distinction that matters: `available` and `supported` are different
failures. PyTorch on a plain Composition is installed and working — it just has
no PyTorch representation to execute. Reporting that as "unavailable" would
send someone off to install torch they already have.
"""

import pytest

from app.services.execution_modes import (
    composition_execution_modes,
    get_execution_modes,
)

AUTODIFF = dict(is_autodiff=True, has_learning=True)
LEARNING_COMP = dict(is_autodiff=False, has_learning=True)
PLAIN_COMP = dict(is_autodiff=False, has_learning=False)


def _by_id(**kwargs):
    return {m["id"]: m for m in composition_execution_modes(**kwargs)}


def test_covers_the_same_backends_as_the_install_list():
    """A composition can't be judged against a backend the install list omits."""
    assert set(_by_id(**AUTODIFF)) == {m["id"] for m in get_execution_modes()}


def test_autodiff_supports_every_backend_for_a_forward_run():
    modes = _by_id(**AUTODIFF)
    for mode_id in ("Python", "PyTorch", "LLVM"):
        assert modes[mode_id]["supported"], f"{mode_id} should be structurally valid"


def test_plain_composition_cannot_use_pytorch():
    """The case the install-level list got wrong: a Composition has no PyTorch
    representation to execute, however installed torch is."""
    for kwargs in (LEARNING_COMP, PLAIN_COMP):
        modes = _by_id(**kwargs)
        assert modes["PyTorch"]["supported"] is False
        assert modes["PyTorch"]["runnable"] is False
        assert modes["Python"]["supported"] is True
        assert modes["LLVM"]["supported"] is True


def test_unsupported_is_reported_differently_from_unavailable():
    """Both disable the option, but for opposite reasons — don't conflate them."""
    pytorch = _by_id(**PLAIN_COMP)["PyTorch"]
    if not pytorch["available"]:
        pytest.skip("torch not installed — can't distinguish the two failures here")
    assert pytorch["available"] is True
    assert pytorch["supported"] is False
    assert pytorch["reason"] and "Composition" in pytorch["reason"]


def test_only_pytorch_trains_an_autodiff_composition():
    modes = _by_id(**AUTODIFF)
    learnable = {k for k, v in modes.items() if v["learnable"]}
    assert learnable <= {"PyTorch"}
    for mode_id in ("Python", "LLVM"):
        assert modes[mode_id]["learnable"] is False
        assert modes[mode_id]["reason"], f"{mode_id} disabled for training with no reason"


def test_plain_composition_trains_under_python_only_with_learning_pathways():
    """This is the whole reason the matrix needs the composition, not just its type."""
    with_learning = _by_id(**LEARNING_COMP)
    without = _by_id(**PLAIN_COMP)

    assert with_learning["Python"]["learnable"] is True
    assert without["Python"]["learnable"] is False
    assert "no learning pathways" in (without["Python"]["reason"] or "")


def test_llvm_never_drives_learning():
    for kwargs in (AUTODIFF, LEARNING_COMP, PLAIN_COMP):
        assert _by_id(**kwargs)["LLVM"]["learnable"] is False


def test_runnable_and_learnable_are_conjunctions():
    """The UI gates on these, so they must never contradict their parts."""
    for kwargs in (AUTODIFF, LEARNING_COMP, PLAIN_COMP):
        for mode in composition_execution_modes(**kwargs):
            assert mode["runnable"] == (mode["supported"] and mode["available"])
            if mode["learnable"]:
                assert mode["supported"] and mode["available"]


def test_every_disabled_mode_explains_itself():
    """A disabled option with no tooltip is the affordance problem from #984."""
    for kwargs in (AUTODIFF, LEARNING_COMP, PLAIN_COMP):
        for mode in composition_execution_modes(**kwargs):
            if not mode["runnable"] or not mode["learnable"]:
                assert mode["reason"], f"{mode['id']} disabled with no reason ({kwargs})"
