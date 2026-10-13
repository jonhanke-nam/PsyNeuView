"""The test-only ``/api/test/pnl-install`` override (#1305).

The e2e harness can't point the backend at another PsyNeuLink install (that is
read from the installed distribution's metadata), so in test mode it declares
a temporary checkout tree as the active PsyNeuLink of a given kind. These
tests check that the override reads back through the real guard the way a
real install of that kind would, and that it is put back.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import router
from app.api.test_routes import router as test_router
from app.services import pnl_source_guard, settings_info


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.include_router(test_router, prefix="/api")
    return TestClient(app)


def _tree(root: Path) -> Path:
    models = root / "psyneulink" / "library" / "models"
    models.mkdir(parents=True)
    model = models / "Standin.py"
    model.write_text("import psyneulink as pnl\nA = pnl.TransferMechanism(name='A')\n")
    return model


def test_override_endpoint_not_exposed_in_production():
    from app.main import app

    assert "/api/test/pnl-install" not in {getattr(r, "path", None) for r in app.routes}


def test_override_declares_each_kind_and_restores(tmp_path, monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(tmp_path / "sources"))
    client = _client()
    real_distribution = settings_info.distribution
    try:
        local = _tree(tmp_path / "PsyNeuLink-local")
        assert client.post("/api/test/pnl-install", json={"kind": "local", "root": str(local.parents[3])}).status_code == 200
        owned = pnl_source_guard.ownership(local)
        assert owned["kind"] == "local" and owned["editable"] is True

        github = _tree(tmp_path / "site-packages-github")
        assert client.post("/api/test/pnl-install", json={"kind": "github", "root": str(github.parents[3])}).status_code == 200
        owned = pnl_source_guard.ownership(github)
        assert owned["kind"] == "github" and owned["editable"] is False
        assert pnl_source_guard.ownership(local) is None

        pypi = _tree(tmp_path / "site-packages-pypi")
        assert client.post("/api/test/pnl-install", json={"kind": "pypi", "root": str(pypi.parents[3])}).status_code == 200
        owned = pnl_source_guard.ownership(pypi)
        assert owned["kind"] == "pypi" and owned["editable"] is False

        assert client.post("/api/test/pnl-install", json={"kind": None}).status_code == 200
        assert settings_info.distribution is real_distribution
        assert pnl_source_guard.ownership(pypi) is None
    finally:
        settings_info.distribution = real_distribution


def test_override_refuses_a_missing_root(tmp_path):
    client = _client()
    resp = client.post("/api/test/pnl-install", json={"kind": "local", "root": str(tmp_path / "nope")})
    assert resp.status_code == 400
    assert client.post("/api/test/pnl-install", json={"kind": "local"}).status_code == 400
