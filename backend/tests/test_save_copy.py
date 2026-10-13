"""Server-side save in every format — the other half of #1067.

Before this, ``.py`` could only be written server-side and every other format
could only be downloaded, so picking a format silently decided where the file
went. These pin that both axes are now independent.
"""

import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

DEMO = str(Path(__file__).resolve().parents[1] / "demos" / "stroop_basic.py")


def test_saves_py_from_the_editor_buffer(tmp_path):
    """A copy saves what you're looking at, not what's last on disk."""
    resp = client.post("/api/model/save-copy", json={
        "file_path": DEMO,
        "fmt": "py",
        "file_name": "copy_of_stroop",
        "directory": str(tmp_path),
        "source": "# edited in the editor\nimport psyneulink as pnl\n",
    })
    assert resp.status_code == 200, resp.text
    written = Path(resp.json()["file_path"])
    assert written == tmp_path / "copy_of_stroop.py"
    assert "edited in the editor" in written.read_text()


def test_saves_a_pnlproject_bundle_server_side(tmp_path):
    resp = client.post("/api/model/save-copy", json={
        "file_path": DEMO,
        "fmt": "pnlproject",
        "file_name": "stroop",
        "directory": str(tmp_path),
    })
    assert resp.status_code == 200, resp.text
    written = Path(resp.json()["file_path"])
    assert written.suffix == ".pnlproject"
    with zipfile.ZipFile(written) as zf:
        assert "manifest.json" in zf.namelist()


def test_extension_is_added_but_not_doubled(tmp_path):
    for name in ("thing", "thing.py"):
        resp = client.post("/api/model/save-copy", json={
            "file_path": DEMO, "fmt": "py", "file_name": name,
            "directory": str(tmp_path), "source": "x = 1\n", "overwrite": True,
        })
        assert Path(resp.json()["file_path"]).name == "thing.py"


def test_refuses_to_clobber_without_overwrite(tmp_path):
    body = {
        "file_path": DEMO, "fmt": "py", "file_name": "once",
        "directory": str(tmp_path), "source": "x = 1\n",
    }
    assert client.post("/api/model/save-copy", json=body).status_code == 200
    assert client.post("/api/model/save-copy", json=body).status_code == 409
    assert client.post("/api/model/save-copy", json={**body, "overwrite": True}).status_code == 200


def test_py_without_source_is_rejected(tmp_path):
    """Rather than silently writing an empty file."""
    resp = client.post("/api/model/save-copy", json={
        "file_path": DEMO, "fmt": "py", "file_name": "nope", "directory": str(tmp_path),
    })
    assert resp.status_code == 400


def test_missing_model_is_404(tmp_path):
    resp = client.post("/api/model/save-copy", json={
        "file_path": str(tmp_path / "nope.py"), "fmt": "pnlproject",
        "file_name": "x", "directory": str(tmp_path),
    })
    assert resp.status_code == 404
