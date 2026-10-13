"""Unit tests for the test-only /api/test/reset endpoint (#147).

The endpoint is gated by PSYNEWVIEW_TEST_MODE=1; both states are covered.
We build a fresh FastAPI instance with the gate flipped on instead of
reusing the module-level client, because the gate is evaluated at
module import time.
"""

import os
from pathlib import Path
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient


def _build_test_app() -> FastAPI:
    """Mirror app.main wiring but with PSYNEWVIEW_TEST_MODE=1 enabled."""
    from app.api.routes import router
    from app.api.test_routes import router as test_router
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.include_router(test_router, prefix="/api")
    return app


def test_reset_endpoint_not_exposed_in_production():
    """Without PSYNEWVIEW_TEST_MODE=1, the reset router isn't registered.

    Asserts route presence directly rather than POST status — once
    frontend/dist exists the SPA fallback mount swallows /api/test/reset
    and returns 405, which would mask a registration bug.
    """
    from app.main import app  # production wiring
    paths = {getattr(r, "path", None) for r in app.routes}
    assert "/api/test/reset" not in paths


def test_reset_endpoint_clears_working_dir(tmp_path: Path):
    """Files in PSYNEWVIEW_WORKING_DIR are removed; the dir itself remains."""
    leftover = tmp_path / "leftover_demo.py"
    leftover.write_text("# stale working copy from a prior test\n")
    sidecar = tmp_path / "leftover_demo.pnlview.json"
    sidecar.write_text("{}")

    app = _build_test_app()
    with mock.patch.dict(os.environ, {"PSYNEWVIEW_WORKING_DIR": str(tmp_path)}):
        # Patch the warm worker so the test doesn't actually restart it
        # (the subprocess spawn is slow and not what we're asserting here).
        with mock.patch("app.services.sandbox._warm_worker", None):
            client = TestClient(app)
            resp = client.post("/api/test/reset")

    assert resp.status_code == 200
    body = resp.json()
    assert set(body["cleared"]) == {"leftover_demo.py", "leftover_demo.pnlview.json"}
    assert body["worker_restarted"] is True
    assert tmp_path.exists()
    assert not leftover.exists()
    assert not sidecar.exists()


def test_reset_endpoint_handles_empty_working_dir(tmp_path: Path):
    """No files to clear is not an error — empty list, dir still there."""
    app = _build_test_app()
    with mock.patch.dict(os.environ, {"PSYNEWVIEW_WORKING_DIR": str(tmp_path)}):
        with mock.patch("app.services.sandbox._warm_worker", None):
            client = TestClient(app)
            resp = client.post("/api/test/reset")

    assert resp.status_code == 200
    assert resp.json()["cleared"] == []


def test_reset_endpoint_works_without_working_dir_env(tmp_path: Path):
    """If PSYNEWVIEW_WORKING_DIR is unset we still restart the worker."""
    app = _build_test_app()
    env = {k: v for k, v in os.environ.items() if k != "PSYNEWVIEW_WORKING_DIR"}
    with mock.patch.dict(os.environ, env, clear=True):
        with mock.patch("app.services.sandbox._warm_worker", None):
            client = TestClient(app)
            resp = client.post("/api/test/reset")

    assert resp.status_code == 200
    body = resp.json()
    assert body["cleared"] == []
    assert body["worker_restarted"] is True
