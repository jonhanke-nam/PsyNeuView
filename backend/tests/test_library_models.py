"""Tests for loading PsyNeuLink library models.

These models live in the PsyNeuLink package at psyneulink/library/models/.
Each test loads a model file, verifies it produces at least one Composition
with nodes and projections, and checks for no errors.
"""

import pytest
import numpy as np
from pathlib import Path
from app.services.introspector import load_and_introspect


def _find_library_models_dir():
    """Find the PsyNeuLink library models directory."""
    try:
        import psyneulink
        models_dir = Path(psyneulink.__file__).parent / "library" / "models"
        if models_dir.is_dir():
            return models_dir
    except ImportError:
        pass
    return None


LIBRARY_DIR = _find_library_models_dir()

# All known library model files (from issue #20). The full package — including
# EGO, which the construct_model() factory loader now materializes (#855).
LIBRARY_MODELS = [
    "GilzenratModel.py",
    "MontagueDayanSejnowski96.py",
    "Nieuwenhuis2005Model.py",
    "Kalanthroff_PCTC_2018.py",
    "Cohen_Huston1994.py",
    "Cohen_Huston1994_horse_race.py",
    "Botvinick_conflict_monitoring_model.py",
    "Giallanza2024_EGO_Study2.py",
]

# Models that create Compositions inside functions rather than at module level.
# The introspector finds these via the gc.get_objects() fallback, and the loader
# now binds them back onto the module (#859) so they also RUN by name — they are
# no longer excluded from the run smoke below.
FUNCTION_SCOPED_MODELS = {
    "MontagueDayanSejnowski96.py",
}

# EGO is an AutodiffComposition trained via .learn() in PyTorch mode; the generic
# zero-input .run() smoke below isn't representative for it (its run path is the
# autodiff/learn path, exercised by the reference-model e2e). It still must LOAD
# directly from the live library via the construct_model() factory (#855), which
# the parametrized load tests above cover.
FACTORY_MODELS = {
    "Giallanza2024_EGO_Study2.py",
}


def _get_available_models():
    """Return list of (name, path) for models that exist on disk."""
    if LIBRARY_DIR is None:
        return []
    models = []
    for name in LIBRARY_MODELS:
        path = LIBRARY_DIR / name
        if path.exists():
            models.append((name, str(path)))
    return models


AVAILABLE_MODELS = _get_available_models()

skip_if_no_pnl = pytest.mark.skipif(
    LIBRARY_DIR is None,
    reason="PsyNeuLink not installed or library models not found"
)


def _load_model(model_path):
    """Load a model, tolerating post-execution errors.

    Library models often crash after their .run() call (which we no-op)
    because post-execution code tries to access results/logs. The model
    definition is still valid — the introspector does partial introspection
    on errors, so we accept results that have compositions even if there's
    also an error from the post-run code.
    """
    try:
        return load_and_introspect(model_path, use_sandbox=False)
    except RuntimeError as e:
        # RuntimeError means no compositions at all — truly failed
        pytest.fail(f"Failed to load: {e}")


@skip_if_no_pnl
@pytest.mark.parametrize("model_name,model_path", AVAILABLE_MODELS,
                         ids=[m[0] for m in AVAILABLE_MODELS])
def test_library_model_loads(model_name, model_path):
    """Each library model should load and produce compositions."""
    result = _load_model(model_path)
    comps = result.get("compositions", [])
    assert len(comps) >= 1, \
        f"{model_name} produced no Compositions"


@skip_if_no_pnl
@pytest.mark.parametrize("model_name,model_path", AVAILABLE_MODELS,
                         ids=[m[0] for m in AVAILABLE_MODELS])
def test_library_model_has_nodes(model_name, model_path):
    """Each Composition should have at least one node."""
    result = _load_model(model_path)
    for comp in result["compositions"]:
        assert len(comp["nodes"]) >= 1, \
            f"{model_name} / {comp['name']} has no nodes"


@skip_if_no_pnl
@pytest.mark.parametrize("model_name,model_path", AVAILABLE_MODELS,
                         ids=[m[0] for m in AVAILABLE_MODELS])
def test_library_model_has_projections(model_name, model_path):
    """Each Composition should have at least one projection."""
    result = _load_model(model_path)
    for comp in result["compositions"]:
        assert len(comp["projections"]) >= 1, \
            f"{model_name} / {comp['name']} has no projections"


@skip_if_no_pnl
@pytest.mark.parametrize("model_name,model_path", AVAILABLE_MODELS,
                         ids=[m[0] for m in AVAILABLE_MODELS])
def test_library_model_nodes_have_types(model_name, model_path):
    """Every node should have a type and name."""
    result = _load_model(model_path)
    for comp in result["compositions"]:
        for node in comp["nodes"]:
            assert "name" in node and node["name"], \
                f"{model_name}: node missing name"
            # A node is either a mechanism (carries 'type') or a nested
            # composition (carries 'compositionType', e.g. EGO's EM module).
            # Both must be identified; only mechanisms have a plain 'type'.
            type_key = "compositionType" if node.get("kind") == "composition" else "type"
            assert node.get(type_key), \
                f"{model_name}: node '{node.get('name')}' missing {type_key}"


