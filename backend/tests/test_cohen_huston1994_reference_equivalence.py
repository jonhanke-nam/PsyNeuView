"""Regression fixture for the Cohen & Huston (1994) Bidirectional Stroop reference model (#794).

Pins that the vendored ``Cohen_Huston1994`` reference model under
``backend/reference_models/`` loads as a standalone PsyNeuLink model, exposes a
Composition, and runs via ``Composition.run`` producing stable, finite,
bounded output. This is a classic non-EM model (no learning / PyTorch), so a
plain deterministic ``run`` — no golden snapshot needed.

The model is vendored (curated extract; the upstream file's module-level run
driver / argparse / matplotlib are stripped). Drift-tracked against
``psyneulink/library/models/Cohen_Huston1994.py``.
"""

import importlib.util
from pathlib import Path

import numpy as np
import pytest

REFERENCE_MODEL = (
    Path(__file__).parent.parent / "reference_models" / "Cohen_Huston1994.py"
)

N_TRIALS = 5
# Color-naming-ish stimulus: red color, GREEN word, "read the word" task.
INPUT = lambda m: {  # noqa: E731
    m.color_input_layer: [1, 0, 0],
    m.word_input_layer: [0, 1, 0],
    m.task_input_layer: [0, 1],
}


def _load_reference_module():
    spec = importlib.util.spec_from_file_location("cohen_huston_ref", REFERENCE_MODEL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _flat(out):
    return np.concatenate([np.asarray(o, dtype=float).ravel() for o in out])


@pytest.fixture(scope="module")
def cohen_module():
    return _load_reference_module()


@pytest.fixture(scope="module")
def cohen_run(cohen_module):
    out = cohen_module.Bidirectional_Stroop.run(inputs=INPUT(cohen_module), num_trials=N_TRIALS)
    return out, _flat(out)


def test_module_imports_and_exposes_composition(cohen_module):
    import psyneulink as pnl

    assert hasattr(cohen_module, "Bidirectional_Stroop")
    assert isinstance(cohen_module.Bidirectional_Stroop, pnl.Composition)
    # 7 mechanisms in the bidirectional Stroop model
    assert len(cohen_module.Bidirectional_Stroop.nodes) >= 5


def test_run_completes(cohen_run):
    out, flat = cohen_run
    assert len(out) >= 1
    assert flat.size >= 1


def test_output_finite(cohen_run):
    _, flat = cohen_run
    assert np.isfinite(flat).all()


def test_output_in_unit_range(cohen_run):
    """Response outputs come from Logistic units, bounded in [0, 1]."""
    _, flat = cohen_run
    assert flat.min() >= -1e-9
    assert flat.max() <= 1 + 1e-6


def test_fresh_load_reproducible():
    """A fresh construct + run reproduces the same output (deterministic model)."""
    m1 = _load_reference_module()
    a = _flat(m1.Bidirectional_Stroop.run(inputs=INPUT(m1), num_trials=N_TRIALS))
    m2 = _load_reference_module()
    b = _flat(m2.Bidirectional_Stroop.run(inputs=INPUT(m2), num_trials=N_TRIALS))
    assert np.allclose(a, b)
