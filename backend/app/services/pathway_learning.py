"""Training a plain Composition through its learning pathways (#997).

PsyNeuLink has two kinds of learning, and the Learn tab used to drive only one:

1. ``AutodiffComposition.learn(execution_mode=PyTorch)`` — torch autograd. Its
   per-epoch loss comes from ``comp.torch_losses``.
2. A plain ``Composition`` with learning pathways (``add_backpropagation_
   learning_pathway``, ``add_td_learning_pathway``, …) or learning mechanisms
   (``RecurrentTransferMechanism(enable_learning=True)``) — PsyNeuLink's own
   LearningMechanisms, under ``ExecutionMode.Python``. There is no
   ``torch_losses`` here, so this module decides what to report instead.

What each epoch reports (the ``metric``):

* **Prediction error** — a TD pathway (its objective is a
  ``PredictionErrorMechanism``): the mean squared TD error δ over a trial's
  timesteps, averaged over the epoch's trials.
* **Error at target** — any other target pathway (backprop, reinforcement):
  the mean squared error the ``ComparatorMechanism`` computes between output
  and target, averaged over the epoch's trials.
* **Weight change** — no target at all (Hebbian): there is no error, so no
  loss. We report how much the learned weights moved in the epoch, relative to
  their size: ``‖W_end − W_start‖_F / ‖W_end‖_F`` (Frobenius norms, over every
  learned matrix together). Pure Hebbian learning has no fixed point — the
  absolute change per epoch settles to a constant, it never reaches zero — so
  the relative figure is the one that says "the pattern has stopped changing
  shape". The absolute norms are returned alongside it.

Training runs one ``learn()`` call per epoch. That is what makes the epoch
boundaries visible at all (weights are read between calls), and it is what
lets the job layer stream an epoch at a time and cancel between them — the
same chunking the autodiff stream path already uses.
"""

from __future__ import annotations

import numpy as np

METRICS = {
    "loss": {
        "id": "loss",
        "label": "Loss",
        "unit": "training loss",
        "description": "The loss PyTorch minimises, averaged over the epoch's trials.",
    },
    "prediction_error": {
        "id": "prediction_error",
        "label": "Prediction error",
        "unit": "mean squared TD error per trial",
        "description": (
            "The temporal-difference prediction error at the PredictionErrorMechanism, "
            "squared and averaged over each trial's timesteps, then over the epoch's trials."
        ),
    },
    "target_error": {
        "id": "target_error",
        "label": "Error at target",
        "unit": "mean squared error per trial",
        "description": (
            "The difference between output and target at the ComparatorMechanism, "
            "squared and averaged, then over the epoch's trials."
        ),
    },
    "weight_change": {
        "id": "weight_change",
        "label": "Weight change",
        "unit": "‖ΔW‖ / ‖W‖ (Frobenius), per epoch",
        "description": (
            "This model learns without a target, so there is no loss. This is how much the "
            "learned weights changed over the epoch, relative to their size."
        ),
    },
}

_GENERATED_ROLES = ("LEARNING", "LEARNING_OBJECTIVE", "TARGET_INPUT")


def _roles(comp, node) -> set[str]:
    try:
        return {getattr(r, "name", str(r)).upper() for r in comp.get_roles_by_node(node)}
    except Exception:
        return set()


def _nodes_with_role(comp, role: str) -> list:
    import psyneulink as pnl

    member = getattr(pnl.NodeRole, role, None)
    if member is None:
        return []
    try:
        return list(comp.get_nodes_by_role(member))
    except Exception:
        return []


def _learning_mechanisms(comp) -> list:
    import psyneulink as pnl

    cls = getattr(pnl, "LearningMechanism", None)
    if cls is None:
        return []
    return [n for n in comp.nodes if isinstance(n, cls)]


def _learned_projections(comp) -> list:
    out = []
    for lm in _learning_mechanisms(comp):
        for proj in getattr(lm, "learned_projections", None) or []:
            if proj not in out:
                out.append(proj)
    return out


