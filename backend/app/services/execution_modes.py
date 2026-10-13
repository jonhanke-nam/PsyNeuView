"""Capability detection for PsyNeuLink execution backends (#537, Learn L4).

Promotes the internal Python/PyTorch/LLVM heuristic (#363) to a first-class,
user-selectable setting. This module answers one question: which
``ExecutionMode`` backends can the running install actually use, and which of
them can drive *training* (autodiff gradients) as opposed to just a forward
``.run()``? The frontend uses that to offer a backend selector with
unavailable / non-learnable options disabled and explained — extending the
#475 capability surface. Pure read: no mutation, no network, no model load.

Install-level, only PyTorch trains: it is the backend of an
``AutodiffComposition``, whose Python and LLVM modes execute the forward graph
but not the autograd backward pass. Which backend can train a *particular*
composition is per-structure (``composition_execution_modes``, #763): a plain
Composition with learning pathways trains under Python, through PsyNeuLink's
own LearningMechanisms (#997, ``pathway_learning.py``). We surface all three so
the choice is explicit and recorded, but mark the non-learnable ones so the UI
can't silently mislead.
"""

from typing import Optional, TypedDict

# What the learn path resolves to when the request omits a backend or asks for
# one that can't train. The worker enforces the same default (see
# sandbox_worker._resolve_learn_execution_mode).
DEFAULT_LEARN_MODE = "PyTorch"

# What the *run* (forward `.run()`) path resolves to when the request omits a
# backend (#764). Python is the plain interpreter path PsyNeuLink itself
# defaults to, so an omitted mode keeps today's behaviour exactly. Unlike
# learning, every available backend can drive a forward run — `available` is
# the only gate the Run selector applies, where Learn also requires
# `learnable`.
DEFAULT_RUN_MODE = "Python"


class ExecutionModeInfo(TypedDict):
    id: str  # "PyTorch" | "Python" | "LLVM" — matches pnl.ExecutionMode names
    label: str
    available: bool  # backend present in this install
    learnable: bool  # can drive autodiff training, not just a forward run
    reason: Optional[str]  # why unavailable or not learnable (UI tooltip)


def _torch_available() -> bool:
    try:
        import torch  # noqa: F401
    except Exception:
        return False
    return True


def _llvm_available() -> bool:
    try:
        from psyneulink.core import llvm as _pnlvm  # noqa: F401
    except Exception:
        return False
    return True


def get_execution_modes() -> list[ExecutionModeInfo]:
    """Probe the install and describe each backend's availability + learn role."""
    torch_ok = _torch_available()
    llvm_ok = _llvm_available()

    pytorch_reason = None if torch_ok else "PyTorch backend unavailable — torch is not installed."

    if not llvm_ok:
        llvm_reason = "LLVM backend unavailable in this PsyNeuLink build."
    else:
        llvm_reason = "LLVM runs the compiled forward graph; autodiff training runs under PyTorch."

    return [
        {
            "id": "PyTorch",
            "label": "PyTorch",
            "available": torch_ok,
            "learnable": torch_ok,
            "reason": pytorch_reason,
        },
        {
            "id": "Python",
            "label": "Python (graph)",
            "available": True,
            "learnable": False,
            "reason": "Python mode executes the forward graph; autodiff training runs under PyTorch.",
        },
        {
            "id": "LLVM",
            "label": "LLVM (compiled)",
            "available": llvm_ok,
            "learnable": False,
            "reason": llvm_reason,
        },
    ]


class CompositionExecutionModeInfo(TypedDict):
    """One backend, judged against a *specific* composition (#763).

    ``available`` is install-level (is torch importable?); ``supported`` is
    structural (can this kind of Composition use the backend at all?).
    ``runnable`` / ``learnable`` are the conjunctions the UI actually gates on,
    so a selector never has to re-derive the matrix.
    """

    id: str
    label: str
    available: bool
    supported: bool   # structurally valid for this composition
    runnable: bool    # supported AND available — can drive a forward .run()
    learnable: bool   # supported AND available — can drive training
    reason: Optional[str]


