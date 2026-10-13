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
