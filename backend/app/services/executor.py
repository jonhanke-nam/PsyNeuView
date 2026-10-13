"""Execute a PsyNeuLink composition and return results.

Loads the model, enables logging on all nodes, runs with provided inputs,
and collects per-trial results and logged values.

Supports sandboxed (subprocess) and in-process execution.
"""

import contextlib
import importlib.util
import re
import sys
import numpy as np
from pathlib import Path

from app.services.sandbox import run_in_sandbox
from app.services.show_graph_guard import suppress_show_graph


@contextlib.contextmanager
def _suppressed_load():
    """Suppress a model script's module-level side effects while it loads.

    The executor loads a model and then drives its own run/learn on the
    resulting Composition. Module-level side effects must not interfere:

    - ``Composition.show_graph`` + matplotlib are no-op'd so loading never
      renders a graphviz PDF (which macOS opens in Preview) or a plot window
      (#608).
    - ``Composition.run/execute/learn`` + ``Mechanism.reset`` are no-op'd so a
      module-level run/learn doesn't accumulate ``comp.results`` or mutate
      trained parameters before the executor's own run (#609).

    Originals are restored on exit, so the executor's subsequent run/learn
    calls execute normally.
    """
    restore_fns = []
    try:
        import psyneulink as pnl
        noop = lambda self, *a, **kw: None
        # Across the whole hierarchy, not just the root (#1090).
        restore_fns.extend(suppress_show_graph(pnl.Composition))
        for method_name in ('run', 'execute', 'learn'):
            orig = getattr(pnl.Composition, method_name)
            setattr(pnl.Composition, method_name, noop)
            restore_fns.append(
                (lambda name, fn: lambda: setattr(pnl.Composition, name, fn))(method_name, orig)
            )
        if hasattr(pnl, 'Mechanism'):
            orig_reset = pnl.Mechanism.reset
            setattr(pnl.Mechanism, 'reset', noop)
            restore_fns.append(lambda: setattr(pnl.Mechanism, 'reset', orig_reset))
    except ImportError:
        pass

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
        restore_fns.append(lambda: [setattr(plt, n, f) for n, f in _orig_funcs.items()])
    except ImportError:
        pass

    try:
        yield
    finally:
        for fn in restore_fns:
            fn()


def _snapshot_composition_ids() -> dict:
    """Compositions alive before a load, keyed by id — see _bind_headless_compositions.

    Holds the objects so none can be freed and its id reused mid-load (#1382).
    """
    from app.services.sandbox_worker import _composition_snapshot
    return _composition_snapshot()


def _bind_headless_compositions(module, before_ids) -> None:
    """Give factory-/function-built Compositions a module handle before getattr.

    Some library models never leave a module-scope variable for their
    Composition: EGO builds it in a ``construct_model()`` factory (#855), and
    models like MontagueDayanSejnowski96 build it inside a helper whose
    module-level assignment fails on a post-run driver error (#859). In both
    cases ``getattr(module, composition_name)`` on the run path can't resolve
    it. Reuse the sandbox worker's materializers so the in-process run/learn/
    get-inputs paths bind the same handle introspection reports.
    """
    from app.services.sandbox_worker import (
        _materialize_factory_composition,
        _materialize_gc_compositions,
    )
    _materialize_factory_composition(module)
    _materialize_gc_compositions(module, before_ids)


def run_model(
    file_path: str,
    composition_name: str,
    inputs: dict,
    use_sandbox: bool = True,
    execution_mode: str | None = None,
    log_nodes: list[str] | None = None,
) -> dict:
    """Execute a composition from a .py file with the given inputs.

    Args:
        file_path: Path to the .py model file.
        composition_name: Variable name of the Composition to run.
        inputs: Dict mapping mechanism variable names to lists of input arrays.
            E.g., {"colors_input": [[1,0,0], [0,1,0]], "words_input": [[0,0,1], [0,1,0]]}

    Returns:
        Dict with:
          - results: per-trial output arrays
          - logs: per-node logged values across trials
          - error: error message if execution failed
    """
    if use_sandbox:
        return run_in_sandbox("run", {
            "file_path": file_path,
            "composition_name": composition_name,
            "inputs": inputs,
            "execution_mode": execution_mode,
            "log_nodes": log_nodes,
        })
    return _run_model_inprocess(file_path, composition_name, inputs, execution_mode)


