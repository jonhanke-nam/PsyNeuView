"""The tools the agent may call: exactly ``TOOL_ALLOWLIST`` (#179).

Every tool checks its own permission on the server on every call, against the
settings as they are now, not as they were when the session started. A tool
that isn't on the list doesn't exist for the agent; the session loop answers
such a call with a ``refused`` event. No tool runs a model, runs a shell,
reaches the network, or changes settings.

File rules live in ``files.py`` and review state in ``review.py``.

An ``app_edit`` proposal carries only structured ops from ``APP_EDIT_OPS``,
each argument checked here as plain data before a proposal exists: values
must be literals (``ast.literal_eval``, no names and no calls), identifiers
must be Python identifiers that aren't keywords, and everything else is a
choice from a fixed list. The page applies the ops through the user's own
edit routes and never applies text as source. Free-form Python reaches a file
only through ``propose_file_write``, which is approved and reviewed.
"""

from __future__ import annotations

import ast
import hashlib
import keyword
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

from app.services.assistant import files, review  # noqa: F401  (review is re-exported for the accept route)
from app.services.assistant.files import PathRefused

TOOL_ALLOWLIST: tuple[str, ...] = (
    "read_open_model",
    "read_docs",
    "propose_app_edit",
    "list_files",
    "read_file",
    "propose_file_write",
    "propose_open_file",
)

DOCS_DIR = Path(__file__).resolve().parents[4] / "docs"
MAX_DOC_HITS = 8
MAX_DOC_SNIPPET = 600


class ToolRefused(Exception):
    """The call isn't allowed; the reason is shown to the user and the agent."""


class ToolContext:
    """What a tool call may see: the settings now, the page's filtered context,
    and the session's proposal store."""

    def __init__(self, *, settings: dict, context: dict, session: Any):
        self.settings = settings
        self.context = context
        self.session = session


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ── definitions the agent sees ───────────────────────────────────────────

_STRING = {"type": "string"}

TOOL_DEFINITIONS: list[dict] = [
    {
        "name": "read_open_model",
        "description": "The model open in PsyNeuView, as far as the user shares it: file path, source, selection, errors, results.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "read_docs",
        "description": "Search the PsyNeuView and PsyNeuLink documentation for a phrase.",
        "input_schema": {"type": "object", "properties": {"query": _STRING}, "required": ["query"], "additionalProperties": False},
    },
    {
        "name": "propose_app_edit",
        "description": (
            "Propose a structured edit to the open model for the user to accept, as a list of ops. "
            "Allowed ops and their args: "
            "update_param {var_name, param_name, new_value, context: mechanism|function, function_class?}; "
            "rename_node {var_name, new_name}; "
            "add_port {var_name, port_kind: input|output, new_name}; "
            "remove_port {var_name, port_kind, port_name}; "
            "rename_port {var_name, port_kind, old_name, new_name}. "
            "new_value must be a plain literal (number, string, list, dict, True/False/None): no names, no calls. "
            "To change code freely, use propose_file_write on the open file instead."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "summary": _STRING,
                "ops": {"type": "array", "items": {"type": "object", "properties": {"op": _STRING, "args": {"type": "object"}}, "required": ["op", "args"]}},
            },
            "required": ["summary", "ops"],
            "additionalProperties": False,
        },
    },
    {
        "name": "list_files",
        "description": "List the model files in the folders the user allows.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "read_file",
        "description": "Read a model file's text from an allowed folder. The file is not run.",
        "input_schema": {"type": "object", "properties": {"path": _STRING}, "required": ["path"], "additionalProperties": False},
    },
    {
        "name": "propose_file_write",
        "description": "Propose writing a model file in a read-and-write folder, for the user to accept.",
        "input_schema": {
            "type": "object",
            "properties": {"path": _STRING, "text": _STRING, "summary": _STRING},
            "required": ["path", "text", "summary"],
            "additionalProperties": False,
        },
    },
    {
        "name": "propose_open_file",
        "description": "Ask the user to open a model file from an allowed folder. Only the user can accept.",
        "input_schema": {"type": "object", "properties": {"path": _STRING, "summary": _STRING}, "required": ["path"], "additionalProperties": False},
    },
]

assert tuple(t["name"] for t in TOOL_DEFINITIONS) == TOOL_ALLOWLIST


# ── the tools ────────────────────────────────────────────────────────────