def composition_execution_modes(
    *, is_autodiff: bool, has_learning: bool
) -> list[CompositionExecutionModeInfo]:
    """Per-composition capability matrix, combined with install availability.

    Structural rules, kept here rather than spread across the run and learn
    paths so there is one place to correct when PsyNeuLink's support changes:

    * **Forward run** — an ``AutodiffComposition`` executes under Python,
      PyTorch or LLVM. A plain ``Composition`` has no PyTorch representation to
      execute, so PyTorch is structurally invalid for it.
    * **Training** — autodiff gradients run under PyTorch only. A plain
      ``Composition`` trains under Python *when it has learning pathways*
      (``learning_components``), via PsyNeuLink's own LearningMechanisms; LLVM
      does not drive learning either way.

    ``has_learning`` is ignored for autodiff compositions, which are learnable
    by construction.
    """
    install = {m["id"]: m for m in get_execution_modes()}
    out: list[CompositionExecutionModeInfo] = []

    for mode_id in ("PyTorch", "Python", "LLVM"):
        base = install[mode_id]
        available = base["available"]

        if is_autodiff:
            supported = True
            can_learn = mode_id == "PyTorch"
        else:
            supported = mode_id in ("Python", "LLVM")
            can_learn = mode_id == "Python" and has_learning

        reason = base["reason"] if not available else None
        if available and not supported:
            reason = (
                f"{base['label']} runs only an AutodiffComposition's compiled graph; "
                "this is a plain Composition."
            )
        elif available and supported and not can_learn:
            if is_autodiff:
                reason = f"{base['label']} executes the forward graph; autodiff training runs under PyTorch."
            elif mode_id == "Python" and not has_learning:
                reason = "This Composition has no learning pathways, so there is nothing to train."
            else:
                reason = f"{base['label']} does not drive learning."

        out.append(
            {
                "id": mode_id,
                "label": base["label"],
                "available": available,
                "supported": supported,
                "runnable": supported and available,
                "learnable": can_learn and available,
                "reason": reason,
            }
        )
    return out


class SteppingSupport(TypedDict):
    """What the debugger/trace can offer for a given (composition, mode) (#767).

    ``level`` is what the UI gates on:

    * ``full`` — the PsyNeuLink scheduler ran, so the ``_debugger`` hook fired
      for real: execution trace, per-node logs and snapshots all describe the
      actual execution.
    * ``synthesized`` — an AutodiffComposition ran through the torch wrappers,
      which bypass the scheduler. The observability contract is reconstructed
      (``_autodiff_observability``) so stepping works, but it is a reconstruction
      rather than a recording.
    * ``degraded`` — the run happened but the trace did not. Stepping is not
      meaningfully available.
    """

    level: str
    reason: Optional[str]


def stepping_support(*, effective_mode: str, is_autodiff: bool) -> SteppingSupport:
    """Describe stepping for the mode a run *actually* used (#767).

    Takes the effective mode, not the requested one — an AutodiffComposition
    runs under PyTorch whatever was asked for, and a plain Composition ignores
    a PyTorch request entirely (see #1001), so the request is not what decides
    the trace.

    The levels below are measured, not assumed. On a plain feedforward
    Composition: Python gives 213 snapshots / 3 trace steps / 3 node logs;
    LLVM gives 325 snapshots but **0** trace steps and **0** logs. On an
    AutodiffComposition the torch path yields a synthesized 11 / 4 / 5.
    """
    if is_autodiff:
        return {
            "level": "synthesized",
            "reason": (
                "This AutodiffComposition runs through the PyTorch wrappers, which bypass "
                "the scheduler. Stepping is reconstructed from the torch path rather than "
                "recorded from it."
            ),
        }
    if effective_mode == "LLVM":
        return {
            "level": "degraded",
            "reason": (
                "The compiled LLVM path does not drive the scheduler, so no execution "
                "trace or per-node values are captured. Run under Python to step."
            ),
        }
    return {"level": "full", "reason": None}
