"""Runnability + baseline-match for the basic Stroop reference model (#579).

Pins the three #577 runnability bars for
``backend/reference_models/stroop_reference_basic.py``:

1. The script loads and exposes a module-scope ``Composition``.
2. A headless Run completes without error through PsyNeuView's executor
   (the ``run_model`` path behind ``POST /api/model/run``).
3. The executor's per-trial output **matches the stock-PsyNeuLink baseline** —
   running the same composition+inputs directly via ``Composition.run``.

Like the Stroop+LC sibling (#580), this is a noise-free plain ``Composition``
(``DriftDiffusionIntegrator`` decision), so runs are deterministic and the
baseline is recomputed in-process every run — no committed golden, no env gate.
"""

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest

from app.services.executor import run_model

REFERENCE_MODEL = (
    Path(__file__).parent.parent / "reference_models" / "stroop_reference_basic.py"
)
COMPOSITION = "stroop_model"

# A congruent then incongruent color-naming trial (task fixed on color).
INPUTS = {
    "color_input": [[1, 0], [0, 1]],
    "word_input": [[1, 0], [0, 1]],
    "task_input": [[1, 0], [1, 0]],
}


def _load_module(modname: str):
    spec = importlib.util.spec_from_file_location(modname, REFERENCE_MODEL)
    module = importlib.util.module_from_spec(spec)
    sys.modules[modname] = module
    spec.loader.exec_module(module)
    return module


def _direct_baseline(modname: str) -> np.ndarray:
    """Run the composition directly in stock PsyNeuLink — the baseline."""
    module = _load_module(modname)
    comp = getattr(module, COMPOSITION)
    pnl_inputs = {
        getattr(module, var): [np.array(v, dtype=float) for v in vals]
        for var, vals in INPUTS.items()
    }
    comp.run(inputs=pnl_inputs)
    return np.array([np.asarray(r, dtype=float) for r in comp.results])


@pytest.fixture(scope="module")
def executor_results() -> np.ndarray:
    """Per-trial output via PsyNeuView's executor (in-process run path)."""
    result = run_model(
        str(REFERENCE_MODEL), COMPOSITION, INPUTS, use_sandbox=False
    )
    assert "error" not in result, result.get("error")
    return np.array(
        [np.asarray(t["output"], dtype=float) for t in result["results"]]
    )


def test_module_imports_and_exposes_composition():
    import psyneulink as pnl

    module = _load_module("stroop_basic_import_check")
    assert hasattr(module, COMPOSITION)
    assert isinstance(getattr(module, COMPOSITION), pnl.Composition)


def test_executor_run_completes(executor_results):
    """Bar 2: a headless Run completes and yields one output per trial."""
    assert executor_results.shape[0] == len(INPUTS["color_input"])
    assert np.isfinite(executor_results).all()


def test_executor_matches_stock_baseline(executor_results):
    """Bar 3: executor output matches a direct stock-PsyNeuLink run."""
    baseline = _direct_baseline("stroop_basic_baseline")
    assert executor_results.shape == baseline.shape
    assert np.allclose(executor_results, baseline, rtol=1e-7, atol=1e-9)


def test_baseline_deterministic():
    """The reference model is noise-free, so two runs match exactly."""
    a = _direct_baseline("stroop_basic_det_a")
    b = _direct_baseline("stroop_basic_det_b")
    assert np.allclose(a, b, rtol=0, atol=0)