def _need_files(ctx: ToolContext) -> None:
    if not ctx.settings["visibility"]["files"]:
        raise ToolRefused("files aren't shared with the assistant (Settings: What it can see)")


def _need_str(args: dict, name: str) -> str:
    value = args.get(name)
    if not isinstance(value, str) or not value:
        raise ToolRefused(f"{name} must be a non-empty string")
    return value


def read_open_model(ctx: ToolContext, args: dict) -> dict:
    return dict(ctx.context)


def read_docs(ctx: ToolContext, args: dict) -> dict:
    query = _need_str(args, "query").strip()[:200]
    if not DOCS_DIR.is_dir():
        return {"hits": []}
    pattern = re.compile(re.escape(query), re.IGNORECASE)
    hits: list[dict] = []
    for path in sorted(DOCS_DIR.rglob("*.md")):
        if any(part.startswith(".") for part in path.relative_to(DOCS_DIR).parts):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        match = pattern.search(text)
        if not match:
            continue
        start = max(0, match.start() - MAX_DOC_SNIPPET // 2)
        hits.append({"doc": str(path.relative_to(DOCS_DIR)), "snippet": text[start:start + MAX_DOC_SNIPPET]})
        if len(hits) >= MAX_DOC_HITS:
            break
    return {"hits": hits}


def propose_app_edit(ctx: ToolContext, args: dict) -> dict:
    if ctx.settings["autonomy"] == "answer":
        raise ToolRefused("autonomy is 'answer only'; the assistant may not propose edits")
    summary = _need_str(args, "summary")[:MAX_NAME_CHARS]
    ops = args.get("ops")
    if not isinstance(ops, list) or not ops:
        raise ToolRefused("ops must be a non-empty list of {op, args}")
    if len(ops) > MAX_OPS:
        raise ToolRefused(f"at most {MAX_OPS} ops in one proposal")
    checked = [check_app_edit_op(op) for op in ops]
    source = ctx.context.get("source") or ""
    # ``after`` is a description of the ops, for the card. It is never source,
    # and the page never applies it as such.
    proposal = ctx.session.add_proposal(
        kind="app_edit", summary=summary, base_hash=sha256_text(source), ops=checked, path=ctx.context.get("file_path"),
        before=None, after="\n".join(describe_op(op) for op in checked),
    )
    return {"proposal_id": proposal["id"], "state": proposal["state"]}


# ── structured ops: the allowlist and its checks ─────────────────────────

MAX_OPS = 20
MAX_NAME_CHARS = 200
MAX_VALUE_CHARS = 4000
MAX_VALUE_ITEMS = 1000

#: ``op -> (required args, optional args)``. Anything else is refused.
APP_EDIT_OPS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "update_param": (("var_name", "param_name", "new_value"), ("context", "function_class", "is_default")),
    "rename_node": (("var_name", "new_name"), ()),
    "add_port": (("var_name", "port_kind", "new_name"), ()),
    "remove_port": (("var_name", "port_kind", "port_name"), ()),
    "rename_port": (("var_name", "port_kind", "old_name", "new_name"), ()),
}

_PORT_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_\-]*$")
_LITERAL_NODES = (ast.Expression, ast.Constant, ast.List, ast.Tuple, ast.Dict, ast.Set, ast.UnaryOp, ast.USub, ast.UAdd, ast.Load)
_LITERAL_CONSTANTS = (int, float, complex, str, bool, type(None))


def check_app_edit_op(op: Any) -> dict:
    """The op with every argument checked and put in canonical form, or
    ``ToolRefused``. The result is what the proposal carries and the page sends."""
    if not isinstance(op, dict) or not isinstance(op.get("op"), str) or not isinstance(op.get("args"), dict):
        raise ToolRefused("each op must be {op, args}")
    name = op["op"]
    if name not in APP_EDIT_OPS:
        raise ToolRefused(f"op {name!r} isn't one of the structured edits ({', '.join(APP_EDIT_OPS)}); free-form changes go through propose_file_write")
    required, optional = APP_EDIT_OPS[name]
    args = op["args"]
    unknown = set(args) - set(required) - set(optional)
    if unknown:
        raise ToolRefused(f"{name}: unknown argument {sorted(unknown)[0]!r}")
    missing = [a for a in required if a not in args]
    if missing:
        raise ToolRefused(f"{name}: missing argument {missing[0]!r}")
    out: dict[str, Any] = {}
    for key, value in args.items():
        out[key] = _check_arg(name, key, value)
    return {"op": name, "args": out}