@skip_if_no_pnl
@pytest.mark.parametrize("model_name,model_path", AVAILABLE_MODELS,
                         ids=[m[0] for m in AVAILABLE_MODELS])
def test_library_model_no_hard_error_when_loaded(model_name, model_path):
    """#796: a model whose definition loads (compositions found) must NOT surface
    a hard ``error``.

    Several upstream library models (e.g. Kalanthroff_PCTC_2018,
    Cohen_Huston1994_horse_race) have module-level drivers that access run
    results / log data after the introspector's no-op'd ``.run()``, raising e.g.
    ``KeyError`` on the composition name. The definition is still valid, so this
    is downgraded to a non-fatal warning rather than a hard error that the
    frontend reads as a load failure.
    """
    result = _load_model(model_path)
    if result.get("compositions"):
        assert "error" not in result, (
            f"{model_name} loaded {len(result['compositions'])} composition(s) but "
            f"surfaced a hard error: {result.get('error')!r} — post-execution "
            f"driver failures should be warnings (#796)"
        )


@skip_if_no_pnl
def test_ego_factory_model_loads_directly_from_source():
    """#855: EGO (Giallanza2024) exposes no Composition at module scope.

    It follows the newer upstream convention — a ``construct_model()`` factory
    called only under ``if __name__ == "__main__":`` — so nothing is built at
    import and the gc fallback finds nothing either. The loader materializes the
    factory's Composition and binds it onto the module, so EGO loads directly
    from the live library like the module-scope models (no maintained copy).
    Regression: before the fix this raised "No PsyNeuLink Composition found at
    module scope."
    """
    path = LIBRARY_DIR / "Giallanza2024_EGO_Study2.py"
    if not path.exists():
        pytest.skip("EGO library model not present in this PsyNeuLink build")

    # In-process and sandbox-worker paths share the same materializer — assert
    # both surface the EGO composition with a runnable module handle (varName).
    result = load_and_introspect(str(path), use_sandbox=False)
    assert "error" not in result, f"EGO load errored: {result.get('error')!r}"
    names = {c["name"] for c in result.get("compositions", [])}
    handles = {c["varName"] for c in result.get("compositions", [])}
    assert "EGO" in names, f"EGO composition not materialized (got {names})"
    assert "EGO" in handles, (
        f"EGO composition lacks a module handle for run/get-inputs (got {handles})"
    )

    from app.services.sandbox_worker import task_introspect
    sb = task_introspect({"file_path": str(path)})
    assert any(c["name"] == "EGO" for c in sb.get("compositions", [])), (
        f"sandbox worker did not materialize EGO (got {sb.get('compositions')!r})"
    )


@skip_if_no_pnl
def test_function_built_model_runs_by_name():
    """#859: a model whose Composition is built inside a helper still runs.

    MontagueDayanSejnowski96 does ``comp_5a = figure_5a()``, but the helper's
    module-level driver reads run results after the no-op'd ``.run()`` and raises
    before the assignment completes — so the Composition survives only in the PNL
    registry with no module attribute. Introspection reports it (via the gc
    fallback) under ``comp.name``, but before the fix ``run``/``get-inputs``
    failed with "Composition 'TD_Learning_Figure_5A' not found". The loader now
    binds gc-discovered compositions onto the module, so it runs by name.
    """
    from app.services.executor import get_input_nodes, run_model

    path = LIBRARY_DIR / "MontagueDayanSejnowski96.py"
    if not path.exists():
        pytest.skip("Montague model not present in this PsyNeuLink build")

    comp_var, _ = _top_composition_var(str(path))
    assert comp_var, "Montague: no composition discovered to run"

    ins = get_input_nodes(str(path), comp_var, use_sandbox=False)
    assert "error" not in ins, (
        f"Montague get_input_nodes failed — module handle not bound? {ins.get('error')!r}"
    )
    res = run_model(str(path), comp_var, _zero_inputs(ins["inputNodes"]),
                    use_sandbox=False)
    assert "error" not in res, f"Montague run failed: {res.get('error')!r}"
    assert res.get("numTrials", 0) >= 1, f"Montague produced no trials ({res!r})"


@skip_if_no_pnl
@pytest.mark.parametrize("model_name,model_path", AVAILABLE_MODELS,
                         ids=[m[0] for m in AVAILABLE_MODELS])
def test_library_model_via_sandbox_worker(model_name, model_path):
    """Each library model should also introspect via the sandbox worker path.

    The other tests use ``use_sandbox=False``, which bypasses the worker's
    projection-name-lookup loop. That divergence masked #165 (sandbox raised
    on projections whose ``.sender`` attribute was unresolved). Calling
    ``task_introspect`` directly in-process catches the regression without
    paying for a real subprocess spawn.
    """
    from app.services.sandbox_worker import task_introspect

    result = task_introspect({"file_path": model_path})
    assert "compositions" in result, \
        f"{model_name}: sandbox worker returned no 'compositions' key (result={result!r})"
    assert len(result["compositions"]) >= 1, \
        f"{model_name}: sandbox worker produced no Compositions"


