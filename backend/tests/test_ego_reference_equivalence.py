"""Regression fixture for the Giallanza 2024 (Study 2) EGO reference model (#321).

Pins that the EGO reference model under ``backend/reference_models/`` runs as a
standalone PsyNeuLink script and produces stable results. EGO is an
``AutodiffComposition`` with a nested ``EMComposition``; its published behavior
comes from ``.learn()`` under ``ExecutionMode.PyTorch`` (not ``Composition.run``),
so this exercises that path directly against the model file.

Two layers (per #321 design discussion):

- **Property tests** (always run): shape, finiteness, value range, row-sum
  bounds, and same-seed reproducibility. These survive PyTorch / platform
  numeric drift.
- **Golden test** (opt-in via ``EGO_GOLDEN=1``): exact ``np.allclose`` against a
  committed snapshot. Gated because torch float ops, while reproducible on a
  fixed machine, can drift across torch versions / platforms and would make CI
  brittle. Run locally to validate an environment or regenerate the golden.

Regenerate the golden after an intended numeric change:

    EGO_GOLDEN=regenerate <python> -m pytest tests/test_ego_reference_equivalence.py -k golden

Note: this validates EGO *as a standalone script*. Reproducing the same run
*inside PsyNeuView's executor* is separate work — the executor calls
``Composition.run`` and does not yet drive learning / PyTorch mode (tracked
separately as the #321 "runs in PsyNeuView" blocker).
"""

import importlib.util
import os
from pathlib import Path

import numpy as np
import pytest

REFERENCE_MODEL = (
    Path(__file__).parent.parent / "reference_models" / "Giallanza2024_ego_study2.py"
)
GOLDEN_PATH = Path(__file__).parent / "fixtures" / "ego" / "ego_study2_seed0_golden.npy"

SEED = 0
N_CONTEXTS = 4  # interleaved -> 25 trial-states; ~5s to learn. Keep small.

# EGO now uses the upstream library-model `targets=` construction (#578), so its
# loss SAMPLE keeps a single afferent and .learn() no longer trips PsyNeuLink#30.
# The tests below actively verify EGO learns and produces valid outputs.


def _load_reference_module():
    spec = importlib.util.spec_from_file_location("ego_study2_ref", REFERENCE_MODEL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_seeded(module, seed=SEED, n_contexts=N_CONTEXTS):
    """Construct a fresh EGO model and run the standalone learn under a seed."""
    import torch

    np.random.seed(seed)
    torch.manual_seed(seed)
    states = module.get_trials(paradigm="interleaved", n_contexts=n_contexts)
    model, input_layer = module.construct_model(memory_capacity=len(states))
    out = module.run_model(model, input_layer, states)
    return np.asarray(out, dtype=float), states


@pytest.fixture(scope="module")
def ego_module():
    return _load_reference_module()


@pytest.fixture(scope="module")
def ego_run(ego_module):
    out, states = _run_seeded(ego_module)
    return out, states, ego_module


def test_module_imports_and_exposes_composition(ego_module):
    """The reference file imports and exposes a module-scope composition."""
    import psyneulink as pnl

    assert hasattr(ego_module, "EGO_comp")
    assert isinstance(ego_module.EGO_comp, pnl.Composition)


def test_output_shape(ego_run):
    out, states, module = ego_run
    assert out.shape == (len(states), module.STATE_SIZE)


def test_output_finite(ego_run):
    out, _, _ = ego_run
    assert np.isfinite(out).all()


def test_output_in_probability_range(ego_run):
    """Predictions are softmax-weighted retrievals of (≥0, ≤1) memory contents."""
    out, _, _ = ego_run
    assert out.min() >= -1e-9
    assert out.max() <= 1 + 1e-6


def test_row_sums_bounded(ego_run):
    """Each prediction row sums to at most 1 (early trials retrieve ~nothing)."""
    out, _, _ = ego_run
    assert out.sum(axis=1).max() <= 1 + 1e-6


def test_same_seed_reproducible(ego_module):
    """A second seeded run reproduces the first exactly on a fixed machine."""
    a, _ = _run_seeded(ego_module)
    b, _ = _run_seeded(ego_module)
    assert np.allclose(a, b, rtol=0, atol=0)


@pytest.mark.skipif(
    not os.environ.get("EGO_GOLDEN"),
    reason="exact golden comparison is opt-in (set EGO_GOLDEN=1); "
    "torch float ops can drift across versions/platforms",
)
def test_matches_golden(ego_run):
    """Exact-ish match against the committed seed-0 snapshot.

    Set ``EGO_GOLDEN=regenerate`` to rewrite the golden from the current run.
    """
    out, _, _ = ego_run
    if os.environ.get("EGO_GOLDEN") == "regenerate":
        GOLDEN_PATH.parent.mkdir(parents=True, exist_ok=True)
        np.save(GOLDEN_PATH, out)
        pytest.skip(f"regenerated golden at {GOLDEN_PATH}")
    golden = np.load(GOLDEN_PATH)
    assert out.shape == golden.shape
    assert np.allclose(out, golden, rtol=1e-5, atol=1e-6)
