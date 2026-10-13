"""An unhandled server error comes back as JSON the page can read (#1396).

When the model runner couldn't import PsyNeuLink, /api/model/load raised a
RuntimeError that reached the page as plain-text "Internal Server Error"; the
page's resp.json() then threw, and the user saw "SyntaxError: The string did
not match the expected pattern" instead of the cause.
"""
from pathlib import Path

from fastapi.testclient import TestClient

from app.api import routes
from app.main import app

client = TestClient(app, raise_server_exceptions=False)


def test_a_runner_failure_on_load_is_json_with_its_message(tmp_path: Path, monkeypatch):
    model = tmp_path / "m.py"
    model.write_text("import psyneulink as pnl\ncomp = pnl.Composition(name='c')\n")

    def broken_runner(*args, **kwargs):
        raise RuntimeError("module 'psyneulink' has no attribute 'Composition'")

    monkeypatch.setattr(routes, "load_and_introspect", broken_runner)
    resp = client.post("/api/model/load", json={"file_path": str(model)})

    assert resp.status_code == 500
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.json()["detail"] == "module 'psyneulink' has no attribute 'Composition'"
    assert resp.json()["reason"] == "server_error"


def test_an_exception_without_a_message_still_names_itself(tmp_path: Path, monkeypatch):
    model = tmp_path / "m.py"
    model.write_text("import psyneulink as pnl\ncomp = pnl.Composition(name='c')\n")

    def broken_runner(*args, **kwargs):
        raise KeyError()

    monkeypatch.setattr(routes, "load_and_introspect", broken_runner)
    resp = client.post("/api/model/load", json={"file_path": str(model)})

    assert resp.status_code == 500
    assert resp.json()["detail"] == "KeyError"
