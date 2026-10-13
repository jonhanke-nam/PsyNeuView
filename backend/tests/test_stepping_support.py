"""Stepping support per execution mode (#767).

The levels here are measured behaviour, not policy — see
docs/execution-modes-and-stepping.md for the numbers. These tests exist so the
descriptions can't drift from what the run path actually produces.
"""

from app.services.execution_modes import stepping_support


def test_python_on_a_plain_composition_is_full():
    s = stepping_support(effective_mode="Python", is_autodiff=False)
    assert s["level"] == "full"
    assert s["reason"] is None, "nothing to explain when stepping is complete"


def test_llvm_is_degraded_and_says_what_to_do():
    """Measured: 325 snapshots but 0 trace steps and 0 node logs."""
    s = stepping_support(effective_mode="LLVM", is_autodiff=False)
    assert s["level"] == "degraded"
    assert s["reason"] and "Python" in s["reason"], "should name the mode that does work"


def test_autodiff_is_synthesized_whatever_mode_was_asked_for():
    """The torch path is forced for autodiff, so the request can't change this."""
    for mode in ("Python", "PyTorch", "LLVM"):
        s = stepping_support(effective_mode=mode, is_autodiff=True)
        assert s["level"] == "synthesized"
        assert s["reason"]


def test_synthesized_is_not_described_as_a_recording():
    """The distinction is the whole point: a reconstruction can only report
    what the torch wrappers expose."""
    s = stepping_support(effective_mode="PyTorch", is_autodiff=True)
    assert "reconstruct" in s["reason"].lower()


def test_every_non_full_level_explains_itself():
    for mode in ("Python", "PyTorch", "LLVM"):
        for autodiff in (True, False):
            s = stepping_support(effective_mode=mode, is_autodiff=autodiff)
            if s["level"] != "full":
                assert s["reason"], f"{mode}/autodiff={autodiff} degraded with no reason"


def test_levels_are_from_the_known_set():
    for mode in ("Python", "PyTorch", "LLVM"):
        for autodiff in (True, False):
            assert stepping_support(effective_mode=mode, is_autodiff=autodiff)["level"] in (
                "full",
                "synthesized",
                "degraded",
            )
