"""PsyNeuView backend server."""

import logging
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api.routes import router
from app.api.ws import handle_websocket
from app.services import (
    edit_lock,
    github_auth,
    managed_layouts,
    pnl_source_guard,
    pnl_updates,
    running_from,
    startup_phases,
    working_copies,
)
from app.services.sandbox import _get_warm_worker


def _configure_app_logging() -> None:
    """Make the app's own loggers actually reach the console (#864).

    uvicorn configures only its ``uvicorn.*`` loggers, so every
    ``logging.getLogger(__name__)`` call under the ``app.*`` namespace — the
    per-load ``[perf]`` timing lines, the ``Warm worker timed out … restarting``
    warnings — was silently dropped. That left slow/wedged loads with zero
    persistent evidence. Attach one handler to the ``app`` parent logger so all
    children propagate to it; keep it idempotent so ``--reload`` re-imports and
    tests don't stack duplicate handlers.

    Level is INFO by default (``[perf]`` lines are INFO); override with
    ``PSYNEWVIEW_LOG_LEVEL`` (e.g. ``WARNING`` to quiet, ``DEBUG`` to trace).
    """
    app_logger = logging.getLogger("app")
    if not any(getattr(h, "_psyneuview", False) for h in app_logger.handlers):
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s:     %(name)s: %(message)s"))
        handler._psyneuview = True  # type: ignore[attr-defined]
        app_logger.addHandler(handler)
    app_logger.setLevel(os.environ.get("PSYNEWVIEW_LOG_LEVEL", "INFO").upper())
    # Don't also bubble to the root logger (would double-print under some
    # uvicorn configs); this handler is the single sink for app.* logs.
    app_logger.propagate = False


