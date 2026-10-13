"""Worker script that runs inside the sandbox subprocess.

Reads a JSON task from stdin, executes it, and prints the result to stdout.
This script is invoked by sandbox.py and should not be imported directly.
"""

import json
import sys
import importlib.util
import re
import warnings

# Suppress noisy warnings
warnings.filterwarnings("ignore", category=FutureWarning)

import numpy as np

# #448: Stock-PsyNeuLink compatibility shim for EMComposition.
# Some upstream ``PrincetonUniversity/PsyNeuLink`` versions ship an
# ``EMComposition.assign_ShowGraph`` override that imports
# ``emshowgraph.EMCompositionShowGraph``, but the ``emshowgraph.py``
# file was never committed. Any reference model that constructs an
# EMComposition raises ``ModuleNotFoundError`` at instantiation.
#
# The jonhanke-nam fork sidesteps this by not overriding
# ``assign_ShowGraph`` at all (inherits the default ``ShowGraph``).
# We replicate that on stock PNL with a stub module that aliases
# ``ShowGraph`` → ``EMCompositionShowGraph``. The try-import guard
# means the shim is a no-op when (a) the real ``emshowgraph`` exists,
# (b) the fork is in use, or (c) any future upstream release ships
# the missing file — in all those cases the real module wins.
#
# Tracked upstream-side at jonhanke-nam/PsyNeuLink#24; retire this
# shim when that lands.
try:
    import psyneulink.library.compositions.emcomposition.emshowgraph  # noqa: F401
except ImportError:
    try:
        import types
        from psyneulink.core.compositions.showgraph import ShowGraph
        _emshowgraph_shim = types.ModuleType(
            "psyneulink.library.compositions.emcomposition.emshowgraph"
        )
        _emshowgraph_shim.EMCompositionShowGraph = ShowGraph
        sys.modules[
            "psyneulink.library.compositions.emcomposition.emshowgraph"
        ] = _emshowgraph_shim
    except ImportError:
        # PsyNeuLink isn't installed at all; let downstream code raise
        # a clearer error when it actually tries to import psyneulink.
        pass


RESULT_MARKER = "###PSYNEWVIEW_RESULT###"

# Emitted on stdout *before* RESULT_MARKER by streaming-capable tasks
# (#535 job layer). Consumers that split on RESULT_MARKER (warm worker,
# cold-start fallback) are unaffected by these extra lines.
PROGRESS_MARKER = "###PSYNEWVIEW_PROGRESS###"

# Parameters to skip in introspection
_SKIP_MECH_PARAMS = {
    "variable", "value", "execution_count", "num_executions",
    "num_executions_before_finished", "is_finished_flag",
    "has_initializers", "input_ports", "output_ports", "function",
    "integrator_function", "integrator_function_value",
    "initial_value", "termination_measure", "termination_measure_value",
    "input_labels_dict", "output_labels_dict",
}

_SKIP_FUNC_PARAMS = {
    "variable", "value", "execution_count", "num_executions",
    "num_executions_before_finished", "is_finished_flag",
    "has_initializers", "changes_shape", "enable_output_type_conversion",
    "max_executions_before_finished", "output_type",
    "multiplicative_param", "additive_param",
}

_SKIP_PROJ_PARAMS = {
    "variable", "value", "execution_count", "num_executions",
    "num_executions_before_finished", "is_finished_flag",
    "has_initializers", "sender", "receiver", "function",
    "input_ports", "output_ports",
}


def to_json(val):
    """Convert a value to JSON-serializable form."""
    if val is None or isinstance(val, (bool, str)):
        return val
    if isinstance(val, (int, float)):
        if isinstance(val, float) and (np.isnan(val) or np.isinf(val)):
            return str(val)
        return val
    if isinstance(val, np.integer):
        return int(val)
    if isinstance(val, np.floating):
        return float(val)
    if isinstance(val, np.ndarray):
        return val.tolist()
    if isinstance(val, (list, tuple)):
        return [to_json(v) for v in val]
    if isinstance(val, dict):
        # JSON object keys must be strings. PsyNeuLink hands us dicts keyed by
        # Component objects (e.g. PARAMETER_SETTING values, per-node maps), so
        # coerce any non-primitive key to its name/str rather than letting the
        # downstream json.dumps blow up the whole run response.
        return {_json_key(k): to_json(v) for k, v in val.items()}
    return None


def _json_key(k):
    """Coerce a dict key to something JSON-serializable (a string)."""
    if isinstance(k, (str, int, float, bool)) or k is None:
        return k
    name = getattr(k, "name", None)
    return name if isinstance(name, str) else str(k)


def _materialize_factory_composition(module):
    """Bind a factory-only model's Composition onto the module namespace (#855).

    PsyNeuLink's newer library models (e.g. ``Giallanza2024_EGO_Study2``) don't
    assign a Composition at module scope. They follow the upstream convention of
    a parameterized ``construct_model()`` factory, invoked only under
    ``if __name__ == "__main__":`` — so after import there's nothing at module
    scope (and nothing in memory for the gc fallback to find). The composition
    itself is fine; our loader just never called the factory.

    When a model exposes no module-scope Composition but defines a callable
    ``construct_model()``, call it (build-only — the execution no-op patches are
    still active, so no train/run fires) and bind each returned Composition back
    onto the module under a stable attribute name. Both introspection
    (``vars(module)`` scan) and run (``getattr(module, varName)``) then resolve
    it exactly like any hand-assigned model, so it loads *and* runs directly
    from the live source with no maintained copy.
    """
    try:
        import psyneulink as pnl
    except Exception:
        return
    # Already exposes a module-scope Composition? Nothing to do.
    if any(isinstance(v, pnl.Composition) and not k.startswith("_")
           for k, v in vars(module).items()):
        return
    factory = getattr(module, "construct_model", None)
    if not callable(factory):
        return
    try:
        result = factory()
    except Exception:
        # A factory that needs real arguments, or that fails to build, is not a
        # model we can auto-materialize — leave the module untouched so the
        # caller reports the normal "no Composition found" load failure.
        return
    candidates = result if isinstance(result, (list, tuple)) else [result]
    for obj in candidates:
        if isinstance(obj, pnl.Composition):
            attr = re.sub(r"-\d+$", "", obj.name or "model").replace(" ", "_").replace(".", "_")
            # Bind unless a real Composition already holds that name. A same-named
            # NON-Composition must not block the run handle — e.g. the library EGO
            # (Giallanza2024_EGO_Study2) has a module-level ``EGO = 'EGO'`` string
            # constant, which shadowed the composition and left it unrunnable
            # ("Composition 'EGO' not found"). #886/#859 follow-up.
            if not isinstance(getattr(module, attr, None), pnl.Composition):
                setattr(module, attr, obj)


def _composition_snapshot():
    """Snapshot every Composition alive before a load (for #859).

    Returns ``{id: composition}``; test membership with ``id(obj) in snapshot``.

    The snapshot holds the Compositions themselves, not just their ids, and
    that matters (#1382). ``gc.get_objects()`` also returns garbage that has
    not been collected yet, such as the Compositions of a model loaded earlier
    in this process. If only the ids were kept, that garbage could be freed
    while the new model runs, and Python could put a Composition the new model
    builds at the same address. It would then have an id already in the
    snapshot and be skipped as pre-existing, so a function-built model such as
    MontagueDayanSejnowski96 loaded with "no composition found". Holding the
    references keeps the old objects alive until the load is done, so no new
    object can take their ids.
    """
    import gc
    try:
        import psyneulink as pnl
    except Exception:
        return {}
    return {id(o): o for o in gc.get_objects() if isinstance(o, pnl.Composition)}


def _materialize_gc_compositions(module, before_ids):
    """Give function-built Compositions a module handle so they can run (#859).

    Some library models (e.g. ``MontagueDayanSejnowski96``) build a Composition
    inside a helper — ``comp_5a = figure_5a()`` — whose module-level assignment
    then *fails* on a post-run driver error (the helper reads results after our
    no-op'd ``.run()``). The Composition was built before the error, so it
    survives in the PsyNeuLink registry and introspection finds it via the gc
    fallback — but the assignment never completed, so there's no module
    attribute and ``getattr(module, varName)`` on the run path can't resolve it.

    Bind each Composition created during *this* load (``before_ids`` excludes
    ones lingering from a prior load in the warm worker) onto the module under
    the same cleaned name introspection reports, so run/get-inputs resolve it
    like a module-scope model. Only acts when the model exposes no module-scope
    Composition, mirroring the introspector's gc fallback.
    """
    import gc
    try:
        import psyneulink as pnl
    except Exception:
        return
    if any(isinstance(v, pnl.Composition) and not k.startswith("_")
           for k, v in vars(module).items()):
        return
    gc.collect()
    for obj in gc.get_objects():
        if not isinstance(obj, pnl.Composition) or id(obj) in before_ids:
            continue
        attr = re.sub(r"-\d+$", "", obj.name or "model").replace(" ", "_")
        # Same as the factory path: only skip if a real Composition already holds
        # the name, so a same-named non-Composition doesn't block the run handle.
        if not isinstance(getattr(module, attr, None), pnl.Composition):
            setattr(module, attr, obj)


