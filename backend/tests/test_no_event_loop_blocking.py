"""Regression guards against backend freezes (#860).

FastAPI runs ``async def`` handlers ON the event loop. A blocking call inside one
-- a ``git`` subprocess, or ``load_and_introspect`` (which drives the sandbox
worker over pipes) -- stalls the WHOLE loop, so every concurrent request hangs and
the backend freezes. Two shipped bugs did exactly this: ``catalog_sources`` + git,
and ~17 model-load endpoints + ``load_and_introspect``. These tests make the
anti-pattern un-shippable, and pin a load-latency budget so a model whose
introspection silently balloons is caught.
"""

import ast
import time
from pathlib import Path

import pytest

from app.main import app

# The app source tree, located relative to this test file (backend/tests/ ->
# backend/app/). Resolving from __file__ — not via the imported module — keeps
# detection independent of how the package is installed (see
# _blocking_async_endpoints).
_APP_DIR = Path(__file__).resolve().parents[1] / "app"

# Blocking primitives that must never run directly on the event loop. A
# threadpool-wrapped call passes the function as an *argument*
# (``run_in_threadpool(load_and_introspect, ...)``) so it has no trailing "(" and
# does not trip the guard — that's the sanctioned escape hatch for async handlers.
_BLOCKING_TOKENS = (
    "load_and_introspect(",
    "subprocess.",
    "check_output(",
    "run_in_sandbox(",
)

# Async endpoints that still call a blocking primitive directly, pending a
# run_in_threadpool wrap. Tracked in #860 — this set must NOT grow.
_KNOWN_ASYNC_BLOCKING = {"import_project", "import_mdf"}


def _is_route_decorator(dec: ast.expr) -> bool:
    """True for a FastAPI route decorator: ``@router.post(...)`` / ``@app.get(...)``
    etc. (also matches the bare, un-called form defensively)."""
    if isinstance(dec, ast.Call):
        dec = dec.func
    return (
        isinstance(dec, ast.Attribute)
        and isinstance(dec.value, ast.Name)
        and dec.value.id in ("router", "app")
        and dec.attr in ("get", "post", "put", "delete", "patch", "websocket")
    )


def _blocking_async_endpoints() -> set[str]:
    """Names of ``async def`` route handlers whose body calls a blocking
    primitive directly (which would stall the event loop, #860).

    Detected by AST-scanning the app source tree on disk — NOT by runtime
    ``inspect``/``app.routes`` introspection. That runtime approach proved
    environment-fragile: under CI's fresh editable (PEP 660) install,
    ``inspect.getsource``/``iscoroutinefunction`` behaved differently than in a
    local checkout, silently dropping every endpoint so the whole allowlist
    looked stale in CI while passing locally (#868). Reading the checked-out
    source files directly is deterministic across environments.
    """
    hits = set()
    for py in sorted(_APP_DIR.rglob("*.py")):
        try:
            src = py.read_text()
            tree = ast.parse(src)
        except (OSError, SyntaxError):
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.AsyncFunctionDef):
                continue
            if not any(_is_route_decorator(d) for d in node.decorator_list):
                continue
            seg = ast.get_source_segment(src, node) or ""
            if any(tok in seg for tok in _BLOCKING_TOKENS):
                hits.add(node.name)
    return hits


def test_no_blocking_call_in_async_endpoint():
    """No async handler may call blocking work directly (freezes the loop, #860)."""
    offenders = _blocking_async_endpoints() - _KNOWN_ASYNC_BLOCKING
    assert not offenders, (
        "async endpoints call blocking work (load_and_introspect / subprocess / "
        "git) directly on the event loop — make them sync `def` or wrap the call "
        f"in `await run_in_threadpool(...)`: {sorted(offenders)}"
    )


def test_allowlist_does_not_rot():
    """Every allowlisted name is still a real async-blocking endpoint — so the
    allowlist can't silently mask a fixed one (or a typo) and weaken the guard."""
    stale = _KNOWN_ASYNC_BLOCKING - _blocking_async_endpoints()
    assert not stale, f"allowlist entries no longer async-blocking; remove them: {sorted(stale)}"


def test_detection_is_nonempty_and_source_based():
    """The detector must actually find endpoints from the source tree — a guard
    against it silently collapsing to empty, which would make both tests above
    vacuous. That collapse is exactly what happened in CI when detection relied
    on runtime ``inspect`` (#868); reading the source tree can't collapse unless
    the app dir is mis-resolved, which this catches."""
    assert _APP_DIR.is_dir(), f"app source dir not found at {_APP_DIR}"
    detected = _blocking_async_endpoints()
    assert detected, "no blocking async endpoints detected — app source dir mis-resolved?"
    assert _KNOWN_ASYNC_BLOCKING <= detected, (
        f"known blocking endpoints not detected: missing {sorted(_KNOWN_ASYNC_BLOCKING - detected)}"
    )


@pytest.mark.parametrize(
    "name",
    [e["name"] for e in __import__("app.api.routes", fromlist=["REFERENCE_MODELS"]).REFERENCE_MODELS],
)
def test_reference_model_load_latency(name):
    """Each bundled reference model introspects within a latency budget, so a load
    that silently balloons is caught before it degrades the app (#860)."""
    from app.api.routes import REFERENCE_DIR
    from app.services.introspector import load_and_introspect

    BUDGET_S = 20  # warm ~1-3s; generous headroom for a cold worker / slow CI
    path = REFERENCE_DIR / f"{name}.py"
    if not path.exists():
        pytest.skip(f"{name} not present")
    t0 = time.time()
    result = load_and_introspect(str(path))
    dt = time.time() - t0
    assert not result.get("error"), f"{name} failed to load: {result.get('error')}"
    assert dt <= BUDGET_S, f"{name} introspection took {dt:.1f}s (> {BUDGET_S}s budget)"