_configure_app_logging()

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start the warm PsyNeuLink worker eagerly so the first request is fast.

    Each step reports itself as a ``PNV-START`` line on stdout, so the Mac
    app's starting window can show real steps with times instead of one
    spinner (PsyNeuView-MacApp#232; ``app/services/startup_phases.py``).
    """
    _announce_what_is_running()
    with startup_phases.phase("migrate"):
        # Before anything can open a working copy: carry edited Reference
        # Models (and other working copies) over from where older versions
        # kept them — the install's own backend/ folder, which an app update
        # replaces (#1319).
        working_copies.migrate_legacy_working_copies()
        # And the layouts and labels written for read-only PsyNeuLink files:
        # out of site-packages and the old managed-copy artifacts tree, into
        # ~/.psyneuview/layouts, where a reinstall can't lose them (#1321).
        managed_layouts.migrate_legacy_layouts()
        # And a psyneulink/ folder an uninstall left in site-packages because
        # one of those layouts was still in it: it hides an editable install
        # from the model runner, so every model fails to load (#1396). Before
        # the runner starts, so an environment already broken this way heals.
        managed_layouts.clear_leftover_packages_here()

    # Before the runner is used (#1304): install a PsyNeuLink update that the
    # last session found and marked ready, pull the checkouts that asked for
    # it, then keep checking every few hours. Off in the e2e harness.
    with startup_phases.phase("pnl-update") as update_phase:
        outcome = pnl_updates.run_at_start()
        pulled = outcome.get("pulled") or 0
        if outcome.get("install") == "failed":
            update_phase.fail(outcome.get("detail"))
        elif outcome.get("install") == "installed":
            update_phase.end(outcome.get("detail"))
        elif pulled:
            # Nothing installed, but the checkouts that asked were pulled:
            # time was spent, so this is an end, not a skip.
            update_phase.end(f"{outcome.get('detail')}; pulled {pulled} checkout(s)")
        else:
            update_phase.skip(outcome.get("detail") or "nothing ready")

    logger.info("Pre-warming PsyNeuLink worker...")
    _prewarm_model_runner()
    # Resolve GitHub auth in the background: the first get_auth() call shells
    # out to `gh auth token` and probes api.github.com (seconds, worst case),
    # which otherwise lands on the first Settings-dialog open (#563).
    threading.Thread(target=github_auth.get_auth, name="github-auth-warm", daemon=True).start()
    # From here uvicorn answers /health: the whole start, from process launch.
    startup_phases.ready()
    yield
    pnl_updates.stop()


def _announce_what_is_running() -> None:
    """One plain line first (#1356): "PsyNeuView 0.5.15 running from your
    checkout at ~/… (devel, abc1234)". Not a ``PNV-START`` line, so the Mac
    app's parser passes over it; it is for whoever reads the log. Also notes
    the commit the server started from, so About can tell when a checkout
    has moved on since. Never fails the start."""
    try:
        running_from.note_start()
        print(running_from.summary_line(running_from.describe()), flush=True)
    except Exception:  # noqa: BLE001 — a report must never stop the start
        logger.exception("Couldn't say what is running")


def _prewarm_model_runner() -> None:
    """Start the warm worker, reported as two phases (PsyNeuView-MacApp#232).

    ``import-psyneulink`` runs from spawning the worker until the child's
    ready signal, which it prints right after ``import psyneulink`` — so the
    parent reports the import the moment the child says it is done, with the
    interpreter's own start (well under a second) inside it. ``warm-worker``
    is whatever remains of the warm-up after that signal; today that is next
    to nothing, since the runner is ready as soon as PsyNeuLink is imported,
    and it is reported so later warm-up work has a step of its own.
    """
    importing = startup_phases.Phase("import-psyneulink")
    warming = startup_phases.Phase("warm-worker")
    importing.begin()

    def on_ready(ok: bool, elapsed: float) -> None:
        if ok:
            importing.end()
        else:
            importing.fail("the model runner did not start")
        warming.begin()

    _get_warm_worker(on_ready=on_ready)
    if not importing.finished:
        # Not the first start of the worker in this process (a test harness,
        # or a reload): nothing was imported now.
        importing.skip("model runner already running")
    warming.begin()
    warming.end()


app = FastAPI(title="PsyNeuView", version=__version__, lifespan=lifespan)

# Allow frontend dev servers on any port (SLOT-based multi-branch testing)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://localhost:\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.exception_handler(pnl_source_guard.PsyNeuLinkFileIsProtected)
async def _pnl_file_is_protected(request, exc: pnl_source_guard.PsyNeuLinkFileIsProtected):
    """A write refused because the file belongs to the active PsyNeuLink (#1225).
    409 with a reason the frontend recognises, from wherever the write began."""
    # ``detail`` is the readable message, since that's what most callers show;
    # the rest lets the editor tell this apart from a changed-on-disk conflict.
    return JSONResponse(status_code=409, content={
        "detail": exc.ownership["message"], "reason": "psyneulink_source_protected",
        "path": exc.path, "kind": exc.ownership["kind"], "root": exc.ownership["root"],
    })

@app.exception_handler(edit_lock.ModelIsViewOnly)
async def _model_is_view_only(request, exc: edit_lock.ModelIsViewOnly):
    """A generated write refused because the model is locked (#1116, #1309).

    The structural-change route checks the lock itself and answers 409; every
    other generated write (a parameter edit from the inspector, a rename, a
    port change) only met the lock inside the writer, and the exception came
    out as a 500 with no message. Same answer for all of them, from wherever
    the write began.
    """
    return JSONResponse(status_code=409, content={
        # #1346: the model's own rules each have a reason — "model_view_only"
        # (the lock), "model_protected" and "model_protected_permanently" (the
        # protection line in the file) — all subclasses of ModelIsViewOnly.
        "detail": str(exc), "reason": exc.reason, "path": exc.model_path,
    })

@app.exception_handler(Exception)
async def _unhandled_error(request, exc: Exception):
    """Any other failure, as JSON the page can read (#1396).

    Without this an unhandled exception reached the page as plain-text
    "Internal Server Error", the page's ``resp.json()`` threw, and the user
    saw the parser's message ("The string did not match the expected
    pattern") instead of the cause — e.g. the model runner's "module
    'psyneulink' has no attribute 'Composition'". Starlette still re-raises
    after sending this, so the traceback is logged as before.
    """
    return JSONResponse(status_code=500, content={
        "detail": str(exc) or type(exc).__name__, "reason": "server_error",
    })


# Test-only endpoints (E2E harness — #147). Gated by an env var so they
# never ship in production builds.
if os.environ.get("PSYNEWVIEW_TEST_MODE") == "1":
    from app.api.test_routes import router as test_router
    app.include_router(test_router, prefix="/api")
    logger.warning("PSYNEWVIEW_TEST_MODE=1 — /api/test/reset is exposed")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        await handle_websocket(websocket)
    except WebSocketDisconnect:
        pass


@app.get("/health")
async def health():
    return {"status": "ok"}


# Serve the production frontend build if it exists. In dev, the Vite dev server
# proxies /api and /ws to this backend, so this mount is inert. In production
# (after `npm run build`) this fields all non-API requests for the SPA shell.
_frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=str(_frontend_dist), html=True), name="frontend")
