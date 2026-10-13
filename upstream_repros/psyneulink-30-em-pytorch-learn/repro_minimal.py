"""Minimal, EM-free reproduction of PsyNeuLink#30.

The crash (``'list' object has no attribute 'owner'`` at
``pytorchwrappers.py:2163``) is usually seen through ``EMComposition`` (the EGO
models), but EM is not the cause. The real trigger is more general:

    a nested composition + an outer ``LossMechanism`` whose SAMPLE input port
    has more than one afferent, trained in PyTorch execution mode.

When the loss node's SAMPLE port receives from >1 sender, ``loss_mech.sample``
returns a **list** of source mechanisms. ``pytorchwrappers.py:2163`` then does
``loss_mech.sample.owner`` — assuming a single Port — and raises.

This script builds exactly that condition with plain ``ProcessingMechanism``s and
no ``EMComposition``, so the failure is isolated to the general case. Run it with
nothing but ``psyneulink`` (+ ``torch``) installed:

    python repro_minimal.py

Exit code: 0 if the bug is present (expected today) or FIXED, 2 on an unexpected
error — see the printed banner.
"""

import sys
import traceback

import psyneulink as pnl

SIZE = 2

SIGNATURE = "loss_mech.sample.owner"
FRAME = 'pytorchwrappers.py", line 2163'


def build():
    """A nested AutodiffComposition whose loss SAMPLE has two afferents."""
    inp = pnl.ProcessingMechanism(name="INPUT", input_shapes=SIZE)
    hidden = pnl.ProcessingMechanism(name="HIDDEN", input_shapes=SIZE)
    nested = pnl.AutodiffComposition(name="NESTED")
    nested.add_node(hidden)
    prediction = pnl.ProcessingMechanism(name="PREDICTION", input_shapes=SIZE)

    outer = pnl.AutodiffComposition(name="OUTER")
    outer.add_linear_processing_pathway([inp, nested, prediction])

    # Infer the backprop pathway: this mints the LossMechanism with
    # SAMPLE <- PREDICTION.
    learning_components = outer.infer_backpropagation_learning_pathways(
        pnl.ExecutionMode.PyTorch
    )

    # Add a SECOND afferent into the loss's SAMPLE port (mirrors what the EGO
    # models do). Now loss_mech.sample == [PREDICTION, INPUT] — a list.
    outer.add_projection(
        pnl.MappingProjection(
            sender=inp, receiver=learning_components[0], learnable=False
        )
    )
    return outer, inp


def main():
    outer, inp = build()
    try:
        outer.learn(
            inputs={inp: [[1.0, 0.0]]},
            execution_mode=pnl.ExecutionMode.PyTorch,
            minibatch_size=1,
        )
    except AttributeError as exc:
        tb = traceback.format_exc()
        if SIGNATURE in tb and FRAME in tb:
            print("BUG PRESENT (PsyNeuLink#30): "
                  f"{type(exc).__name__}: {exc}")
            print(f"  at pytorchwrappers.py:2163 — {SIGNATURE}")
            return 0
        print("UNEXPECTED AttributeError — not the #30 signature:\n" + tb)
        return 2
    except Exception:  # noqa: BLE001 - report anything else verbatim
        print("UNEXPECTED error (not #30):\n" + traceback.format_exc())
        return 2
    print("FIXED: learn() completed without the #30 crash.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
