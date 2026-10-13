"""Regression fixtures for two vendored LC (locus coeruleus) reference models (#800):

- ``GilzenratModel`` — Gilzenrat et al. LC gain model (comp var ``task``)
- ``Nieuwenhuis2005Model`` — Nieuwenhuis et al. (2005) LC / P300 model (comp var ``task``)

Both vendored from ``psyneulink/library/models/`` as curated construction extracts
(the upstream module-level run drivers — argparse / .run() / matplotlib /
show_graph — are stripped, so loading has no side effects and pops no graph PDFs).
Plain deterministic ``Composition.run``.
"""

import importlib.util
from pathlib import Path

import numpy as np
import pytest
import psyneulink as pnl

REF_DIR = Path(__file__).parent.parent / "reference_models"

# (module filename stem, module-level Composition variable)
MODELS = [
    ("GilzenratModel", "task"),
    ("Nieuwenhuis2005Model", "task"),
]
N_TRIALS = 3


def _load(name):
    # Belt-and-suspenders: no vendored model should render a graph, but never let
    # a load pop a graphviz PDF / matplotlib window during tests.
    pnl.clear_registry()
    pnl.Composition.show_graph = lambda self, *a, **k: None
    spec = importlib.util.spec_from_file_location(f"{name}_ref", REF_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _inputs(comp):
    ins = comp.get_nodes_by_role(pnl.NodeRole.INPUT)
    return {n: ([1] + [0] * (int(np.prod(n.defaults.variable.shape)) - 1)) for n in ins}


def _flat(out):
    return np.concatenate([np.asarray(o, dtype=float).ravel() for o in out])


def _run(name, var):
    comp = getattr(_load(name), var)
    return _flat(comp.run(inputs=_inputs(comp), num_trials=N_TRIALS))


@pytest.mark.parametrize("name,var", MODELS, ids=[m[0] for m in MODELS])
def test_exposes_composition(name, var):
    comp = getattr(_load(name), var)
    assert isinstance(comp, pnl.Composition)
    assert len(comp.nodes) >= 2


@pytest.mark.parametrize("name,var", MODELS, ids=[m[0] for m in MODELS])
def test_runs_finite(name, var):
    flat = _run(name, var)
    assert flat.size >= 1
    assert np.isfinite(flat).all()


# NB: no fresh-load reproducibility check here — GilzenratModel is stochastic
# (Gaussian noise on its mechanisms), so two independent runs legitimately
# differ. Seeding the per-mechanism RNGs to pin this is out of scope for a
# runnability regression.
