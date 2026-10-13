"""Regression fixtures for two vendored Stroop-variant reference models (#798):

- ``Kalanthroff_PCTC_2018`` (PCTC proactive/reactive control Stroop, ``PCTC_MODEL``)
- ``Cohen_Huston1994_horse_race`` (feedforward Stroop, ``FEEDFORWARD_STROOP_SYSTEM``)

Both vendored from ``psyneulink/library/models/`` as curated construction extracts
(the upstream module-level run drivers are stripped). Classic non-EM models →
plain deterministic ``Composition.run``. Clean loading was unblocked by #797.
"""

import importlib.util
from pathlib import Path

import numpy as np
import pytest
import psyneulink as pnl

REF_DIR = Path(__file__).parent.parent / "reference_models"

# (module filename stem, module-level Composition variable)
MODELS = [
    ("Kalanthroff_PCTC_2018", "PCTC"),
    ("Cohen_Huston1994_horse_race", "Bidirectional_Stroop"),
]
N_TRIALS = 5


def _load(name):
    # Clear the process-global PNL registry so a re-load doesn't '-N'-suffix
    # names (mirrors the introspector).
    pnl.clear_registry()
    spec = importlib.util.spec_from_file_location(f"{name}_ref", REF_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _inputs(comp):
    ins = comp.get_nodes_by_role(pnl.NodeRole.INPUT)
    return {n: ([1] + [0] * (n.defaults.variable.shape[-1] - 1)) for n in ins}


def _flat(out):
    return np.concatenate([np.asarray(o, dtype=float).ravel() for o in out])


def _run(name, var):
    comp = getattr(_load(name), var)
    return _flat(comp.run(inputs=_inputs(comp), num_trials=N_TRIALS))


@pytest.mark.parametrize("name,var", MODELS, ids=[m[0] for m in MODELS])
def test_exposes_composition(name, var):
    comp = getattr(_load(name), var)
    assert isinstance(comp, pnl.Composition)
    assert len(comp.nodes) >= 5


@pytest.mark.parametrize("name,var", MODELS, ids=[m[0] for m in MODELS])
def test_runs_finite(name, var):
    flat = _run(name, var)
    assert flat.size >= 1
    assert np.isfinite(flat).all()


@pytest.mark.parametrize("name,var", MODELS, ids=[m[0] for m in MODELS])
def test_output_unit_range(name, var):
    """Response outputs come from Logistic units, bounded in [0, 1]."""
    flat = _run(name, var)
    assert flat.min() >= -1e-9
    assert flat.max() <= 1 + 1e-6


@pytest.mark.parametrize("name,var", MODELS, ids=[m[0] for m in MODELS])
def test_fresh_load_reproducible(name, var):
    a = _run(name, var)
    b = _run(name, var)
    assert np.allclose(a, b)