def _resolve_composition(module, comp_name):
    """Find the Composition by display name, falling back from module variable.

    Mirrors ``sandbox_worker._resolve_composition`` so the in-process path agrees
    with the worker path: the client may send a composition's display name (its
    ``name=``) which differs from the module variable it's bound to (e.g. EGO's
    ``EGO_comp`` named "EGO"). Try the attribute, then match any module-scope
    Composition by ``.name``. Returns the Composition or None (#859-class).
    """
    import psyneulink as pnl

    comp = getattr(module, comp_name, None)
    if isinstance(comp, pnl.Composition):
        return comp
    for obj in vars(module).values():
        if isinstance(obj, pnl.Composition) and getattr(obj, "name", None) == comp_name:
            return obj
    return None


def _run_model_inprocess(
    file_path: str,
    composition_name: str,
    inputs: dict,
    execution_mode: str | None = None,
) -> dict:
    """In-process execution (used as fallback and in tests)."""
    import psyneulink as pnl

    try:
        # Load and execute the script
        spec = importlib.util.spec_from_file_location("user_model_run", file_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["user_model_run"] = module
        # Neutralize sys.argv so a library model's ``argparse.parse_args()`` at
        # module level sees no stray args (e.g. pytest's) and uses its defaults
        # instead of raising SystemExit — mirrors the sandbox loader.
        saved_argv = sys.argv
        sys.argv = [file_path]
        before_ids = _snapshot_composition_ids()
        try:
            with _suppressed_load():
                try:
                    spec.loader.exec_module(module)
                except Exception:
                    # Raw library models raise here when their module-level driver
                    # reads run results / logs after the no-op'd ``.run()`` (#796).
                    # The Composition is already built in the module namespace, so
                    # swallow it and drive our own clean run below; a genuine load
                    # failure is caught separately when ``comp`` comes back None.
                    pass
                _bind_headless_compositions(module, before_ids)
        finally:
            sys.argv = saved_argv

        # Find the composition (by display name, falling back from variable).
        comp = _resolve_composition(module, composition_name)
        if comp is None:
            return {"error": f"Composition '{composition_name}' not found in {file_path}"}

        # Resolve input mechanism names to actual mechanism objects
        pnl_inputs = {}
        for var_name, values in inputs.items():
            mech = _resolve_input_node(comp, module, var_name)
            if mech is None:
                return {"error": f"Input mechanism '{var_name}' not found"}
            pnl_inputs[mech] = [np.array(v, dtype=float) for v in values]

        # AutodiffComposition (e.g. the Giallanza EGO model) runs as a compiled
        # PyTorch module via .learn() — plain .run() fails inside the nested EM
        # machinery (#363). The PyTorch path bypasses the scheduler, so instead
        # of node.log we instrument the wrappers to synthesize the full
        # observability contract (trace / snapshots / logs), shared with the
        # sandbox worker (#629).
        if _is_autodiff(comp):
            from app.services.sandbox_worker import _autodiff_observability

            return _autodiff_observability(comp, pnl_inputs)

        for node in comp.nodes:
            if hasattr(node, "log"):
                node.log.set_log_conditions("value")
        mode, effective_mode, mode_reason = _resolve_run_execution_mode(pnl, execution_mode)
        comp.run(inputs=pnl_inputs, execution_mode=mode)
        raw_results = list(comp.results)

        # Collect per-trial results
        trial_results = []
        for i, r in enumerate(raw_results):
            trial_results.append({
                "trial": i,
                "output": _to_list(r),
            })

        # Collect per-node logs
        node_logs = {}
        for node in comp.nodes:
            if hasattr(node, "log"):
                try:
                    log_dict = node.log.nparray_dictionary()
                    if log_dict:
                        # log_dict is {context: {Run, Trial, Pass, Time_step, value}}
                        for context_name, context_data in log_dict.items():
                            trials = [int(t[0]) for t in context_data.get("Trial", [])]
                            values = context_data.get("value", np.array([]))
                            node_logs[node.name] = {
                                "trials": trials,
                                "values": _to_list(values),
                            }
                except Exception:
                    pass

        from app.services.sandbox_worker import _output_labels

        return {
            "results": trial_results,
            "executionMode": effective_mode,
            "executionModeReason": mode_reason,
            "outputLabels": _output_labels(comp),
            "logs": node_logs,
            "numTrials": len(trial_results),
        }

    except Exception as e:
        return {"error": str(e)}
    finally:
        if "user_model_run" in sys.modules:
            del sys.modules["user_model_run"]


def learn_model(
    file_path: str,
    composition_name: str,
    inputs: dict,
    targets: dict,
    epochs: int = 10,
    learning_rate: float | None = None,
    execution_mode: str | None = None,
    use_sandbox: bool = True,
) -> dict:
    """Train a learning-capable composition with supervised targets (#534, L1).

    Args:
        inputs: Dict mapping input-node variable names to per-trial vectors.
        targets: Dict mapping output-node variable names to per-trial target
            vectors (same trial count as inputs).
        epochs: Number of passes over the trial set.
        learning_rate: Optional override of the model's own learning rate.

    Returns:
        Dict with finalLoss, epochLosses (one per epoch), epochs,
        learningRate, numTrials, and results (final-epoch per-trial outputs),
        or an error message. ``metric`` names what epochLosses/finalLoss
        measure (#997): PyTorch loss for an AutodiffComposition; for a plain
        Composition with learning pathways, the prediction error / error at
        target, or — with no target (Hebbian) — the relative weight change.
        A Composition with no learning at all gets a notLearnable flag.
    """
    if use_sandbox:
        return run_in_sandbox("learn", {
            "file_path": file_path,
            "composition_name": composition_name,
            "inputs": inputs,
            "targets": targets,
            "epochs": epochs,
            "learning_rate": learning_rate,
            "execution_mode": execution_mode,
        })
    return _learn_model_inprocess(
        file_path, composition_name, inputs, targets, epochs, learning_rate,
        execution_mode,
    )


# Capability id -> ExecutionMode member name, where they differ (#764).
_EXECUTION_MODE_MEMBERS = {
    "LLVM": "LLVMRun",
}


def _resolve_run_execution_mode(pnl, requested):
    """Pick the ExecutionMode for a forward ``.run()`` (#764).

    Unlike the learn path, this honors what was asked for: every backend that
    is *available* can execute the forward graph, so there is no reason to
    override the user's choice. Returns ``(mode, effective_id, reason)`` —
    ``reason`` is non-None only when the request could not be met, so the
    caller can say why the run used something else.
    """
    from app.services.execution_modes import DEFAULT_RUN_MODE, get_execution_modes

    if requested in (None, ""):
        requested = DEFAULT_RUN_MODE

    info = {m["id"]: m for m in get_execution_modes()}
    if requested not in info:
        return (
            getattr(pnl.ExecutionMode, DEFAULT_RUN_MODE),
            DEFAULT_RUN_MODE,
            f"Unknown execution mode '{requested}' — ran under {DEFAULT_RUN_MODE}.",
        )
    if not info[requested]["available"]:
        return (
            getattr(pnl.ExecutionMode, DEFAULT_RUN_MODE),
            DEFAULT_RUN_MODE,
            info[requested]["reason"] or f"{requested} is unavailable — ran under {DEFAULT_RUN_MODE}.",
        )

    # Our capability ids don't all match ExecutionMode member names. The enum's
    # real members are PyTorch / _LLVM / _PTX / _PerNode / _Exec / _Run /
    # _Fallback; "Python" is a composite alias, and there is no "LLVM" at all —
    # the public compiled-run mode is LLVMRun. Without this mapping, selecting
    # LLVM silently falls back to Python and the option is decorative.
    member = _EXECUTION_MODE_MEMBERS.get(requested, requested)
    mode = getattr(pnl.ExecutionMode, member, None)
    if mode is None:
        # The install advertises the backend but this PsyNeuLink build has no
        # matching ExecutionMode member — fall back rather than AttributeError.
        return (
            getattr(pnl.ExecutionMode, DEFAULT_RUN_MODE),
            DEFAULT_RUN_MODE,
            f"This PsyNeuLink build has no ExecutionMode.{member} — ran under {DEFAULT_RUN_MODE}.",
        )
    return mode, requested, None


def _resolve_learn_execution_mode(pnl, requested, *, is_autodiff=True, has_learning=False):
    """Pick the ExecutionMode for training (#537, honesty fix #765, per-composition #997).

    Returns ``(mode, effective_id, reason)``, where ``reason`` is non-None
    exactly when the request could not be honored, so the UI can say why the
    run trained under something other than what was picked.

    Which backends can train depends on the composition (#763's matrix): an
    AutodiffComposition trains only under PyTorch; a plain Composition with
    learning pathways trains only under Python, through PsyNeuLink's own
    LearningMechanisms. The default — what an omitted request resolves to, and
    what an unusable one falls back to — is the composition's own learnable
    backend, not a global constant. Called without a composition it judges an
    AutodiffComposition, which is what every caller meant before #997.
    """
    from app.services.execution_modes import (
        DEFAULT_LEARN_MODE,
        composition_execution_modes,
        get_execution_modes,
    )

    if is_autodiff:
        info = {m["id"]: m for m in get_execution_modes()}
        default_id = DEFAULT_LEARN_MODE
    else:
        info = {
            m["id"]: m
            for m in composition_execution_modes(is_autodiff=False, has_learning=has_learning)
        }
        default_id = "Python"
    default_mode = getattr(pnl.ExecutionMode, default_id)

    if requested in (None, ""):
        return default_mode, default_id, None

    if requested not in info:
        return (
            default_mode,
            default_id,
            f"Unknown execution mode '{requested}' — trained under {default_id}.",
        )

    entry = info[requested]
    if not entry["available"]:
        return (
            default_mode,
            default_id,
            entry["reason"] or f"{requested} is unavailable — trained under {default_id}.",
        )
    if not entry["learnable"]:
        if not is_autodiff:
            return (
                default_mode,
                default_id,
                f"{entry['reason'] or f'{requested} does not drive learning.'} "
                f"A Composition's learning pathways train under {default_id}.",
            )
        return (
            default_mode,
            default_id,
            entry["reason"]
            or f"{requested} cannot run autodiff training — trained under {default_id}.",
        )

    member = _EXECUTION_MODE_MEMBERS.get(requested, requested)
    mode = getattr(pnl.ExecutionMode, member, None)
    if mode is None:
        return (
            default_mode,
            default_id,
            f"This PsyNeuLink build has no ExecutionMode.{member} — trained under {default_id}.",
        )
    return mode, requested, None


def _learn_model_inprocess(
    file_path: str,
    composition_name: str,
    inputs: dict,
    targets: dict,
    epochs: int,
    learning_rate: float | None,
    execution_mode: str | None = None,
) -> dict:
    """In-process learning (used as fallback and in tests)."""
    import psyneulink as pnl
    from app.services.pathway_learning import METRICS

    try:
        spec = importlib.util.spec_from_file_location("user_model_learn", file_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["user_model_learn"] = module
        before_ids = _snapshot_composition_ids()
        with _suppressed_load():
            spec.loader.exec_module(module)
            _bind_headless_compositions(module, before_ids)

        comp = getattr(module, composition_name, None)
        if comp is None or not isinstance(comp, pnl.Composition):
            return {"error": f"Composition '{composition_name}' not found in {file_path}"}
        if not _is_autodiff(comp):
            # #997: a plain Composition trains through its learning pathways
            # under Python — one shared implementation with the sandbox worker.
            from app.services.pathway_learning import learn_pathway_composition

            return learn_pathway_composition(
                comp, module, inputs, targets,
                epochs=epochs, learning_rate=learning_rate,
                requested_mode=execution_mode,
                resolve_node=_resolve_input_node, serialize=_to_list,
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

        exec_mode, effective_mode, mode_reason = _resolve_learn_execution_mode(pnl, execution_mode)
        learn_kwargs = {
            "inputs": {"inputs": pnl_inputs, "targets": pnl_targets, "epochs": epochs},
            "execution_mode": exec_mode,
            "minibatch_size": 1,
        }
        if learning_rate is not None:
            learn_kwargs["learning_rate"] = float(learning_rate)
        comp.learn(**learn_kwargs)

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

        # comp.results accumulates across all epochs; the last num_trials
        # entries (after the optimization-step stride) are the trained
        # model's final-epoch outputs.
        stride = _optimizations_per_minibatch(comp)
        all_results = list(comp.results)[::stride]
        final_results = all_results[-num_trials:]
        trial_results = [
            {"trial": i, "output": _to_list(r)} for i, r in enumerate(final_results)
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
            "learningKind": "autodiff",
            "metric": METRICS["loss"],
        }

    except Exception as e:
        return {"error": str(e)}
    finally:
        if "user_model_learn" in sys.modules:
            del sys.modules["user_model_learn"]


def get_input_nodes(file_path: str, composition_name: str, use_sandbox: bool = True) -> dict:
    """Get the input nodes and their expected shapes for a composition."""
    if use_sandbox:
        return run_in_sandbox("get_input_nodes", {
            "file_path": file_path,
            "composition_name": composition_name,
        })
    return _get_input_nodes_inprocess(file_path, composition_name)


def _get_input_nodes_inprocess(file_path: str, composition_name: str) -> dict:
    """In-process version."""
    import psyneulink as pnl

    try:
        spec = importlib.util.spec_from_file_location("user_model_info", file_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["user_model_info"] = module
        # Neutralize sys.argv so a library model's module-level argparse uses its
        # defaults instead of raising SystemExit — mirrors the sandbox loader.
        saved_argv = sys.argv
        sys.argv = [file_path]
        before_ids = _snapshot_composition_ids()
        try:
            with _suppressed_load():
                try:
                    spec.loader.exec_module(module)
                except Exception as e:
                    # Raw library models raise after the no-op'd ``.run()`` when
                    # their driver reads results; the Composition is already built,
                    # so proceed to enumerate its input nodes (#796). Kept, in
                    # case it wasn't built: then this is why (#1235).
                    from app.services.sandbox_worker import describe_load_error
                    module.__psyneuview_load_error__ = describe_load_error(e, file_path)
                _bind_headless_compositions(module, before_ids)
        finally:
            sys.argv = saved_argv

        comp = getattr(module, composition_name, None)
        if comp is None or not isinstance(comp, pnl.Composition):
            from app.services.sandbox_worker import missing_composition_error
            return missing_composition_error(module, composition_name)

        # Node roles are computed lazily, so analyze the graph before querying.
        try:
            comp._analyze_graph()
        except Exception:
            pass

        # Use PsyNeuLink's own NodeRole.INPUT classification rather than
        # counting incoming projections — the heuristic mis-handled BIAS /
        # learning machinery (e.g. dropped STATE and surfaced [BIAS] on the
        # Giallanza EGO model, #363).
        from app.services.pathway_learning import is_generated_learning_node

        input_nodes = []
        for node in comp.get_nodes_by_role(pnl.NodeRole.INPUT):
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

    except Exception as e:
        return {"error": str(e)}
    finally:
        if "user_model_info" in sys.modules:
            del sys.modules["user_model_info"]


def _resolve_input_node(comp, module, var_name):
    """Find the composition node an input key refers to.

    A module attribute is trusted only when it is itself a graph node — some
    models also define string name-constants (e.g. ``STATE = 'STATE'``) that
    would otherwise shadow the mechanism. Falls back to matching node names,
    tolerating the ``-N`` suffix PsyNeuLink appends when a name is re-registered
    (which happens when the same model module is loaded more than once).
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


def _to_list(val):
    """Convert numpy arrays to nested lists for JSON serialization."""
    if isinstance(val, np.ndarray):
        return val.tolist()
    if isinstance(val, (list, tuple)):
        return [_to_list(v) for v in val]
    if isinstance(val, (np.integer,)):
        return int(val)
    if isinstance(val, (np.floating,)):
        return float(val)
    return val


def format_pnl_call(method: str, comp_name: str, kwargs: dict) -> str:
    """Render the PsyNeuLink call we are about to make, as source (#766).

    Built from the *actual* kwargs dict handed to ``comp.run`` / ``comp.learn``
    rather than written out by hand, so it cannot drift from what really runs —
    a call string that says one thing while the code does another is worse than
    none at all.

    Bulk arguments are summarized rather than dumped: ``inputs`` for a real
    model is thousands of floats, and the point is to show the *shape* of the
    call, not its payload.
    """
    def render(key, value):
        # ExecutionMode members repr as "ExecutionMode.Python" — exactly the
        # source form someone would type.
        if key in ("execution_mode",):
            return str(value)
        if isinstance(value, dict):
            if key == "inputs" and isinstance(value.get("inputs"), dict):
                # learn() nests its stimuli under one dict. Targets are absent
                # for a model that learns without them (Hebbian, #997).
                inner = value.get("inputs") or {}
                targets = value.get("targets")
                epochs = value.get("epochs")
                trials = len(next(iter(inner.values()), []))
                parts = [f"'inputs': <{len(inner)} node(s) x {trials} trial(s)>"]
                if targets is not None:
                    parts.append(f"'targets': <{len(targets)} node(s)>")
                if epochs is not None:
                    parts.append(f"'epochs': {epochs}")
                return "{" + ", ".join(parts) + "}"
            trials = len(next(iter(value.values()), [])) if value else 0
            return f"<{len(value)} node(s) x {trials} trial(s)>"
        if isinstance(value, float):
            return repr(round(value, 6))
        return repr(value)

    rendered = ", ".join(f"{k}={render(k, v)}" for k, v in kwargs.items() if v is not None)
    return f"{comp_name}.{method}({rendered})"
