"""Regression fixtures for the vendored MontagueDayanSejnowski96 reference model (#800).

Montague, Dayan & Sejnowski (1996) — mesolimbic dopamine / TD-learning model.
Vendored from ``psyneulink/library/models/`` as a curated construction extract:
upstream this model is function-based (``figure_5a/5b/5c()`` each build → learn →
plot). We lift figure_5a's construction to module scope only — the ``.learn()``
call, matplotlib plotting, argparse, and the module-level driver are stripped, so
loading has no side effects and pops no graph PDFs.

Unlike the other reference models this one's whole purpose is *learning*, so the
suite exercises ``Composition.learn`` directly (deterministic TD learning — no
noise — so it's also reproducibility-checked). This is standard PsyNeuLink
learning, distinct from the AutodiffComposition path that currently blocks EGO.
"""

import importlib.util
from pathlib import Path

import numpy as np
import pytest
import psyneulink as pnl

REF_DIR = Path(__file__).parent.parent / "reference_models"
NAME = "MontagueDayanSejnowski96"
N_LEARN_TRIALS = 6


def _load():
    # Belt-and-suspenders: no vendored model should render a graph, but never let
    # a load pop a graphviz PDF / matplotlib window during tests.
    pnl.clear_registry()
    pnl.Composition.show_graph = lambda self, *a, **k: None
    spec = importlib.util.spec_from_file_location(f"{NAME}_ref", REF_DIR / f"{NAME}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _flat(out):
    return np.concatenate([np.asarray(o, dtype=float).ravel() for o in out])


def _run(module):
    comp = module.comp
    ins = comp.get_nodes_by_role(pnl.NodeRole.INPUT)
    inputs = {n: [[1.0] + [0.0] * 59] for n in ins}
    return _flat(comp.run(inputs=inputs, num_trials=2))


def _learn(module):
    comp = module.comp
    full = module.build_stimulus_dictionary(
        module.sample_mechanism, module.target_mechanism, no_reward_trials={14, 29}
    )
    inputs = {k: v[:N_LEARN_TRIALS] for k, v in full.items()}
    comp.learn(inputs=inputs)
    return np.asarray(comp.results, dtype=float)


def test_exposes_composition():
    comp = _load().comp
    assert isinstance(comp, pnl.Composition)
    assert len(comp.nodes) >= 2


def test_runs_finite():
    flat = _run(_load())
    assert flat.size >= 1
    assert np.isfinite(flat).all()


def test_learns_finite():
    res = _learn(_load())
    assert res.size >= 1
    assert np.isfinite(res).all()


def test_learn_reproducible():
    # TD learning here is deterministic (no noise), so two fresh loads that learn
    # the same trials must agree.
    a = _learn(_load())
    b = _learn(_load())
    assert np.allclose(a, b)