def constructed_learning_flag(mech) -> bool | None:
    """Whether ``mech`` was built to learn, for a mechanism whose own
    ``enable_learning`` Parameter does not say (#1385).

    ``RecurrentTransferMechanism`` (and the classes built on it, such as
    ``ContrastiveHebbianMechanism``) declares ``enable_learning = False`` in
    its Parameters and never sets it: the constructor keeps the argument in
    ``_learning_enabled`` and, when it is true, builds an
    ``AutoAssociativeLearningMechanism``. So ``parameters.enable_learning``
    reads ``False`` on a mechanism that learns. The learning mechanism that
    exists is the truth. Returns None for a mechanism without one to consult.
    """
    if not hasattr(mech, "learning_mechanism") or not hasattr(mech, "_learning_enabled"):
        return None
    try:
        return mech.learning_mechanism is not None or bool(mech._learning_enabled)
    except Exception:
        return None


def is_generated_learning_node(comp, node) -> bool:
    """True for a node a learning pathway generated (its TARGET, objective or
    learning mechanisms), which a person never supplies inputs for (#1383).

    PsyNeuLink gives a pathway's TARGET mechanism the INPUT role, so a list of
    input nodes taken from that role offers it as something to fill in.
    """
    import psyneulink as pnl

    if _roles(comp, node) & set(_GENERATED_ROLES):
        return True
    cls = getattr(pnl, "LearningMechanism", None)
    return cls is not None and isinstance(node, cls)


def learning_profile(comp, *, is_autodiff: bool) -> dict:
    """How (and whether) this composition learns, for the Learn tab (#997).

    ``kind`` is ``autodiff`` (PyTorch), ``pathway`` (PsyNeuLink's own
    LearningMechanisms, under Python) or ``none``. For ``pathway`` it also
    names the nodes that take targets (none for Hebbian), the generated
    learning nodes the input grid must leave out, and the metric each epoch
    will report.
    """
    if is_autodiff:
        return {
            "kind": "autodiff",
            "metric": METRICS["loss"],
            "targetNodes": None,  # autodiff: every OUTPUT node takes a target
            "generatedNodes": [],
            "reason": None,
        }

    lms = _learning_mechanisms(comp)
    try:
        has_learning = bool(getattr(comp, "learning_components", None)) or bool(lms)
    except Exception:
        has_learning = bool(lms)
    if not has_learning:
        return {
            "kind": "none",
            "metric": None,
            "targetNodes": [],
            "generatedNodes": [],
            "reason": (
                "This is a plain Composition with no learning pathways or learning mechanisms, "
                "so there is nothing to train. An AutodiffComposition trains under PyTorch; a "
                "Composition trains under Python once it has a learning pathway (for example "
                "add_backpropagation_learning_pathway or add_td_learning_pathway) or a "
                "mechanism with enable_learning=True."
            ),
        }

    import psyneulink as pnl

    objectives = _nodes_with_role(comp, "LEARNING_OBJECTIVE")
    pe_cls = getattr(pnl, "PredictionErrorMechanism", None)
    if objectives:
        all_td = pe_cls is not None and all(isinstance(o, pe_cls) for o in objectives)
        metric = METRICS["prediction_error" if all_td else "target_error"]
    else:
        metric = METRICS["weight_change"]

    # The trained output nodes carry PsyNeuLink's SAMPLE role; their targets
    # go in learn()'s "targets" dict, keyed by the node itself.
    target_nodes = [n.name for n in _nodes_with_role(comp, "SAMPLE")]
    if objectives and not target_nodes:
        target_nodes = [n.name for n in _nodes_with_role(comp, "TARGET_INPUT")]

    generated = [
        n.name for n in comp.nodes
        if _roles(comp, n) & set(_GENERATED_ROLES) or n in lms
    ]
    return {
        "kind": "pathway",
        "metric": metric,
        "targetNodes": target_nodes,
        "generatedNodes": generated,
        "reason": None,
    }


