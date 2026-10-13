"""Which scheduler Conditions survive an MDF round-trip (#85) — measured.

Each case puts one Condition on a three-node chain, exports MDF, regenerates
the script, runs both for three trials and compares the order nodes ran in.
The test then checks the export warning agrees with what happened: the
conditions it flags are exactly the ones that break. If an upstream fix
(jonhanke-nam/PsyNeuLink#6) makes one survive, its case fails here — the
signal to drop it from MDF_UNSAFE_CONDITIONS.

Measured 2026-10-12 (PsyNeuLink 0.20, modeci_mdf 0.4.13), beyond the cases
below: every pass, trial and call-count condition, Always/Never, All/Any/Not,
JustRan, AllHaveRun, WhenFinished, AtTrialStart, TimeInterval and
termination conditions survive; Condition/While/WhileNot/When with a Python
function, WhenFinishedAny/All, a Threshold on a Port, and a Threshold on the
value of a node whose name isn't a plain identifier (a space, a "-1" suffix) break.
"""
import re
import signal
from types import SimpleNamespace

import pytest

pytest.importorskip("modeci_mdf")

import psyneulink as pnl
from psyneulink.core.globals.mdf import get_mdf_serialized

from app.services.sandbox_worker import find_mdf_gaps


def _canon(name):
    return re.sub(r"([-_]\d+)+$", "", name)


def _chain(first="a"):
    a = pnl.TransferMechanism(name=first)
    b = pnl.TransferMechanism(name="b")
    d = pnl.TransferMechanism(name="d")
    comp = pnl.Composition(name="chain")
    comp.add_linear_processing_pathway([a, b, d])
    # Bounded trials, so a condition that never lets a node run can't loop.
    comp.scheduler.termination_conds = {pnl.TimeScale.TRIAL: pnl.AfterNPasses(4)}
    return comp, a, b, d


def _order(comp):
    """The order nodes ran in over three trials, by canonical name."""
    def _stop(*_):
        raise TimeoutError("trial never ended")

    old = signal.signal(signal.SIGALRM, _stop)
    signal.alarm(10)
    try:
        comp.run(inputs={n: [[1.0]] for n in comp.get_nodes_by_role(pnl.NodeRole.INPUT)}, num_trials=3)
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old)
    steps = comp.scheduler.execution_list[comp.default_execution_id]
    return [tuple(sorted(_canon(n.name) for n in step)) for step in steps]


def _round_trip(comp, tmp_path):
    """The regenerated Composition, or the exception that stopped it."""
    path = tmp_path / "m.json"
    path.write_text(get_mdf_serialized(comp, fmt="json"))
    try:
        ns = {}
        exec(compile(pnl.generate_script_from_mdf(str(path)), "regenerated", "exec"), ns)
    except Exception as e:  # noqa: BLE001 — any failure is the measurement
        return e
    return next(v for v in ns.values() if isinstance(v, pnl.Composition))


CASES = {
    "AtPass": lambda a, b, d: (b, pnl.AtPass(1)),
    "EveryNCalls": lambda a, b, d: (b, pnl.EveryNCalls(a, 2)),
    "All(AtPass, EveryNCalls)": lambda a, b, d: (b, pnl.All(pnl.AtPass(1), pnl.EveryNCalls(a, 1))),
    "WhenFinished": lambda a, b, d: (b, pnl.WhenFinished(a)),
    "AfterNTrials": lambda a, b, d: (b, pnl.AfterNTrials(1)),
    "Threshold on variable": lambda a, b, d: (b, pnl.Threshold(a, "variable", 0.5, ">=")),
    "While(function)": lambda a, b, d: (b, pnl.While(lambda: True)),
    "WhenFinishedAny": lambda a, b, d: (d, pnl.WhenFinishedAny(a, b)),
    "Threshold on value": lambda a, b, d: (b, pnl.Threshold(a, "value", 0.5, ">=")),
    "Threshold on value, name with a space": lambda a, b, d: (b, pnl.Threshold(a, "value", 0.5, ">=")),
    "Threshold on an OutputPort": lambda a, b, d: (b, pnl.Threshold(a.output_port, "value", 0.5, ">=")),
}

# MDF turns a name that isn't a Python identifier into one ("my input" ->
# "my_input"), but not inside a Threshold's reference to that node's value.
FIRST_NODE = {"Threshold on value, name with a space": "my input"}


@pytest.mark.parametrize("case", list(CASES))
def test_the_warning_matches_what_the_round_trip_does(case, tmp_path):
    comp, a, b, d = _chain(FIRST_NODE.get(case, "a"))
    node, cond = CASES[case](a, b, d)
    comp.scheduler.add_condition(node, cond)
    flagged = any(g["issue"] == 85 for g in find_mdf_gaps(SimpleNamespace(chain=comp), comp))

    before = _order(comp)
    regenerated = _round_trip(comp, tmp_path)
    survived = not isinstance(regenerated, Exception) and _order(regenerated) == before

    assert flagged == (not survived), (
        f"{case}: round-trip {'survived' if survived else f'broke ({regenerated!r})'}, "
        f"but the export warning {'flags' if flagged else 'does not flag'} it"
    )
