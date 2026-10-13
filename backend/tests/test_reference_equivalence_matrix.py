"""Reference-model execute-path equivalence — one parametrized matrix (#653).

For every bundled reference model, assert that **PsyNeuView's executor** (the
``run_model`` path behind ``POST /api/model/run``) reproduces **stock
PsyNeuLink** (``Composition.run``) on the same inputs, within a documented
tolerance. This is the canonical "does PsyNeuView match PsyNeuLink?" gate;
adding a future reference model is a one-row change to ``REFERENCE_MODELS``.
Every model under ``backend/reference_models/`` has a row; ``test_every_reference_model_has_a_row``
fails when one is added without.

EGO is an ``AutodiffComposition`` whose published behavior comes from ``.learn()``
in PyTorch mode; the executor doesn't drive learning yet (#363), so its
execute-path row is skipped here and EGO is covered at the script-golden level
by ``test_ego_reference_equivalence.py`` until that blocker clears.

(The per-model files ``test_stroop_*_reference_equivalence.py`` keep their
model-specific runnability bars from #579/#580; this matrix is the unified,
scalable equivalence check.)
"""

import importlib.util
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pytest

import psyneulink as pnl
from psyneulink.core.globals.utilities import set_global_seed

from app.services.executor import learn_model, run_model

REF_DIR = Path(__file__).parent.parent / "reference_models"


@dataclass
class RefModel:
    key: str
    filename: str
    composition: str
    inputs: dict
    rtol: float = 1e-7
    atol: float = 1e-9
    skip: str | None = None  # reason to skip the execute-path check, or None
    # PsyNeuLink's global seed, set before each load. Every component draws its
    # own seed from it at construction, so the executor's load and the stock
    # load get identical noise (GilzenratModel is stochastic: unseeded runs differ).
    seed: int = 0


# A congruent then incongruent color-naming trial (task fixed on color) — the
# same fixed inputs the per-model equivalence tests use.
STROOP_INPUTS = {
    "color_input": [[1, 0], [0, 1]],
    "word_input": [[1, 0], [0, 1]],
    "task_input": [[1, 0], [1, 0]],
}

# One color-naming trial for the Botvinick conflict-monitoring model. Keys are the
# module's input-layer variables; a color-naming task cue with a single color/word.
BOTVINICK_INPUTS = {
    "colors_input_layer": [[1, 0, 0]],
    "words_input_layer": [[0, 1, 0]],
    "task_input_layer": [[1, 0]],
}

# The library models below (#794, #798, #800) are keyed by node name: their
# input layers are named in PsyNeuLink (``name="COLOR INPUT"``) and the Run
# panel sends those names. Each model gets a few distinct trials, so a
# trial-ordering slip in the executor would show.

# Color red / word red, then color red / word green; task: name the color.
COHEN_HUSTON_INPUTS = {
    "COLOR INPUT": [[1, 0, 0], [1, 0, 0]],
    "WORD INPUT": [[1, 0, 0], [0, 1, 0]],
    "TASK INPUT": [[1, 0], [1, 0]],
}
BOTVINICK_LIBRARY_INPUTS = COHEN_HUSTON_INPUTS
HORSE_RACE_INPUTS = {
    "COLORS_INPUT": [[1, 0, 0], [1, 0, 0]],
    "WORDS_INPUT": [[1, 0, 0], [0, 1, 0]],
    "TASK_INPUT": [[1, 0], [1, 0]],
}
# Congruent then incongruent, proactive control off then on.
KALANTHROFF_INPUTS = {
    "WORDS_INPUT": [[1, 0], [0, 1]],
    "COLORS_INPUT": [[1, 0], [1, 0]],
    "PROACTIVE_CONTROL": [[0, 0], [1, 0]],
    "BIAS": [[1, 0], [1, 0]],
}
# Target, then distractor, then target again.
GILZENRAT_INPUTS = {"INPUT LAYER": [[1, 0], [0, 1], [1, 0]]}
NIEUWENHUIS_INPUTS = {"INPUT LAYER": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]}
# The cue at time step 0, then nothing. Only SAMPLE: the Run panel leaves the
# TD pathway's TARGET out of the inputs (#1383), and PsyNeuLink fills it in.
# Untrained, the model's weights are zero and its output doesn't depend on the
# input, so this row checks the run path end to end but not much more; the
# model's real behaviour is learning, compared in
# ``test_montague_learning_matches_stock_psyneulink`` below.
MONTAGUE_INPUTS = {"SAMPLE": [[1.0] + [0.0] * 59, [0.0] * 60]}