def _matrix(proj, comp):
    """A projection's current weights in ``comp``'s context, as floats.

    Before the first execution in a context PsyNeuLink has no value there yet
    (``get(comp)`` is None), so fall back to the projection's own default.
    """
    param = proj.parameters.matrix
    for getter in (lambda: param.get(comp), lambda: proj.defaults.matrix):
        try:
            value = getter()
        except Exception:
            continue
        if value is None:
            continue
        try:
            return np.array(value, dtype=float)
        except (TypeError, ValueError):
            continue
    return None


def _snapshot(projs, comp):
    return [_matrix(p, comp) for p in projs]


def _weight_change(before, after):
    """``(relative, absolute)`` Frobenius change across all learned matrices."""
    sq_delta = 0.0
    sq_after = 0.0
    seen = False
    for b, a in zip(before, after):
        if a is None:
            continue
        if b is None or b.shape != a.shape:
            b = np.zeros_like(a)
        sq_delta += float(np.sum(np.square(a - b)))
        sq_after += float(np.sum(np.square(a)))
        seen = True
    if not seen:
        return None, None
    absolute = float(np.sqrt(sq_delta))
    norm = float(np.sqrt(sq_after))
    if not (np.isfinite(absolute) and np.isfinite(norm)):
        return None, None
    relative = absolute / norm if norm > 0 else 0.0
    return relative, absolute


def _finite(x):
    return float(x) if x is not None and np.isfinite(x) else None


def train(
    comp,
    pnl_inputs: dict,
    pnl_targets: dict,
    *,
    epochs: int,
    learning_rate,
    exec_mode,
    profile: dict,
    on_epoch=None,
) -> dict:
    """Run ``epochs`` learn() calls and measure the profile's metric per epoch.

    ``on_epoch(epoch, value, extra)`` is called after each epoch — the job
    layer streams it. Returns ``epoch_values`` (one per epoch, None where the
    value wasn't finite), plus the absolute weight changes for Hebbian models
    and any warnings worth showing.
    """
    metric_id = profile["metric"]["id"]
    objectives = _nodes_with_role(comp, "LEARNING_OBJECTIVE")
    projs = _learned_projections(comp)

    trial_errors: list[float] = []

    def after_trial():
        per_obj = []
        for obj in objectives:
            try:
                value = obj.parameters.value.get(comp)
                arr = np.asarray(value, dtype=float)
            except Exception:
                continue
            # A Comparator's value is [OUTCOME, MSE]; the PE mechanism's is δ
            # over the timesteps. The first row is the error vector either way.
            err = arr[0] if arr.ndim > 1 else arr
            per_obj.append(float(np.mean(np.square(err))))
        if per_obj:
            trial_errors.append(float(np.mean(per_obj)))

    learn_kwargs = {"execution_mode": exec_mode}
    if objectives:
        learn_kwargs["call_after_trial"] = after_trial
    if learning_rate is not None:
        learn_kwargs["learning_rate"] = float(learning_rate)

    stimuli = {"inputs": pnl_inputs, "epochs": 1}
    if pnl_targets:
        stimuli["targets"] = pnl_targets

    epoch_values: list = []
    abs_changes: list = []
    warnings: list[str] = []
    before = _snapshot(projs, comp)
    for e in range(epochs):
        trial_errors.clear()
        comp.learn(inputs=stimuli, **learn_kwargs)
        extra = {"metric": metric_id}
        if metric_id == "weight_change":
            after = _snapshot(projs, comp)
            relative, absolute = _weight_change(before, after)
            before = after
            value = relative
            abs_changes.append(absolute)
            extra["absolute"] = absolute
        else:
            value = float(np.mean(trial_errors)) if trial_errors else None
        value = _finite(value)
        if value is None and not warnings:
            warnings.append(
                f"Epoch {e + 1}: the {profile['metric']['label'].lower()} was not a finite "
                "number — the weights may have diverged. Try a smaller learning rate or "
                "fewer epochs."
            )
        epoch_values.append(value)
        if on_epoch is not None:
            on_epoch(e + 1, value, extra)

    return {"epoch_values": epoch_values, "abs_changes": abs_changes, "warnings": warnings}


