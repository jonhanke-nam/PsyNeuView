"""The server refuses requests from another site or under another name."""

import io
import json
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.request_guard import host_allowed, origin_allowed
from app.services.deployment_mode import CONTAINER, LOCAL, MAC_APP

client = TestClient(app)
LOCAL_HOST = {"Host": "127.0.0.1:8000"}


@pytest.mark.parametrize(
    "host,mode,allowed",
    [
        ("127.0.0.1:8000", LOCAL, True),
        ("localhost:8000", MAC_APP, True),
        ("[::1]:8000", LOCAL, True),
        ("evil.example:8000", LOCAL, False),
        ("evil.example:8000", MAC_APP, False),
        ("127.0.0.1.evil.example", LOCAL, False),
        ("localhost.evil.example:8000", LOCAL, False),
        ("", LOCAL, False),
        ("app.example.org", CONTAINER, True),
    ],
)
def test_host(host, mode, allowed):
    assert host_allowed(host, mode) is allowed


@pytest.mark.parametrize(
    "origin,host,forwarded,mode,allowed",
    [
        ("http://127.0.0.1:8000", "127.0.0.1:8000", "", MAC_APP, True),
        ("http://localhost:5173", "localhost:8000", "", LOCAL, True),
        # The Mac app has no dev server, so another local page is another site.
        ("http://localhost:5173", "127.0.0.1:8000", "", MAC_APP, False),
        ("https://evil.example", "127.0.0.1:8000", "", LOCAL, False),
        ("http://localhost.evil.example", "127.0.0.1:8000", "", LOCAL, False),
        ("null", "127.0.0.1:8000", "", LOCAL, False),
        ("file://", "127.0.0.1:8000", "", LOCAL, False),
        ("https://app.example.org", "app.example.org", "", CONTAINER, True),
        ("https://app.example.org", "backend:8000", "app.example.org", CONTAINER, True),
        ("https://evil.example", "app.example.org", "", CONTAINER, False),
        # A remote deployment isn't opened up by a loopback origin.
        ("http://localhost:5173", "app.example.org", "", CONTAINER, False),
    ],
)
def test_origin(origin, host, forwarded, mode, allowed):
    assert origin_allowed(origin, host, forwarded, mode) is allowed


def test_another_site_cannot_upload_a_project(tmp_path):
    """The request a page can send without a preflight, refused before it's read."""
    resp = client.post(
        "/api/model/import-project",
        headers={**LOCAL_HOST, "Origin": "https://evil.example"},
        files={"file": ("x.pnlproject", b"not read", "application/octet-stream")},
    )
    assert resp.status_code == 403


def test_another_name_is_refused():
    resp = client.get("/health", headers={"Host": "evil.example:8000"})
    assert resp.status_code == 403


def test_the_apps_own_requests_still_work():
    assert client.get("/health", headers=LOCAL_HOST).status_code == 200
    # Same site, with an Origin, as the page sends on a POST.
    resp = client.post(
        "/api/model/file-exists",
        headers={**LOCAL_HOST, "Origin": "http://127.0.0.1:8000"},
        json={"file_path": "/nonexistent.py"},
    )
    assert resp.status_code != 403
    # The Mac app's own calls send no Origin.
    resp = client.post("/api/model/file-exists", headers=LOCAL_HOST, json={"file_path": "/nonexistent.py"})
    assert resp.status_code != 403


def test_a_get_from_another_site_changes_nothing_and_stays_unreadable():
    """A GET changes nothing, and CORS keeps the answer from another site."""
    resp = client.get("/health", headers={**LOCAL_HOST, "Origin": "https://evil.example"})
    assert resp.status_code == 200
    assert "access-control-allow-origin" not in resp.headers


def test_websocket_from_another_site_is_refused():
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws", headers={**LOCAL_HOST, "Origin": "https://evil.example"}):
            pass


def test_websocket_from_the_app_connects():
    with client.websocket_connect("/ws", headers={**LOCAL_HOST, "Origin": "http://127.0.0.1:8000"}) as ws:
        assert ws.receive_json()["type"] == "presence"


@pytest.mark.parametrize(
    "name,expected",
    [
        ("../../outside", "outside"),
        ("/etc/outside", "outside"),
        ("..\\..\\outside", "outside"),
        ("..", "imported_model"),
        ("", "imported_model"),
        (None, "imported_model"),
        (".hidden", "imported_model"),
        ("my_model", "my_model"),
    ],
)
def test_bundle_name_cannot_choose_the_folder(name, expected):
    from app.api.routes import _bundle_model_name

    assert _bundle_model_name(name) == expected


def test_import_stays_in_the_models_folder(tmp_path, monkeypatch):
    import app.api.routes as routes

    models = tmp_path / "models"
    monkeypatch.setattr(routes, "get_default_save_dir", lambda: models)
    monkeypatch.setattr(routes, "load_and_introspect", lambda path: {"compositions": []})
    monkeypatch.setattr(routes, "load_layout", lambda path: None)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(
            "manifest.json",
            json.dumps({"formatVersion": 1, "model": {"name": "../outside"}, "files": {"source": "model.py"}}),
        )
        z.writestr("model.py", "x = 1\n")
    resp = client.post(
        "/api/model/import-project",
        headers=LOCAL_HOST,
        files={"file": ("x.pnlproject", buf.getvalue(), "application/octet-stream")},
    )
    assert resp.status_code == 200, resp.text
    assert Path(resp.json()["file_path"]).parent == models
    assert not (tmp_path / "outside.py").exists()
