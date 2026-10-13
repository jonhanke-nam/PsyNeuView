"""Execution-mode handling on the *learn* path (#765).

The override itself is legitimate — autodiff gradients run only under PyTorch
today, so a request for a non-learnable backend has to fall back. What was
broken is that the fallback was silent: both branches of the old resolver
returned PyTorch unconditionally, so a caller was never told its choice had
been discarded, and the Learn selector was decorative.

These tests pin the *reason*, not just the mode. A resolver that returns the
right mode with no explanation would pass a naive test and still be the bug.
"""

import psyneulink as pnl
import pytest

from app.services.execution_modes import DEFAULT_LEARN_MODE, get_execution_modes
from app.services.executor import _resolve_learn_execution_mode


def _resolve(requested):
    return _resolve_learn_execution_mode(pnl, requested)


@pytest.mark.parametrize("requested", [None, ""])
def test_omitted_mode_uses_the_default_without_complaint(requested):
    mode, effective, reason = _resolve(requested)
    assert effective == DEFAULT_LEARN_MODE
    assert reason is None
    assert mode is getattr(pnl.ExecutionMode, DEFAULT_LEARN_MODE)


def test_learnable_request_is_honored_silently():
    """Asking for a backend that can train gets it, with nothing to explain."""
    learnable = [m for m in get_execution_modes() if m["available"] and m["learnable"]]
    assert learnable, "no learnable backend — the learn path could not work at all"
    for info in learnable:
        mode, effective, reason = _resolve(info["id"])
        assert effective == info["id"]
        assert reason is None
        assert isinstance(mode, pnl.ExecutionMode)


def test_non_learnable_request_falls_back_and_explains():
    """The regression this issue is about: the override must not be silent."""
    non_learnable = [m for m in get_execution_modes() if m["available"] and not m["learnable"]]
    assert non_learnable, "expected Python (and usually LLVM) to be non-learnable"
    for info in non_learnable:
        mode, effective, reason = _resolve(info["id"])
        assert effective == DEFAULT_LEARN_MODE
        assert mode is getattr(pnl.ExecutionMode, DEFAULT_LEARN_MODE)
        assert reason, f"{info['id']} was overridden with no reason given"


def test_unknown_mode_falls_back_and_names_what_was_asked_for():
    mode, effective, reason = _resolve("Bogus")
    assert effective == DEFAULT_LEARN_MODE
    assert reason and "Bogus" in reason


def test_resolver_is_not_hardcoded_to_pytorch():
    """Guards the exact shape of the original bug.

    The old implementation was two identical `return PyTorch` branches, so it
    reported PyTorch even for inputs it had never examined. Derive the expected
    answers from the capability model instead: if a future PsyNeuLink trains
    under another backend, this test starts demanding it be honored rather than
    silently rewritten to PyTorch.
    """
    reasons = {info["id"]: _resolve(info["id"])[2] for info in get_execution_modes()}
    learnable_ids = {m["id"] for m in get_execution_modes() if m["available"] and m["learnable"]}
    for mode_id, reason in reasons.items():
        if mode_id in learnable_ids:
            assert reason is None, f"{mode_id} is learnable but was overridden: {reason}"
        else:
            assert reason is not None, f"{mode_id} is not learnable but no reason was given"


def test_single_resolver_implementation():
    """The worker used to carry its own copy that always returned PyTorch.

    Two implementations of one decision is how they drift; #765 is what that
    drift looked like. The worker now imports this one.
    """
    import app.services.sandbox_worker as worker

    assert not hasattr(worker, "_resolve_learn_execution_mode"), (
        "sandbox_worker defines its own learn-mode resolver again — it should "
        "import the one in executor.py"
    )