def learn_pathway_composition(
    comp,
    module,
    inputs: dict,
    targets: dict,
    *,
    epochs: int,
    learning_rate,
    requested_mode,
    resolve_node,
    serialize,
    on_epoch=None,
) -> dict:
    """The whole learn request for a non-autodiff Composition (#997).

    Shared by the sandbox worker and the in-process executor so the two can't
    drift (the #765 lesson). ``resolve_node(comp, module, key)`` maps a request
    key to a node; ``serialize`` turns numpy into JSON. Returns the same
    response contract as the autodiff path — ``epochLosses`` / ``finalLoss``
    carry the metric's values — plus ``metric`` naming what they are.
    """
    import psyneulink as pnl
    from app.services.executor import _resolve_learn_execution_mode, format_pnl_call

    profile = learning_profile(comp, is_autodiff=False)
    if profile["kind"] == "none":
        return {
            "error": f"Composition '{comp.name}' is not learning-capable: {profile['reason']}",
            "notLearnable": True,
        }
    if epochs < 1:
        return {"error": "epochs must be >= 1"}

    pnl_inputs = {}
    for key, values in (inputs or {}).items():
        node = resolve_node(comp, module, key)
        if node is None:
            return {"error": f"Input mechanism '{key}' not found"}
        pnl_inputs[node] = [np.array(v, dtype=float) for v in values]

    target_names = profile["targetNodes"] or []
    pnl_targets = {}
    for key, values in (targets or {}).items():
        node = resolve_node(comp, module, key)
        if node is None:
            return {"error": f"Target mechanism '{key}' not found"}
        if node.name not in target_names:
            if not target_names:
                return {
                    "error": (
                        f"Composition '{comp.name}' learns without targets "
                        f"({profile['metric']['label'].lower()} is reported instead), "
                        f"so '{key}' can't take one."
                    )
                }
            return {
                "error": (
                    f"'{key}' is not trained by a learning pathway; targets go to: "
                    + ", ".join(target_names)
                )
            }
        pnl_targets[node] = [np.array(v, dtype=float) for v in values]

    if not pnl_inputs:
        return {"error": "Learning requires at least one input"}
    missing = [n for n in target_names if not any(t.name == n for t in pnl_targets)]
    if missing:
        return {"error": "Learning needs targets for: " + ", ".join(missing)}

    trial_counts = {len(v) for v in pnl_inputs.values()} | {len(v) for v in pnl_targets.values()}
    if len(trial_counts) != 1:
        return {"error": "All inputs and targets must supply the same number of trials"}
    num_trials = trial_counts.pop()

    exec_mode, effective_mode, mode_reason = _resolve_learn_execution_mode(
        pnl, requested_mode, is_autodiff=False, has_learning=True
    )

    stimuli = {"inputs": pnl_inputs, "epochs": epochs}
    if pnl_targets:
        stimuli["targets"] = pnl_targets
    call_kwargs = {"inputs": stimuli, "execution_mode": exec_mode}
    if learning_rate is not None:
        call_kwargs["learning_rate"] = float(learning_rate)
    pnl_call = format_pnl_call("learn", comp.name, call_kwargs)

    trained = train(
        comp, pnl_inputs, pnl_targets,
        epochs=epochs, learning_rate=learning_rate, exec_mode=exec_mode,
        profile=profile, on_epoch=on_epoch,
    )
    epoch_values = trained["epoch_values"]
    finite = [v for v in epoch_values if v is not None]

    final_results = list(comp.results)[-num_trials:]
    response = {
        "finalLoss": epoch_values[-1] if epoch_values else None,
        "epochLosses": finite,
        "epochs": epochs,
        "learningRate": learning_rate,
        "numTrials": num_trials,
        "results": [{"trial": i, "output": serialize(r)} for i, r in enumerate(final_results)],
        "executionMode": effective_mode,
        "executionModeReason": mode_reason,
        "pnlCall": pnl_call,
        "learningKind": "pathway",
        "metric": profile["metric"],
        "warnings": trained["warnings"],
    }
    if profile["metric"]["id"] == "weight_change":
        response["epochWeightChangeAbsolute"] = trained["abs_changes"]
    return response
