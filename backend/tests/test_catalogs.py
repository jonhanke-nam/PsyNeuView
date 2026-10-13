"""The user's own Open-menu catalogs and project folder (#1229).

The preferences file is already a throwaway one (conftest).
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import deployment_mode
from app.services.model_dirs import get_model_dirs

client = TestClient(app)


@pytest.fixture(autouse=True)
def _no_models_dir_env(monkeypatch):
    monkeypatch.delenv("PSYNEWVIEW_MODELS_DIR", raising=False)


def _folder(root, *models):
    root.mkdir(parents=True)
    for m in models:
        (root / m).parent.mkdir(parents=True, exist_ok=True)
        (root / m).write_text("import psyneulink as pnl\n")
    return root


def test_an_added_catalog_lists_its_models(tmp_path):
    folder = _folder(tmp_path / "Lab models", "a.py", "sub/b.py", "__pycache__/c.py")
    resp = client.post("/api/catalogs", json={"path": str(folder)})
    assert resp.status_code == 200 and resp.json()["name"] == "Lab models"

    catalogs = client.get("/api/catalogs").json()["catalogs"]
    assert [c["name"] for c in catalogs] == ["Lab models"]
    assert sorted(m["relative"] for m in catalogs[0]["models"]) == ["a.py", "sub/b.py"]


def test_a_catalog_can_be_renamed_and_removed_without_touching_files(tmp_path):
    folder = _folder(tmp_path / "lab", "a.py")
    cid = client.post("/api/catalogs", json={"path": str(folder), "name": "Mine"}).json()["id"]

    assert client.patch(f"/api/catalogs/{cid}", json={"name": "Lab"}).json()["name"] == "Lab"
    assert client.delete(f"/api/catalogs/{cid}").status_code == 200
    assert client.get("/api/catalogs").json()["catalogs"] == []
    assert (folder / "a.py").exists()


@pytest.mark.parametrize("bad", ["missing", "duplicate"])
def test_bad_folders_are_refused_with_a_reason(tmp_path, bad):
    folder = _folder(tmp_path / "lab", "a.py")
    if bad == "duplicate":
        client.post("/api/catalogs", json={"path": str(folder)})
    else:
        folder = tmp_path / "nowhere"
    resp = client.post("/api/catalogs", json={"path": str(folder)})
    assert resp.status_code == 400 and resp.json()["detail"]


def test_the_project_folder_moves_and_new_models_are_saved_there(tmp_path):
    folder = _folder(tmp_path / "project")
    assert client.post("/api/catalogs/project-folder", json={"path": str(folder)}).status_code == 200
    assert get_model_dirs()[0] == folder.resolve()
    assert client.get("/api/catalogs").json()["projectFolder"]["path"] == str(folder.resolve())

    resp = client.post("/api/models/save-as", json={"source": "import psyneulink as pnl\n", "file_name": "new"})
    assert resp.status_code == 200
    assert (folder / "new.py").exists()


def test_the_project_folder_cannot_also_be_a_catalog(tmp_path):
    folder = _folder(tmp_path / "project")
    client.post("/api/catalogs/project-folder", json={"path": str(folder)})
    assert client.post("/api/catalogs", json={"path": str(folder)}).status_code == 400


def test_the_hosted_deployment_cannot_change_catalogs(tmp_path, monkeypatch):
    monkeypatch.setattr(deployment_mode, "current_mode", lambda: deployment_mode.HOSTED)
    folder = _folder(tmp_path / "lab")
    assert client.post("/api/catalogs", json={"path": str(folder)}).status_code == 400
    assert client.get("/api/catalogs").json()["canEdit"] is False