REFERENCE_MODELS = [
    RefModel("stroop_basic", "stroop_reference_basic.py", "stroop_model", STROOP_INPUTS),
    RefModel("stroop_lc", "stroop_reference_with_lc.py", "stroop_with_lc", STROOP_INPUTS),
    # First vendored upstream example (#589, corpus B). Unnamed module comp → the
    # module variable is `comp`; lives under reference_models/upstream/ (drift-tracked).
    RefModel("botvinick", "upstream/botvinick_model_composition.py", "comp", BOTVINICK_INPUTS),
    RefModel("cohen_huston1994", "Cohen_Huston1994.py", "Bidirectional_Stroop", COHEN_HUSTON_INPUTS),
    RefModel(
        "cohen_huston1994_horse_race", "Cohen_Huston1994_horse_race.py", "Bidirectional_Stroop", HORSE_RACE_INPUTS
    ),
    RefModel(
        "botvinick_library",
        "Botvinick_conflict_monitoring_model.py",
        "System_Conflict_Monitoring",
        BOTVINICK_LIBRARY_INPUTS,
    ),
    RefModel("kalanthroff_pctc_2018", "Kalanthroff_PCTC_2018.py", "PCTC", KALANTHROFF_INPUTS),
    RefModel("gilzenrat", "GilzenratModel.py", "task", GILZENRAT_INPUTS),
    RefModel("nieuwenhuis2005", "Nieuwenhuis2005Model.py", "task", NIEUWENHUIS_INPUTS),
    RefModel("montague_dayan_sejnowski96", "MontagueDayanSejnowski96.py", "comp", MONTAGUE_INPUTS),
    RefModel(
        "ego",
        "Giallanza2024_ego_study2.py",
        "EGO",
        {},
        skip=(
            "EGO is an AutodiffComposition; execute-path equivalence is blocked "
            "on executor learning support (#363). Covered at the script-golden "
            "level by test_ego_reference_equivalence.py."
        ),
    ),
]


