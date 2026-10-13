"""Phase 2A wire-up test (#303): ``task_run`` returns debugger snapshots.

Runs a 2-trial 1-mechanism composition through the in-process ``task_run``
and asserts the new ``debuggerSnapshots`` field is populated with the
expected categories. Sanity-checks listener teardown by running twice.
"""

import pytest


pnl = pytest.importorskip("psyneulink")
_debugger = pytest.importorskip("psyneulink._debugger")


def _write_tiny_model(tmp_path):
    """Write a minimal model file with a 1-mechanism composition named ``comp``."""
    model_path = tmp_path / "tiny_model.py"
    model_path.write_text(
        "import psyneulink as pnl\n"
        "mech = pnl.TransferMechanism(name='mech')\n"
        "comp = pnl.Composition(name='comp')\n"
        "comp.add_node(mech)\n"
    )
    return str(model_path)


def test_task_run_returns_debugger_snapshots(tmp_path):
    from app.services.sandbox_worker import task_run

    model_path = _write_tiny_model(tmp_path)
    result = task_run({
        "file_path": model_path,
        "composition_name": "comp",
        "inputs": {"mech": [[1.0], [2.0]]},
    })

    assert "debuggerSnapshots" in result, \
        f"task_run should return debuggerSnapshots, got keys={list(result)}"
    snaps = result["debuggerSnapshots"]
    assert isinstance(snaps, list) and snaps, "snapshots list should be non-empty"

    cats = [s["category"] for s in snaps]
    # The four categories we subscribe to should each fire at least once.
    for required in ("BEGINNING_OF_TRIAL", "EXECUTION_SET", "NODE_EXECUTION", "END_OF_TRIAL"):
        assert required in cats, f"expected {required} in {set(cats)}"

    # BEGINNING_OF_TRIAL should fire once per trial with monotonically increasing trial_num.
    trial_starts = [s["trial_num"] for s in snaps if s["category"] == "BEGINNING_OF_TRIAL"]
    assert trial_starts == [0, 1], f"expected trial starts [0, 1], got {trial_starts}"

    # NODE_EXECUTION carries the threaded trial_num + a serialized output.
    node_execs = [s for s in snaps if s["category"] == "NODE_EXECUTION"]
    assert node_execs, "at least one NODE_EXECUTION snapshot expected"
    assert all(s["trial_num"] in (0, 1) for s in node_execs)
    assert all(s["node"] == "mech" for s in node_execs)
    # Linear default function: output equals input.
    assert any(s["output"] == [[1.0]] for s in node_execs)
    assert any(s["output"] == [[2.0]] for s in node_execs)

    # END_OF_TRIAL: one per trial. ``outputs`` may be an ndarray-shaped list
    # (current PsyNeuLink) or a ``{node: value}`` dict (future builds).
    trial_ends = [s for s in snaps if s["category"] == "END_OF_TRIAL"]
    assert [s["trial_num"] for s in trial_ends] == [0, 1]
    for s in trial_ends:
        assert s["outputs"] is not None


def test_run_returns_execution_trial_boundaries(tmp_path):
    """#293: response must include step indices where each trial starts."""
    from app.services.sandbox_worker import task_run

    model_path = _write_tiny_model(tmp_path)
    result = task_run({
        "file_path": model_path,
        "composition_name": "comp",
        "inputs": {"mech": [[1.0], [2.0], [3.0]]},
    })

    boundaries = result.get("executionTrialBoundaries")
    assert boundaries is not None, "executionTrialBoundaries missing from response"
    # 3 trials × 1 execution set per trial → boundaries at steps 0, 1, 2.
    assert boundaries == [0, 1, 2], (
        f"expected [0,1,2] for 3-trial single-step comp, got {boundaries}"
    )
    # Each boundary must be a valid index into executionTrace (or equal to len
    # for the trailing edge — but here all boundaries are starts, so they're
    # strict indices).
    trace_len = len(result["executionTrace"])
    assert all(0 <= b < trace_len for b in boundaries), (
        f"boundaries {boundaries} not all valid indices into executionTrace[{trace_len}]"
    )


def test_run_results_unchanged_when_snapshots_captured(tmp_path):
    """Listener attachment must not perturb composition outputs."""
    from app.services.sandbox_worker import task_run

    model_path = _write_tiny_model(tmp_path)
    payload = {
        "file_path": model_path,
        "composition_name": "comp",
        "inputs": {"mech": [[1.0], [2.0], [3.0]]},
    }
    result = task_run(payload)

    assert [r["output"] for r in result["results"]] == [[[1.0]], [[2.0]], [[3.0]]]


def test_listener_cleared_between_runs(tmp_path):
    """Second run must start with a clean listener (no leak from first run)."""
    from app.services.sandbox_worker import task_run

    model_path = _write_tiny_model(tmp_path)
    task_run({
        "file_path": model_path,
        "composition_name": "comp",
        "inputs": {"mech": [[1.0]]},
    })
    assert _debugger.get_listener() is None, \
        "task_run must clear the listener it registered"

    # Second run still produces snapshots — listener gets re-registered.
    result = task_run({
        "file_path": model_path,
        "composition_name": "comp",
        "inputs": {"mech": [[1.0]]},
    })
    assert result["debuggerSnapshots"], "second run should still capture snapshots"
    assert _debugger.get_listener() is None
