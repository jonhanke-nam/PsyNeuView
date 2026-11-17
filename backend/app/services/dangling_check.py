"""Static-analysis pass that finds dangling projection declarations.

A projection is "dangling" when its ``sender=`` or ``receiver=`` references a
variable that is not assigned anywhere at module scope. This typically arises
when a mechanism was deleted from the GUI (or the source) and the projections
that referenced it were left behind. Such files usually fail to ``exec`` with
a NameError, so the runtime introspector returns no compositions. This pass
runs purely on the source (AST) and works regardless of exec success.

Detected dangling refs are reported alongside the model graph so the frontend
can render a clear "broken projection" indicator and a validation surface
listing every dangling reference.
"""

from __future__ import annotations

import ast


def find_dangling_projections(source: str) -> list[dict]:
    """Return a list of dangling projection records found in ``source``.

    Each record has:

    - ``varName`` — the projection's variable name
    - ``type`` — the projection class (e.g. ``"MappingProjection"``)
    - ``line`` — 1-based source line of the declaration
    - ``senderRef`` — the variable name referenced as sender (may be None)
    - ``receiverRef`` — the variable name referenced as receiver (may be None)
    - ``missing`` — list of referenced names that are not defined anywhere
    - ``missingSide`` — ``"sender"``, ``"receiver"``, or ``"both"``
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []

    defined_names = _collect_defined_names(tree)

    dangling: list[dict] = []
    for node in ast.walk(tree):
        record = _check_projection_assign(node, defined_names)
        if record is not None:
            dangling.append(record)
    return dangling


def _collect_defined_names(tree: ast.AST) -> set[str]:
    """Return all names assigned somewhere in the tree (best-effort).

    We collect both module-level and function-level assignments. The point is
    to avoid false positives: a name like ``A`` defined inside a helper is
    still a valid in-scope reference for projections built next to it.
    """
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                names.update(_targets_to_names(target))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
        elif isinstance(node, ast.AugAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.For) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                names.add(alias.asname or alias.name.split(".")[0])
    return names


def _targets_to_names(target: ast.AST) -> list[str]:
    if isinstance(target, ast.Name):
        return [target.id]
    if isinstance(target, (ast.Tuple, ast.List)):
        out = []
        for elt in target.elts:
            out.extend(_targets_to_names(elt))
        return out
    return []


def _check_projection_assign(node: ast.AST, defined_names: set[str]) -> dict | None:
    """If ``node`` is ``<var> = pnl.<...Projection>(...)`` and any endpoint
    reference is undefined, return a dangling record. Otherwise return None."""
    if not isinstance(node, ast.Assign) or len(node.targets) != 1:
        return None
    target = node.targets[0]
    if not isinstance(target, ast.Name) or not isinstance(node.value, ast.Call):
        return None

    cls_name = _call_class_name(node.value.func)
    if cls_name is None or not cls_name.endswith("Projection"):
        return None

    sender_ref = _endpoint_ref(node.value, kwname="sender", positional_index=0)
    receiver_ref = _endpoint_ref(node.value, kwname="receiver", positional_index=1)

    missing: list[str] = []
    if sender_ref and sender_ref not in defined_names:
        missing.append(sender_ref)
    if receiver_ref and receiver_ref not in defined_names and receiver_ref != sender_ref:
        missing.append(receiver_ref)
    if not missing:
        return None

    sender_missing = sender_ref is not None and sender_ref not in defined_names
    receiver_missing = receiver_ref is not None and receiver_ref not in defined_names
    if sender_missing and receiver_missing:
        side = "both"
    elif sender_missing:
        side = "sender"
    else:
        side = "receiver"

    return {
        "varName": target.id,
        "type": cls_name,
        "line": node.lineno,
        "senderRef": sender_ref,
        "receiverRef": receiver_ref,
        "missing": missing,
        "missingSide": side,
    }


def _call_class_name(func: ast.AST) -> str | None:
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return None


def _endpoint_ref(call: ast.Call, *, kwname: str, positional_index: int) -> str | None:
    """Find the variable name passed as ``call.kwname=`` (or by position).

    Returns None when the endpoint is not a plain name reference — e.g. it's a
    literal, an inline expression, or absent. We only flag *named* references
    as potentially dangling; non-name endpoints aren't something the user can
    accidentally orphan by deleting a mechanism.
    """
    for keyword in call.keywords:
        if keyword.arg == kwname:
            return _name_of(keyword.value)
    if positional_index < len(call.args):
        return _name_of(call.args[positional_index])
    return None


def _name_of(value: ast.AST) -> str | None:
    """Extract a name from ``X``, ``X['port']``, or ``X.output_ports[...]``."""
    if isinstance(value, ast.Name):
        return value.id
    if isinstance(value, ast.Subscript):
        return _name_of(value.value)
    if isinstance(value, ast.Attribute):
        return _name_of(value.value)
    return None


def find_broken_projections(source: str, skipped: list[dict] | None) -> list[dict]:
    """Projections whose statement raised, so they were never made (#1235).

    A dangling projection names an endpoint that doesn't exist. A *broken* one
    names two that do, but PsyNeuLink refused to connect them, typically
    because their shapes don't match. The resilient load skips that statement
    (#615), so the connection just vanished from the graph, and the only clue
    was two nodes that used to be joined no longer being so.

    ``skipped`` is the resilient load's ``[{line, error}]``. Returns one record
    per skipped statement that is ``<var> = pnl.<...Projection>(...)``, with its
    endpoints and PsyNeuLink's reason.
    """
    if not skipped:
        return []
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []
    by_line = {s.get("line"): s.get("error", "") for s in skipped if s.get("line")}
    broken: list[dict] = []
    for node in tree.body:
        if node.lineno not in by_line:
            continue
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name) or not isinstance(node.value, ast.Call):
            continue
        cls_name = _call_class_name(node.value.func)
        if cls_name is None or not cls_name.endswith("Projection"):
            continue
        broken.append({
            "varName": target.id,
            "type": cls_name,
            "line": node.lineno,
            "senderRef": _endpoint_ref(node.value, kwname="sender", positional_index=0),
            "receiverRef": _endpoint_ref(node.value, kwname="receiver", positional_index=1),
            "error": by_line[node.lineno],
        })
    return broken


# Composition and scheduler methods that build the model, as opposed to
# driving it (#254).
_DEFINITION_METHODS = {
    "add_condition", "add_condition_set", "add_node", "add_nodes",
    "add_projection", "add_projections", "add_linear_processing_pathway",
    "add_pathways", "add_controller", "add_required_node_role",
    "add_backpropagation_learning_pathway", "add_reinforcement_learning_pathway",
    "add_td_learning_pathway", "add_linear_learning_pathway",
}

# What a module-level driver does: run the model, read what it produced, show
# it. Errors there are expected under the introspector's no-op'd run (#796).
_DRIVER_MARKERS = (
    ".run(", ".learn(", ".execute(", ".results", ".log", "print(", "plt.",
    "show_graph(", ".plot(", "nparray", "np.save", "open(",
)


def find_skipped_definitions(source: str, skipped: list[dict] | None) -> list[dict]:
    """Skipped statements that define the model, so their errors are real (#254).

    The resilient load (#615) skips any top-level statement that raises, and
    when the Composition still builds, the error was reported only as a calm
    "module-level driver" notice (#796, #848). That suits a driver reading the
    results of a run the introspector skipped. It hid
    ``comp.scheduler.add_condition(C, pnl.BeforeNode(UNDEFINED))``: the model
    loaded without that condition and no error was shown.

    Returns ``[{line, error}]`` for each skipped statement that builds the
    model: a scheduler condition, a Composition ``add_*`` call, or a
    ``pnl.<Class>(...)`` construction. Projections are left out: dangling and
    broken projections are already shown on the graph (#615, #1235). Anything
    that looks like a driver (runs, reads results, prints, plots) is left out.
    """
    if not skipped:
        return []
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []
    by_line = {s.get("line"): s.get("error", "") for s in skipped if s.get("line")}
    found: list[dict] = []
    for node in tree.body:
        if node.lineno not in by_line:
            continue
        text = ast.get_source_segment(source, node) or ""
        if any(marker in text for marker in _DRIVER_MARKERS):
            continue
        if _is_definition(node):
            found.append({"line": node.lineno, "error": by_line[node.lineno]})
    return found


def _is_definition(node: ast.AST) -> bool:
    value = None
    if isinstance(node, ast.Expr):
        value = node.value
    elif isinstance(node, (ast.Assign, ast.AnnAssign)):
        value = node.value
    if not isinstance(value, ast.Call):
        return False
    func = value.func
    # comp.add_node(...), comp.scheduler.add_condition(...)
    if isinstance(func, ast.Attribute) and func.attr in _DEFINITION_METHODS:
        return True
    # x = pnl.TransferMechanism(...), x = Composition(...): a construction.
    # Projections are shown on the graph instead (find_broken_projections).
    cls_name = _call_class_name(func)
    if cls_name and cls_name[:1].isupper() and not cls_name.endswith("Projection"):
        return isinstance(node, (ast.Assign, ast.AnnAssign))
    return False
