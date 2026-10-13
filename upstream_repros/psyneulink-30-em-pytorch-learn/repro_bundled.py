"""Reproduction of PsyNeuLink#30 via a real EMComposition model.

This is the higher-fidelity companion to ``repro_minimal.py``: instead of a
synthetic two-node graph, it loads a full ``EMComposition``-based EGO model
(Giallanza et al. 2024, Study 2) and calls ``.learn()`` under PyTorch. The crash
is identical (``pytorchwrappers.py:2163``), but here it is reached through
``emcomposition/pytorchEMwrappers.py`` — the exact path the EGO reference model
and the upstream ``EGO CSW Model.py`` script hit.

The model file under ``models/`` is a verbatim copy of PsyNeuView's bundled
reference model and imports nothing from PsyNeuView — this folder is fully
self-contained. Run with only ``psyneulink`` (+ ``torch``) installed:

    python repro_bundled.py
"""

import importlib.util
import sys
import traceback
from pathlib import Path

import numpy as np
import psyneulink as pnl

MODEL = Path(__file__).parent / "models" / "Giallanza2024_ego_study2.py"
COMPOSITION = "EGO_comp"
INPUT_NODE = "STATE"
STATE_SIZE = 10

SIGNATURE = "loss_mech.sample.owner"
FRAME_2163 = 'pytorchwrappers.py", line 2163'


def _one_hot(i, n=STATE_SIZE):
    v = np.zeros(n)
    v[i] = 1.0
    return v


def _load_composition():
    spec = importlib.util.spec_from_file_location("ego_model", MODEL)
    module = importlib.util.module_from_spec(spec)
    sys.modules["ego_model"] = module
    spec.loader.exec_module(module)
    comp = getattr(module, COMPOSITION)
    state = next(n for n in comp.nodes if n.name == INPUT_NODE)
    return comp, state


def main():
    comp, state = _load_composition()
    try:
        comp.learn(
            inputs={state: [_one_hot(0), _one_hot(1), _one_hot(2)]},
            execution_mode=pnl.ExecutionMode.PyTorch,
            minibatch_size=1,
        )
    except AttributeError as exc:
        tb = traceback.format_exc()
        if SIGNATURE in tb and FRAME_2163 in tb:
            via_em = "pytorchEMwrappers" in tb
            print(f"BUG PRESENT (PsyNeuLink#30): {type(exc).__name__}: {exc}")
            print(f"  at pytorchwrappers.py:2163 — {SIGNATURE}"
                  f"{' (via pytorchEMwrappers)' if via_em else ''}")
            return 0
        print("UNEXPECTED AttributeError — not the #30 signature:\n" + tb)
        return 2
    except Exception:  # noqa: BLE001
        print("UNEXPECTED error (not #30):\n" + traceback.format_exc())
        return 2
    print("FIXED: EGO .learn() completed without the #30 crash.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
