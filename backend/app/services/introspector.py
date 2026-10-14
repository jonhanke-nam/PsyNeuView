"""Execute a PsyNeuLink .py file and introspect the resulting objects.

This is the core of the Python → GUI direction. Instead of parsing the AST,
we run the script and ask PsyNeuLink what it built.

Supports two modes:
- Sandboxed (default): runs in a subprocess for isolation
- In-process: faster, used for tests and when sandbox is not needed
"""

import importlib.util
import sys
import numpy as np
from pathlib import Path

from app.services.sandbox import run_in_sandbox
from app.services.show_graph_guard import suppress_show_graph
from app.services.execution_modes import composition_execution_modes


def load_and_introspect(
    file_path: str,
    use_sandbox: bool = True,
    developer_mode: bool = False,
    flat: bool = False,
    pytorch: bool = False,
    show_graph: dict | None = None,
) -> dict:
    """Execute a .py file and introspect all PsyNeuLink Compositions.

    Args:
        file_path: Path to the .py model file.
        use_sandbox: If True (default), run in a subprocess for isolation.
        developer_mode: If True, don't patch Composition.run/execute/learn —
            let the script's calls into PNL execution actually run. Used for
            extracted pytest tests (#273 / #249) so a loaded test can produce
            real results, not just a graph snapshot. Default False matches
            the existing "open a model file, see the graph" behavior.
        flat: If True, inline every nested composition into a single flat
            node/edge set (#658). Only honored on the sandbox path — the
            in-process serializer keeps the per-composition (nested) view.
        pytorch: If True, serialize the autodiff-flattened (PyTorch) view for
            an AutodiffComposition (#230); ignored for non-autodiff comps.
            Sandbox path only.
        show_graph: If given, also ask show_graph about the model while it is
            loaded, for the "Like show_graph" layout (#27); the answers come
            back under ``showGraph``. Sandbox path only.

    Returns a JSON-serializable dict describing the full model graph.
    """
    if use_sandbox:
        result = run_in_sandbox(
            "introspect",
            {"file_path": file_path, "developer_mode": developer_mode, "flat": flat, "pytorch": pytorch,
             "show_graph": show_graph},
        )
        # Return the full result even if it contains an error — the error
        # message, diagnostics, and any partial data are all useful to the
        # frontend. Only raise if the result has no compositions key at all
        # (indicating a catastrophic sandbox failure).
        if "compositions" not in result and "error" in result:
            raise RuntimeError(result["error"])
        return result
    return _load_and_introspect_inprocess(file_path, developer_mode=developer_mode)

# Parameters to skip — these are internal/computed, not user-facing
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


def _to_json_value(val):
    """Convert a Python value to something JSON-serializable."""
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
        return [_to_json_value(v) for v in val]
    if isinstance(val, dict):
        return {k: _to_json_value(v) for k, v in val.items()}
    # Fall back to string repr for complex objects
    return None


