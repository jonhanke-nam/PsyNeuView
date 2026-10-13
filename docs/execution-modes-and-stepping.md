# Execution modes and stepping

What the debugger, trace bar and Run State can tell you depends on which
execution mode a run used. This page records what each mode actually gives you,
measured rather than assumed (#767).

## The short version

| Composition | Mode | Execution trace | Per-node values | Stepping |
|---|---|---|---|---|
| `Composition` | Python | yes | yes | **full** |
| `Composition` | PyTorch | yes | yes | **full** — but see below, the mode is ignored |
| `Composition` | LLVM | **no** | **no** | **degraded** — run works, trace doesn't |
| `AutodiffComposition` | any | yes | yes | **synthesized** |

The run response carries this as `steppingSupport: {level, reason}`, so the UI
can say which case you're in instead of presenting every trace as equivalent.

## Why the modes differ

The `_debugger` hook and `node.log` fire from **the PsyNeuLink scheduler**.
Anything that bypasses the scheduler bypasses the observability contract with
it.

**Python** drives the scheduler directly, so the trace is a recording of what
happened.

**PyTorch on an `AutodiffComposition`** runs through the torch wrappers, which
bypass the scheduler entirely. `_autodiff_observability` reconstructs the same
shape of data from the torch path so stepping still works — but it is a
reconstruction, not a recording. That distinction matters when a snapshot
disagrees with your mental model: the reconstruction can only report what the
wrappers expose.

**PyTorch on a plain `Composition`** is accepted and **silently ignored** — you
get the Python path. Measured: the same model under Python and PyTorch produces
byte-identical debugger snapshots (digest `095fc39d`, 213 snapshots each). If
torch were genuinely executing, it would bypass the scheduler and the snapshots
could not match. See #1001.

**LLVM** compiles and runs the graph without driving the scheduler. The run
succeeds and returns correct results, but there is no execution trace and no
per-node logs — measured as 325 snapshots but **0** trace steps and **0** node
logs on a plain feedforward Composition. Snapshots alone are not enough to
step: the trace bar has nothing to advance through.

## Measurements

Plain `Composition` (`demos/feedforward_network.py`) and `AutodiffComposition`
(`demos/autodiff_feedforward.py`), single trial, via `POST /api/model/run`:

```
Composition   Python    snapshots=213  trace=3  logs=3
Composition   PyTorch   snapshots=213  trace=3  logs=3   (identical digest to Python)
Composition   LLVM      snapshots=325  trace=0  logs=0
Autodiff      Python    snapshots=11   trace=4  logs=5   (resolves to PyTorch)
Autodiff      PyTorch   snapshots=11   trace=4  logs=5
Autodiff      LLVM      snapshots=11   trace=4  logs=5   (resolves to PyTorch)
```

The Autodiff rows are identical because that path forces PyTorch regardless of
the request — an `AutodiffComposition` only behaves correctly under the torch
wrappers (#363).

## What gets captured, and what gets dropped

Every node's value is logged, on every run. `POST /api/model/run` accepts
`log_nodes` to narrow that to a subset when full capture is expensive; omitting
it keeps the default.

Snapshots are a different story. Two caps bound them:

| cap | value | what it protects |
|---|---|---|
| `_MAX_PARAMETER_SETTING_SNAPSHOTS` | 500 | stops PARAMETER_SETTING crowding out the trial / execution-set snapshots stepping depends on |
| `_MAX_DEBUGGER_SNAPSHOTS` | 10,000 | overall memory bound |

**These fire far more often than you would guess.** A **two-trial** run of
`stroop_reference_basic.py` drops **13,230** parameter-setting snapshots,
keeping 500 of 13,730 — about 3.6%:

```
nodesLogged 7 / 7
snapshots   590
dropped     {'parameterSetting': 13230, 'global': 0}
truncated   True
caps        {'parameterSetting': 500, 'global': 10000}
```

The run response reports this as a `capture` block, and the Run panel shows a
warning when anything was dropped. Before #768 the truncation was silent, so a
trace missing 96% of its parameter writes looked identical to a complete one.

The caps themselves are a tuning decision, not a bug — #464 will replace them
with relevance filtering rather than a flat count. What matters here is that
their effect is visible.

## If you need to step

Run under **Python**. It is the default (`DEFAULT_RUN_MODE`), so this is only a
consideration if you have deliberately switched modes.

For an `AutodiffComposition` there is no Python option that preserves
correctness — the torch path is the only one that works, so synthesized
stepping is the best available and is not a degradation you can avoid.

## Learning

Which backend can *train* a composition is per-structure too (#763, #997), and
comes back from introspection as each composition's `executionModes`
(`learnable`) and `learningProfile`:

| Composition | Trains under | Each epoch reports |
|---|---|---|
| `AutodiffComposition` | PyTorch | loss (`comp.torch_losses`) |
| `Composition` with a TD learning pathway | Python | prediction error: the `PredictionErrorMechanism`'s δ, mean squared over the trial, averaged over the epoch |
| `Composition` with another learning pathway | Python | error at target: the `ComparatorMechanism`'s error, mean squared, averaged over the epoch |
| `Composition` with a learning mechanism and no target (Hebbian) | Python | weight change: ‖W_end − W_start‖_F / ‖W_end‖_F over the learned matrices |
| `Composition` with neither | — | not learnable; the Learn tab says why |

An omitted or unusable mode resolves to the composition's own learnable backend
(`_resolve_learn_execution_mode`), with a reason whenever the request was not
honored. The Python path runs one `learn()` call per epoch, measuring between
calls — which is also what lets the job layer stream per-epoch progress and
cancel between epochs. The response keeps `epochLosses` / `finalLoss` for older
clients and adds `metric` (`id`, `label`, `unit`, `description`) naming what
they hold. The code is `backend/app/services/pathway_learning.py`.

Two things PsyNeuLink does here that are easy to trip over:

- **Hebbian learning has no fixed point.** The absolute weight change per epoch
  settles to a constant; it never reaches zero. The relative change is what
  falls, so that is the metric (the absolute norms come back too, as
  `epochWeightChangeAbsolute`). If activity carries over from one trial to the
  next, a `Linear` unit feeds back through the growing weights and they blow
  up to inf/NaN within a few epochs; a non-finite epoch is reported as
  missing, with a warning. The `hebbian_learning` demo clears activity at the
  start of each trial (as the course notebook does), so it stays finite.
- **A TD prediction error only vanishes if the cue's arrival is predictable.**
  With a cue that comes on part-way through the trial (Montague et al. 1996,
  Fig. 5), δ moves from the reward back to the cue onset and its total stays
  the same, so "prediction error" does not fall. The `td_learning` demo keeps
  the cue on from the first timestep for that reason.

## Separately: `_debugger` hook availability

Independent of mode, a PsyNeuLink build without the `_debugger` hook cannot
supply snapshots at all. That is a build-level constraint reported as
`debuggerHookAvailable`, and the Run panel explains it separately. The hook was
upstreamed in PsyNeuLink 0.19.1.0; only older builds lack it.

Related: #247 and #355 (debugger umbrellas), #761 (execution modes).
