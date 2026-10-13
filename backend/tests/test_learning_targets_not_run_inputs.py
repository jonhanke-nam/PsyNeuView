"""A learning pathway's TARGET is not a Run input (#1383).

PsyNeuLink gives the TARGET mechanism that add_td_learning_pathway (and the
backpropagation and reinforcement pathways) generates the INPUT role, so an
input list taken from that role offered it as something to fill in. A run
does not learn and takes no targets: PsyNeuLink fills the TARGET with its
default. The learning profile names the generated nodes, the input-node
lists leave them out, and a run given only the real inputs succeeds.
"""

from pathlib import Path

import numpy as np
import pytest

from app.services.executor import _get_input_nodes_inprocess, run_model
from app.services.sandbox_worker import task_get_input_nodes, task_introspect

BACKEND = Path(__file__).parent.parent
TD_DEMO = BACKEND / "demos" / "td_learning.py"
MONTAGUE = BACKEND / "reference_models" / "MontagueDayanSejnowski96.py"

BACKPROP = """
import psyneulink as pnl
inp = pnl.TransferMechanism(name='inp', input_shapes=2)
hid = pnl.TransferMechanism(name='hid', input_shapes=3, function=pnl.Logistic)
out = pnl.TransferMechanism(name='out', input_shapes=1, function=pnl.Logistic)
bp = pnl.Composition(name='bp')
bp.add_backpropagation_learning_pathway([inp, hid, out], learning_rate=0.5)
"""

REINFORCEMENT = """
import psyneulink as pnl
stim = pnl.TransferMechanism(name='stim', input_shapes=3)
act = pnl.TransferMechanism(name='act', input_shapes=3)
rl = pnl.Composition(name='rl')
rl.add_reinforcement_learning_pathway([stim, act], learning_rate=0.1)
"""


def _model(tmp_path, name, source):
    path = tmp_path / f"{name}.py"
    path.write_text(source)
    return path


def _cases(tmp_path):
    return [
        (TD_DEMO, "td_learning", ["cue"]),
        (MONTAGUE, "comp", ["sample_mechanism"]),
        (_model(tmp_path, "bp_model", BACKPROP), "bp", ["inp"]),
        (_model(tmp_path, "rl_model", REINFORCEMENT), "rl", ["stim"]),
    ]


def test_the_td_profile_flags_its_generated_target():
    result = task_introspect({"file_path": str(TD_DEMO)})
    [comp] = result["compositions"]
    profile = comp["learningProfile"]
    assert "TARGET for value_estimate" in profile["generatedNodes"]
    assert profile["targetNodes"] == ["value_estimate"]
    # PsyNeuLink calls it an INPUT node: the reason the Run tab offered it.
    [target] = [n for n in comp["nodes"] if n["name"] == "TARGET for value_estimate"]
    assert "INPUT" in target["roles"] and "TARGET_INPUT" in target["roles"]


@pytest.mark.parametrize("getter", ["sandbox", "in_process"])
def test_input_node_lists_leave_out_generated_targets(tmp_path, getter):
    for path, comp, expected in _cases(tmp_path):
        if getter == "sandbox":
            info = task_get_input_nodes({"file_path": str(path), "composition_name": comp})
        else:
            info = _get_input_nodes_inprocess(str(path), comp)
        assert "error" not in info, (path.name, info)
        assert [n["varName"] for n in info["inputNodes"]] == expected, path.name


def test_a_td_run_without_targets_succeeds():
    cue_on = [1.0] * 10
    result = run_model(str(TD_DEMO), "td_learning", {"cue": [cue_on] * 3}, use_sandbox=False)
    assert not result.get("error"), result.get("error")
    assert result["numTrials"] == 3
    # Untrained (zero weights): the value estimate is just its 0.01 intercept.
    out = np.asarray(result["results"][0]["output"], dtype=float).ravel()
    assert np.allclose(out, 0.01)


def test_backprop_and_reinforcement_runs_without_targets_succeed(tmp_path):
    bp = _model(tmp_path, "bp_run", BACKPROP)
    rl = _model(tmp_path, "rl_run", REINFORCEMENT)
    for path, comp, inputs in [(bp, "bp", {"inp": [[1, 0], [0, 1]]}), (rl, "rl", {"stim": [[1, 0, 0]]})]:
        result = run_model(str(path), comp, inputs, use_sandbox=False)
        assert not result.get("error"), (path.name, result.get("error"))
        assert result["numTrials"] == len(next(iter(inputs.values())))