def _load_and_introspect_inprocess(
    file_path: str,
    developer_mode: bool = False,
) -> dict:
    """In-process introspection (used as fallback and in tests).

    See ``load_and_introspect`` for the meaning of ``developer_mode``.
    """
    import psyneulink as pnl

    # Read source for line mapping and header metadata
    source = Path(file_path).read_text()
    line_map = _build_declaration_index(source)
    header = _parse_header(source)

    # Check for PsyNeuLink version mismatch (compare base version only,
    # ignoring dev/local suffixes like +227.ge814fc5aad)
    warnings = []
    if header.get("psyneulink_version"):
        current_version = getattr(pnl, "__version__", "unknown")
        file_version = header["psyneulink_version"]
        file_base = file_version.split("+")[0].split(".dev")[0]
        current_base = current_version.split("+")[0].split(".dev")[0]
        if file_base != current_base:
            warnings.append(
                f"Model was written for PsyNeuLink {file_version}, "
                f"but you are running {current_version}. "
                f"Some features may behave differently."
            )

    # Record existing Compositions before loading, so we can detect new ones
    # created inside functions (gc fallback for function-scoped Compositions).
    # The snapshot holds the objects, not just their ids: an id-only snapshot
    # let a freed earlier Composition lend its id to the one this load builds,
    # which was then skipped as pre-existing (#1382).
    from app.services.sandbox_worker import _composition_snapshot
    comps_before = _composition_snapshot()

    # Load and execute the script as a module.
    # - Clears sys.argv so argparse scripts use defaults
    # - Patches Composition.run/execute to no-ops (skips simulations)
    # - Suppresses matplotlib plotting
    spec = importlib.util.spec_from_file_location("user_model", file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["user_model"] = module

    saved_argv = sys.argv
    sys.argv = [file_path]

    # Patch PNL execution and matplotlib to no-ops during introspection.
    # This lets us load library models that run simulations and plot at
    # module level without waiting for execution or opening windows.
    # Execution patches are skipped under developer_mode (#273 / #249) so
    # extracted pytest tests can actually execute their .run/.learn calls —
    # but show_graph is suppressed unconditionally: a module-level
    # comp.show_graph() must never render a graphviz PDF that the OS opens in
    # Preview during a load, in any mode (#608).
    restore_fns = []
    noop = lambda self, *a, **kw: None
    # Across the whole hierarchy, not just the root: AutodiffComposition
    # defines its own show_graph, so patching Composition alone left EM models
    # still rendering a PDF over the app (#1090).
    restore_fns.extend(suppress_show_graph(pnl.Composition))
    if not developer_mode:
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

        try:
            import matplotlib
            matplotlib.use('Agg')
            import matplotlib.pyplot as plt
            _orig_plt = {}
            for fn_name in ('show', 'plot', 'xlabel', 'ylabel', 'title',
                             'legend', 'xlim', 'ylim', 'xticks', 'yticks',
                             'figure', 'subplot', 'subplots', 'savefig'):
                if hasattr(plt, fn_name):
                    _orig_plt[fn_name] = getattr(plt, fn_name)
                    setattr(plt, fn_name, lambda *a, **kw: None)
            restore_fns.append(lambda: [setattr(plt, n, f) for n, f in _orig_plt.items()])
        except ImportError:
            pass

    # Clear the process-global PNL registry before executing, so re-loading a
    # model in this long-lived backend doesn't re-register names and suffix
    # them ('STATE' -> 'STATE-1'), which would surface as numbered nodes on the
    # canvas (#642). Mirrors sandbox_worker.py before its resilient load.
    pnl.clear_registry()

    execution_error = None
    try:
        spec.loader.exec_module(module)
        # Factory-only library models (e.g. Giallanza2024 EGO) build nothing at
        # import — construct_model() runs only under __main__. Materialize its
        # Composition now, while the no-op patches are still active so the build
        # can't fire a train/run (#855). Shared with the sandbox worker path.
        from app.services.sandbox_worker import _materialize_factory_composition
        _materialize_factory_composition(module)
    except Exception as e:
        # Post-execution errors (e.g. accessing run results after no-op'd run)
        # are expected for library models. The model definition is still valid.
        execution_error = str(e)
    finally:
        sys.argv = saved_argv
        for fn in restore_fns:
            fn()

    # Resolve PNL names → local vars now that the module has executed, so
    # function-scoped nodes get stable editable handles (#422).
    name_to_var = _build_name_index(source, vars(module))

    # Find all Composition instances in the module's namespace
    all_comps = {}
    for name, obj in vars(module).items():
        if isinstance(obj, pnl.Composition) and not name.startswith("_"):
            all_comps[name] = obj

    # Fallback: if no module-level Compositions found, search via gc.
    # This catches Compositions created inside functions (e.g. library models
    # that define Compositions in helper functions called at module level).
    if not all_comps:
        import gc
        gc.collect()
        for obj in gc.get_objects():
            if isinstance(obj, pnl.Composition) and id(obj) not in comps_before:
                # Use the Composition's name as the variable name
                var_name = obj.name.replace(" ", "_").replace("-", "_")
                all_comps[var_name] = obj

    # Identify top-level compositions (not nested inside another)
    nested_ids = set()
    for comp in all_comps.values():
        for node in comp.nodes:
            if isinstance(node, pnl.Composition):
                nested_ids.add(id(node))

    compositions = []
    for name, obj in all_comps.items():
        if id(obj) not in nested_ids:
            compositions.append(_serialize_composition(name, obj, line_map, name_to_var))

    # Clean up
    del sys.modules["user_model"]

    result = {
        "compositions": compositions,
        "lineMap": line_map,
        "header": header,
    }
    if warnings:
        result["warnings"] = warnings
    if execution_error:
        if compositions:
            # #796: the model's definition loaded fine (compositions found).
            # This error is from the model's own module-level driver running
            # *after* the no-op'd .run() — e.g. accessing run results / log data
            # that don't exist (the exact "post-execution error, definition
            # still valid" case noted above). Common in raw upstream library
            # models. Surface it via the calm "notices" channel (not a warning)
            # so the graph loads cleanly and the model is accommodated as-is
            # (#848), instead of a hard `error` the frontend reads as failure.
            result.setdefault("notices", []).append(
                "Non-fatal: model definition loaded, but its module-level driver "
                f"raised after the no-op'd run: {execution_error}"
            )
        else:
            # No compositions found — the error is a genuine load failure.
            result["error"] = execution_error
    return result


def _parse_header(source: str) -> dict:
    """Parse the standardized header comments from a model file.

    Looks for lines like:
        # Format Version: 1.0
        # PsyNeuLink: 0.18.0
        # Model: my_model
    """
    import re
    header = {}
    for line in source.splitlines():
        line = line.strip()
        if not line.startswith("#"):
            if line:  # Non-comment, non-empty line — end of header
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
    return header


def _build_declaration_index(source: str) -> dict:
    """Map local variable names to their declaration line (#422).

    Returns ``{var_name: line_number}`` (1-indexed) for every
    ``<var> = pnl.<Class>(`` declaration, including indented
    (function-scoped) ones. Also records ``scheduler.add_condition`` lines.
    """
    import re
    line_map = {}
    for i, line in enumerate(source.splitlines(), 1):
        # Accepts any dotted path to a capitalized callable, so `pnl.Thing(`,
        # bare `Thing(`, `psyneulink.Thing(` and `pnl.core.Thing(` all count.
        # The writer has always matched all four; indexing only the `pnl.`
        # form meant nodes it could edit were reported as uneditable (#1140).
        # Capitalized, not any callable, so `x = compute(...)` is not indexed
        # as a declaration. Kept byte-identical to the copy in sandbox_worker.py —
        # test_declaration_pattern_shared.py fails if they drift.
        match = re.match(r"^\s*(\w+)\s*=\s*(?:\w+\.)*(?:[A-Z]\w*)\(", line)
        if match and match.group(1) not in line_map:
            line_map[match.group(1)] = i
        match = re.match(r"^\s*\w+\.scheduler\.add_condition\(\s*(\w+)", line)
        if match:
            line_map[f"_sched_{match.group(1)}_{i}"] = i
    return line_map


def _build_name_index(source: str, namespace: dict) -> dict:
    """Map each component's PNL name to its local variable (#422).

    Walks the AST for ``<var> = pnl.<Class>(...)`` assignments and evaluates
    the ``name=`` keyword against the executed module ``namespace`` — so a
    node whose PNL name comes from a constant/expression (e.g. ``name=STATE``
    in the EGO model) still resolves to a stable, writable handle. The source
    was already executed, so evaluating these kwargs adds no trust boundary.
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
    import re
    clean = re.sub(r"-\d+$", "", node_name)
    for key in (node_name, clean):
        var = name_to_var.get(key)
        if var:
            return var
    if clean in line_map:
        return clean
    return None


def _build_line_map(source: str) -> dict:
    """Parse source to map variable names to their line numbers.

    Looks for patterns like: var_name = pnl.SomeClass(
    Returns {var_name: line_number} (1-indexed).
    """
    return _build_declaration_index(source)


def _serialize_composition(var_name: str, comp, line_map: dict, name_to_var: dict | None = None) -> dict:
    """Serialize a PsyNeuLink Composition to a JSON-serializable dict."""
    import psyneulink as pnl
    if name_to_var is None:
        name_to_var = {}
    # AutodiffComposition is in the library; absent in older PNL builds.
    try:
        from psyneulink.library.compositions import AutodiffComposition
        is_autodiff = isinstance(comp, AutodiffComposition)
    except ImportError:
        is_autodiff = False

    # #763: learning pathways make a plain Composition trainable under Python
    # (PsyNeuLink's own LearningMechanisms). Autodiff comps are learnable by
    # construction, so this only decides the non-autodiff case.
    try:
        has_learning = bool(getattr(comp, "learning_components", None))
    except Exception:
        has_learning = False

    nodes = []
    for node in comp.nodes:
        if isinstance(node, pnl.Composition):
            node_data = _serialize_composition(node.name, node, line_map, name_to_var)
            node_data["kind"] = "composition"
        else:
            node_data = _serialize_mechanism(node)
            node_data["kind"] = "mechanism"
            handle = _resolve_node_handle(node.name, line_map, name_to_var)
            if handle:
                node_data["varName"] = handle
                node_data["line"] = line_map.get(handle)
        nodes.append(node_data)

    projections = []
    for proj in comp.projections:
        proj_data = _serialize_projection_in_context(proj, comp)
        if proj_data:
            projections.append(proj_data)

    scheduling = _serialize_gsc_conditions(comp)
    basic_conditions = _serialize_basic_conditions(comp)
    termination_conds = _serialize_termination_conditions(comp)
    scheduler_config = _serialize_scheduler_config(comp)

    return {
        "varName": var_name,
        "name": comp.name,
        "kind": "composition",
        "compositionType": type(comp).__name__,
        "isAutodiff": is_autodiff,
        "hasLearning": has_learning,
        # #763: which backends this specific composition can run / train under,
        # already combined with install availability so the UI doesn't re-derive
        # the matrix. Computed here because the model is loaded anyway.
        "executionModes": composition_execution_modes(
            is_autodiff=is_autodiff, has_learning=has_learning
        ),
        # #997: how this composition learns (autodiff / learning pathway /
        # not at all), which nodes take targets, and what each epoch reports.
        "learningProfile": _learning_profile(comp, is_autodiff),
        "nodes": nodes,
        "projections": projections,
        "scheduling": scheduling,
        "basicConditions": basic_conditions,
        "terminationConditions": termination_conds,
        "schedulerConfig": scheduler_config,
        "line": line_map.get(var_name),
    }


def _operation_to_name(val):
    """Convert a graph_scheduler Operation value to a readable name."""
    import functools
    if hasattr(val, 'name') and isinstance(val.name, str):
        return val.name
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


def _serialize_gsc_conditions(comp) -> list:
    """Extract GraphStructureConditions from a Composition's scheduler."""
    import re as _re

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
        return _re.sub(r'-\d+$', '', name) if name else name

    gsc_list = []
    for owner_node, conditions in structural.items():
        owner_name = _clean_name(
            owner_node.name if hasattr(owner_node, 'name') else str(owner_node)
        )
        for idx, gsc in enumerate(conditions):
            gsc_type = type(gsc).__name__
            target_nodes = []
            if hasattr(gsc, 'nodes') and gsc.nodes:
                for n in gsc.nodes:
                    target_nodes.append(
                        _clean_name(n.name if hasattr(n, 'name') else str(n))
                    )
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


def _serialize_condition(cond) -> dict:
    """Recursively serialize a Condition to a JSON-friendly dict."""
    import re as _re

    def _clean_name(name):
        return _re.sub(r'-\d+$', '', name) if name else name

    def _arg_to_json(arg):
        if hasattr(arg, 'name') and hasattr(arg, 'parameters'):
            return {"_node": _clean_name(arg.name)}
        if isinstance(arg, (int, float, bool, str)):
            return arg
        if isinstance(arg, (list, tuple)):
            return [_arg_to_json(a) for a in arg]
        try:
            from graph_scheduler.condition import ConditionBase
            if isinstance(arg, ConditionBase):
                return _serialize_condition(arg)
        except ImportError:
            pass
        return str(arg)

    cond_type = type(cond).__name__
    if cond_type in ('All', 'Any', 'Not', 'NWhen', 'And', 'Or'):
        children = [_arg_to_json(a) for a in (cond.args or [])]
        result = {"type": cond_type, "children": children}
        if cond_type == 'NWhen' and hasattr(cond, 'kwargs'):
            n = cond.kwargs.get('n')
            if n is not None:
                result["n"] = n
        result["explanation"] = _explain_condition(result)
        return result

    result = {"type": cond_type, "args": {}}
    parsed_args = [_arg_to_json(a) for a in (cond.args or ())]
    if parsed_args:
        result["args"]["positional"] = parsed_args
    for k, v in (cond.kwargs or {}).items():
        if k in ('_owner',):
            continue
        result["args"][k] = _arg_to_json(v)
    if not result["args"]:
        del result["args"]
    result["explanation"] = _explain_condition(result)
    return result


# Plain-English templates for flat conditions, keyed by type. {node}/{n} are
# filled from the condition's positional args. Phrases are sentence fragments
# describing *when the owning node runs*.
_CONDITION_PHRASES = {
    "EveryNCalls": "every {n} times {node} runs",
    "AfterNCalls": "after {node} has run {n} times",
    "BeforeNCalls": "before {node} has run {n} times",
    "AtNCalls": "when {node} has run exactly {n} times",
    "AfterCall": "after call number {n} of {node}",
    "JustRan": "right after {node} runs",
    "WhenFinished": "when {node} finishes",
    "AtPass": "at pass {n}",
    "AfterPass": "after pass {n}",
    "BeforePass": "before pass {n}",
    "EveryNPasses": "every {n} passes",
    "AtTrial": "at trial {n}",
    "AfterTrial": "after trial {n}",
    "BeforeTrial": "before trial {n}",
    "AfterNTrials": "after {n} trials",
    "AtTimeStep": "at time step {n}",
    "AfterTimeStep": "after time step {n}",
    "BeforeTimeStep": "before time step {n}",
    "AfterNTimeSteps": "after {n} time steps",
    "AtRun": "at run {n}",
    "AfterRun": "after run {n}",
    "AfterNRuns": "after {n} runs",
    "Always": "always",
    "Never": "never",
    "AllHaveRun": "once all nodes have run",
    "AtTrialStart": "at the start of each trial",
    "AtRunStart": "at the start of each run",
}


def _explain_condition(d: dict) -> str:
    """Render a serialized condition dict as a plain-English sentence fragment."""
    cond_type = d.get("type", "")

    children = d.get("children")
    if children is not None:
        kid_text = [c.get("explanation") or _explain_condition(c) for c in children]
        if cond_type == "Not":
            inner = kid_text[0] if kid_text else "that condition"
            return f"not ({inner})"
        if cond_type == "NWhen":
            inner = kid_text[0] if kid_text else "that condition"
            n = d.get("n", 1)
            return f"the first {n} time(s) that {inner}"
        joiner = "all of" if cond_type in ("All", "And") else "any of"
        return f"{joiner}: " + "; ".join(kid_text)

    positional = (d.get("args", {}) or {}).get("positional", []) or []
    node = None
    n = None
    for a in positional:
        if isinstance(a, dict) and "_node" in a:
            node = a["_node"]
        elif isinstance(a, (int, float)):
            n = a

    template = _CONDITION_PHRASES.get(cond_type)
    if template is None:
        return cond_type
    try:
        return template.format(node=node, n=n)
    except (KeyError, IndexError):
        return cond_type


def _serialize_basic_conditions(comp) -> list:
    """Extract basic conditions from the scheduler."""
    import re as _re
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
        return _re.sub(r'-\d+$', '', name) if name else name

    return [
        {
            "owner": _clean_name(node.name if hasattr(node, 'name') else str(node)),
            "condition": _serialize_condition(cond),
        }
        for node, cond in basic.items()
    ]


def _serialize_termination_conditions(comp) -> dict:
    """Extract termination conditions from the scheduler."""
    scheduler = getattr(comp, 'scheduler', None)
    if scheduler is None:
        return {}
    term_conds = getattr(scheduler, 'termination_conds', None)
    if not term_conds:
        return {}
    return {
        (ts.name if hasattr(ts, 'name') else str(ts)): _serialize_condition(cond)
        for ts, cond in term_conds.items()
    }


def _serialize_scheduler_config(comp) -> dict:
    """Extract scheduler configuration metadata."""
    import re as _re
    scheduler = getattr(comp, 'scheduler', None)
    if scheduler is None:
        return {}

    def _clean_name(name):
        return _re.sub(r'-\d+$', '', name) if name else name

    result = {}
    mode = getattr(scheduler, 'mode', None)
    if mode is not None:
        result["mode"] = mode.name if hasattr(mode, 'name') else str(mode)
    cq = getattr(scheduler, 'consideration_queue', None)
    if cq:
        result["considerationQueue"] = [
            [_clean_name(n.name) if hasattr(n, 'name') else str(n) for n in step]
            for step in cq
        ]
    return result


def _serialize_mechanism(mech) -> dict:
    """Serialize a Mechanism with its ports and parameters."""
    input_ports = [
        {
            "name": p.name,
            "shape": list(p.defaults.value.shape) if hasattr(p.defaults.value, "shape") else [],
        }
        for p in mech.input_ports
    ]
    output_ports = [
        {
            "name": p.name,
            "shape": list(p.defaults.value.shape) if hasattr(p.defaults.value, "shape") else [],
        }
        for p in mech.output_ports
    ]
    parameter_ports = []
    if hasattr(mech, "parameter_ports") and mech.parameter_ports is not None:
        for p in mech.parameter_ports:
            try:
                shape = list(p.defaults.value.shape) if hasattr(p.defaults.value, "shape") else []
            except Exception:
                shape = []
            parameter_ports.append({"name": p.name, "shape": shape})

    # Extract actual parameter values using .get()
    params = {}
    if hasattr(mech, "parameters"):
        for param_name in mech.parameters.names():
            if param_name in _SKIP_MECH_PARAMS:
                continue
            try:
                val = getattr(mech.parameters, param_name).get()
                json_val = _to_json_value(val)
                if json_val is not None:
                    params[param_name] = json_val
            except Exception:
                pass

    # #1385: RecurrentTransferMechanism's enable_learning Parameter never
    # takes the constructor's value; report whether it was built to learn.
    if "enable_learning" in params:
        try:
            from app.services.pathway_learning import constructed_learning_flag
            built = constructed_learning_flag(mech)
            if built is not None:
                params["enable_learning"] = built
        except Exception:
            pass

    # Function info with actual values
    func_info = None
    if hasattr(mech, "function") and mech.function is not None:
        func = mech.function
        func_params = {}
        if hasattr(func, "parameters"):
            for param_name in func.parameters.names():
                if param_name in _SKIP_FUNC_PARAMS:
                    continue
                try:
                    val = getattr(func.parameters, param_name).get()
                    json_val = _to_json_value(val)
                    if json_val is not None:
                        func_params[param_name] = json_val
                except Exception:
                    pass
        func_info = {
            "type": type(func).__name__,
            "params": func_params,
        }

    return {
        "name": mech.name,
        "type": type(mech).__name__,
        "inputPorts": input_ports,
        "outputPorts": output_ports,
        "parameterPorts": parameter_ports,
        "params": params,
        "function": func_info,
    }


def _extract_projection_params(proj) -> tuple[dict, dict | None]:
    """Extract parameters and function info from a projection."""
    params = {}
    if hasattr(proj, "parameters"):
        for param_name in proj.parameters.names():
            if param_name in _SKIP_PROJ_PARAMS:
                continue
            try:
                val = getattr(proj.parameters, param_name).get()
                json_val = _to_json_value(val)
                if json_val is not None:
                    params[param_name] = json_val
            except Exception:
                pass

    func_info = None
    if hasattr(proj, "function") and proj.function is not None:
        func = proj.function
        func_params = {}
        if hasattr(func, "parameters"):
            for param_name in func.parameters.names():
                if param_name in _SKIP_FUNC_PARAMS:
                    continue
                try:
                    val = getattr(func.parameters, param_name).get()
                    json_val = _to_json_value(val)
                    if json_val is not None:
                        func_params[param_name] = json_val
                except Exception:
                    pass
        func_info = {
            "type": type(func).__name__,
            "params": func_params,
        }

    return params, func_info


def _serialize_projection(proj) -> dict:
    """Serialize a Projection."""
    params, func_info = _extract_projection_params(proj)
    return {
        "name": proj.name,
        "type": type(proj).__name__,
        "sender": {
            "mechanism": proj.sender.owner.name if proj.sender.owner else None,
            "port": proj.sender.name,
        },
        "receiver": {
            "mechanism": proj.receiver.owner.name if proj.receiver.owner else None,
            "port": proj.receiver.name,
        },
        "params": params,
        "function": func_info,
    }


def _serialize_projection_in_context(proj, comp) -> dict | None:
    """Serialize a projection, resolving CIM references to user-facing nodes.

    Cross-composition projections go through CIMs (CompositionInterfaceMechanisms).
    We map these back to the composition node they belong to. Purely internal
    CIM-to-CIM projections within nested compositions are filtered out.
    """
    sender_owner = proj.sender.owner
    receiver_owner = proj.receiver.owner

    if not sender_owner or not receiver_owner:
        return None

    sender_name = sender_owner.name
    receiver_name = receiver_owner.name

    # Resolve CIM references: "X Input_CIM" or "X Output_CIM" → the composition "X"
    if "Input_CIM" in sender_name:
        # Sender is an Input_CIM — this is an internal routing, skip
        return None
    if "Output_CIM" in receiver_name:
        # Receiver is an Output_CIM — internal routing, skip
        return None

    if "Output_CIM" in sender_name:
        # Sender is Output_CIM of a nested composition → resolve to that composition
        # "inner_comp Output_CIM" → "inner_comp"
        comp_name = sender_name.replace(" Output_CIM", "")
        sender_name = comp_name

    if "Input_CIM" in receiver_name:
        # Receiver is Input_CIM of a nested composition → resolve to that composition
        comp_name = receiver_name.replace(" Input_CIM", "")
        receiver_name = comp_name

    params, func_info = _extract_projection_params(proj)
    return {
        "name": proj.name,
        "type": type(proj).__name__,
        "sender": {
            "mechanism": sender_name,
            "port": proj.sender.name,
        },
        "receiver": {
            "mechanism": receiver_name,
            "port": proj.receiver.name,
        },
        "params": params,
        "function": func_info,
    }


def _learning_profile(comp, is_autodiff):
    """The Learn tab's per-composition profile (#997); never fails a load."""
    try:
        from app.services.pathway_learning import learning_profile

        return learning_profile(comp, is_autodiff=is_autodiff)
    except Exception:
        return None
