"""Rendering the concrete PsyNeuLink call (#766).

The whole value of this string is that it matches what actually ran. A call
display that says one thing while the code does another is worse than showing
nothing, so these tests care about fidelity: real ExecutionMode members, the
same kwargs the runner uses, and no silent dropping of arguments that change
behaviour.
"""

import psyneulink as pnl

from app.services.executor import format_pnl_call


def test_renders_a_plain_run():
    call = format_pnl_call(
        "run", "my_network", {"inputs": {"a": [[1, 0]], "b": [[0, 1]]}, "execution_mode": pnl.ExecutionMode.Python}
    )
    assert call.startswith("my_network.run(")
    assert "execution_mode=ExecutionMode.Python" in call


def test_execution_mode_renders_as_the_real_member_not_our_capability_id():
    """LLVM is our id; LLVMRun is the member PsyNeuLink actually receives.

    Showing the id would misrepresent the call — someone reading it and typing
    `ExecutionMode.LLVM` into a REPL would get an AttributeError.
    """
    mode = getattr(pnl.ExecutionMode, "LLVMRun")
    call = format_pnl_call("run", "c", {"inputs": {}, "execution_mode": mode})
    assert "ExecutionMode.LLVMRun" in call
    assert "ExecutionMode.LLVM," not in call


def test_bulk_inputs_are_summarized_not_dumped():
    """A real model's inputs are thousands of floats; the shape is the point."""
    inputs = {f"node{i}": [[0.0] * 50 for _ in range(20)] for i in range(8)}
    call = format_pnl_call("run", "c", {"inputs": inputs, "execution_mode": pnl.ExecutionMode.Python})
    assert "8 node(s) x 20 trial(s)" in call
    assert "0.0" not in call, "input payload leaked into the call string"
    assert len(call) < 200


def test_learn_shows_the_arguments_that_change_behaviour():
    call = format_pnl_call(
        "learn",
        "autodiff_comp",
        {
            "inputs": {"inputs": {"a": [[1, 0]]}, "targets": {"b": [[0, 1]]}, "epochs": 5},
            "execution_mode": pnl.ExecutionMode.PyTorch,
            "minibatch_size": 1,
            "learning_rate": 0.05,
        },
    )
    assert call.startswith("autodiff_comp.learn(")
    for expected in ("'epochs': 5", "minibatch_size=1", "learning_rate=0.05", "ExecutionMode.PyTorch"):
        assert expected in call, f"missing {expected!r} in {call}"


def test_omitted_optional_arguments_are_not_invented():
    """learning_rate=None means PsyNeuLink's default — don't claim we passed one."""
    call = format_pnl_call(
        "learn",
        "c",
        {
            "inputs": {"inputs": {}, "targets": {}, "epochs": 1},
            "execution_mode": pnl.ExecutionMode.PyTorch,
            "learning_rate": None,
        },
    )
    assert "learning_rate" not in call


def test_float_arguments_do_not_render_as_binary_noise():
    """0.1 reprs cleanly, but a computed rate can arrive as 0.30000000000000004."""
    call = format_pnl_call("learn", "c", {"inputs": {}, "learning_rate": 0.1 + 0.2})
    assert "0.30000000000000004" not in call
    assert "learning_rate=0.3" in call
