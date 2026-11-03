"""The tools the agent may call: exactly ``TOOL_ALLOWLIST`` (#179).

Every tool checks its own permission on the server on every call, against the
settings as they are now, not as they were when the session started. A tool
that isn't on the list doesn't exist for the agent; the session loop answers
such a call with a ``refused`` event. No tool runs a model, runs a shell,
reaches the network, or changes settings.

File rules live in ``files.py`` and review state in ``review.py``, owned by
another part; this module calls them through the contract's signatures, with
``stand_ins`` filling in until they land.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any, Callable

try:  # the real modules, when the files part has landed
    from app.services.assistant import files, review
except ImportError:  # pragma: no cover - depends on the branch state
    from app.services.assistant import stand_ins as files  # type: ignore[no-redef]
    from app.services.assistant import stand_ins as review  # type: ignore[no-redef]

PathRefused = getattr(files, "PathRefused", Exception)

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
        "description": "Propose a structured edit to the open model for the user to accept, as a list of ops such as update_param or rename_node.",
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
    summary = _need_str(args, "summary")
    ops = args.get("ops")
    if not isinstance(ops, list) or not ops or not all(
        isinstance(op, dict) and isinstance(op.get("op"), str) and isinstance(op.get("args"), dict) for op in ops
    ):
        raise ToolRefused("ops must be a non-empty list of {op, args}")
    source = ctx.context.get("source") or ""
    proposal = ctx.session.add_proposal(
        kind="app_edit", summary=summary, base_hash=sha256_text(source), ops=ops, path=None, before=None, after=None,
    )
    return {"proposal_id": proposal["id"], "state": proposal["state"]}


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
