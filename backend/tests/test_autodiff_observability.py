"""Autodiff (PyTorch) runs synthesize the scheduler path's observability
contract so the stepper / Run State / value pills / snapshot table light up
(#629).

AutodiffComposition executes as a compiled PyTorch module, bypassing the
scheduler, so node.log and the _debugger hook capture nothing. The run path
instruments the PyTorch wrappers instead and reconstructs executionTrace /
executionTrialBoundaries / debuggerSnapshots / logs. These tests assert the
reconstructed contract matches what the frontend consumes.
"""

from pathlib import Path

import pytest

pytest.importorskip("psyneulink")
pytest.importorskip("torch")

from app.services.executor import run_model

FEEDFORWARD = str(Path(__file__).parent.parent / "demos" / "autodiff_feedforward.py")
EGO = str(Path(__file__).parent.parent / "reference_models" / "Giallanza2024_ego_study2.py")


def _run_feedforward():
    return run_model(
        FEEDFORWARD,
        "autodiff_comp",
        {"input_layer": [[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]]},
        use_sandbox=False,
    )


def test_autodiff_run_synthesizes_full_contract():
    r = _run_feedforward()
    assert "error" not in r, r
    assert r["numTrials"] == 3

    trace = r["executionTrace"]
    assert trace, "executionTrace must be non-empty so the stepper appears"
    assert all(isinstance(step, list) and step for step in trace)
    assert all(isinstance(n, str) for step in trace for n in step)

    # Three trials, 4 steps each on PsyNeuLink 0.19:
    # [input, TARGET] -> hidden -> output -> LOSS (0.19 includes the LOSS node in
    # the autodiff execution sets, so it appears as a trace step; #840).
    assert len(trace) == 12
    assert any("LOSS" in n for step in trace for n in step), trace
    boundaries = r["executionTrialBoundaries"]
    assert boundaries == [0, 4, 8]
    # >1 boundary is what enables the per-trial nav buttons in the frontend.
    assert len(boundaries) > 1
    assert boundaries == sorted(boundaries)
    assert all(0 <= b < len(trace) for b in boundaries)


def test_execution_set_snapshots_align_with_trace():
    # buildStepNodeValues() in the frontend increments its step counter on each
    # EXECUTION_SET snapshot, so their count MUST equal executionTrace length or
    # per-node values land on the wrong step.
    r = _run_feedforward()
    snaps = r["debuggerSnapshots"]
    exec_sets = [s for s in snaps if s["category"] == "EXECUTION_SET"]
    assert len(exec_sets) == len(r["executionTrace"])


def test_node_execution_snapshots_carry_values():
    # Every NODE_EXECUTION carries a value — including the LOSS node, whose value is
    # its per-trial loss (from comp.torch_losses), since it has no captured
    # forward-activation output (#840).
    r = _run_feedforward()
    node_exec = [s for s in r["debuggerSnapshots"] if s["category"] == "NODE_EXECUTION"]
    assert node_exec, "need NODE_EXECUTION snapshots for value pills / Run State"
    for s in node_exec:
        assert s["node"], s
        assert s["output"] is not None, s
        assert isinstance(s["trial_num"], int) and 0 <= s["trial_num"] < r["numTrials"]


def test_logs_populated_per_trial():
    r = _run_feedforward()
    logs = r["logs"]
    assert "output_layer" in logs, logs.keys()
    entry = logs["output_layer"]
    assert entry["trials"] == [0, 1, 2]
    assert len(entry["values"]) == 3


def test_logs_consistent_with_node_execution_snapshots():
    # The per-trial card value (logs) and the stepper value (NODE_EXECUTION) for
    # the same node+trial come from the same capture, so they must agree.
    r = _run_feedforward()
    logs = r["logs"]["output_layer"]["values"]
    for s in r["debuggerSnapshots"]:
        if s["category"] == "NODE_EXECUTION" and s["node"] == "output_layer":
            assert s["output"] == logs[s["trial_num"]]


def test_results_shape_unchanged():
    # The observability synthesis must not perturb the displayed outputs:
    # one result per trial, each with a trial index and output.
    r = _run_feedforward()
    assert len(r["results"]) == r["numTrials"]
    for i, res in enumerate(r["results"]):
        assert res["trial"] == i
        assert res["output"] is not None


def test_ego_run_expands_nested_em_internals():
    """The motivating case: EGO's nested EMComposition is expanded into the
    flattened feedforward trace. On 0.19 the retrieval field nodes are named
    ``<field> [RETRIEVED]`` (the old bare ``RETRIEVE``/``STORE`` nodes went away
    in the EMComposition restructure, #805)."""
    states = [
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    ]
    r = run_model(EGO, "EGO_comp", {"state_input_layer": states}, use_sandbox=False)
    assert "error" not in r, r
    assert r["executionTrace"], "EGO autodiff run must produce a trace"
    flat = {n for step in r["executionTrace"] for n in step}
    # EM internals + the final prediction must both appear in the trace.
    assert "STATE [RETRIEVED]" in flat, sorted(flat)
    assert "PREDICTION" in flat, sorted(flat)
    assert "PREDICTION" in r["logs"]
    assert len(r["executionTrialBoundaries"]) == r["numTrials"]