def _check_arg(op: str, key: str, value: Any) -> Any:
    if key in ("var_name", "param_name", "function_class"):
        return _identifier(value, f"{op}.{key}")
    if key == "new_value":
        return plain_literal(value)
    if key == "context":
        if value not in ("mechanism", "function"):
            raise ToolRefused(f"{op}.context must be 'mechanism' or 'function'")
        return value
    if key == "port_kind":
        if value not in ("input", "output"):
            raise ToolRefused(f"{op}.port_kind must be 'input' or 'output'")
        return value
    if key == "is_default":
        if not isinstance(value, bool):
            raise ToolRefused(f"{op}.is_default must be true or false")
        return value
    if op == "rename_node" and key == "new_name":
        # A display name, written by the route as a quoted string literal (repr).
        if not isinstance(value, str) or not value.strip() or len(value) > MAX_NAME_CHARS or not value.isprintable():
            raise ToolRefused("rename_node.new_name must be a short printable name")
        return value.strip()
    if key in ("new_name", "old_name", "port_name"):
        if not isinstance(value, str) or len(value) > MAX_NAME_CHARS or not _PORT_NAME.match(value):
            raise ToolRefused(f"{op}.{key} must be a port name: letters, digits, underscores or hyphens")
        return value
    raise ToolRefused(f"{op}: unknown argument {key!r}")  # pragma: no cover - keys are from the allowlist


def _identifier(value: Any, what: str) -> str:
    if (
        not isinstance(value, str) or not value or len(value) > MAX_NAME_CHARS
        or not value.isidentifier() or keyword.iskeyword(value) or value.startswith("__")
    ):
        raise ToolRefused(f"{what} must be a Python identifier that isn't a keyword")
    return value


def plain_literal(value: Any) -> str:
    """``value`` as the text of a Python literal, or ``ToolRefused``.

    A string is parsed as an expression that may hold only constants and
    containers of them (no names, no calls, no operators but a sign), then
    rebuilt with ``repr`` so a comment, a newline or an unbalanced quote in
    it can't reach the file. A number, bool, list or dict from JSON is
    checked the same way. The result is what ``file_writer`` writes.
    """
    if isinstance(value, str):
        if not value.strip():
            raise ToolRefused("new_value can't be empty")
        if len(value) > MAX_VALUE_CHARS:
            raise ToolRefused(f"new_value is longer than {MAX_VALUE_CHARS} characters")
        try:
            tree = ast.parse(value.strip(), mode="eval")
        except (SyntaxError, ValueError):
            raise ToolRefused("new_value must be a plain literal: a number, a string, a list, a dict, True, False or None") from None
        for node in ast.walk(tree):
            if not isinstance(node, _LITERAL_NODES):
                raise ToolRefused(f"new_value must be a plain literal, not {type(node).__name__.lower()} (no names, no calls)")
            if isinstance(node, ast.Constant) and not isinstance(node.value, _LITERAL_CONSTANTS):
                raise ToolRefused("new_value must be a plain literal")
        try:
            literal = ast.literal_eval(tree)
        except (ValueError, TypeError, SyntaxError, MemoryError, RecursionError):
            raise ToolRefused("new_value must be a plain literal") from None
    else:
        literal = value
    _check_plain_data(literal, 0)
    text = repr(literal)
    if len(text) > MAX_VALUE_CHARS:
        raise ToolRefused(f"new_value is longer than {MAX_VALUE_CHARS} characters")
    return text


def _check_plain_data(value: Any, depth: int, seen: list | None = None) -> None:
    seen = [0] if seen is None else seen
    seen[0] += 1
    if depth > 8 or seen[0] > MAX_VALUE_ITEMS:
        raise ToolRefused("new_value is too deep or too long")
    if isinstance(value, _LITERAL_CONSTANTS):
        return
    if isinstance(value, (list, tuple, set, frozenset)):
        for item in value:
            _check_plain_data(item, depth + 1, seen)
        return
    if isinstance(value, dict):
        for k, v in value.items():
            _check_plain_data(k, depth + 1, seen)
            _check_plain_data(v, depth + 1, seen)
        return
    raise ToolRefused(f"new_value holds a {type(value).__name__}, which isn't plain data")