def _load_module(model: RefModel):
    path = REF_DIR / model.filename
    spec = importlib.util.spec_from_file_location(f"refeq_{model.key}", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module, path


def _executor_output(model: RefModel, path: Path):
    """Per-trial output through PsyNeuView's executor, as a ragged structure.

    Returns one list of output vectors per trial. Multi-terminal models emit
    several output vectors of *different* lengths (e.g. Botvinick →
    COLORS_HIDDEN/WORDS_HIDDEN/TASK_LAYER/RESPONSE, lengths 3/3/2/2/1), so we
    keep them as a list rather than forcing a single (homogeneous) ndarray.
    Compared vector-by-vector in the test.
    """
    result = run_model(str(path), model.composition, model.inputs, use_sandbox=False)
    assert "error" not in result, result.get("error")
    return [[np.asarray(v, dtype=float) for v in t["output"]] for t in result["results"]]


def _stock_node(comp, module, key: str):
    """The node an input key names: a module variable, else a node name.

    Written here rather than borrowed from the executor, so a name-resolution
    slip in the executor shows as a difference instead of being reproduced.
    A second load of the same file gets ``-N``-suffixed names, so the suffix
    is ignored.
    """
    obj = getattr(module, key, None)
    if obj is not None and obj in comp.nodes:
        return obj
    for node in comp.nodes:
        if re.sub(r"-\d+$", "", node.name) == key:
            return node
    raise KeyError(f"no input node {key!r} in {comp.name}")


def _stock_baseline(model: RefModel, module):
    """Per-trial output from stock PsyNeuLink, same ragged shape as the executor."""
    comp = getattr(module, model.composition)
    pnl_inputs = {
        _stock_node(comp, module, key): [np.array(v, dtype=float) for v in vals]
        for key, vals in model.inputs.items()
    }
    comp.run(inputs=pnl_inputs)
    return [[np.asarray(v, dtype=float) for v in trial] for trial in comp.results]


@pytest.mark.parametrize("model", REFERENCE_MODELS, ids=lambda m: m.key)
def test_executor_matches_stock_psyneulink(model: RefModel):
    if model.skip:
        pytest.skip(model.skip)

    # Each side loads the file fresh from the same seed, so both draw the same
    # noise; the stock load comes second so its components aren't consumed by
    # the executor's run.
    set_global_seed(model.seed)
    executor_out = _executor_output(model, REF_DIR / model.filename)
    set_global_seed(model.seed)
    pnl.clear_registry()
    module, _ = _load_module(model)
    baseline = _stock_baseline(model, module)

    # Structure-aware comparison: same trials, same per-trial output vectors,
    # each vector matching within tolerance. Tolerates heterogeneous vector
    # lengths that a single ndarray can't represent.
    assert len(executor_out) == len(baseline), (
        f"{model.key}: executor trial count {len(executor_out)} != baseline {len(baseline)}"
    )
    for ti, (e_trial, b_trial) in enumerate(zip(executor_out, baseline)):
        assert len(e_trial) == len(b_trial), (
            f"{model.key} trial {ti}: executor produced {len(e_trial)} output vectors, "
            f"stock produced {len(b_trial)}"
        )
        for vi, (ev, bv) in enumerate(zip(e_trial, b_trial)):
            assert ev.shape == bv.shape, (
                f"{model.key} trial {ti} vector {vi}: executor shape {ev.shape} "
                f"!= baseline {bv.shape}"
            )
            assert np.allclose(ev, bv, rtol=model.rtol, atol=model.atol), (
                f"{model.key} trial {ti} vector {vi}: PsyNeuView executor diverges from "
                f"stock PsyNeuLink (rtol={model.rtol}, atol={model.atol})\n"
                f"  executor={ev}\n  stock={bv}"
            )


def test_every_reference_model_has_a_row():
    """A new reference model can't slip in without an equivalence row (#653)."""
    on_disk = {p.relative_to(REF_DIR).as_posix() for p in REF_DIR.rglob("*.py") if p.name != "__init__.py"}
    in_matrix = {m.filename for m in REFERENCE_MODELS}
    assert on_disk - in_matrix == set(), f"reference models without an equivalence row: {sorted(on_disk - in_matrix)}"


def test_montague_learning_matches_stock_psyneulink():
    """PsyNeuView's Learn path trains Montague exactly as ``Composition.learn`` does (#653).

    MontagueDayanSejnowski96 exists to learn (TD), so its run row alone says
    little. Train it both ways on the model's own stimuli (cue at 41, reward
    at 54, one unrewarded trial) and compare the last epoch's outputs, which
    depend on the learned weights.
    """
    path = REF_DIR / "MontagueDayanSejnowski96.py"
    trials, epochs = 6, 3

    set_global_seed(0)
    pnl.clear_registry()
    model = RefModel("montague_learn", "MontagueDayanSejnowski96.py", "comp", {})
    module, _ = _load_module(model)
    stimuli = module.build_stimulus_dictionary(module.sample_mechanism, module.target_mechanism, no_reward_trials={3})
    samples = stimuli[module.sample_mechanism][:trials]
    targets = stimuli[module.target_mechanism][:trials]

    set_global_seed(0)
    pnl.clear_registry()
    result = learn_model(
        str(path), "comp", {"sample_mechanism": samples}, {"action_selection": targets},
        epochs=epochs, use_sandbox=False,
    )
    assert "error" not in result, result.get("error")
    executor_out = np.array([np.asarray(t["output"], dtype=float).ravel() for t in result["results"]])

    # Stock: the same epochs as separate learn() calls, as the Learn tab makes them.
    set_global_seed(0)
    pnl.clear_registry()
    module, _ = _load_module(model)
    comp = module.comp
    for _ in range(epochs):
        comp.learn(inputs={"inputs": {module.sample_mechanism: samples, module.target_mechanism: targets}, "epochs": 1})
    stock_out = np.array([np.asarray(t, dtype=float).ravel() for t in comp.results[-trials:]])

    assert np.abs(stock_out).sum() > 0, "the model learned nothing, so the comparison proves nothing"
    assert executor_out.shape == stock_out.shape
    assert np.allclose(executor_out, stock_out, rtol=1e-7, atol=1e-9), (
        "PsyNeuView's Learn path diverges from stock Composition.learn for Montague\n"
        f"  max difference {np.max(np.abs(executor_out - stock_out))}"
    )