def load_module(file_path, run_user_code=False, reset_registry=False,
                tolerate_exec_error=False):
    """Load and execute a .py file as a module.

    Clears sys.argv before execution so that scripts using argparse
    (e.g. PsyNeuLink library models) don't crash or pick up stale args.

    Graphics side effects (``Composition.show_graph``, matplotlib plotting) are
    ALWAYS suppressed during load — a programmatic load must never render a
    graphviz PDF that the OS pops open, or open a plot window (#608). The app
    renders graphs explicitly via ``task_show_graph``.

    Execution side effects (``Composition.run/execute/learn`` at module level)
    are suppressed unless ``run_user_code`` is True. Every caller either
    introspects the definition or drives execution itself afterward on a clean
    object, so a module-level run/learn only pollutes ``comp.results`` and
    mutates trained parameters before that happens (#609). ``run_user_code`` is
    set only for developer-mode extracted pytest tests (#273 / #249), which
    intentionally execute the script's own run/learn calls.

    ``reset_registry`` clears the process-global PsyNeuLink name registry before
    executing, so re-loading a model in this long-lived worker doesn't
    re-register names and suffix them ('CONFLICT MONITORING_SYSTEM' ->
    '...-2'). ``task_introspect`` already does this (#642); the run/learn paths
    need it too, otherwise a run following a load produces ``-2`` node names.

    ``tolerate_exec_error`` swallows an exception raised *after* the module has
    finished defining its objects — the classic raw-library-model pattern where
    a module-level driver calls ``.run()`` (no-op'd above) and then reads the
    results/logs that never got produced, raising e.g. "Parameter X has no value
    for execution_id …" (#796). The Composition and mechanisms already exist in
    the module namespace, so a caller that drives its own run/learn can proceed;
    it detects a genuine load failure separately (target Composition is None).
    """
    if reset_registry:
        try:
            import psyneulink as pnl
            pnl.clear_registry()
        except Exception:
            pass

    spec = importlib.util.spec_from_file_location("user_model", file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["user_model"] = module

    saved_argv = sys.argv
    sys.argv = [file_path]

    patches = _apply_graphics_patches()
    patches += _apply_stdout_redirect()
    if not run_user_code:
        patches += _apply_execution_patches()

    # Snapshot pre-existing Compositions so we can bind ones this load builds
    # but leaves without a module handle (#859).
    comps_before = _composition_snapshot()

    try:
        try:
            spec.loader.exec_module(module)
        except Exception as e:
            if not tolerate_exec_error:
                raise
            # Post-definition driver error — non-fatal. The objects the caller
            # needs are already built; let it proceed and drive its own clean
            # run/learn. Kept, though: when the objects were *not* built, this
            # is the only account of why (#1235).
            module.__psyneuview_load_error__ = describe_load_error(e, file_path)
        # Factory-only library models (e.g. EGO) expose no module-scope
        # Composition; materialize it now, while the execution no-op patches are
        # still active so the build can't fire a train/run (#855).
        _materialize_factory_composition(module)
        # Function-built models (e.g. MontagueDayanSejnowski96) whose module-level
        # assignment failed on a post-run driver error leave a Composition with no
        # module handle; bind it so the run path can resolve it by name (#859).
        _materialize_gc_compositions(module, comps_before)
    finally:
        sys.argv = saved_argv
        for restore_fn in patches:
            restore_fn()

    return module


def load_module_resilient(file_path, run_user_code=False):
    """Execute a model file statement-by-statement, skipping ones that raise.

    A fallback for when a normal :func:`load_module` raises (#615): one broken
    top-level statement — e.g. a half-finished projection created mid-edit that
    references a not-yet-defined endpoint — otherwise aborts the rest of the
    script, so the ``Composition`` never gets built and the whole model
    collapses to "0 mechanisms". Running each top-level statement in its own
    ``exec`` lets the valid mechanisms and the Composition still render; the
    broken statement (and any later statement that references its now-undefined
    variable) is skipped. ``dangling_check`` flags the broken projection
    separately for the UI.

    Returns ``(module, skipped)`` where ``skipped`` is a list of
    ``{"line", "error"}`` for each statement that was skipped.

    The caller must clear the PsyNeuLink registry first when a prior partial
    ``load_module`` already registered objects, so re-created objects keep their
    original names instead of being ``-1`` suffixed.
    """
    import ast

    with open(file_path) as f:
        source = f.read()

    spec = importlib.util.spec_from_file_location("user_model", file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["user_model"] = module

    saved_argv = sys.argv
    sys.argv = [file_path]

    patches = _apply_graphics_patches()
    patches += _apply_stdout_redirect()
    if not run_user_code:
        patches += _apply_execution_patches()

    skipped = []
    try:
        tree = ast.parse(source, file_path)
        for node in tree.body:
            try:
                code = compile(
                    ast.Module(body=[node], type_ignores=[]), file_path, "exec"
                )
                exec(code, module.__dict__)
            except Exception as e:
                skipped.append({"line": getattr(node, "lineno", None), "error": str(e)})
    finally:
        sys.argv = saved_argv
        for restore_fn in patches:
            restore_fn()

    return module, skipped


def _apply_stdout_redirect():
    """Send a loaded model's stdout to stderr during exec (#865).

    The persistent sandbox worker returns task results over *stdout*
    (``###READY###`` / ``RESULT_MARKER`` + JSON). A model that ``print()``s at
    module level — ``_Leabra-Demo`` dumps large numpy arrays — floods that same
    channel during ``exec_module``. The parent only drains stdout while awaiting
    a result, so a model printing more than the ~64 KB OS pipe buffer stalls the
    worker on ``write()`` until its timeout fires (a fast model looks like a
    300 s hang). stderr *is* continuously drained (see sandbox ``_drain_stderr``),
    so route module prints there: they still land in the server logs and the
    result protocol stays clean. Restored before the worker writes its result,
    so the learn path's intentional stdout progress streaming is unaffected.

    Returns a list with a single restore callable (matches the other patch
    helpers so both loaders can splice it into their ``patches`` list).
    """
    saved_stdout = sys.stdout
    sys.stdout = sys.stderr
    return [lambda: setattr(sys, "stdout", saved_stdout)]


def _suppress_show_graph_fallback(root):
    """Stand-in for show_graph_guard.suppress_show_graph. (#1090)

    Kept deliberately duplicated rather than imported: this file runs as a
    script in a subprocess, and suppression failing open — silently letting a
    PDF open over the app — is worse than a few repeated lines.

    Walks the hierarchy and patches only classes that define ``show_graph``
    themselves, since those are the ones whose own method would shadow a
    patched ancestor.
    """
    seen, stack = {}, [root]
    while stack:
        for sub in stack.pop().__subclasses__():
            if id(sub) not in seen:
                seen[id(sub)] = sub
                stack.append(sub)

    def noop(self, *a, **kw):
        return None

    restore_fns = []
    for cls in [root] + list(seen.values()):
        if "show_graph" not in cls.__dict__:
            continue
        original = cls.__dict__["show_graph"]
        try:
            setattr(cls, "show_graph", noop)
        except (AttributeError, TypeError):
            continue
        restore_fns.append((lambda c, fn: lambda: setattr(c, "show_graph", fn))(cls, original))
    return restore_fns


def _apply_graphics_patches():
    """Suppress graphics side effects during module load (#608).

    Patches ``Composition.show_graph`` to a no-op and forces matplotlib into
    its non-interactive Agg backend with plotting functions no-op'd. Models
    routinely call ``comp.show_graph()`` and ``plt.show()`` at module level;
    during a programmatic load the former renders a graphviz PDF that macOS
    opens in Preview, and the latter pops a plot window. The app renders graphs
    on demand via ``task_show_graph`` (``output_fmt='source'`` → SVG) instead.

    Returns a list of callables that restore the original behavior.
    """
    restore_fns = []

    # Patch show_graph to a no-op across the whole Composition hierarchy, not
    # just the root: AutodiffComposition defines its own show_graph, so patching
    # Composition alone left EM models rendering a PDF over the app (#1090).
    #
    # This file runs as a script in a subprocess, so `app` resolves through
    # whatever install is on the path rather than the tree this file came from.
    # Suppression must not depend on that resolution succeeding: an ImportError
    # here previously meant no suppression at all, silently, which is the exact
    # failure it exists to prevent. Hence the local fallback.
    try:
        import psyneulink as pnl
    except ImportError:
        pnl = None
    if pnl is not None:
        try:
            from app.services.show_graph_guard import suppress_show_graph
        except ImportError:
            suppress_show_graph = _suppress_show_graph_fallback
        restore_fns.extend(suppress_show_graph(pnl.Composition))

    # Force a non-interactive backend and no-op the common plotting calls
    try:
        import matplotlib
        matplotlib.use('Agg')

        import matplotlib.pyplot as plt
        _orig_funcs = {}
        for fn_name in ('show', 'plot', 'xlabel', 'ylabel', 'title',
                         'legend', 'xlim', 'ylim', 'xticks', 'yticks',
                         'figure', 'subplot', 'subplots', 'savefig'):
            if hasattr(plt, fn_name):
                _orig_funcs[fn_name] = getattr(plt, fn_name)
                setattr(plt, fn_name, lambda *a, **kw: None)

        def restore_plt():
            for name, fn in _orig_funcs.items():
                setattr(plt, name, fn)
        restore_fns.append(restore_plt)
    except ImportError:
        pass

    return restore_fns


def _apply_execution_patches():
    """Suppress execution side effects during module load (#609).

    Patches ``Composition.run/execute/learn`` and ``Mechanism.reset`` to
    no-ops so module-level execution doesn't run simulations, accumulate
    ``comp.results``, or mutate trained parameters before the caller drives its
    own run/learn on a clean object. Many PNL example/library models call these
    at module level.

    Returns a list of callables that restore the original behavior.
    """
    restore_fns = []
    try:
        import psyneulink as pnl
        noop = lambda self, *args, **kwargs: None
        for method_name in ('run', 'execute', 'learn'):
            orig = getattr(pnl.Composition, method_name)
            setattr(pnl.Composition, method_name, noop)
            restore_fns.append(
                (lambda name, fn: lambda: setattr(pnl.Composition, name, fn))(method_name, orig)
            )
        # Patch Mechanism.reset (some models call reset after run)
        if hasattr(pnl, 'Mechanism'):
            orig_reset = pnl.Mechanism.reset
            setattr(pnl.Mechanism, 'reset', noop)
            restore_fns.append(lambda: setattr(pnl.Mechanism, 'reset', orig_reset))
    except ImportError:
        pass
    return restore_fns


# Node roles that mark a mechanism as generated by a learning pathway
# (add_*_learning_pathway creates the objective / target / learning mechanisms).
# Such nodes have no user `var = pnl.Type(...)` constructor to edit, so they are
# view-only *by design* rather than because the source is non-standard (#822).
_GENERATED_LEARNING_ROLE_NAMES = {
    "LEARNING",
    "LEARNING_OBJECTIVE",
    "TARGET",
    "TARGET_INPUT",
}


def _collect_composition_objects(module, pnl):
    """Every Composition reachable from the module (top-level + nested)."""
    seen = []
    stack = [
        obj for name, obj in vars(module).items()
        if isinstance(obj, pnl.Composition) and not name.startswith("_")
    ]
    while stack:
        comp = stack.pop()
        if any(comp is c for c in seen):
            continue
        seen.append(comp)
        try:
            for node in comp.nodes:
                if isinstance(node, pnl.Composition):
                    stack.append(node)
        except Exception:
            pass
    return seen


def _is_generated_learning_node(mech, comp_objs, pnl) -> bool:
    """True if ``mech`` is generated by a learning pathway (objective / target /
    learning mechanism) rather than authored via ``var = pnl.Type(...)`` — so it
    is view-only by design, not because the declaration is non-standard (#822).

    Detected by type (``LearningMechanism``) or by node role (LEARNING /
    LEARNING_OBJECTIVE / TARGET / TARGET_INPUT). Only meaningful for nodes that
    are already view-only; user-authored nodes are editable via the line map and
    never reach this check.
    """
    learning_mech_cls = getattr(pnl, "LearningMechanism", None)
    if learning_mech_cls is not None and isinstance(mech, learning_mech_cls):
        return True
    for comp in comp_objs:
        try:
            roles = comp.get_roles_by_node(mech)
        except Exception:
            continue
        for role in roles:
            if getattr(role, "name", str(role)).upper() in _GENERATED_LEARNING_ROLE_NAMES:
                return True
    return False


def _trials(values):
    """A PsyNeuLink per-node input list as one flat float vector per trial.

    PsyNeuLink accepts ``[2, 0, 0]`` (one number per trial), ``[[1, 0], [0, 1]]``
    (one vector per trial) and ``[[[1, 0]], [[0, 1]]]`` (one vector per input
    port, one port). Returns None for anything else (e.g. several input ports),
    so a set the Run/Learn grids can't show is skipped rather than mangled.
    """
    try:
        arr = np.asarray(values, dtype=float)
    except (TypeError, ValueError):
        return None
    if arr.ndim == 1:
        return [[float(v)] for v in arr]
    if arr.ndim == 2:
        return [[float(v) for v in row] for row in arr]
    if arr.ndim == 3 and arr.shape[1] == 1:
        return [[float(v) for v in row[0]] for row in arr]
    return None


def _node_trials(mapping, nodes):
    """``{Mechanism: trials}`` → ``{node name: trials}`` if every key is one of
    ``nodes`` and every value parses, else None."""
    if not isinstance(mapping, dict) or not mapping:
        return None
    out = {}
    for key, values in mapping.items():
        if not any(key is n for n in nodes):
            return None
        trials = _trials(values)
        if trials is None:
            return None
        out[key.name] = trials
    lengths = {len(t) for t in out.values()}
    return out if len(lengths) == 1 else None


def _find_input_sets(module, all_comps):
    """Input and training sets a model declares, in PsyNeuLink's own shapes (#1216).

    No new format: a module-level dict is offered to the Run tab when it has the
    shape ``Composition.run`` takes (``{input_node: [trial, …]}``), and to the
    Learn tab when it has the shape ``Composition.learn`` takes
    (``{"inputs": {…}, "targets": {…}, "epochs": n}``; ``targets`` may be
    left out for a model that learns without them, #997). That's how the course
    notebooks already write their data. Each set is named by its variable and
    tied to the composition whose nodes it uses; declaration order is kept, and
    the first set of each kind is what the tab opens with.
    """
    found = []
    for var_name, value in vars(module).items():
        if var_name.startswith("_") or not isinstance(value, dict):
            continue
        for comp_var, comp in all_comps.items():
            nodes = list(comp.nodes)
            run = _node_trials(value, nodes)
            if run is not None:
                found.append({"name": var_name, "kind": "run", "composition": comp_var, "inputs": run})
                break
            # A model that learns without targets (Hebbian, #997) declares
            # just {"inputs": {...}, "epochs": n}; "targets" is then absent.
            has_targets = isinstance(value.get("targets"), dict)
            if isinstance(value.get("inputs"), dict) and (has_targets or "targets" not in value):
                inputs = _node_trials(value["inputs"], nodes)
                targets = _node_trials(value["targets"], nodes) if has_targets else {}
                if inputs is not None and targets is not None:
                    entry = {"name": var_name, "kind": "learn", "composition": comp_var,
                             "inputs": inputs, "targets": targets}
                    epochs = value.get("epochs")
                    if isinstance(epochs, (int, np.integer)) and epochs > 0:
                        entry["epochs"] = int(epochs)
                    found.append(entry)
                    break
    return found


def _compute_diagnostics(module, compositions, line_map, pnl):
    """Compute diagnostics about the loaded model for the UI.

    Returns a dict with counts, editability info, and warnings.
    """
    # Detect import style and format from the source
    source = ""
    try:
        from pathlib import Path as _P
        if hasattr(module, '__file__'):
            source = _P(module.__file__).read_text()
    except Exception:
        pass

    import_style = "unknown"
    if "import psyneulink as pnl" in source:
        import_style = "standard"
    elif re.search(r"from\s+psyneulink\s+import\s+\*", source):
        import_style = "star"

    is_standardized = source.strip().startswith("# PsyNeuLink Model File")

    # Provenance of the loaded file, if it carries a vendored-from header (#835):
    # which upstream repo/file/commit this model was vendored from, + a GitHub
    # link. None for user files / raw scripts. Generic — works for any bundled
    # example/script that adopts the header, not just today's reference models.
    # sandbox_worker runs both as a package module (in-process) and as a spawned
    # script in the sandbox subprocess, where sys.path[0] is this directory and
    # there is no importable `app` package. Import lineage for both contexts.
    try:
        from app.services.lineage import parse_lineage
    except ModuleNotFoundError:
        from lineage import parse_lineage  # script context: sibling module
    lineage = parse_lineage(source)

    diagnostics = {
        "mechanismCount": 0,
        "projectionCount": 0,
        "compositionCount": len(compositions),
        "editableVars": [],
        "readOnlyVars": [],
        "generatedVars": [],
        # Nodes with no module-level variable at all — written inside another
        # constructor's arguments, so there is no line of their own to edit
        # (#1117). Distinct from readOnlyVars, which *do* have a variable.
        "inlineVars": [],
        "importStyle": import_style,
        "isStandardized": is_standardized,
        "pnlVersion": getattr(pnl, "__version__", "unknown"),
        "lineage": lineage,
        "warnings": [],
        "notices": [],
    }

    # Count mechanisms and projections across all compositions
    comp_names = []
    for comp_data in compositions:
        comp_names.append(comp_data.get("varName") or comp_data.get("name", ""))
        for node in comp_data.get("nodes", []):
            if node.get("kind") == "mechanism":
                diagnostics["mechanismCount"] += 1
        diagnostics["projectionCount"] += len(comp_data.get("projections", []))
    diagnostics["compositionNames"] = comp_names

    # Compute model complexity metrics
    total_params = 0
    max_fan_in = 0
    max_fan_out = 0
    nesting_depth = 0

    def _count_depth(nodes, depth=0):
        nonlocal nesting_depth
        nesting_depth = max(nesting_depth, depth)
        for n in nodes:
            if n.get("kind") == "composition":
                _count_depth(n.get("nodes", []), depth + 1)

    for comp_data in compositions:
        _count_depth(comp_data.get("nodes", []))
        # Count params across all nodes
        for node in comp_data.get("nodes", []):
            total_params += len(node.get("params", {}))
            if node.get("function"):
                total_params += len(node["function"].get("params", {}))
        # Compute fan-in/fan-out per node
        in_count: dict = {}
        out_count: dict = {}
        for proj in comp_data.get("projections", []):
            s = proj.get("sender", {}).get("mechanism", "")
            r = proj.get("receiver", {}).get("mechanism", "")
            out_count[s] = out_count.get(s, 0) + 1
            in_count[r] = in_count.get(r, 0) + 1
        if in_count:
            max_fan_in = max(max_fan_in, max(in_count.values()))
        if out_count:
            max_fan_out = max(max_fan_out, max(out_count.values()))

    diagnostics["complexity"] = {
        "totalParams": total_params,
        "maxFanIn": max_fan_in,
        "maxFanOut": max_fan_out,
        "nestingDepth": nesting_depth,
    }

    if len(compositions) > 1:
        diagnostics["warnings"].append(
            f"File has {len(compositions)} top-level compositions: {', '.join(comp_names)}. "
            f"Use the composition selector in the toolbar to switch between them."
        )

    # Composition objects for role-based classification below.
    comp_objs = _collect_composition_objects(module, pnl)

    # Classify variables as editable (in line_map) vs view-only. Split view-only
    # into framework-generated learning nodes (objective / target / learning
    # mechanisms from add_*_learning_pathway — no user constructor to edit, so
    # view-only by design) vs genuinely non-standard declarations. The former
    # get a calm notice, not a "not matching pattern" warning (#822).
    for attr_name, attr_obj in vars(module).items():
        if attr_name.startswith("_"):
            continue
        if isinstance(attr_obj, (pnl.Mechanism, pnl.Projection)):
            if attr_name in line_map:
                diagnostics["editableVars"].append(attr_name)
            elif isinstance(attr_obj, pnl.Mechanism) and _is_generated_learning_node(
                attr_obj, comp_objs, pnl
            ):
                diagnostics["generatedVars"].append(attr_name)
            else:
                diagnostics["readOnlyVars"].append(attr_name)

    # A node can be in a composition and have no module-level variable at all:
    #
    #     pnl.LCControlMechanism(
    #         objective_mechanism=pnl.ObjectiveMechanism(name='Combine values'),
    #     )
    #
    # The loop above walks `vars(module)`, so such a node lands in none of the
    # three buckets. That is why the panel could report "5 mechanisms — 4
    # editable" and never say what the fifth one was: the count exposed it, but
    # nothing named it (#1117).
    # Names the author typed as `name='...'`, read from the parse tree.
    #
    # Distinguishes a node the user wrote inside a constructor from one the
    # framework assembled: PsyNeuLink builds names like "TARGET for Action
    # Selection" that appear nowhere in the file. A text scan would count a
    # commented-out line, and the comment-blanked view blanks string contents —
    # which is exactly where these names live. The tree has neither problem.
    _named_in_source = set()
    try:
        import ast as _ast

        for _n in _ast.walk(_ast.parse(source)):
            if isinstance(_n, _ast.Call):
                for _kw in _n.keywords:
                    if _kw.arg == "name" and isinstance(_kw.value, _ast.Constant):
                        if isinstance(_kw.value.value, str):
                            _named_in_source.add(_kw.value.value)
    except (SyntaxError, ValueError):
        # Unparseable source means every such node reads as framework-built,
        # which is the safer way to be wrong: it avoids pointing someone at
        # source that may not exist.
        pass

    module_mech_names = set()
    for _obj in vars(module).values():
        if isinstance(_obj, pnl.Mechanism):
            module_mech_names.add(_obj.name)
            module_mech_names.add(re.sub(r"-\d+$", "", _obj.name))

    for _comp in comp_objs:
        for _node in getattr(_comp, "nodes", []):
            if not isinstance(_node, pnl.Mechanism):
                continue
            if isinstance(_node, pnl.CompositionInterfaceMechanism):
                continue
            _clean = re.sub(r"-\d+$", "", _node.name)
            if _node.name in module_mech_names or _clean in module_mech_names:
                continue
            if _node.name in diagnostics["inlineVars"] or _node.name in diagnostics["generatedVars"]:
                continue
            # Same split as above, and the honest thing to say differs: one the
            # user wrote and can edit in the code, the other the framework built
            # and there is no source for at all.
            if _is_generated_learning_node(_node, comp_objs, pnl) or _node.name not in _named_in_source:
                diagnostics["generatedVars"].append(_node.name)
            else:
                diagnostics["inlineVars"].append(_node.name)

    # Detect mechanisms not inside any composition
    all_comp_nodes = set()
    for comp_data in compositions:
        for node in comp_data.get("nodes", []):
            name = node.get("name", "")
            all_comp_nodes.add(name)
            all_comp_nodes.add(re.sub(r'-\d+$', '', name))

    orphan_mechs = []
    for attr_name, attr_obj in vars(module).items():
        if attr_name.startswith("_"):
            continue
        if isinstance(attr_obj, pnl.Mechanism) and not isinstance(attr_obj, pnl.CompositionInterfaceMechanism):
            clean = re.sub(r'-\d+$', '', attr_obj.name)
            if attr_obj.name not in all_comp_nodes and clean not in all_comp_nodes:
                orphan_mechs.append(attr_name)

    if orphan_mechs:
        # Find the composition variable name for the suggestion
        comp_var = None
        for attr_name, attr_obj in vars(module).items():
            if isinstance(attr_obj, pnl.Composition) and not attr_name.startswith("_"):
                comp_var = attr_name
                break
        suggestion = ""
        if comp_var and len(orphan_mechs) <= 3:
            adds = ", ".join(f"{comp_var}.add_node({m})" for m in orphan_mechs)
            suggestion = f" — try: {adds}"
        diagnostics["warnings"].append(
            f"{len(orphan_mechs)} mechanism(s) not in any composition: {', '.join(orphan_mechs)}{suggestion}"
        )

    if diagnostics["readOnlyVars"]:
        diagnostics["warnings"].append(
            f"{len(diagnostics['readOnlyVars'])} variable(s) are view-only "
            f"(not matching 'var = pnl.Type(' pattern): {', '.join(diagnostics['readOnlyVars'][:5])}"
        )

    if diagnostics["inlineVars"]:
        _n = len(diagnostics["inlineVars"])
        _names = ", ".join(diagnostics["inlineVars"][:5])
        _more = "" if _n <= 5 else f" and {_n - 5} more"
        diagnostics["notices"].append(
            (f"{_names}{_more} is written" if _n == 1 else f"{_n} nodes are written")
            + " inside another component's settings, so "
            + ("it has" if _n == 1 else "they have")
            + " no line of "
            + ("its" if _n == 1 else "their")
            + " own to edit from the graph"
            + ("" if _n == 1 else f": {_names}{_more}")
            + ". You can still edit "
            + ("it" if _n == 1 else "them")
            + " in the code editor."
        )

    if diagnostics["generatedVars"]:
        diagnostics["notices"].append(
            f"{len(diagnostics['generatedVars'])} node(s) are generated by a learning "
            f"pathway and are view-only by design: {', '.join(diagnostics['generatedVars'][:5])}"
        )

    # Detect duplicate mechanism names (can cause confusion)
    mech_names = {}
    for attr_name, attr_obj in vars(module).items():
        if attr_name.startswith("_"):
            continue
        if isinstance(attr_obj, pnl.Mechanism):
            clean = re.sub(r'-\d+$', '', attr_obj.name)
            if clean in mech_names:
                diagnostics["warnings"].append(
                    f"Duplicate mechanism name '{clean}': variables '{mech_names[clean]}' and '{attr_name}'"
                )
            mech_names[clean] = attr_name

    # Detect PNL class calls inside function definitions. These nodes are
    # shown and editable in place (#422), so this is an informational notice
    # (not a warning) — surfaced via the calm "notices" channel (#423 follow-up).
    try:
        import ast
        from pathlib import Path
        source = Path(module.__file__).read_text() if hasattr(module, '__file__') else ""
        if source:
            tree = ast.parse(source)
            func_names = []
            pnl_names = {"TransferMechanism", "ProcessingMechanism", "DDM",
                         "RecurrentTransferMechanism", "IntegratorMechanism",
                         "ObjectiveMechanism", "ControlMechanism", "LearningMechanism",
                         "MappingProjection", "Composition", "AutodiffComposition"}
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    for child in ast.walk(node):
                        if isinstance(child, ast.Call):
                            func = child.func
                            name = None
                            if isinstance(func, ast.Attribute):
                                name = func.attr
                            elif isinstance(func, ast.Name):
                                name = func.id
                            if name and name in pnl_names:
                                if node.name not in func_names:
                                    func_names.append(node.name)
                                break
            if func_names:
                where = ", ".join(func_names[:3])
                diagnostics["notices"].append(
                    f"This model builds some nodes inside a function ({where}). "
                    "They're shown and editable here. Heads up: \"Convert to "
                    "Standard Format\" isn't supported for this layout."
                )
    except Exception:
        pass

    return diagnostics


def _version_mismatch_warning(file_version: str, current_version: str) -> str | None:
    """Return a version-mismatch warning, or None when the versions are close
    enough not to matter (#879).

    Only warns on a **major.minor** difference (e.g. 0.18 vs 0.19). Patch/micro
    components and dev/local build suffixes are ignored, so a model written for
    0.19.1 no longer warns against a 0.19.1.0+10.gABC dev build or a 0.19.2 patch
    release — that noise fired for essentially every bundled model against a
    from-source install.
    """
    def _major_minor(v: str) -> str:
        base = v.split("+")[0].split(".dev")[0]
        return ".".join(base.split(".")[:2])

    if not file_version or current_version in ("", "unknown"):
        return None
    if _major_minor(file_version) != _major_minor(current_version):
        return (
            f"Model was written for PsyNeuLink {file_version}, "
            f"but you are running {current_version}."
        )
    return None


def task_introspect(params):
    """Execute a .py file and introspect PsyNeuLink objects."""
    import time
    timings = {}

    t0 = time.time()
    import psyneulink as pnl
    timings["import_pnl"] = time.time() - t0

    from pathlib import Path

    file_path = params["file_path"]
    source = Path(file_path).read_text()

    # Parse header
    header = {}
    for line in source.splitlines():
        line = line.strip()
        if not line.startswith("#"):
            if line:
                break
            continue
        m = re.match(r"#\s*Format Version:\s*(.+)", line)
        if m:
            header["format_version"] = m.group(1).strip()
        m = re.match(r"#\s*PsyNeuLink:\s*(.+)", line)
        if m:
            header["psyneulink_version"] = m.group(1).strip()
        m = re.match(r"#\s*Model:\s*(.+)", line)
        if m:
            header["model_name"] = m.group(1).strip()

    # Version warnings — major.minor only, ignoring patch/dev/local suffixes (#879).
    warnings_list = []
    if header.get("psyneulink_version"):
        _vw = _version_mismatch_warning(
            header["psyneulink_version"], getattr(pnl, "__version__", "unknown")
        )
        if _vw:
            warnings_list.append(_vw)

    # Line map (includes indented function-scoped declarations — #422).
    line_map = _build_declaration_index(source)

    # Record existing Compositions before loading, so we can detect new ones
    # created inside functions (gc fallback for function-scoped Compositions).
    # Holds the objects, not just ids, so a freed one can't lend its id to a
    # Composition this load builds (#1382).
    import gc
    comps_before = _composition_snapshot()

    # Pre-validate syntax before execution (gives precise line numbers)
    try:
        compile(source, file_path, "exec")
    except SyntaxError as e:
        return {
            "compositions": [], "lineMap": line_map, "header": header,
            "error": f"Syntax error: {e.msg}",
            "errorLine": e.lineno,
            "errorCol": e.offset,
        }

    # Execute (with partial introspection on failure).
    # load_module suppresses execution + graphics side effects so we get the
    # model definition quickly without running simulations or opening graph
    # PDFs. When developer_mode is requested (#273 / #249, extracted pytest
    # tests), run_user_code lets the script's .run/.learn calls actually run.
    developer_mode = bool(params.get("developer_mode", False))
    flat = bool(params.get("flat", False))
    pytorch = bool(params.get("pytorch", False))
    t1 = time.time()
    execution_error = None
    skipped_statements = None
    # The warm worker is a long-lived process, so names from a prior load are
    # still in PsyNeuLink's global registry. Re-loading would re-register them
    # and append '-N' suffixes ('STATE' -> 'STATE-1'), surfacing as numbered
    # nodes on the canvas (#642). Clear the registry before each load so names
    # stay clean across repeated opens/reloads.
    pnl.clear_registry()
    try:
        module = load_module(file_path, run_user_code=developer_mode)
    except Exception as e:
        execution_error = str(e)
        # Degrade gracefully (#615). A normal load aborts at the first failing
        # statement, so a single broken one — e.g. a half-finished projection
        # mid-edit referencing an undefined endpoint — stops the Composition
        # from being built and collapses the whole model to "0 mechanisms".
        # Re-run statement-by-statement, skipping only the failing statements,
        # so the valid mechanisms + Composition still render. Clear the
        # registry first: the aborted normal load already registered the
        # objects defined before the error, and re-creating them would -1
        # suffix their names.
        try:
            pnl.clear_registry()
            module, skipped_statements = load_module_resilient(
                file_path, run_user_code=developer_mode
            )
        except Exception:
            module = sys.modules.get("user_model")
        if module is None:
            # Extract line number from traceback if possible
            import traceback
            error_line = None
            for frame in traceback.extract_tb(e.__traceback__):
                if "user_model" in frame.filename or frame.filename == file_path:
                    error_line = frame.lineno
            return {
                "compositions": [], "lineMap": line_map, "header": header,
                "error": execution_error,
                "errorLine": error_line,
                "partialExecution": True,
            }
    timings["exec_module"] = time.time() - t1

    # Introspect
    t2 = time.time()

    # Build projection name lookup: maps (sender_clean, receiver_clean) → var_name
    # For cross-comp projections, also maps (sender, composition_containing_receiver)
    def _clean(name):
        return re.sub(r'-\d+$', '', name) if name else name

    proj_name_lookup = {}
    all_comps = {}  # module-attr name → Composition object
    # Key by module attribute name (the Python variable), NOT comp.name —
    # the route's export endpoint does ``getattr(module, varName)`` to find
    # the live Composition, so the reported varName must be a real attr.
    # The in-process introspector (introspector.py) keys the same way; this
    # branch had drifted to using ``_clean(comp.name)``, which broke export
    # whenever the user's var name differed from comp.name (issue #106).
    for attr_name, attr_obj in vars(module).items():
        if isinstance(attr_obj, pnl.Composition) and not attr_name.startswith("_"):
            all_comps[attr_name] = attr_obj

    # Fallback: if no module-level Compositions found, search via gc.
    # Catches Compositions created inside functions (e.g. library models).
    if not all_comps:
        gc.collect()
        for obj in gc.get_objects():
            if isinstance(obj, pnl.Composition) and id(obj) not in comps_before:
                var_name = _clean(obj.name).replace(" ", "_")
                all_comps[var_name] = obj

    for attr_name, attr_obj in vars(module).items():
        if isinstance(attr_obj, pnl.MappingProjection) and not attr_name.startswith("_"):
            # Use getattr to tolerate projections whose .sender/.receiver
            # attributes haven't been resolved yet — some library models
            # (e.g. Cohen_Huston1994_horse_race, #165) construct projections
            # in a state where attribute access on .sender raises
            # AttributeError. Skip those for the name lookup; they'll still
            # show up under their auto-generated names in the graph.
            sender = getattr(attr_obj, "sender", None)
            receiver = getattr(attr_obj, "receiver", None)
            s = _clean(sender.owner.name) if sender and getattr(sender, "owner", None) else None
            r = _clean(receiver.owner.name) if receiver and getattr(receiver, "owner", None) else None
            if s and r:
                proj_name_lookup[(s, r)] = attr_name
                # Also map (sender, composition_containing_receiver)
                for comp_name, comp_obj in all_comps.items():
                    for node in comp_obj.nodes:
                        if _clean(node.name) == r:
                            proj_name_lookup[(s, comp_name)] = attr_name
                        # And reverse: (composition_containing_sender, receiver)
                        if _clean(node.name) == s:
                            proj_name_lookup[(comp_name, r)] = attr_name

    # Resolve PNL names → local vars now that the module has executed, so
    # function-scoped nodes get stable editable handles (#422).
    name_to_var = _build_name_index(source, vars(module))

    compositions = []
    for name, obj in all_comps.items():
        compositions.append(serialize_composition(name, obj, line_map, proj_name_lookup, name_to_var, flat=flat, pytorch=pytorch))
    timings["introspect"] = time.time() - t2
    timings["total"] = time.time() - t0

    # Print timings to stderr for server logs
    import sys as _sys
    _sys.stderr.write(f"[perf] sandbox introspect: import={timings['import_pnl']:.2f}s "
                      f"exec={timings['exec_module']:.2f}s "
                      f"introspect={timings['introspect']:.2f}s "
                      f"total={timings['total']:.2f}s\n")

    # Compute diagnostics for the UI
    diagnostics = _compute_diagnostics(module, compositions, line_map, pnl)

    result = {"compositions": compositions, "lineMap": line_map, "header": header, "diagnostics": diagnostics}
    try:
        input_sets = _find_input_sets(module, all_comps)
    except Exception:  # never let an optional extra break loading the model
        input_sets = []
    if input_sets:
        result["inputSets"] = input_sets
    if warnings_list:
        result["warnings"] = warnings_list
    if execution_error:
        result["partialExecution"] = True
        # Lines the resilient re-run skipped (#615) — the broken statement(s)
        # that would otherwise have collapsed the whole model.
        if skipped_statements:
            result["skippedStatements"] = skipped_statements
            # #1235: a skipped projection is a connection PsyNeuLink refused to
            # make; say which, between what, and why, so the graph can show it.
            from pathlib import Path as _Path
            try:
                from app.services.dangling_check import find_broken_projections
            except ModuleNotFoundError:
                from dangling_check import find_broken_projections  # script context
            try:
                broken = find_broken_projections(_Path(file_path).read_text(), skipped_statements)
            except OSError:
                broken = []
            if broken:
                result["brokenProjections"] = broken
        if compositions:
            # #796: the model's definition loaded (compositions present). The
            # error is from a skipped module-level driver statement — e.g.
            # accessing run results / log data after the introspector's no-op'd
            # .run() (Kalanthroff_PCTC_2018, Cohen_Huston1994_horse_race). Not a
            # load failure — surface via the calm "notices" channel (not a
            # warning), since a module-level driver is normal for verbatim
            # PsyNeuLink scripts and the model loaded fine (#848). Keeps the
            # partial-execution diagnostics above.
            result.setdefault("notices", []).append(
                "Non-fatal: model definition loaded, but its module-level driver "
                f"raised after the no-op'd run: {execution_error}"
            )
        else:
            result["error"] = execution_error
    if not compositions:
        if not execution_error:
            result["error"] = (
                "No PsyNeuLink Composition found at module scope. "
                "Define one with: comp = pnl.Composition(name='my_model')"
            )
    return result


def describe_load_error(exc, file_path):
    """What went wrong while a model file ran, and where in it (#1235).

    The line is the deepest frame in the model file itself, not in PsyNeuLink,
    so it points at the user's statement that failed.
    """
    import traceback

    frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == file_path]
    where = frames[-1] if frames else None
    return {
        "type": type(exc).__name__,
        "message": str(exc),
        "line": where.lineno if where else None,
        "code": (where.line or "").strip() if where else "",
    }


def missing_composition_error(module, comp_name):
    """The error for a Composition that isn't there, saying why when we know.

    It used to be only "Composition 'X' not found", which is also what a model
    with a shape mismatch said: the file raised while building the Composition,
    the error was tolerated (#796), and the real cause, PsyNeuLink's own
    message naming the projection and the sizes, was thrown away (#1235).
    """
    load_error = getattr(module, "__psyneuview_load_error__", None)
    if not load_error:
        return {"error": f"Composition '{comp_name}' not found"}
    where = f" at line {load_error['line']}" if load_error["line"] else ""
    code = f" ({load_error['code']})" if load_error["code"] else ""
    return {
        "error": (
            f"The model file stopped{where}{code} before building '{comp_name}', "
            f"so there is nothing to run. {load_error['type']}: {load_error['message']}"
        ),
        "errorLine": load_error["line"],
    }


def _resolve_composition(module, comp_name):
    """Find the Composition the client asked to run/learn/graph/inspect.

    The client sends the composition's *display name* (its ``name=`` attribute),
    but a model may store it in a differently-named module variable — e.g. EGO's
    ``EGO_comp = construct_model()[0]`` yields a composition named "EGO" bound to
    the variable ``EGO_comp``. A bare ``getattr(module, comp_name)`` then misses
    it ("Composition 'EGO' not found", a #859-class gap #863 didn't cover). Try
    the attribute first, then fall back to matching any module-scope Composition
    by its ``.name``. Returns the Composition or None.
    """
    import psyneulink as pnl

    comp = getattr(module, comp_name, None)
    if isinstance(comp, pnl.Composition):
        return comp
    for obj in vars(module).values():
        if isinstance(obj, pnl.Composition) and getattr(obj, "name", None) == comp_name:
            return obj
    return None


def task_run(params):
    """Execute a composition with inputs."""
    import psyneulink as pnl

    file_path = params["file_path"]
    comp_name = params["composition_name"]
    inputs = params["inputs"]
    requested_mode = params.get("execution_mode")  # #764

    # Reset the registry so the run's names match the model's real names (not
    # '-2' suffixed by a prior load in this worker), and tolerate a raw library
    # model's post-run driver error so we still reach our own clean run (#796).
    module = load_module(file_path, reset_registry=True, tolerate_exec_error=True)

    comp = _resolve_composition(module, comp_name)
    if comp is None or not isinstance(comp, pnl.Composition):
        return missing_composition_error(module, comp_name)

    # Resolve inputs
    pnl_inputs = {}
    for var_name, values in inputs.items():
        mech = _resolve_input_node(comp, module, var_name)
        if mech is None:
            return {"error": f"Input mechanism '{var_name}' not found"}
        pnl_inputs[mech] = [np.array(v, dtype=float) for v in values]

    # AutodiffComposition (e.g. the Giallanza EGO model) only behaves correctly
    # under .learn() in PyTorch mode; plain .run() fails inside the nested EM
    # machinery (#363). The torch autograd path bypasses PsyNeuLink's scheduler,
    # so node.log / the _debugger hook capture nothing. Instead we instrument the
    # PyTorch wrappers to synthesize the same observability contract the normal
    # path produces, lighting up the stepper / Run State / value pills (#629).
    from app.services.execution_modes import stepping_support
    from app.services.executor import _resolve_run_execution_mode, format_pnl_call

    exec_mode, effective_mode, mode_reason = _resolve_run_execution_mode(pnl, requested_mode)

    if _is_autodiff(comp):
        # devel synthesizes the PyTorch-path observability contract here.
        # #475: still report whether the build exposes the `_debugger` hook so
        # the run panel / trace bar can explain degraded support (the autodiff
        # path never populates snapshots, but hook availability is build-level).
        result = _autodiff_observability(comp, pnl_inputs)
        result["debuggerHookAvailable"] = _debugger_hook_available()
        # This path goes through the torch wrappers regardless of what was
        # asked for, so report PyTorch and say why if it differs (#764).
        result["pnlCall"] = format_pnl_call(
            "run", comp.name, {"inputs": pnl_inputs, "execution_mode": pnl.ExecutionMode.PyTorch}
        )
        result["steppingSupport"] = stepping_support(effective_mode="PyTorch", is_autodiff=True)
        # #768: this path reports capture too, or the Run panel shows "?/?" for
        # every autodiff model. The numbers mean something slightly different
        # here: values are *synthesized* from the torch wrappers rather than
        # logged by the scheduler, and the snapshot caps never apply because
        # the capping listener only runs on the scheduler path — so nothing is
        # dropped, and saying so is the honest answer rather than omitting it.
        _synth_logs = result.get("logs") or {}

        def _loggable(c):
            """Count recursively — the torch wrappers expose nested EM internals
            ("CONTEXT [QUERY]", "STATE [RETRIEVED]"), so a top-level-only
            denominator reads as 16 of 8."""
            total = 0
            for n in getattr(c, "nodes", []) or []:
                if isinstance(n, pnl.Composition):
                    total += _loggable(n)
                elif hasattr(n, "log"):
                    total += 1
            return total

        result["capture"] = {
            "nodesLogged": len(_synth_logs),
            "nodesAvailable": max(len(_synth_logs), _loggable(comp)),
            "nodeNames": sorted(_synth_logs),
            "snapshots": len(result.get("debuggerSnapshots") or []),
            "snapshotsDropped": {"parameterSetting": 0, "global": 0},
            "truncated": False,
            "synthesized": True,
            "caps": {
                "parameterSetting": _MAX_PARAMETER_SETTING_SNAPSHOTS,
                "global": _MAX_DEBUGGER_SNAPSHOTS,
            },
        }
        result["executionMode"] = "PyTorch"
        result["executionModeReason"] = (
            None
            if effective_mode == "PyTorch"
            else f"AutodiffComposition runs under PyTorch; the {effective_mode} selection does not apply."
        )
        return result

    # Enable logging
    # #768: log every node's value by default — that is what the debugger,
    # value pills and Run State all read. `log_nodes` narrows it when a big
    # model makes full capture expensive; None keeps today's behaviour.
    wanted = params.get("log_nodes")
    logged_nodes = []
    for node in comp.nodes:
        if not hasattr(node, "log"):
            continue
        if wanted is not None and node.name not in wanted:
            continue
        node.log.set_log_conditions("value")
        logged_nodes.append(node.name)

    # Run, capturing debugger snapshots if the _debugger hook is available
    # in this PsyNeuLink build. Phase 2A of #247: backend-only wire-up of
    # `_debugger.set_listener` — UI doesn't consume the snapshots yet, but
    # surfacing them in the response unblocks the next iteration.
    # #766: describe the call from the same kwargs the runner uses, so the
    # displayed source and the executed call cannot disagree.
    run_kwargs = {"inputs": pnl_inputs, "execution_mode": exec_mode}
    pnl_call = format_pnl_call("run", comp.name, run_kwargs)

    debugger_snapshots, execution_trial_boundaries, snapshots_dropped = _run_capturing_debugger_snapshots(
        comp, pnl_inputs, execution_mode=exec_mode
    )

    # Collect results
    trial_results = []
    for i, r in enumerate(comp.results):
        trial_results.append({"trial": i, "output": to_json(r)})

    node_logs = {}
    for node in comp.nodes:
        if hasattr(node, "log"):
            try:
                log_dict = node.log.nparray_dictionary()
                for context_name, context_data in log_dict.items():
                    trials = [int(t[0]) for t in context_data.get("Trial", [])]
                    values = context_data.get("value", np.array([]))
                    node_logs[node.name] = {
                        "trials": trials,
                        "values": to_json(values),
                    }
            except Exception:
                pass

    # Capture execution trace from scheduler
    execution_trace = []
    execution_counts = {}
    try:
        eid = comp.default_execution_id
        exec_list = comp.scheduler.execution_list.get(eid, [])
        for step in exec_list:
            step_nodes = []
            for n in step:
                name = re.sub(r'-\d+$', '', n.name) if hasattr(n, 'name') else str(n)
                step_nodes.append(name)
                execution_counts[name] = execution_counts.get(name, 0) + 1
            execution_trace.append(step_nodes)
    except Exception:
        pass

    return {
        "results": trial_results,
        "executionMode": effective_mode,
        "executionModeReason": mode_reason,
        "pnlCall": pnl_call,
        # #767: the trace has to say which mode produced it — stepping means
        # different things under each, and a trace that doesn't say is a trap.
        "steppingSupport": stepping_support(
            effective_mode=effective_mode, is_autodiff=_is_autodiff(comp)
        ),
        # #768: what this run actually captured, including what the caps threw
        # away. A truncated trace that doesn't say so reads as a complete one.
        "capture": {
            "nodesLogged": len(logged_nodes),
            "nodesAvailable": sum(1 for n in comp.nodes if hasattr(n, "log")),
            "nodeNames": logged_nodes,
            "snapshots": len(debugger_snapshots),
            "snapshotsDropped": snapshots_dropped,
            "truncated": any(snapshots_dropped.values()),
            "caps": {
                "parameterSetting": _MAX_PARAMETER_SETTING_SNAPSHOTS,
                "global": _MAX_DEBUGGER_SNAPSHOTS,
            },
        },
        "outputLabels": _output_labels(comp),
        "logs": node_logs,
        "numTrials": len(trial_results),
        "executionTrace": execution_trace,
        "executionTrialBoundaries": execution_trial_boundaries,
        "executionCounts": execution_counts,
        "debuggerSnapshots": debugger_snapshots,
        "debuggerHookAvailable": _debugger_hook_available(),
    }


def task_learn(params):
    """Train a learning-capable composition (#534 L1; non-autodiff #997)."""
    import psyneulink as pnl
    from app.services.pathway_learning import METRICS

    file_path = params["file_path"]
    comp_name = params["composition_name"]
    inputs = params["inputs"]
    targets = params.get("targets") or {}
    epochs = int(params.get("epochs", 10))
    learning_rate = params.get("learning_rate")
    requested_mode = params.get("execution_mode")

    module = load_module(file_path)

    comp = _resolve_composition(module, comp_name)
    if comp is None or not isinstance(comp, pnl.Composition):
        return missing_composition_error(module, comp_name)
    if not _is_autodiff(comp):
        # #997: a plain Composition trains through its learning pathways under
        # Python. One implementation, shared with the in-process executor. In
        # job mode each epoch is its own learn() call and its own progress
        # line, so streaming and cancel work exactly as on the autodiff path.
        from app.services.pathway_learning import learn_pathway_composition

        on_epoch = None
        if params.get("stream_progress"):
            def on_epoch(epoch, value, extra):
                # "loss" keeps its name for old clients; "metric" (in extra)
                # says what it actually measures.
                print(
                    PROGRESS_MARKER
                    + json.dumps({"epoch": epoch, "epochs": epochs, "loss": value, **extra}),
                    flush=True,
                )

        return learn_pathway_composition(
            comp, module, inputs, targets,
            epochs=epochs, learning_rate=learning_rate,
            requested_mode=requested_mode,
            resolve_node=_resolve_input_node, serialize=to_json,
            on_epoch=on_epoch,
        )
    if epochs < 1:
        return {"error": "epochs must be >= 1"}

    pnl_inputs = {}
    for var_name, values in inputs.items():
        mech = _resolve_input_node(comp, module, var_name)
        if mech is None:
            return {"error": f"Input mechanism '{var_name}' not found"}
        pnl_inputs[mech] = [np.array(v, dtype=float) for v in values]

    pnl_targets = {}
    for var_name, values in targets.items():
        mech = _resolve_input_node(comp, module, var_name)
        if mech is None:
            return {"error": f"Target mechanism '{var_name}' not found"}
        pnl_targets[mech] = [np.array(v, dtype=float) for v in values]

    if not pnl_inputs or not pnl_targets:
        return {"error": "Learning requires at least one input and one target"}

    trial_counts = {len(v) for v in pnl_inputs.values()}
    trial_counts |= {len(v) for v in pnl_targets.values()}
    if len(trial_counts) != 1:
        return {"error": "All inputs and targets must supply the same number of trials"}
    num_trials = trial_counts.pop()

    # #765: one implementation, imported — this file used to carry its own copy
    # that silently returned PyTorch for everything, so the two could drift.
    from app.services.executor import _resolve_learn_execution_mode

    exec_mode, effective_mode, mode_reason = _resolve_learn_execution_mode(pnl, requested_mode)
    learn_base = {
        "execution_mode": exec_mode,
        "minibatch_size": 1,
    }
    if learning_rate is not None:
        learn_base["learning_rate"] = float(learning_rate)

    # #766: same principle as the run path — render what we actually pass.
    from app.services.executor import format_pnl_call

    pnl_call = format_pnl_call(
        "learn",
        comp.name,
        {
            "inputs": {"inputs": pnl_inputs, "targets": pnl_targets, "epochs": epochs},
            **learn_base,
        },
    )

    if params.get("stream_progress"):
        # Job mode (#535): drive learn() one epoch at a time — weights and
        # torch_losses persist on the comp across calls — and emit a
        # progress line after each epoch for the job layer to stream.
        epoch_losses = []
        seen_losses = 0
        for e in range(epochs):
            comp.learn(
                inputs={"inputs": pnl_inputs, "targets": pnl_targets, "epochs": 1},
                **learn_base,
            )
            raw = np.asarray(comp.torch_losses, dtype=float).flatten()
            chunk = raw[seen_losses:]
            seen_losses = len(raw)
            loss = float(chunk.mean()) if len(chunk) else None
            epoch_losses.append(loss)
            print(
                PROGRESS_MARKER
                + json.dumps({"epoch": e + 1, "epochs": epochs, "loss": loss, "metric": "loss"}),
                flush=True,
            )
        epoch_losses = [l for l in epoch_losses if l is not None]
    else:
        comp.learn(
            inputs={"inputs": pnl_inputs, "targets": pnl_targets, "epochs": epochs},
            **learn_base,
        )
        # torch_losses holds one entry per optimization step (retained by
        # default); average each epoch's chunk to report a per-epoch loss.
        raw_losses = np.asarray(comp.torch_losses, dtype=float).flatten()
        epoch_losses = []
        if len(raw_losses):
            steps = max(1, len(raw_losses) // epochs)
            for i in range(epochs):
                chunk = raw_losses[i * steps:(i + 1) * steps]
                if len(chunk):
                    epoch_losses.append(float(chunk.mean()))
    final_loss = epoch_losses[-1] if epoch_losses else None

    # comp.results accumulates across all epochs; the last num_trials entries
    # (after the optimization-step stride) are the final-epoch outputs.
    stride = _optimizations_per_minibatch(comp)
    all_results = list(comp.results)[::stride]
    final_results = all_results[-num_trials:]
    trial_results = [
        {"trial": i, "output": to_json(r)} for i, r in enumerate(final_results)
    ]

    return {
        "finalLoss": final_loss,
        "epochLosses": epoch_losses,
        "epochs": epochs,
        "learningRate": learning_rate,
        "numTrials": num_trials,
        "results": trial_results,
        "executionMode": effective_mode,
        "executionModeReason": mode_reason,
        "pnlCall": pnl_call,
        # #997: name what epochLosses measure, so the UI labels it honestly.
        "learningKind": "autodiff",
        "metric": METRICS["loss"],
    }


# Cap snapshot list size to bound memory on pathological runs.
_MAX_DEBUGGER_SNAPSHOTS = 10000

# PARAMETER_SETTING fires on every internal parameter write during execution.
# These names are per-execution bookkeeping with no analytical value to the
# UI; dropping them turns ~500 firings in a trivial 2-trial run into a handful
# of meaningful ones (weights, user-set params). First-pass denylist — the
# UI-consumer contract (#464) will refine it.
# Even after the denylist, PARAMETER_SETTING dwarfs every other category
# (~1000+ kept writes in a 2-trial Stroop run). Cap it on its own so it can't
# consume the global snapshot budget and starve the low-volume categories that
# trace stepping depends on (EXECUTION_SET / NODE_EXECUTION / run+trial
# boundaries). #464 will replace this coarse cap with real relevance filtering.
_MAX_PARAMETER_SETTING_SNAPSHOTS = 500

_PARAMETER_SETTING_DENYLIST = frozenset({
    "value",
    "variable",
    "previous_value",
    "execution_count",
    "num_executions",
    "num_executions_before_finished",
    "is_finished_flag",
})


def _debugger_hook_available() -> bool:
    """True when this PsyNeuLink build ships the `_debugger` hook.

    The run response carries this so the frontend can explain *why* per-node
    values / snapshots are missing on stock builds (#475) rather than looking
    silently broken. Mirrors the import guard in
    ``_run_capturing_debugger_snapshots``.
    """
    try:
        import psyneulink._debugger  # noqa: F401
    except Exception:
        return False
    return True


def _run_capturing_debugger_snapshots(comp, pnl_inputs, execution_mode=None):
    """Run ``comp`` with a ``_debugger`` listener attached.

    Returns ``(snapshots, trial_boundaries)`` where ``trial_boundaries`` is a
    list of step indices into ``executionTrace`` at which a new trial starts
    (``[0, n0, n0+n1, ...]``). Falls back to ``([], [0])`` if the PsyNeuLink
    build doesn't ship the ``_debugger`` module yet — that keeps older PNL
    pinnings working unchanged; the frontend treats a single-element list as
    "no per-trial nav available" and hides the trial-step buttons.

    Snapshots are intentionally small dicts: one per fired category, JSON-clean,
    tagged with the current trial number. ``trial_num`` is threaded through a
    closure variable because ``EXECUTION_SET`` / ``NODE_EXECUTION`` don't carry
    it in their locals (only ``BEGINNING_OF_TRIAL`` / ``END_OF_TRIAL`` do).
    """
    run_kwargs = {"inputs": pnl_inputs}
    if execution_mode is not None:
        run_kwargs["execution_mode"] = execution_mode

    # #768: both caps below drop snapshots silently. Count what they discard so
    # the response can say the trace is truncated rather than letting a partial
    # capture read as a complete one.
    dropped = {"parameterSetting": 0, "global": 0}

    try:
        from psyneulink import _debugger
    except ImportError:
        comp.run(**run_kwargs)
        return [], [0], dropped

    snapshots = []
    current_trial = [None]
    # EXECUTION_SET firings map 1:1 to executionTrace steps (Phase 2C, #308),
    # so counting them gives us the step index that a BEGINNING_OF_TRIAL
    # introduces.
    step_count = [0]
    trial_boundaries = []
    param_setting_count = [0]

    def listener(category, locals_provider):
        if category is _debugger.BreakpointCategory.BEGINNING_OF_TRIAL:
            trial_boundaries.append(step_count[0])
        elif category is _debugger.BreakpointCategory.EXECUTION_SET:
            step_count[0] += 1

        # Stop building PARAMETER_SETTING snapshots once its own cap is hit,
        # before the (relatively expensive) build — protects the global budget.
        if (category is _debugger.BreakpointCategory.PARAMETER_SETTING
                and param_setting_count[0] >= _MAX_PARAMETER_SETTING_SNAPSHOTS):
            dropped["parameterSetting"] += 1
            return
        if len(snapshots) >= _MAX_DEBUGGER_SNAPSHOTS:
            dropped["global"] += 1
            return
        try:
            snap = _build_snapshot(category, locals_provider, current_trial)
        except Exception:
            # A buggy locals build must not poison the run.
            return
        if snap is not None:
            snapshots.append(snap)
            # Count only kept (non-denylisted) writes toward the cap.
            if category is _debugger.BreakpointCategory.PARAMETER_SETTING:
                param_setting_count[0] += 1

    _debugger.set_listener(listener)
    try:
        comp.run(**run_kwargs)
    finally:
        _debugger.set_listener(None)
    # If the hook is installed but no BEGINNING_OF_TRIAL fired (e.g. a build
    # that only emits the leaf categories), still return a sane single-trial
    # boundary so the frontend sees a consistent shape.
    if not trial_boundaries:
        trial_boundaries = [0]
    return snapshots, trial_boundaries, dropped


def _build_snapshot(category, locals_provider, current_trial):
    """Build one snapshot dict for a fired category, or ``None`` to skip."""
    from psyneulink import _debugger

    name = category.name  # stable enum identifier, e.g. "NODE_EXECUTION"

    if category is _debugger.BreakpointCategory.BEGINNING_OF_TRIAL:
        locs = locals_provider()
        current_trial[0] = locs.get("trial_num")
        return {"category": name, "trial_num": current_trial[0]}

    if category is _debugger.BreakpointCategory.END_OF_TRIAL:
        locs = locals_provider()
        outputs = locs.get("outputs")
        # PsyNeuLink builds disagree on the shape of ``outputs`` here:
        # current jonhanke-dev passes ``get_output_values()`` (an ndarray),
        # the expanded-categories branch (#250 follow-up) passes a
        # ``{node: value}`` dict. Handle both so this works across pinnings.
        if hasattr(outputs, "items"):
            serialized = {_node_name(n): to_json(v) for n, v in outputs.items()}
        else:
            serialized = to_json(outputs)
        return {
            "category": name,
            "trial_num": locs.get("trial_num"),
            "outputs": serialized,
        }

    if category is _debugger.BreakpointCategory.EXECUTION_SET:
        locs = locals_provider()
        return {
            "category": name,
            "trial_num": current_trial[0],
            "execution_set": [_node_name(n) for n in (locs.get("execution_set") or ())],
        }

    if category is _debugger.BreakpointCategory.NODE_EXECUTION:
        locs = locals_provider()
        node = locs.get("node")
        context = locs.get("context")
        return {
            "category": name,
            "trial_num": current_trial[0],
            "node": _node_name(node) if node is not None else None,
            "output": _safe_node_value(node, context),
        }

    # --- Categories below were dropped by the original spike (#247) and are
    #     restored here (#460). The frontend snapshot table renders all of
    #     these generically: `node` / `execution_set` feed the "node" column,
    #     `output` / `outputs` feed the "output" column, and `trial_num` feeds
    #     the "trial" column. Keep every payload JSON-clean (via `to_json`)
    #     and small.

    if category is _debugger.BreakpointCategory.INPUTS_TO_NODE:
        # Fires once per node, just before `node.execute`, carrying the inputs
        # the node is about to receive. locals: {node, execution_set,
        # scheduler, context}.
        locs = locals_provider()
        node = locs.get("node")
        context = locs.get("context")
        return {
            "category": name,
            "trial_num": current_trial[0],
            "node": _node_name(node) if node is not None else None,
            "output": _safe_node_input(node, context),
        }

    if category is _debugger.BreakpointCategory.END_OF_EXECUTION_SET:
        # locals: {execution_set, scheduler, context,
        #          outputs: {node: get_output_values(context)}}.
        locs = locals_provider()
        outputs = locs.get("outputs") or {}
        return {
            "category": name,
            "trial_num": current_trial[0],
            "execution_set": [_node_name(n) for n in (locs.get("execution_set") or ())],
            "outputs": {_node_name(n): to_json(v) for n, v in outputs.items()},
        }

    if category is _debugger.BreakpointCategory.PARAMETER_SETTING:
        # The highest-volume category by far (~500 firings in a trivial
        # 2-trial run). Most are internal per-execution bookkeeping the UI
        # can't use; we drop those via `_PARAMETER_SETTING_DENYLIST` and keep
        # the meaningful ones (weights/`matrix`, user-set params, etc.).
        # locals: {parameter, owner, value, context}. `parameter` is a
        # Parameter (has `.name`); `owner` is its Parameters container whose
        # `_owner` is the component. NOTE: this denylist is a first-pass
        # filter and is the contract #464 (UI consumer) builds on — revisit
        # the exact list there.
        locs = locals_provider()
        param = locs.get("parameter")
        pname = getattr(param, "name", None)
        if pname in _PARAMETER_SETTING_DENYLIST:
            return None
        owner = locs.get("owner")
        component = getattr(owner, "_owner", None)
        cname = _node_name(component) if component is not None else None
        label = f"{cname}.{pname}" if cname and pname else (pname or cname)
        return {
            "category": name,
            "trial_num": current_trial[0],
            "node": label,
            "parameter": pname,
            "output": to_json(locs.get("value")),
        }

    if category is _debugger.BreakpointCategory.BEGINNING_OF_RUN:
        # Fires before the first trial, so `current_trial` isn't set yet.
        # locals: {scheduler, context, num_trials}.
        locs = locals_provider()
        return {
            "category": name,
            "trial_num": None,
            "output": {"num_trials": to_json(locs.get("num_trials"))},
        }

    if category is _debugger.BreakpointCategory.END_OF_RUN:
        # locals: {scheduler, context, results}. `results` is the full nested
        # run output; the table truncates the preview and keeps the rest on
        # hover.
        locs = locals_provider()
        return {
            "category": name,
            "trial_num": current_trial[0],
            "output": to_json(locs.get("results")),
        }

    if category is _debugger.BreakpointCategory.EXCEPTION:
        # locals: {exception, scheduler, context, trial_num}.
        locs = locals_provider()
        return {
            "category": name,
            "trial_num": locs.get("trial_num"),
            "output": str(locs.get("exception")),
        }

    if category is _debugger.BreakpointCategory.END_OF_INIT:
        # Fires at the end of every `Component.__init__`. During a run this is
        # rare (components are already built), but capture it for the cases
        # that do construct components mid-run (e.g. learning machinery).
        # locals: {component}.
        locs = locals_provider()
        component = locs.get("component")
        return {
            "category": name,
            "trial_num": current_trial[0],
            "node": _node_name(component) if component is not None else None,
        }

    if category is _debugger.BreakpointCategory.PYTORCH_STEP:
        # Only fires for AutodiffComposition (PyTorch backend).
        # locals: {wrapper, composition}.
        locs = locals_provider()
        comp = locs.get("composition")
        return {
            "category": name,
            "trial_num": current_trial[0],
            "node": _node_name(comp) if comp is not None else None,
        }

    # Any future category we don't recognize yet: skip rather than guess.
    return None


def _node_name(node):
    """Match the executionTrace normalization: strip trailing ``-N`` suffix."""
    if node is None:
        return None
    raw = node.name if hasattr(node, "name") else str(node)
    return re.sub(r"-\d+$", "", raw)


def _safe_node_input(node, context):
    """Return the inputs a node is about to receive, JSON-clean, or ``None``.

    Used by INPUTS_TO_NODE, which fires just before ``node.execute``. Prefers
    the public ``get_input_values`` API and falls back to the raw ``variable``
    parameter for builds/nodes that don't expose it.
    """
    if node is None:
        return None
    try:
        val = node.get_input_values(context)
    except Exception:
        try:
            val = node.parameters.variable._get(context)
        except Exception:
            return None
    return to_json(val)


def _safe_node_value(node, context):
    """Return the node's most recent value, JSON-clean, or ``None`` on failure."""
    if node is None:
        return None
    try:
        val = node.parameters.value._get(context)
    except Exception:
        try:
            val = node.value
        except Exception:
            return None
    return to_json(val)


def _output_labels(comp):
    """Friendly label for each composition output vector (#632).

    Each row of ``comp.results`` is the ``output_CIM`` port values in port order;
    this returns a parallel list naming each vector by its source node, prefixed
    with the containing composition when the source lives in a nested one (e.g.
    EGO's EM retrievals -> ``EM: CONTEXT [RETRIEVED]``). Falls back to a cleaned
    port name, then to ``output[i]`` — a labeling failure must never break a run.
    """
    try:
        cim = comp.output_CIM
        ports = list(cim.output_ports)
    except Exception:
        return []
    labels = []
    for i, port in enumerate(ports):
        label = None
        try:
            # (source_port, source_node, source_comp); traces nested CIMs.
            _src_port, src_node, src_comp = cim._get_source_info_from_output_CIM(port)
            node_name = _node_name(src_node)
            if src_comp is not None and src_comp is not comp:
                label = f"{_node_name(src_comp)}: {node_name}"
            else:
                label = node_name
        except Exception:
            raw = getattr(port, "name", "") or ""
            raw = re.sub(r"^OUTPUT_CIM_", "", raw)
            raw = re.sub(r"_OutputPort-\d+$", "", raw)
            label = raw or None
        labels.append(label or f"output[{i}]")
    return labels


def task_get_input_nodes(params):
    """Get input nodes for a composition.

    Uses PsyNeuLink's own ``NodeRole.INPUT`` classification (after analyzing
    the graph) rather than counting incoming projections. The projection-count
    heuristic mis-handled models with BIAS or learning machinery — e.g. it
    surfaced the ``[BIAS]`` node and dropped the real input on the Giallanza
    EGO model (#363). Sub-compositions are never listed — only mechanisms.
    """
    import psyneulink as pnl

    file_path = params["file_path"]
    comp_name = params["composition_name"]

    # Same resilience as task_run: reset names to the model's real ones and
    # tolerate a raw library model's post-run driver error, so the Run panel
    # can list inputs for models that would otherwise fail to load here (#796).
    module = load_module(file_path, reset_registry=True, tolerate_exec_error=True)

    comp = _resolve_composition(module, comp_name)
    if comp is None or not isinstance(comp, pnl.Composition):
        return missing_composition_error(module, comp_name)

    # Node roles are computed lazily, so analyze the graph before querying.
    try:
        comp._analyze_graph()
    except Exception:
        pass

    from app.services.pathway_learning import is_generated_learning_node

    input_nodes = []
    for node in comp.get_nodes_by_role(pnl.NodeRole.INPUT):
        # Skip sub-compositions — only list mechanisms as input nodes
        if isinstance(node, pnl.Composition):
            continue
        # #1383: a learning pathway's TARGET is an INPUT node to PsyNeuLink,
        # but a run takes no targets; PsyNeuLink fills it with its default.
        if is_generated_learning_node(comp, node):
            continue
        var_name = None
        for name, obj in vars(module).items():
            if obj is node:
                var_name = name
                break
        shape = list(node.input_ports[0].defaults.value.shape) if node.input_ports else []
        input_nodes.append({
            "name": node.name,
            "varName": var_name or node.name,
            "shape": shape,
        })

    return {"inputNodes": input_nodes}


def task_show_graph(params):
    """Render a composition's show_graph() output as SVG.

    Uses PsyNeuLink's built-in GraphViz visualization. Requires the
    ``graphviz`` Python package and the Graphviz system executables.
    """
    import psyneulink as pnl

    file_path = params["file_path"]
    comp_name = params["composition_name"]
    options = params.get("options", {})

    module = load_module(file_path)

    comp = _resolve_composition(module, comp_name)
    if comp is None or not isinstance(comp, pnl.Composition):
        return missing_composition_error(module, comp_name)

    # show_pytorch is an AutodiffComposition-only kwarg; a plain Composition's
    # show_graph rejects it outright (at any value), so drop it for non-autodiff
    # comps rather than forward an unrecognized argument (#437).
    if not isinstance(comp, pnl.AutodiffComposition):
        options.pop("show_pytorch", None)

    try:
        import graphviz as gv
        # Use 'source' format to get the final DOT with all colors applied,
        # then render to SVG. The 'gv' format returns an intermediate object
        # that may not have role-based colors (green/red/purple) applied.
        dot_source = comp.show_graph(output_fmt='source', **options)
        svg_bytes = gv.Source(dot_source).pipe(format='svg')
        return {"svg": svg_bytes.decode('utf-8')}
    except Exception as e:
        return {"error": f"show_graph failed: {e}"}


def task_export_mdf(params):
    """Serialize a Composition as MDF JSON or YAML.

    Delegates to ``psyneulink.core.globals.mdf.get_mdf_serialized``, which
    accepts one or more disjoint Compositions and returns the MDF text.

    Note: PsyNeuView-specific metadata injection (issue #86) happens
    in-process in the route, not here, because the sandbox subprocess
    does not have ``app`` on its import path.
    """
    import psyneulink as pnl
    from psyneulink.core.globals.mdf import get_mdf_serialized

    file_path = params["file_path"]
    comp_name = params["composition_name"]
    fmt = params.get("fmt", "yaml")
    if fmt not in ("json", "yaml", "yml"):
        return {"error": f"Unsupported MDF format: {fmt!r}. Use 'json' or 'yaml'."}

    module = load_module(file_path)
    comp = _resolve_composition(module, comp_name)
    if comp is None or not isinstance(comp, pnl.Composition):
        return missing_composition_error(module, comp_name)

    try:
        text = get_mdf_serialized(comp, fmt=fmt)
    except Exception as e:
        return {"error": f"MDF export failed: {e}"}
    return {"text": text, "fmt": fmt}



# Known MDF round-trip gaps, checked on the live Composition before an MDF
# export (#83, #84, #85, #87; #82 nested Compositions and PsyNeuLink#7
# graph-structure conditions are warned about from the graph data). Each gap
# is pinned in tests/mdf; the upstream issue says what a fix would need.
MDF_GAP_UPSTREAM = {
    83: "https://github.com/jonhanke-nam/PsyNeuLink/issues/4",
    84: "https://github.com/jonhanke-nam/PsyNeuLink/issues/5",
    85: "https://github.com/jonhanke-nam/PsyNeuLink/issues/6",
}

# Scheduler Conditions that break on an MDF round-trip, measured by exporting,
# regenerating and running each one (tests/mdf/test_condition_round_trip.py):
# a Python function can't be written to MDF (the regenerated script is a
# syntax error), and WhenFinishedAny/All crash the import. Timing, call-count,
# composite (All/Any/Not), JustRan, WhenFinished and termination conditions
# come back and run the same.
MDF_UNSAFE_CONDITIONS = {
    "Condition": "a Python function, which MDF can't hold; the imported script won't run",
    "While": "a Python function, which MDF can't hold; the imported script won't run",
    "WhileNot": "a Python function, which MDF can't hold; the imported script won't run",
    "When": "a Python function, which MDF can't hold; the imported script won't run",
    "NWhen": "a Python function, which MDF can't hold; the imported script won't run",
    "WhenFinishedAny": "the import fails",
    "WhenFinishedAll": "the import fails",
}


def _mdf_shared_nodes(module, comp):
    """#83: nodes of ``comp`` that another Composition in the model also holds.

    MDF writes each Composition on its own, so a node two Compositions share
    comes back as two separate copies and anything they shared is lost.
    """
    import psyneulink as pnl

    others = [
        v for v in vars(module).values()
        if isinstance(v, pnl.Composition) and v is not comp and comp not in v.nodes
    ]
    shared = []
    for node in comp.nodes:
        if isinstance(node, pnl.Composition):
            continue
        holders = [o.name for o in others if node in o.nodes]
        if holders:
            shared.append(f"{node.name} (also in {', '.join(sorted(holders))})")
    return shared


def _mdf_matrix_2d_variable_projections(comp):
    """#84: projections whose MatrixTransform has a 2D variable.

    PsyNeuLink's exporter keeps only the last row of such a variable
    (projection.py, "2d variable on MatrixTransform will be incorrect on
    import"), so the imported projection computes something else.
    """
    import numpy as np

    found = []
    for proj in getattr(comp, "projections", []):
        func = getattr(proj, "function", None)
        if func is None or type(func).__name__ != "MatrixTransform":
            continue
        try:
            if func._is_identity(defaults=True):
                continue
        except Exception:
            pass
        shape = np.shape(getattr(proj.defaults, "variable", None))
        if len(shape) >= 2 and shape[0] > 1:
            found.append(f"{proj.name} (variable {shape[0]}×{shape[1]})")
    return found


def _mdf_unsafe_condition_reasons(cond):
    """Why ``cond`` (or a condition inside it) won't survive MDF; [] when it will."""
    reasons = []
    name = type(cond).__name__
    if name in MDF_UNSAFE_CONDITIONS:
        reasons.append(f"{name}: {MDF_UNSAFE_CONDITIONS[name]}")
    elif name == "Threshold":
        dep = getattr(cond, "dependency", None)
        param = getattr(cond, "parameter", None)
        # Measured: a Threshold on a Port breaks the import. One on a node's
        # value breaks too when MDF has to rewrite the node's name into an
        # identifier ("my input" -> "my_input"), since the reference to the
        # value keeps the old name. One on a node's variable comes back.
        dep_name = str(getattr(dep, "name", dep))
        if not hasattr(dep, "input_ports"):
            reasons.append(f"Threshold on the port {dep_name}: the import fails")
        elif param != "variable" and not dep_name.isidentifier():
            reasons.append(
                f"Threshold on {dep_name}'s {param}: the imported script fails "
                f"(the name isn't a plain identifier, so MDF renames the node)"
            )
    for arg in getattr(cond, "args", ()) or ():
        if hasattr(arg, "is_satisfied"):
            reasons.extend(_mdf_unsafe_condition_reasons(arg))
    return reasons


def _mdf_unsafe_conditions(comp):
    """#85: scheduler conditions in ``comp`` that won't survive an MDF round-trip."""
    found = []
    sched = getattr(comp, "scheduler", None)
    if sched is None:
        return found
    conds = getattr(sched.conditions, "conditions", {}) or {}
    for node, cond in conds.items():
        for reason in _mdf_unsafe_condition_reasons(cond):
            found.append(f"{getattr(node, 'name', node)} — {reason}")
    for scale, cond in (getattr(sched, "termination_conds", None) or {}).items():
        for reason in _mdf_unsafe_condition_reasons(cond):
            found.append(f"end of {getattr(scale, 'name', scale).lower()} — {reason}")
    return found


def _mdf_random_noise_nodes(comp):
    """#87: stateful nodes whose noise is drawn at random.

    Measured against MDF's reference engine (modeci_mdf): deterministic
    stateful nodes — six integrator kinds, chains, constant noise — give the
    same numbers as PsyNeuLink, but random noise doesn't. The engine draws
    the noise once and adds that same value every step. PsyNeuLink itself
    re-imports the file and runs it the same, so this only matters to other
    MDF tools.
    """
    import psyneulink as pnl

    def is_random(noise):
        if isinstance(noise, (list, tuple)):
            return any(is_random(n) for n in noise)
        return isinstance(noise, pnl.Function) or callable(noise)

    found = []
    for node in comp.nodes:
        funcs = [getattr(node, "function", None), getattr(node, "integrator_function", None)]
        stateful = [f for f in funcs if isinstance(f, pnl.StatefulFunction)]
        noises = [getattr(f, "noise", None) for f in stateful] + [getattr(node, "noise", None)]
        if stateful and any(is_random(n) for n in noises if n is not None):
            found.append(node.name)
    return found


def find_mdf_gaps(module, comp):
    """Every known MDF round-trip gap in ``comp``, as warnings for the export dialog."""
    gaps = []
    shared = _mdf_shared_nodes(module, comp)
    if shared:
        gaps.append({
            "issue": 83, "upstream": MDF_GAP_UPSTREAM[83], "severity": "warning",
            "title": "Shared components come back as separate copies",
            "detail": "MDF writes each Composition on its own, so a component two Compositions share is re-created once per Composition on import; anything they shared (state, learned weights) is no longer shared.",
            "items": shared,
        })
    matrix2d = _mdf_matrix_2d_variable_projections(comp)
    if matrix2d:
        gaps.append({
            "issue": 84, "upstream": MDF_GAP_UPSTREAM[84], "severity": "warning",
            "title": "Some projections will compute something else after import",
            "detail": "PsyNeuLink's MDF export keeps only the last row of a projection's 2D variable, so these projections change on import.",
            "items": matrix2d,
        })
    unsafe = _mdf_unsafe_conditions(comp)
    if unsafe:
        gaps.append({
            "issue": 85, "upstream": MDF_GAP_UPSTREAM[85], "severity": "warning",
            "title": "Some scheduler conditions won't survive the round-trip",
            "detail": "These conditions can't be read back from MDF; the rest of this model's conditions come back and run the same.",
            "items": unsafe,
        })
    noisy = _mdf_random_noise_nodes(comp)
    if noisy:
        gaps.append({
            "issue": 87, "upstream": None, "severity": "info",
            "title": "Random noise: other MDF tools will give different numbers",
            "detail": "These components add random noise while they integrate. PsyNeuLink re-imports the file and runs it the same, but MDF's reference engine draws the noise once and reuses it, so a non-PsyNeuLink MDF tool won't match.",
            "items": noisy,
        })
    return gaps


def task_mdf_gaps(params):
    """The known MDF round-trip gaps in a model's Composition (#83-#87)."""
    import psyneulink as pnl

    # A fresh name registry, so the warnings name components as the model
    # does ("shared", not "shared-1" after an earlier load in this worker).
    module = load_module(params["file_path"], reset_registry=True)
    comp = _resolve_composition(module, params["composition_name"])
    if comp is None or not isinstance(comp, pnl.Composition):
        return {"error": f"Composition '{params['composition_name']}' not found"}
    return {"gaps": find_mdf_gaps(module, comp)}


def _resolve_cim(mech, comp, direction):
    """Resolve a CompositionInterfaceMechanism to the visible node.

    For cross-composition projections, PsyNeuLink routes through CIM nodes.
    This function traces through them to find the actual visible mechanism.

    - If mech is an Input_CIM of a nested composition: return the composition name
      (the edge should point to the group node)
    - If mech is an Output_CIM of a nested composition: return the composition name
    - Otherwise: return the mechanism name as-is
    """
    import psyneulink as pnl

    if not hasattr(pnl, 'CompositionInterfaceMechanism'):
        return mech.name if mech else None

    if not isinstance(mech, pnl.CompositionInterfaceMechanism):
        return mech.name if mech else None

    # This CIM belongs to a nested composition — find which one
    for node in comp.nodes:
        if isinstance(node, pnl.Composition):
            if mech is node.input_CIM or mech is node.output_CIM:
                return node.name

    # Fallback: return the CIM name (shouldn't happen normally)
    return mech.name if mech else None


def _get_node_roles(comp, node):
    """Get the set of role names for a node in a composition."""
    try:
        roles = comp.get_roles_by_node(node)
        return sorted(r.name for r in roles) if roles else []
    except Exception:
        return []


def _ensure_graph_analyzed(comp):
    """Ensure composition graph has been analyzed so roles are populated."""
    try:
        comp._analyze_graph()
    except Exception:
        pass


def _is_autodiff(comp) -> bool:
    """True if ``comp`` is an AutodiffComposition (learning via PyTorch).

    Imported lazily because AutodiffComposition lives in the library and is
    absent from older PsyNeuLink builds.
    """
    try:
        from psyneulink.library.compositions import AutodiffComposition
    except Exception:
        return False
    return isinstance(comp, AutodiffComposition)


def _optimizations_per_minibatch(comp) -> int:
    """How many optimization steps ``learn()`` runs per input trial (>= 1)."""
    try:
        n = int(comp.parameters.optimizations_per_minibatch.default_value)
        return n if n >= 1 else 1
    except Exception:
        return 1


def _autodiff_observability(comp, pnl_inputs):
    """Run an AutodiffComposition under PyTorch and synthesize the scheduler
    path's observability contract (#629).

    The model executes as a compiled PyTorch module, so ``node.log`` and the
    ``_debugger`` hook capture nothing. We wrap ``PytorchMechanismWrapper.execute``
    to record per-node output tensors during the single ``learn()`` call, then
    synthesize ``executionTrace`` / ``executionTrialBoundaries`` / ``logs`` /
    ``debuggerSnapshots`` from the wrapper's feedforward ``execution_sets``. The
    frontend stepper, Run State panel, value pills, and snapshot table consume
    this identically to a normal run — no frontend changes needed.

    Per-node values are aligned to trials by taking the FIRST optimization step
    of each trial, mirroring how ``comp.results`` is strided
    (``results[::optimizations_per_minibatch]``) so the stepper stays consistent
    with the displayed outputs.

    Any failure degrades to results-only — a run must never break.
    """
    import psyneulink as pnl

    stride = _optimizations_per_minibatch(comp)

    # Capture per-node outputs by wrapping the PyTorch wrapper's execute(). PNL
    # calls execute() directly (not __call__), so nn.Module forward hooks don't
    # fire — a method wrap does. Patch the class for the duration of the single
    # learn(), then restore.
    captures = {}  # node_name -> [squeezed value per execute() call]
    patched = None
    try:
        from psyneulink.library.compositions.pytorchwrappers import (
            PytorchMechanismWrapper,
        )

        orig_execute = PytorchMechanismWrapper.execute

        def _capturing_execute(self, *args, **kwargs):
            out = orig_execute(self, *args, **kwargs)
            try:
                mech = getattr(self, "mechanism", None) or getattr(self, "_mechanism", None)
                name = _node_name(mech) if mech is not None else None
                if name is not None and hasattr(out, "detach"):
                    captures.setdefault(name, []).append(np.squeeze(out.detach().cpu().numpy()))
            except Exception:
                pass
            return out

        PytorchMechanismWrapper.execute = _capturing_execute
        patched = (PytorchMechanismWrapper, orig_execute)
        comp.learn(inputs=pnl_inputs, execution_mode=pnl.ExecutionMode.PyTorch, minibatch_size=1)
    finally:
        if patched is not None:
            patched[0].execute = patched[1]

    # Results — identical to the prior results-only behavior.
    trial_results = [
        {"trial": i, "output": to_json(r)}
        for i, r in enumerate(list(comp.results)[::stride])
    ]
    num_trials = len(trial_results)
    output_labels = _output_labels(comp)

    results_only = {
        "results": trial_results,
        "outputLabels": output_labels,
        "logs": {},
        "numTrials": num_trials,
        "executionTrace": [],
        "executionTrialBoundaries": [0],
        "executionCounts": {},
        "debuggerSnapshots": [],
    }

    rep = getattr(comp, "pytorch_representation", None)
    exec_sets = getattr(rep, "execution_sets", None) if rep is not None else None
    if not exec_sets or num_trials == 0 or not captures:
        return results_only

    # Per-node, per-trial value: first optimization step of each trial (matches
    # results[::stride]). Nodes execute a different number of times per trial
    # (state nodes once, others once per optimization step), so derive the block
    # size per node rather than assuming the global stride.
    per_trial = {}  # node_name -> [JSON-clean value per trial]
    for name, vals in captures.items():
        if not vals:
            continue
        block = max(1, len(vals) // num_trials)
        per_trial[name] = [to_json(vals[min(t * block, len(vals) - 1)]) for t in range(num_trials)]

    # Ordered, non-empty execution sets -> per-step node-name lists (one trial's
    # worth). EMComposition internals are expanded here, giving a full feedforward
    # trace (match -> retrieve -> store -> predict).
    step_names = []
    for s in exec_sets:
        names = []
        for w in s:
            mech = getattr(w, "mechanism", None) or getattr(w, "_mechanism", None)
            nm = _node_name(mech) if mech is not None else None
            if nm:
                names.append(nm)
        if names:
            step_names.append(names)

    # PsyNeuLink 0.19 includes the LOSS node in the autodiff execution sets, so it
    # shows up as a trace step. But the loss runs in the loss/backward path, not the
    # forward `execute` we capture, so it has no forward-activation value. Its output
    # IS the per-trial loss, which PsyNeuLink records in `comp.torch_losses` (one
    # entry per trial for this minibatch_size=1 run). Populate the single loss node's
    # value so the LOSS step carries its loss in the stepper instead of None (#840).
    try:
        torch_losses = np.asarray(getattr(comp, "torch_losses", None) or [], dtype=float).flatten()
    except Exception:
        torch_losses = np.asarray([])
    if len(torch_losses) == num_trials:
        loss_nodes = [
            nm
            for nm in {n for step in step_names for n in step}
            if nm.startswith("LOSS for ") and nm not in per_trial
        ]
        if len(loss_nodes) == 1:
            per_trial[loss_nodes[0]] = [
                to_json(float(torch_losses[t])) for t in range(num_trials)
            ]

    if not step_names:
        return results_only

    execution_trace = []
    execution_counts = {}
    snapshots = []
    trial_boundaries = []
    capped = False
    for t in range(num_trials):
        trial_boundaries.append(len(execution_trace))
        snapshots.append({"category": "BEGINNING_OF_TRIAL", "trial_num": t, "source": "pytorch"})
        for names in step_names:
            execution_trace.append(names)
            for nm in names:
                execution_counts[nm] = execution_counts.get(nm, 0) + 1
            snapshots.append(
                {"category": "EXECUTION_SET", "trial_num": t, "execution_set": names, "source": "pytorch"}
            )
            for nm in names:
                vals = per_trial.get(nm)
                snapshots.append(
                    {
                        "category": "NODE_EXECUTION",
                        "trial_num": t,
                        "node": nm,
                        "output": vals[t] if vals is not None and t < len(vals) else None,
                        "source": "pytorch",
                    }
                )
            if len(snapshots) >= _MAX_DEBUGGER_SNAPSHOTS:
                capped = True
                break
        snapshots.append(
            {"category": "END_OF_TRIAL", "trial_num": t, "outputs": trial_results[t]["output"], "source": "pytorch"}
        )
        if capped:
            break

    logs = {name: {"trials": list(range(num_trials)), "values": vals} for name, vals in per_trial.items()}

    return {
        "results": trial_results,
        "outputLabels": output_labels,
        "logs": logs,
        "numTrials": num_trials,
        "executionTrace": execution_trace,
        "executionTrialBoundaries": trial_boundaries,
        "executionCounts": execution_counts,
        "debuggerSnapshots": snapshots,
    }


def _resolve_input_node(comp, module, var_name):
    """Find the composition node an input key refers to.

    A module attribute is trusted only when it is itself a graph node — some
    models also define string name-constants (e.g. ``STATE = 'STATE'``) that
    would otherwise shadow the mechanism. Falls back to matching node names,
    tolerating the ``-N`` suffix PsyNeuLink appends when a name is re-registered.
    """
    obj = getattr(module, var_name, None)
    if obj is not None and obj in comp.nodes:
        return obj
    for node in comp.nodes:
        if node.name == var_name:
            return node
    base = re.sub(r"-\d+$", "", var_name)
    for node in comp.nodes:
        if re.sub(r"-\d+$", "", node.name) == base:
            return node
    # The Run panel keys inputs by the introspector's varName handle, which for
    # a node whose PNL name comes from a function-local var + name= kwarg (e.g.
    # EGO's ``state_input_layer = ProcessingMechanism(name=STATE)``) is the local
    # var, not the node name. Resolve that handle back to the node's PNL name.
    pnl_name = _handle_to_pnl_name(module, var_name)
    if pnl_name:
        for node in comp.nodes:
            if node.name == pnl_name:
                return node
        nbase = re.sub(r"-\d+$", "", pnl_name)
        for node in comp.nodes:
            if re.sub(r"-\d+$", "", node.name) == nbase:
                return node
    return None


def _handle_to_pnl_name(module, var_name):
    """Map an introspector varName handle back to the node's PNL ``name=``.

    Mirrors the AST scan the graph serializer uses to mint handles (#572): finds
    the ``<var_name> = pnl.<Class>(name=...)`` assignment and evaluates its
    ``name=`` kwarg against the already-executed module namespace. Returns the
    resolved PNL name, or None.
    """
    import ast
    from pathlib import Path
    try:
        source = Path(module.__file__).read_text()
        tree = ast.parse(source)
    except Exception:
        return None
    namespace = dict(vars(module))
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        if len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
            continue
        if node.targets[0].id != var_name or not isinstance(node.value, ast.Call):
            continue
        for kw in node.value.keywords:
            if kw.arg != "name":
                continue
            try:
                code = compile(ast.Expression(kw.value), "<name>", "eval")
                resolved = eval(code, namespace)  # noqa: S307 - trusted, already-exec'd source
            except Exception:
                resolved = None
            return resolved if isinstance(resolved, str) else None
    return None


def _build_declaration_index(source):
    """Map local variable names to their declaration line (#422).

    Returns ``{var_name: 1-indexed line}`` for every ``<var> = pnl.<Class>(``
    declaration, **including indented (function-scoped) ones** so they can be
    located and edited. Also records ``scheduler.add_condition`` lines
    (unchanged behavior).
    """
    line_map = {}
    for i, line in enumerate(source.splitlines(), 1):
        # Accepts any dotted path to a capitalized callable, so `pnl.Thing(`,
        # bare `Thing(`, `psyneulink.Thing(` and `pnl.core.Thing(` all count.
        # The writer has always matched all four; indexing only the `pnl.`
        # form meant nodes it could edit were reported as uneditable (#1140).
        # Capitalized, not any callable, so `x = compute(...)` is not indexed
        # as a declaration. Kept byte-identical to the copy in introspector.py —
        # test_declaration_pattern_shared.py fails if they drift.
        m = re.match(r"^\s*(\w+)\s*=\s*(?:\w+\.)*(?:[A-Z]\w*)\(", line)
        if m and m.group(1) not in line_map:
            line_map[m.group(1)] = i
        m = re.match(r"^\s*\w+\.scheduler\.add_condition\(\s*(\w+)", line)
        if m:
            line_map[f"_sched_{m.group(1)}_{i}"] = i
    return line_map


def _build_name_index(source, namespace):
    """Map each component's PNL name to its local variable (#422).

    Walks the AST for ``<var> = pnl.<Class>(...)`` assignments and evaluates
    the ``name=`` keyword against the executed module ``namespace`` — so a
    node whose PNL name comes from a module constant or expression (e.g.
    ``name=STATE`` / ``name=CONTEXT + ' [BIAS]'`` in the EGO model) still
    resolves to a stable, writable handle. The source was already executed,
    so evaluating these kwargs introduces no new trust boundary.
    """
    import ast
    name_to_var = {}
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return name_to_var
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        if len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
            continue
        if not isinstance(node.value, ast.Call):
            continue
        var = node.targets[0].id
        for kw in node.value.keywords:
            if kw.arg != "name":
                continue
            try:
                code = compile(ast.Expression(kw.value), "<name>", "eval")
                resolved = eval(code, dict(namespace))  # noqa: S307 - trusted, already-exec'd source
            except Exception:
                resolved = None
            if isinstance(resolved, str) and resolved not in name_to_var:
                name_to_var[resolved] = var
            break
    return name_to_var


def _resolve_node_handle(node_name, line_map, name_to_var):
    """Resolve a node's PNL name to a stable local-var handle, or None."""
    clean = re.sub(r"-\d+$", "", node_name)
    for key in (node_name, clean):
        var = name_to_var.get(key)
        if var:
            return var
    if clean in line_map:
        return clean
    return None


# Names PsyNeuLink gives to the identity pass-through projections inside a
# CIM, e.g. "(INPUT_CIM_inner_a_InputPort-0) to (inner_a-InputPort-0)". The
# user's real MappingProjection in a stitched chain never matches this, so we
# use it to pick the projection that actually carries the matrix/function.
_CIM_PASSTHROUGH_RE = re.compile(r"^\(.*\) to \(.*\)$")


def _pick_primary_projection(chain):
    """Choose the projection in a CIM-stitched chain that carries the real
    matrix/function — the user's MappingProjection — over the CIM's identity
    pass-throughs. Falls back to the first link if every link looks internal."""
    for proj in chain:
        if not _CIM_PASSTHROUGH_RE.match(getattr(proj, "name", "") or ""):
            return proj
    return chain[0]


def _serialize_flat_projection(sender_mech, receiver_mech, chain, proj_name_lookup, via_cim=None):
    """Serialize one CIM-stitched edge between two real mechanisms (#657).

    ``chain`` is the list of projections traversed from sender to receiver
    (length 1 for a direct edge, longer when it crossed CIM boundaries). The
    matrix/function come from the chain's primary (non-pass-through) link.
    ``via_cim`` overrides the boundary-crossing flag (#704: a single projection
    can still cross a CIM when one endpoint was resolved through a port_map).
    """
    primary = _pick_primary_projection(chain)
    if via_cim is None:
        via_cim = len(chain) > 1
    direct = not via_cim
    sender_name = sender_mech.name
    receiver_name = receiver_mech.name

    s_clean = re.sub(r"-\d+$", "", sender_name)
    r_clean = re.sub(r"-\d+$", "", receiver_name)
    proj_var = proj_name_lookup.get((s_clean, r_clean))

    proj_type = type(primary).__name__
    proj_params = _serialize_params(primary, _SKIP_PROJ_PARAMS, proj_type)

    proj_func_info = None
    if hasattr(primary, "function") and primary.function is not None:
        func = primary.function
        func_type = type(func).__name__
        proj_func_info = {
            "type": func_type,
            "params": _serialize_params(func, _SKIP_FUNC_PARAMS, func_type),
        }

    matrix_shape = None
    try:
        if hasattr(primary, "parameters") and hasattr(primary.parameters, "matrix"):
            matrix = primary.parameters.matrix.get()
            if hasattr(matrix, "shape"):
                matrix_shape = list(matrix.shape)
    except Exception:
        pass

    # Ports are only meaningful for a direct edge; across a CIM the primary's
    # ports belong to the CIM, not to the real endpoints, so omit them.
    return {
        "name": primary.name,
        "varName": proj_var,
        "type": proj_type,
        "sender": {
            "mechanism": sender_name,
            "port": primary.sender.name if (direct and primary.sender) else None,
        },
        "receiver": {
            "mechanism": receiver_name,
            "port": primary.receiver.name if (direct and primary.receiver) else None,
        },
        "params": proj_params,
        "function": proj_func_info,
        "matrixShape": matrix_shape,
        "viaCim": not direct,
    }


def _flatten_graph(comp, line_map, proj_name_lookup, name_to_var):
    """Inline every nested composition into a single flat node/edge set (#657).

    Walks ``comp`` and all descendant compositions, hoisting their real
    mechanism nodes to one level and re-resolving CIM-bridged projections to
    their true inner sender/receiver by contracting CompositionInterfaceMechanism
    nodes out of the graph. Purely structural — nothing is dropped or reordered
    (the autodiff-specific flatten layers on top of this in #661).

    Returns ``(flat_nodes, flat_projections)``.
    """
    import psyneulink as pnl
    from collections import defaultdict

    def is_cim(mech):
        return isinstance(mech, pnl.CompositionInterfaceMechanism)

    # 1. Real mechanism nodes, recursively, each tagged with its enclosing
    #    sub-composition path (outermost-first, excluding the root comp).
    flat_nodes = []
    real_ids = set()

    def walk_nodes(c, path):
        _ensure_graph_analyzed(c)
        for node in c.nodes:
            if isinstance(node, pnl.Composition):
                walk_nodes(node, path + [node.name])
            elif is_cim(node):
                continue
            elif id(node) not in real_ids:
                real_ids.add(id(node))
                node_data = serialize_mechanism(node)
                node_data["kind"] = "mechanism"
                node_data["roles"] = _get_node_roles(c, node)
                handle = _resolve_node_handle(node.name, line_map, name_to_var)
                if handle:
                    node_data["varName"] = handle
                    node_data["line"] = line_map.get(handle)
                node_data["compPath"] = path
                flat_nodes.append(node_data)

    walk_nodes(comp, [])

    # 2. Every projection across the whole tree, de-duplicated by identity,
    #    indexed as a forward adjacency keyed by sender-owner id.
    all_projs = {}

    def walk_projs(c):
        for proj in c.projections:
            all_projs[id(proj)] = proj
        for node in c.nodes:
            if isinstance(node, pnl.Composition):
                walk_projs(node)

    walk_projs(comp)

    efferent = defaultdict(list)
    for proj in all_projs.values():
        sender = proj.sender.owner if getattr(proj, "sender", None) else None
        if sender is not None:
            efferent[id(sender)].append(proj)

    # 3. Contract CIM nodes: from each real source, walk forward through
    #    CIM-only nodes until reaching real receivers, accumulating the chain
    #    of projections crossing each boundary, then emit a stitched edge.
    flat_projections = []
    seen_edges = set()

    for start in all_projs.values():
        sender = start.sender.owner if getattr(start, "sender", None) else None
        if sender is None or is_cim(sender) or id(sender) not in real_ids:
            continue
        stack = [(start, [start])]
        visited_cims = set()
        while stack:
            proj, chain = stack.pop()
            receiver = proj.receiver.owner if getattr(proj, "receiver", None) else None
            if receiver is None:
                continue
            if is_cim(receiver):
                if id(receiver) in visited_cims:
                    continue
                visited_cims.add(id(receiver))
                for nxt in efferent.get(id(receiver), []):
                    stack.append((nxt, chain + [nxt]))
                continue
            if id(receiver) not in real_ids:
                continue
            edge_key = (id(sender), id(receiver))
            if edge_key in seen_edges or id(sender) == id(receiver):
                continue
            seen_edges.add(edge_key)
            flat_projections.append(
                _serialize_flat_projection(sender, receiver, chain, proj_name_lookup)
            )

    return flat_nodes, flat_projections


def _pytorch_flatten(comp, line_map, proj_name_lookup, name_to_var):
    """Serialize the autodiff (PyTorch) flattened view of an AutodiffComposition (#230).

    Walks ``comp``'s ``PytorchCompositionWrapper`` — PsyNeuLink's authoritative
    flattened graph for gradient computation: nested compositions are inlined,
    ``exclude_in_autodiff`` projections are already absent, and
    ``exclude_from_gradient_calc`` nodes are tagged. Reuses the #657 CIM
    contraction to stitch any wrapper projection that still crosses a
    CompositionInterfaceMechanism to its real endpoints.

    Nodes carry ``excludeFromGradientCalc`` and an ``executionOrder`` rank (from
    the wrapper's consideration-set sequence) on top of the usual mechanism
    serialization. Returns ``(nodes, projections)``, or ``None`` if ``comp`` is
    not an AutodiffComposition or the representation can't be built.
    """
    import psyneulink as pnl

    try:
        from psyneulink.library.compositions import AutodiffComposition
    except Exception:
        return None
    if not isinstance(comp, AutodiffComposition):
        return None
    try:
        rep = comp._build_pytorch_representation(context=None)
    except Exception:
        return None
    nodes_map = getattr(rep, "nodes_map", None) if rep is not None else None
    if not nodes_map:
        return None

    def is_cim(mech):
        return isinstance(mech, pnl.CompositionInterfaceMechanism)

    # Execution order: rank each node by its consideration-set index in the
    # wrapper's feedforward sequence.
    wrapper_to_mech = {id(w): m for m, w in nodes_map.items()}
    rank = {}
    for i, exec_set in enumerate(getattr(rep, "execution_sets", []) or []):
        for w in exec_set:
            mech = wrapper_to_mech.get(id(w))
            if mech is not None:
                rank[id(mech)] = i

    # Provenance: the nested-composition path each mechanism was inlined from.
    comp_path = {}

    def walk_paths(c, path):
        for node in c.nodes:
            if isinstance(node, pnl.Composition):
                walk_paths(node, path + [node.name])
            elif not is_cim(node):
                comp_path[id(node)] = path

    walk_paths(comp, [])

    node_ids = set(id(m) for m in nodes_map.keys())
    nodes = []
    for mech, wrapper in nodes_map.items():
        node_data = serialize_mechanism(mech)
        node_data["kind"] = "mechanism"
        node_data["roles"] = _get_node_roles(comp, mech)
        handle = _resolve_node_handle(mech.name, line_map, name_to_var)
        if handle:
            node_data["varName"] = handle
            node_data["line"] = line_map.get(handle)
        node_data["compPath"] = comp_path.get(id(mech), [])
        node_data["excludeFromGradientCalc"] = bool(
            getattr(wrapper, "exclude_from_gradient_calc", False)
        )
        if id(mech) in rank:
            node_data["executionOrder"] = rank[id(mech)]
        nodes.append(node_data)

    # Edges: one per wrapper projection, with CIM endpoints resolved to their
    # real inner mechanism via the CIM's port_map (#704). A projection can have
    # a CIM as its sender (EM Output_CIM -> PREDICTION) or receiver
    # (STATE -> EM Input_CIM); the forward-only contraction used before dropped
    # the former, leaving PREDICTION isolated. Resolving both sides matches
    # PsyNeuLink's own show_pytorch edge set.
    def resolve_cim_endpoint(cim, port, as_sender):
        # as_sender: the CIM is the projection's sender, so `port` is one of its
        # output ports (pair[1]); else it's the receiver and `port` is an input
        # port (pair[0]). The port_map key is the real inner mechanism's port.
        idx = 1 if as_sender else 0
        port_map = getattr(cim, "port_map", None) or {}
        for inner_port, pair in port_map.items():
            try:
                if pair[idx] is port:
                    return getattr(inner_port, "owner", None)
            except (IndexError, TypeError):
                continue
        return None

    projections = []
    seen_edges = set()
    for w in getattr(rep, "projection_wrappers", []) or []:
        proj = getattr(w, "projection", None)
        if proj is None:
            continue
        s_port = getattr(proj, "sender", None)
        r_port = getattr(proj, "receiver", None)
        sender = s_port.owner if s_port else None
        receiver = r_port.owner if r_port else None
        if sender is None or receiver is None:
            continue

        via_cim = is_cim(sender) or is_cim(receiver)
        if is_cim(sender):
            sender = resolve_cim_endpoint(sender, s_port, as_sender=True)
        if is_cim(receiver):
            receiver = resolve_cim_endpoint(receiver, r_port, as_sender=False)
        if sender is None or receiver is None:
            continue
        if id(sender) not in node_ids or id(receiver) not in node_ids:
            continue
        edge_key = (id(sender), id(receiver))
        if edge_key in seen_edges or id(sender) == id(receiver):
            continue
        seen_edges.add(edge_key)
        projections.append(
            _serialize_flat_projection(sender, receiver, [proj], proj_name_lookup, via_cim=via_cim)
        )

    return nodes, projections


def serialize_composition(var_name, comp, line_map, proj_name_lookup=None, name_to_var=None, flat=False, pytorch=False):
    import psyneulink as pnl
    # AutodiffComposition is in the library; absent in older PNL builds.
    try:
        from psyneulink.library.compositions import AutodiffComposition
        is_autodiff = isinstance(comp, AutodiffComposition)
    except ImportError:
        is_autodiff = False

    if proj_name_lookup is None:
        proj_name_lookup = {}
    if name_to_var is None:
        name_to_var = {}

    # Ensure graph is analyzed so node roles (INPUT, OUTPUT, etc.) are populated
    _ensure_graph_analyzed(comp)

    nodes = []
    for node in comp.nodes:
        if isinstance(node, pnl.Composition):
            node_data = serialize_composition(node.name, node, line_map, proj_name_lookup, name_to_var)
            node_data["kind"] = "composition"
        else:
            node_data = serialize_mechanism(node)
            node_data["kind"] = "mechanism"
            # Synthesize a stable editable handle for this node (#422). For
            # module-scope models the local var equals the cleaned name; for
            # function-scoped models the var is recovered from the source
            # `name=` kwarg via name_to_var.
            handle = _resolve_node_handle(node.name, line_map, name_to_var)
            if handle:
                node_data["varName"] = handle
                node_data["line"] = line_map.get(handle)
        node_data["roles"] = _get_node_roles(comp, node)
        nodes.append(node_data)

    # Build set of visible node names for filtering
    visible_names = set()
    for node in comp.nodes:
        visible_names.add(node.name)

    projections = []
    seen_edges = set()  # deduplicate resolved edges
    for proj in comp.projections:
        # Tolerate projections whose .sender/.receiver hasn't been resolved
        # — same defensive pattern as the module-scope lookup above (#165).
        proj_sender = getattr(proj, "sender", None)
        proj_receiver = getattr(proj, "receiver", None)
        sender_mech = proj_sender.owner if proj_sender and getattr(proj_sender, "owner", None) else None
        receiver_mech = proj_receiver.owner if proj_receiver and getattr(proj_receiver, "owner", None) else None
        if sender_mech is None or receiver_mech is None:
            continue

        # Resolve CIMs to visible composition group nodes
        sender_name = _resolve_cim(sender_mech, comp, "sender")
        receiver_name = _resolve_cim(receiver_mech, comp, "receiver")

        # Skip projections where sender or receiver isn't a visible node
        if sender_name not in visible_names or receiver_name not in visible_names:
            continue

        # Skip self-loops (can happen with CIM resolution)
        if sender_name == receiver_name:
            continue

        # Deduplicate (multiple CIM projections can resolve to the same edge)
        edge_key = (sender_name, receiver_name)
        if edge_key in seen_edges:
            continue
        seen_edges.add(edge_key)

        # Find the variable name by matching (sender, receiver) in the lookup
        s_clean = re.sub(r'-\d+$', '', sender_name) if sender_name else None
        r_clean = re.sub(r'-\d+$', '', receiver_name) if receiver_name else None
        proj_var = proj_name_lookup.get((s_clean, r_clean))

        # Extract projection parameters and function
        proj_type = type(proj).__name__
        proj_params = _serialize_params(proj, _SKIP_PROJ_PARAMS, proj_type)

        proj_func_info = None
        if hasattr(proj, "function") and proj.function is not None:
            func = proj.function
            func_type = type(func).__name__
            func_params = _serialize_params(func, _SKIP_FUNC_PARAMS, func_type)
            proj_func_info = {"type": func_type, "params": func_params}

        # Get matrix shape for MappingProjections
        matrix_shape = None
        try:
            if hasattr(proj, 'parameters') and hasattr(proj.parameters, 'matrix'):
                matrix = proj.parameters.matrix.get()
                if hasattr(matrix, 'shape'):
                    matrix_shape = list(matrix.shape)
        except Exception:
            pass

        projections.append({
            "name": proj.name,
            "varName": proj_var,
            "type": proj_type,
            "sender": {
                "mechanism": sender_name,
                "port": proj_sender.name if proj_sender else None,
            },
            "receiver": {
                "mechanism": receiver_name,
                "port": proj_receiver.name if proj_receiver else None,
            },
            "params": proj_params,
            "function": proj_func_info,
            "matrixShape": matrix_shape,
        })

    # Collect inactive projections (exist on nodes but not in composition)
    inactive_projections = []
    try:
        active_proj_ids = set(id(p) for p in comp.projections)
        seen_inactive = set()
        for node in comp.nodes:
            if isinstance(node, pnl.Composition):
                continue
            for proj in getattr(node, 'efferents', []):
                if id(proj) in active_proj_ids or id(proj) in seen_inactive:
                    continue
                seen_inactive.add(id(proj))
                s = proj.sender.owner.name if proj.sender and proj.sender.owner else None
                r = proj.receiver.owner.name if proj.receiver and proj.receiver.owner else None
                if s and r and s in visible_names and r in visible_names and s != r:
                    inactive_projections.append({
                        "name": proj.name,
                        "type": type(proj).__name__,
                        "sender": {"mechanism": s, "port": proj.sender.name if proj.sender else None},
                        "receiver": {"mechanism": r, "port": proj.receiver.name if proj.receiver else None},
                        "active": False,
                    })
    except Exception:
        pass

    # Serialize CIM (CompositionInterfaceMechanism) data
    cim_info = None
    try:
        cim_nodes = []
        cim_projections = []

        for cim_type, cim_obj, cim_role in [
            ("input_CIM", getattr(comp, 'input_CIM', None), "INPUT_CIM"),
            ("output_CIM", getattr(comp, 'output_CIM', None), "OUTPUT_CIM"),
            ("parameter_CIM", getattr(comp, 'parameter_CIM', None), "PARAMETER_CIM"),
        ]:
            if cim_obj is None:
                continue
            cim_data = serialize_mechanism(cim_obj)
            cim_data["kind"] = "mechanism"
            cim_data["roles"] = [cim_role]
            cim_data["cimType"] = cim_type
            cim_nodes.append(cim_data)

        # CIM projections: all projections that involve a CIM
        for proj in comp.projections:
            sender_mech = proj.sender.owner if proj.sender else None
            receiver_mech = proj.receiver.owner if proj.receiver else None
            if sender_mech is None or receiver_mech is None:
                continue
            sender_is_cim = isinstance(sender_mech, pnl.CompositionInterfaceMechanism)
            receiver_is_cim = isinstance(receiver_mech, pnl.CompositionInterfaceMechanism)
            if not sender_is_cim and not receiver_is_cim:
                continue
            cim_projections.append({
                "name": proj.name,
                "type": type(proj).__name__,
                "sender": {
                    "mechanism": sender_mech.name,
                    "port": proj.sender.name if proj.sender else None,
                },
                "receiver": {
                    "mechanism": receiver_mech.name,
                    "port": proj.receiver.name if proj.receiver else None,
                },
            })

        if cim_nodes:
            cim_info = {
                "nodes": cim_nodes,
                "projections": cim_projections,
            }
    except Exception:
        pass

    # #657: flat view replaces the per-composition node/edge set with the
    # whole tree inlined into one level (CIMs contracted out). Controller /
    # learning / scheduling below stay at the root composition's level.
    if flat:
        nodes, projections = _flatten_graph(comp, line_map, proj_name_lookup, name_to_var)
        inactive_projections = []
        cim_info = None

    # #230: PyTorch view — the autodiff-flattened graph PNL builds for gradient
    # computation. Specialization of the flat view; falls back to whatever was
    # built above if comp isn't an AutodiffComposition or the rep can't build.
    pytorch_applied = False
    if pytorch:
        pt = _pytorch_flatten(comp, line_map, proj_name_lookup, name_to_var)
        if pt is not None:
            nodes, projections = pt
            inactive_projections = []
            cim_info = None
            pytorch_applied = True

    # Serialize controller if present
    controller_info = None
    if hasattr(comp, 'controller') and comp.controller is not None:
        ctrl = comp.controller
        ctrl_data = serialize_mechanism(ctrl)
        ctrl_data["kind"] = "mechanism"
        ctrl_data["roles"] = ["CONTROLLER"]

        # Objective mechanism
        obj_mech_data = None
        if hasattr(ctrl, 'objective_mechanism') and ctrl.objective_mechanism is not None:
            obj = ctrl.objective_mechanism
            obj_mech_data = serialize_mechanism(obj)
            obj_mech_data["kind"] = "mechanism"
            obj_mech_data["roles"] = ["CONTROLLER_OBJECTIVE"]

        # Control projections (from controller to controlled nodes)
        control_projections = []
        try:
            for proj in ctrl.efferents:
                if hasattr(proj, 'receiver') and proj.receiver and proj.receiver.owner:
                    receiver_name = proj.receiver.owner.name
                    # Resolve CIM if needed
                    if isinstance(proj.receiver.owner, pnl.CompositionInterfaceMechanism):
                        receiver_name = _resolve_cim(proj.receiver.owner, comp, "receiver") or receiver_name
                    control_projections.append({
                        "name": proj.name,
                        "type": type(proj).__name__,
                        "sender": {"mechanism": ctrl.name, "port": proj.sender.name if proj.sender else None},
                        "receiver": {"mechanism": receiver_name, "port": proj.receiver.name if proj.receiver else None},
                    })
        except Exception:
            pass

        # Monitoring projections (from monitored nodes to objective mechanism)
        monitor_projections = []
        if obj_mech_data is not None:
            try:
                obj = ctrl.objective_mechanism
                for proj in obj.afferents:
                    if hasattr(proj, 'sender') and proj.sender and proj.sender.owner:
                        sender_name = proj.sender.owner.name
                        if isinstance(proj.sender.owner, pnl.CompositionInterfaceMechanism):
                            sender_name = _resolve_cim(proj.sender.owner, comp, "sender") or sender_name
                        monitor_projections.append({
                            "name": proj.name,
                            "type": type(proj).__name__,
                            "sender": {"mechanism": sender_name, "port": proj.sender.name if proj.sender else None},
                            "receiver": {"mechanism": obj.name, "port": proj.receiver.name if proj.receiver else None},
                        })
            except Exception:
                pass

        controller_info = {
            "mechanism": ctrl_data,
            "objectiveMechanism": obj_mech_data,
            "controlProjections": control_projections,
            "monitorProjections": monitor_projections,
        }

    # Serialize learning components if present
    learning_info = None
    try:
        learning_comps = getattr(comp, 'learning_components', None)
        if learning_comps:
            learning_mechs = []
            learning_projections = []

            for lcomp in learning_comps:
                if isinstance(lcomp, pnl.Mechanism):
                    mech_data = serialize_mechanism(lcomp)
                    mech_data["kind"] = "mechanism"
                    mech_data["roles"] = _get_node_roles(comp, lcomp)
                    if not mech_data["roles"]:
                        mech_data["roles"] = ["LEARNING"]
                    learning_mechs.append(mech_data)
                elif isinstance(lcomp, pnl.Projection):
                    sender_name = lcomp.sender.owner.name if lcomp.sender and lcomp.sender.owner else None
                    receiver_name = lcomp.receiver.owner.name if lcomp.receiver and lcomp.receiver.owner else None
                    if sender_name and receiver_name:
                        learning_projections.append({
                            "name": lcomp.name,
                            "type": type(lcomp).__name__,
                            "sender": {"mechanism": sender_name, "port": lcomp.sender.name if lcomp.sender else None},
                            "receiver": {"mechanism": receiver_name, "port": lcomp.receiver.name if lcomp.receiver else None},
                        })

            if learning_mechs or learning_projections:
                learning_info = {
                    "mechanisms": learning_mechs,
                    "projections": learning_projections,
                }
    except Exception:
        pass

    # --- Serialize scheduling conditions ---
    scheduling = _serialize_gsc_conditions(comp)
    basic_conditions = _serialize_basic_conditions(comp)
    termination_conds = _serialize_termination_conditions(comp)
    scheduler_config = _serialize_scheduler_config(comp)

    # #763: learning pathways make a plain Composition trainable under Python.
    # Autodiff comps are learnable by construction, so this decides only the
    # non-autodiff case. Same computation as introspector.py's in-process
    # serializer; the matrix itself lives once, in execution_modes.py.
    try:
        has_learning = bool(getattr(comp, "learning_components", None))
    except Exception:
        has_learning = False

    from app.services.execution_modes import composition_execution_modes

    return {
        "varName": var_name,
        "name": comp.name,
        "kind": "composition",
        "compositionType": type(comp).__name__,
        "isAutodiff": is_autodiff,
        "hasLearning": has_learning,
        "executionModes": composition_execution_modes(
            is_autodiff=is_autodiff, has_learning=has_learning
        ),
        # #997: how this composition learns (autodiff / learning pathway /
        # not at all), which nodes take targets, and what each epoch reports.
        "learningProfile": _learning_profile(comp, is_autodiff),
        "flattened": flat or pytorch_applied,
        "pytorchView": pytorch_applied,
        "nodes": nodes,
        "projections": projections,
        "inactiveProjections": inactive_projections,
        "cim": cim_info,
        "controller": controller_info,
        "learning": learning_info,
        "scheduling": scheduling,
        "basicConditions": basic_conditions,
        "terminationConditions": termination_conds,
        "schedulerConfig": scheduler_config,
        "line": line_map.get(var_name),
    }


def _operation_to_name(val):
    """Convert a graph_scheduler Operation value to a readable name.

    On Python 3.13+, Operation enum members degrade to functools.partial
    objects, so we reverse-lookup by matching the partial's function.
    """
    import functools
    if hasattr(val, 'name') and isinstance(val.name, str):
        return val.name  # Normal enum member

    if isinstance(val, functools.partial):
        try:
            from graph_scheduler.condition import Operation
            for name in ['KEEP', 'REPLACE', 'DISCARD', 'MERGE', 'UNION',
                         'INTERSECTION', 'DIFFERENCE', 'INVERSE_DIFFERENCE',
                         'SYMMETRIC_DIFFERENCE']:
                member = getattr(Operation, name, None)
                if member is not None and isinstance(member, functools.partial):
                    if member.func is val.func:
                        return name
        except ImportError:
            pass

    return str(val)


def _serialize_gsc_conditions(comp):
    """Extract GraphStructureConditions from a Composition's scheduler.

    Returns a list of GSCInfo-shaped dicts.
    """
    try:
        from graph_scheduler.condition import GraphStructureCondition  # noqa: F401
    except ImportError:
        return []

    scheduler = getattr(comp, 'scheduler', None)
    if scheduler is None:
        return []

    cond_set = getattr(scheduler, 'conditions', None)
    if cond_set is None:
        return []

    structural = getattr(cond_set, 'conditions_structural', {})
    if not structural:
        return []

    def _clean_name(name):
        return re.sub(r'-\d+$', '', name) if name else name

    gsc_list = []
    for owner_node, conditions in structural.items():
        owner_name = _clean_name(
            owner_node.name if hasattr(owner_node, 'name') else str(owner_node)
        )
        for idx, gsc in enumerate(conditions):
            gsc_type = type(gsc).__name__

            # Extract target nodes
            target_nodes = []
            if hasattr(gsc, 'nodes') and gsc.nodes:
                for n in gsc.nodes:
                    target_nodes.append(
                        _clean_name(n.name if hasattr(n, 'name') else str(n))
                    )

            # Extract operation params for _GSCWithOperations subclasses
            params = {}
            for attr in (
                'owner_senders', 'owner_receivers',
                'subject_senders', 'subject_receivers',
            ):
                val = getattr(gsc, attr, None)
                if val is not None:
                    if isinstance(val, dict):
                        params[attr] = {
                            (_clean_name(k.name) if hasattr(k, 'name') else str(k)):
                            _operation_to_name(v)
                            for k, v in val.items()
                        }
                    else:
                        params[attr] = _operation_to_name(val)

            for attr in (
                'reconnect_non_subject_receivers',
                'remove_new_self_referential_edges',
                'prune_cycles', 'ignore_conflicts',
            ):
                val = getattr(gsc, attr, None)
                if val is not None and isinstance(val, bool):
                    params[attr] = val

            gsc_list.append({
                "id": f"gsc_{owner_name}_{idx}",
                "type": gsc_type,
                "owner": owner_name,
                "nodes": target_nodes,
                "params": params,
            })

    return gsc_list


def _serialize_condition(cond):
    """Recursively serialize a Condition to a JSON-friendly dict.

    Handles composites (All/Any/Not) by recursing into child conditions.
    Node references are resolved to cleaned name strings.
    """
    def _clean_name(name):
        return re.sub(r'-\d+$', '', name) if name else name

    def _arg_to_json(arg):
        """Convert a condition argument to JSON-serializable form."""
        if hasattr(arg, 'name') and hasattr(arg, 'parameters'):
            # PsyNeuLink Component (Mechanism, Composition, etc.)
            return {"_node": _clean_name(arg.name)}
        if isinstance(arg, (int, float, bool, str)):
            return arg
        if isinstance(arg, (list, tuple)):
            return [_arg_to_json(a) for a in arg]
        # Check if it's a nested Condition
        try:
            from graph_scheduler.condition import ConditionBase
            if isinstance(arg, ConditionBase):
                return _serialize_condition(arg)
        except ImportError:
            pass
        return str(arg)

    cond_type = type(cond).__name__

    # Composite conditions: All/And, Any/Or, Not, NWhen
    if cond_type in ('All', 'Any', 'Not', 'NWhen', 'And', 'Or'):
        children = []
        for arg in (cond.args or []):
            children.append(_arg_to_json(arg))
        result = {"type": cond_type, "children": children}
        # NWhen has an 'n' parameter
        if cond_type == 'NWhen' and hasattr(cond, 'kwargs'):
            n = cond.kwargs.get('n')
            if n is not None:
                result["n"] = n
        return result

    # Regular conditions: extract args as readable values
    result = {"type": cond_type, "args": {}}

    # Map common condition arg patterns to readable keys
    args = cond.args or ()
    kwargs = cond.kwargs or {}

    # Most conditions have (dependency_node, n) or just (n,) patterns
    parsed_args = []
    for arg in args:
        parsed_args.append(_arg_to_json(arg))

    if parsed_args:
        result["args"]["positional"] = parsed_args

    for k, v in kwargs.items():
        if k in ('_owner',):
            continue
        result["args"][k] = _arg_to_json(v)

    # Clean up empty args
    if not result["args"]:
        del result["args"]

    return result


def _serialize_basic_conditions(comp):
    """Extract basic (non-graph-structure) conditions from the scheduler.

    Returns a list of {owner, condition} dicts.
    """
    scheduler = getattr(comp, 'scheduler', None)
    if scheduler is None:
        return []

    cond_set = getattr(scheduler, 'conditions', None)
    if cond_set is None:
        return []

    basic = getattr(cond_set, 'conditions_basic', {})
    if not basic:
        return []

    def _clean_name(name):
        return re.sub(r'-\d+$', '', name) if name else name

    result = []
    for node, cond in basic.items():
        node_name = _clean_name(
            node.name if hasattr(node, 'name') else str(node)
        )
        result.append({
            "owner": node_name,
            "condition": _serialize_condition(cond),
        })
    return result


def _serialize_termination_conditions(comp):
    """Extract termination conditions from the scheduler.

    Returns a dict of {timeScale: condition}.
    """
    scheduler = getattr(comp, 'scheduler', None)
    if scheduler is None:
        return {}

    term_conds = getattr(scheduler, 'termination_conds', None)
    if not term_conds:
        return {}

    result = {}
    for time_scale, cond in term_conds.items():
        key = time_scale.name if hasattr(time_scale, 'name') else str(time_scale)
        result[key] = _serialize_condition(cond)
    return result


def _serialize_scheduler_config(comp):
    """Extract scheduler configuration metadata."""
    scheduler = getattr(comp, 'scheduler', None)
    if scheduler is None:
        return {}

    result = {}

    mode = getattr(scheduler, 'mode', None)
    if mode is not None:
        result["mode"] = mode.name if hasattr(mode, 'name') else str(mode)

    # Consideration queue: the actual execution order
    cq = getattr(scheduler, 'consideration_queue', None)
    if cq:
        def _clean_name(name):
            return re.sub(r'-\d+$', '', name) if name else name
        result["considerationQueue"] = [
            [_clean_name(n.name) if hasattr(n, 'name') else str(n) for n in step]
            for step in cq
        ]

    return result


def _get_constructor_kwargs(cls):
    """Get the set of parameter names accepted by a class's __init__."""
    import inspect
    try:
        sig = inspect.signature(cls.__init__)
        skip = {'self', 'kwargs', 'params', 'owner', 'prefs', 'default_variable'}
        return {
            name for name, p in sig.parameters.items()
            if name not in skip and p.kind != inspect.Parameter.VAR_KEYWORD
        }
    except (ValueError, TypeError):
        return set()


def _get_class_default(cls, param_name):
    """Get the class-level default for a parameter (not the instance default)."""
    try:
        class_param = getattr(cls.Parameters, param_name, None)
        if class_param is not None and hasattr(class_param, 'default_value'):
            return to_json(class_param.default_value)
        # A Parameter declared as a plain value (RecurrentTransferMechanism's
        # ``enable_learning = False``) has that value as its default (#1385).
        if isinstance(class_param, (bool, int, float, str)):
            return to_json(class_param)
    except Exception:
        pass
    return None


def _values_equal(a, b):
    """Compare two values for equality, handling numpy arrays."""
    try:
        if a is None and b is None:
            return True
        if a is None or b is None:
            return False
        if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
            return list(a) == list(b)
        return a == b
    except Exception:
        return False


_FUNCTION_INTERMEDIATE_BASES = {
    "Function", "Function_Base", "TransferFunction",
    "DeterministicTransferFunction", "CombinationFunction",
    "TransformFunction", "SelectionFunction", "DistributionFunction",
    "ObjectiveFunction", "OptimizationFunction", "LearningFunction",
    "StatefulFunction", "IntegratorFunction", "MemoryFunction",
    "TimerFunction", "FitFunction",
}


# Mechanisms whose `function` slot accepts functions spanning more than one
# family, so the MRO-sibling walk gives the wrong list (it both omits the
# cross-family options and includes invalid same-family siblings). For these,
# the listed names replace the sibling walk entirely. Mirrors PNL's own
# validation set (e.g. DDM._validate_params accepts exactly these two).
_MECH_FUNCTION_ALLOWLIST = {
    "DDM": ["DriftDiffusionAnalytical", "DriftDiffusionIntegrator"],
}


def _valid_function_types(mech, func_instance):
    """Function class names to offer for `mech`'s function dropdown."""
    allow = _MECH_FUNCTION_ALLOWLIST.get(type(mech).__name__)
    if allow is not None:
        return sorted(allow)
    return _get_valid_function_classes(func_instance)


def _get_valid_function_classes(func_instance):
    """Return concrete sibling function class names for the given function instance.

    Walks the MRO to find the family base (e.g. TransferFunction for a Linear
    instance), then enumerates instantiable subclasses of that base. Intermediate
    bases (TransferFunction, DeterministicTransferFunction, etc.) are filtered
    out, but the currently-selected class is always included so the dropdown
    can show the present value even if it lives at an intermediate level.
    """
    import inspect

    cls = type(func_instance)
    family_base = None
    for ancestor in cls.__mro__:
        name = ancestor.__name__
        if name in ("Function_Base", "Function", "Component", "object"):
            break
        if name.endswith("Function"):
            family_base = ancestor
    if family_base is None:
        return [cls.__name__]

    def collect(c, out):
        for sub in c.__subclasses__():
            collect(sub, out)
            out.add(sub)

    candidates = {family_base}
    collect(family_base, candidates)

    result = set()
    for c in candidates:
        if inspect.isabstract(c):
            continue
        if c.__name__ in _FUNCTION_INTERMEDIATE_BASES and c is not cls:
            continue
        result.add(c.__name__)

    return sorted(result)


def _serialize_params(instance, skip_set, context_label):
    """Serialize parameters with rich metadata.

    Returns a dict of param_name -> {value, default, isDefault, editable, source}.
    """
    cls = type(instance)
    constructor_kwargs = _get_constructor_kwargs(cls)
    result = {}

    for param_name in instance.parameters.names():
        if param_name in skip_set:
            continue
        try:
            param_obj = getattr(instance.parameters, param_name)
            val = param_obj.get()
            json_val = to_json(val)
            if json_val is None:
                continue

            is_internal = getattr(param_obj, 'pnl_internal', False)
            is_constructor = param_name in constructor_kwargs
            class_default = _get_class_default(cls, param_name)
            is_default = _values_equal(json_val, class_default)

            result[param_name] = {
                "value": json_val,
                "default": class_default,
                "isDefault": is_default,
                "editable": is_constructor and not is_internal,
                "source": context_label if is_constructor else "inherited",
            }
        except Exception:
            pass

    return result


def _port_entry(p):
    """Serialize one port's display metadata.

    Includes #11's optional ``element_names`` when the port has them set
    via PsyNeuLink's model-intrinsic API (Layer 1). Omitted from the
    output when null so the frontend's resolver only fast-paths
    through model-side labels when they actually exist.
    """
    entry = {
        "name": p.name,
        "shape": list(p.defaults.value.shape) if hasattr(p.defaults.value, "shape") else [],
    }
    element_names = getattr(p, "element_names", None)
    if element_names:
        entry["element_names"] = list(element_names)
    return entry


def _apply_constructed_learning_flag(mech, params):
    """Show ``enable_learning`` as the mechanism was built, not as PsyNeuLink's
    never-updated Parameter reads (#1385; see ``constructed_learning_flag``)."""
    entry = params.get("enable_learning")
    if not isinstance(entry, dict):
        return
    try:
        from app.services.pathway_learning import constructed_learning_flag
    except Exception:
        return
    built = constructed_learning_flag(mech)
    if built is None:
        return
    entry["value"] = built
    entry["isDefault"] = _values_equal(built, entry.get("default"))


def serialize_mechanism(mech):
    input_ports = [_port_entry(p) for p in mech.input_ports]
    output_ports = [_port_entry(p) for p in mech.output_ports]
    parameter_ports = []
    if hasattr(mech, "parameter_ports") and mech.parameter_ports is not None:
        for p in mech.parameter_ports:
            try:
                shape = list(p.defaults.value.shape) if hasattr(p.defaults.value, "shape") else []
            except Exception:
                shape = []
            parameter_ports.append({"name": p.name, "shape": shape})

    mech_type = type(mech).__name__
    params = _serialize_params(mech, _SKIP_MECH_PARAMS, mech_type)
    _apply_constructed_learning_flag(mech, params)

    func_info = None
    if hasattr(mech, "function") and mech.function is not None:
        func = mech.function
        func_type = type(func).__name__
        func_params = _serialize_params(func, _SKIP_FUNC_PARAMS, func_type)
        func_info = {
            "type": func_type,
            "params": func_params,
            "validTypes": _valid_function_types(mech, func),
        }

    return {
        "name": mech.name,
        "type": mech_type,
        "inputPorts": input_ports,
        "outputPorts": output_ports,
        "parameterPorts": parameter_ports,
        "params": params,
        "function": func_info,
    }


def _handle_one_task(payload_str: str) -> str:
    """Parse a JSON task, execute it, return the JSON result string."""
    TASKS = {
        "introspect": task_introspect,
        "run": task_run,
        "learn": task_learn,
        "get_input_nodes": task_get_input_nodes,
        "show_graph": task_show_graph,
        "export_mdf": task_export_mdf,
        "mdf_gaps": task_mdf_gaps,
    }

    try:
        payload = json.loads(payload_str)
    except json.JSONDecodeError as e:
        return json.dumps({"error": f"Invalid JSON: {e}"}, default=str)

    task = payload.get("task")
    params = payload.get("params", {})

    handler = TASKS.get(task)
    if handler is None:
        result = {"error": f"Unknown task: {task}"}
    else:
        # Record warnings as objects rather than letting them go to stderr.
        # On the warm-worker path stderr is drained to a log with no task
        # boundaries, so a successful run had no way to report what it warned
        # about at all. Capturing here keeps the category, file and line, which
        # is what lets the UI point at the offending line (#1101).
        import warnings as _warnings

        with _warnings.catch_warnings(record=True) as caught:
            _warnings.simplefilter("always")
            try:
                # Clean up previous user module to avoid stale state
                for mod_name in list(sys.modules.keys()):
                    if mod_name.startswith("user_model"):
                        del sys.modules[mod_name]
                result = handler(params)
            except Exception as e:
                result = {"error": str(e)}

        if isinstance(result, dict) and caught:
            # Serialise only. Deciding which of these are worth showing needs
            # app.services.model_warnings, and this file also runs as a script
            # in a subprocess where `app` does not resolve — routing the work
            # through that import would silently produce nothing, which is
            # exactly how the show_graph suppression failed in #1090. The route
            # classifies these in the backend process, where the import works.
            result["captured_warnings"] = [
                {
                    "category": getattr(w.category, "__name__", "Warning"),
                    "message": str(w.message),
                    "filename": w.filename or "",
                    "lineno": int(w.lineno or 0),
                }
                for w in caught
            ]

    return json.dumps(result, default=str)


def _install_orphan_watchdog(interval: float = 1.0, use_signal_timer: bool = False) -> None:
    """Exit if the parent backend process dies, so a stuck/spinning worker can't
    linger as an orphan burning 100% CPU (#864).

    The task loop only notices a dead parent when it returns to read stdin — a
    runaway introspection that spins never does, so the worker gets reparented
    (``getppid()`` -> 1) and keeps a core pinned indefinitely. macOS has no
    ``PR_SET_PDEATHSIG``, so we watch ``getppid()`` two complementary ways:

      * a daemon thread (always) — catches idle workers and spins inside C
        extensions (numpy/torch) that release the GIL;
      * a ``SIGALRM`` interval timer (``use_signal_timer``) — catches pure-Python
        spins (``while True``), where the GIL-holding main thread never yields to
        the thread but the interpreter still services signals at eval-loop
        breakpoints.

    ``use_signal_timer`` is opt-in and only enabled for the **persistent**
    introspection worker, where pure-Python ``while True`` spins were the actual
    #864 concern. It must NOT be armed in the one-shot job workers
    (``jobs.py``): those run long PsyNeuLink/torch training where the periodic
    SIGALRM — left at ``SIG_DFL`` by the training path when the main-thread
    handler can't service it in time — terminates the worker mid-run with exit
    -14 (#870 regression). Job workers are short-lived and parent-driven, so the
    daemon-thread ``getppid()`` watch already covers them.

    Either firing calls ``os._exit()`` immediately: as an orphan a clean
    shutdown is impossible and could itself hang.
    """
    import os
    import signal
    import threading
    import time as _time

    original_ppid = os.getppid()

    def _orphaned() -> bool:
        # Parent gone -> reparented (pid changes; 1 on macOS/Linux).
        return os.getppid() != original_ppid

    def _thread_watch() -> None:
        while True:
            _time.sleep(interval)
            if _orphaned():
                os._exit(1)

    threading.Thread(target=_thread_watch, daemon=True, name="orphan-watchdog").start()

    # SIGALRM path — main thread only; opt-in (persistent worker) so it can't
    # kill long-running one-shot job workers (#870). No-op without SIGALRM.
    if use_signal_timer and hasattr(signal, "SIGALRM") and hasattr(signal, "setitimer"):
        def _on_alarm(_signum, _frame):
            if _orphaned():
                os._exit(1)

        try:
            signal.signal(signal.SIGALRM, _on_alarm)
            signal.setitimer(signal.ITIMER_REAL, interval, interval)
        except (ValueError, OSError):
            # setitimer/signal only work on the main thread; the daemon thread
            # still covers us if we were somehow started off it.
            pass


def _run_persistent():
    """Persistent mode: import PsyNeuLink once, then loop handling tasks.

    Protocol:
    1. Print "###READY###" when PsyNeuLink is imported and ready
    2. Read one JSON line from stdin per task
    3. Print "###PSYNEWVIEW_RESULT###" marker, then JSON result on next line
    4. Repeat until stdin closes
    """
    import time
    t0 = time.time()

    # Pre-import PsyNeuLink (the expensive part)
    import psyneulink as pnl  # noqa: F401
    elapsed = time.time() - t0
    sys.stderr.write(f"[perf] persistent worker: PNL import {elapsed:.2f}s\n")

    # Signal ready
    print("###READY###", flush=True)

    # Task loop
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        result_str = _handle_one_task(line)
        print(RESULT_MARKER, flush=True)
        print(result_str, flush=True)


def _learning_profile(comp, is_autodiff):
    """The Learn tab's per-composition profile (#997); never fails a load."""
    try:
        from app.services.pathway_learning import learning_profile

        return learning_profile(comp, is_autodiff=is_autodiff)
    except Exception:
        return None


def _run_oneshot():
    """One-shot mode (original behavior): read one task, execute, exit."""
    payload = sys.stdin.read()
    result_str = _handle_one_task(payload)
    print(RESULT_MARKER)
    print(result_str)


if __name__ == "__main__":
    persistent = "--persistent" in sys.argv
    # Die if orphaned (#864) — installed before any task work so even a spin
    # during the first task can't outlive the parent. The SIGALRM half is armed
    # only for the persistent introspection worker (where pure-Python `while
    # True` spins are the concern); one-shot job workers run long training that a
    # stray SIGALRM would kill (#870), and the daemon-thread watch covers them.
    _install_orphan_watchdog(use_signal_timer=persistent)
    if persistent:
        _run_persistent()
    else:
        _run_oneshot()