def describe_op(op: dict) -> str:
    a = op["args"]
    if op["op"] == "update_param":
        where = f"{a['var_name']}.function" if a.get("context") == "function" else a["var_name"]
        return f"{where}.{a['param_name']} = {a['new_value']}" if not a.get("is_default") else f"{where}.{a['param_name']}: back to the default"
    if op["op"] == "rename_node":
        return f"rename {a['var_name']} to {a['new_name']!r}"
    if op["op"] == "add_port":
        return f"{a['var_name']}: add {a['port_kind']} port {a['new_name']}"
    if op["op"] == "remove_port":
        return f"{a['var_name']}: remove {a['port_kind']} port {a['port_name']}"
    return f"{a['var_name']}: rename {a['port_kind']} port {a['old_name']} to {a['new_name']}"


def list_files(ctx: ToolContext, args: dict) -> dict:
    _need_files(ctx)
    return {"files": files.list_model_files()}


def read_file(ctx: ToolContext, args: dict) -> dict:
    _need_files(ctx)
    path = _need_str(args, "path")
    try:
        text = files.read_model_file(path)
    except PathRefused as e:
        raise ToolRefused(str(e)) from None
    except OSError as e:
        raise ToolRefused(f"couldn't read the file: {e.strerror or e}") from None
    return {"path": path, "text": text, "hash": sha256_text(text)}


def propose_file_write(ctx: ToolContext, args: dict) -> dict:
    if not any(f["access"] == "read_write" for f in ctx.settings["folders"]):
        raise ToolRefused("no folder allows writing (Settings: Allowed folders)")
    path = _need_str(args, "path")
    text = _need_str(args, "text")
    summary = _need_str(args, "summary")
    try:
        resolved = files.resolve_allowed(path, write=True)
    except PathRefused as e:
        raise ToolRefused(str(e)) from None
    before = None
    if resolved.exists():
        try:
            before = resolved.read_text(encoding="utf-8")
        except OSError as e:
            raise ToolRefused(f"couldn't read the file: {e.strerror or e}") from None
    freeform = resolved.suffix.lower() == ".py"
    proposal = ctx.session.add_proposal(
        kind="file_write",
        summary=summary,
        base_hash=sha256_text(before) if before is not None else None,
        ops=[],
        path=str(resolved),
        before=before,
        after=text,
        freeform_python=freeform,
        warnings=python_warnings(text) if freeform else [],
    )
    return {"proposal_id": proposal["id"], "state": proposal["state"], "warnings": proposal["warnings"]}


def propose_open_file(ctx: ToolContext, args: dict) -> dict:
    _need_files(ctx)
    path = _need_str(args, "path")
    try:
        resolved = files.resolve_allowed(path)
    except PathRefused as e:
        raise ToolRefused(str(e)) from None
    proposal = ctx.session.add_proposal(
        kind="open_file", summary=args.get("summary") or f"Open {resolved.name}", base_hash=None, ops=[], path=str(resolved), before=None, after=None,
    )
    return {"proposal_id": proposal["id"], "state": proposal["state"]}


TOOLS: dict[str, Callable[[ToolContext, dict], dict]] = {
    "read_open_model": read_open_model,
    "read_docs": read_docs,
    "propose_app_edit": propose_app_edit,
    "list_files": list_files,
    "read_file": read_file,
    "propose_file_write": propose_file_write,
    "propose_open_file": propose_open_file,
}

assert tuple(TOOLS) == TOOL_ALLOWLIST


# ── advisory warnings for free-form Python ───────────────────────────────

_WARNING_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"^\s*(import|from)\s+(?!psyneulink\b|numpy\b|np\b)", "imports a module other than psyneulink or numpy"),
    (r"\bopen\s*\(|\bpathlib\b|\bos\.(path|remove|unlink|rename|listdir|walk)|\bshutil\b", "accesses files"),
    (r"\b(urllib|requests|http\.client|socket|httpx|aiohttp)\b", "uses the network"),
    (r"\bsubprocess\b|\bos\.(system|popen|exec\w*|spawn\w*)\b", "runs other programs (subprocess)"),
    (r"\b(eval|exec|compile|__import__)\s*\(", "runs code built at runtime (eval/exec)"),
)


def python_warnings(text: str) -> list[str]:
    """Advice only, as the issue says: easy to evade, never a boundary."""
    warnings = []
    for pattern, message in _WARNING_PATTERNS:
        if re.search(pattern, text, re.MULTILINE):
            warnings.append(message)
    return warnings