# --- Running library models (#796 follow-up) --------------------------------
# The models above only load; these RUN them. Raw upstream library models carry
# a module-level driver that calls ``.run()`` and then reads the results. The
# app no-op's that ``.run()``, so the driver's post-run read raises "Parameter X
# has no value for execution_id …". That exception used to abort the executor's
# module load *before* it reached its own clean run — so Botvinick et al. failed
# to run at all. The run paths now tolerate the post-definition driver error and
# reset the name registry, so the model runs under its real (un-suffixed) names.

# Every model runs by name except EGO (autodiff — trained via .learn, not the
# generic zero-input .run smoke). Function-built models (Montague) run now that
# the loader binds their gc-discovered compositions onto the module (#859).
RUNNABLE_MODELS = [
    (name, path) for name, path in AVAILABLE_MODELS
    if name not in FACTORY_MODELS
]


def _top_composition_var(model_path):
    """Introspect a model and return the top composition's module var name.

    Returns (var_name, what_introspection_said) so a model that comes back with
    no composition says why: it has failed now and then on Python 3.14 in CI
    (MontagueDayanSejnowski96) and never locally.
    """
    result = load_and_introspect(model_path, use_sandbox=False)
    comps = result.get("compositions", [])
    said = {k: result.get(k) for k in ("notices", "error", "errors") if result.get(k)}
    return (comps[0]["varName"] if comps else None), said


def _zero_inputs(input_nodes):
    """Build a single all-zeros trial for each discovered input node."""
    inputs = {}
    for n in input_nodes:
        size = int(np.prod(n["shape"])) if n.get("shape") else 1
        inputs[n["varName"]] = [[0.0] * size]
    return inputs


@skip_if_no_pnl
@pytest.mark.parametrize("model_name,model_path", RUNNABLE_MODELS,
                         ids=[m[0] for m in RUNNABLE_MODELS])
def test_library_model_runs(model_name, model_path):
    """#796: each runnable library model should RUN (not just load).

    Regression for the module-level driver aborting the executor's load: the
    reported case was ``Botvinick_conflict_monitoring_model.py`` surfacing
    "Parameter 'integrator_mode' of COLOR HIDDEN has no value for execution_id"
    on Run Model instead of producing results.
    """
    from app.services.executor import get_input_nodes, run_model

    comp_var, said = _top_composition_var(model_path)
    assert comp_var, f"{model_name}: no top composition found to run; introspection said: {said!r}"

    ins = get_input_nodes(model_path, comp_var, use_sandbox=False)
    assert "error" not in ins, \
        f"{model_name}: get_input_nodes failed: {ins.get('error')!r}"

    res = run_model(model_path, comp_var, _zero_inputs(ins["inputNodes"]),
                    use_sandbox=False)
    assert "error" not in res, \
        f"{model_name}: run failed: {res.get('error')!r}"
    assert res.get("numTrials", 0) >= 1, \
        f"{model_name}: run produced no trials (result={res!r})"


@skip_if_no_pnl
def test_botvinick_runs_via_sandbox_worker_after_load():
    """#796: running a driver-carrying model through the sandbox worker *after*
    a load must succeed with the model's real names — not ``-2`` suffixed ones.

    The worker is long-lived, so a prior ``task_introspect`` leaves the PsyNeuLink
    registry populated; without a registry reset the run re-registers the same
    names as 'CONFLICT MONITORING_SYSTEM-2' / 'COLOR HIDDEN-2'. This reproduces
    the exact sequence a user hits: open the model, then click Run.
    """
    from app.services.sandbox_worker import (
        task_introspect, task_get_input_nodes, task_run,
    )

    botvinick = next(
        (p for n, p in AVAILABLE_MODELS
         if n == "Botvinick_conflict_monitoring_model.py"),
        None,
    )
    if botvinick is None:
        pytest.skip("Botvinick model not present")
    comp_var, _ = _top_composition_var(botvinick)

    # Prior load — pollutes the registry exactly like opening the model does.
    task_introspect({"file_path": botvinick})

    ins = task_get_input_nodes({"file_path": botvinick, "composition_name": comp_var})
    assert "error" not in ins, f"input nodes failed: {ins.get('error')!r}"
    names = [n["name"] for n in ins["inputNodes"]]
    assert not any(name.endswith(tuple(f"-{i}" for i in range(1, 10))) for name in names), \
        f"input node names should not be registry-suffixed: {names}"

    res = task_run({
        "file_path": botvinick,
        "composition_name": comp_var,
        "inputs": _zero_inputs(ins["inputNodes"]),
    })
    assert "error" not in res, f"run failed: {res.get('error')!r}"
    assert res.get("numTrials", 0) >= 1, f"run produced no trials (result={res!r})"
