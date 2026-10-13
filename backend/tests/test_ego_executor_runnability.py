"""Runnability + baseline-match for the EGO reference model via the executor (#578).

Pins the three #577 runnability bars for
``backend/reference_models/Giallanza2024_ego_study2.py`` — specifically through
**PsyNeuView's executor** (the ``run_model`` path behind ``POST /api/model/run``),
which is the gap ``test_ego_reference_equivalence.py`` explicitly left open
(that file validates EGO as a *standalone* script, not inside the executor).

EGO is an ``AutodiffComposition`` with a nested ``EMComposition``; its module-
scope ``EGO_comp`` runs via ``.learn()`` under ``ExecutionMode.PyTorch`` (the
executor's autodiff branch), not plain ``Composition.run``.

Bars:

1. The script loads and exposes a module-scope ``AutodiffComposition``.
2. A headless Run completes without error through the executor.
3. The executor's per-trial output **matches a direct PsyNeuLink ``.learn()``**
   of the same model under an identical seed.

Determinism note: EGO's torch ops drift across torch versions / platforms, so
a *committed* golden would be brittle (hence the opt-in ``EGO_GOLDEN`` gate in
``test_ego_reference_equivalence.py``). Every comparison here is instead
**same-process under a fixed seed** — the executor run and its baseline are
computed back-to-back on the same machine/version, so the match is exact and
needs no env gate.
"""

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest

from app.services.executor import (
    run_model,
    _optimizations_per_minibatch,
    _resolve_input_node,
)

REFERENCE_MODEL = (
    Path(__file__).parent.parent / "reference_models" / "Giallanza2024_ego_study2.py"
)
COMPOSITION = "EGO_comp"
INPUT_NODE = "STATE"
SEED = 0

# EGO now uses the upstream library-model `targets=` construction (#578), so its
# loss SAMPLE keeps a single afferent and .learn() no longer trips PsyNeuLink#30.


def _one_hot(i: int, n: int = 10) -> list[float]:
    v = [0.0] * n
    v[i] = 1.0
    return v


# Three one-hot STATE trials — a minimal exercise of the learn path (module
# EGO_comp has memory_capacity=2; feeding 3 trials is fine for runnability).
INPUTS = {INPUT_NODE: [_one_hot(0), _one_hot(1), _one_hot(2)]}


def _seed() -> None:
    import torch

    np.random.seed(SEED)
    torch.manual_seed(SEED)


def _load_module(modname: str):
    spec = importlib.util.spec_from_file_location(modname, REFERENCE_MODEL)
    module = importlib.util.module_from_spec(spec)
    sys.modules[modname] = module
    spec.loader.exec_module(module)
    return module


def _executor_output() -> np.ndarray:
    """Seeded run through PsyNeuView's executor (in-process autodiff path)."""
    _seed()
    result = run_model(
        str(REFERENCE_MODEL), COMPOSITION, INPUTS, use_sandbox=False
    )
    assert "error" not in result, result.get("error")
    return np.array(
        [np.asarray(t["output"], dtype=float) for t in result["results"]]
    )


def _direct_learn_baseline(modname: str) -> np.ndarray:
    """Seeded direct ``.learn()`` of the same model, mirroring the executor.

    Replicates exactly what the executor's autodiff branch does — same
    PyTorch execution mode, same minibatch size, same stride — so a match
    confirms the executor's module loading / input resolution / result
    extraction don't perturb the computation.
    """
    import psyneulink as pnl

    _seed()
    module = _load_module(modname)
    comp = getattr(module, COMPOSITION)
    state = _resolve_input_node(comp, module, INPUT_NODE)
    comp.learn(
        inputs={state: [np.array(v, dtype=float) for v in INPUTS[INPUT_NODE]]},
        execution_mode=pnl.ExecutionMode.PyTorch,
        minibatch_size=1,
    )
    stride = _optimizations_per_minibatch(comp)
    return np.array(
        [np.asarray(r, dtype=float) for r in list(comp.results)[::stride]]
    )


@pytest.fixture(scope="module")
def executor_results() -> np.ndarray:
    return _executor_output()


def test_module_imports_and_exposes_autodiff():
    import psyneulink as pnl

    module = _load_module("ego_import_check")
    assert hasattr(module, COMPOSITION)
    assert isinstance(getattr(module, COMPOSITION), pnl.AutodiffComposition)


def test_executor_run_completes(executor_results):
    """Bar 2: a headless Run completes via the executor and yields output."""
    assert executor_results.shape[0] == len(INPUTS[INPUT_NODE])
    assert np.isfinite(executor_results).all()


def test_executor_matches_direct_learn_baseline(executor_results):
    """Bar 3: executor output matches a same-process seeded direct .learn()."""
    baseline = _direct_learn_baseline("ego_baseline")
    assert executor_results.shape == baseline.shape
    assert np.allclose(executor_results, baseline, rtol=1e-9, atol=1e-12)


def test_executor_deterministic_under_seed(executor_results):
    """A second seeded executor run reproduces the first exactly."""
    again = _executor_output()
    assert executor_results.shape == again.shape
    assert np.allclose(executor_results, again, rtol=0, atol=0)
