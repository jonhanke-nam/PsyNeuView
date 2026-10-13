"""Moving My Project Folder, and where it lives by default (#1295).

The preferences file is a throwaway one (conftest), and the project folder
is set through it here, never through the environment variable.
"""

import os

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import deployment_mode, model_dirs, project_folder

client = TestClient(app)

MODEL = "import psyneulink as pnl\n"


@pytest.fixture(autouse=True)
def _no_models_dir_env(monkeypatch):
    monkeypatch.delenv(model_dirs.MODELS_DIR_ENV, raising=False)


def _project(tmp_path, name="project"):
    """A project folder with a model, its sidecars beside it and in the hidden
    folder, a nested model, and a symlink — the shapes a move must carry."""
    folder = tmp_path / name
    (folder / "sub").mkdir(parents=True)
    (folder / ".psyneuview").mkdir()
    (folder / "stroop.py").write_text(MODEL)
    (folder / "stroop.pnlview.json").write_text("{}")
    (folder / "stroop.labels.yaml").write_text("labels: {}\n")
    (folder / ".psyneuview" / "stroop.psyneuview.json").write_text("{}")
    (folder / "sub" / "nested.py").write_text(MODEL)
    os.symlink("stroop.py", folder / "link.py")
    client.post("/api/catalogs/project-folder", json={"path": str(folder)})
    return folder


def _files(folder):
    return sorted(
        str(p.relative_to(folder)) for p in folder.rglob("*") if p.is_file() or p.is_symlink()
    )


def test_a_move_carries_everything_and_points_the_setting_at_the_new_place(tmp_path):
    src = _project(tmp_path)
    before = _files(src)
    dst = tmp_path / "Documents" / "PsyNeuView-My-Models"

    resp = client.post("/api/catalogs/project-folder/move", json={"path": str(dst)})
    assert resp.status_code == 200, resp.text
    assert resp.json()["ok"] and resp.json()["files"] == len(before)

    assert _files(dst) == before
    assert os.readlink(dst / "link.py") == "stroop.py"
    assert not src.exists()
    assert model_dirs.get_model_dirs()[0] == dst.resolve()
    assert client.get("/api/catalogs").json()["projectFolder"]["path"] == str(dst.resolve())
    # Recorded for Report a Problem.
    last = client.get("/api/catalogs").json()["projectFolder"]["lastMove"]
    assert last["ok"] and last["from"] == str(src.resolve()) and last["to"] == str(dst.resolve())
    assert isinstance(last["at"], float)


def test_moving_back_is_just_another_move(tmp_path):
    src = _project(tmp_path)
    before = _files(src)
    dst = tmp_path / "elsewhere"
    assert client.post("/api/catalogs/project-folder/move", json={"path": str(dst)}).status_code == 200
    assert client.post("/api/catalogs/project-folder/move", json={"path": str(src)}).status_code == 200
    assert _files(src) == before and not dst.exists()
    assert model_dirs.get_model_dirs()[0] == src.resolve()


def test_an_interrupted_move_leaves_the_old_folder_and_the_setting_alone(tmp_path, monkeypatch):
    src = _project(tmp_path)
    before = _files(src)
    dst = tmp_path / "new"
    copied = []
    real = project_folder._copy_file

    def flaky(s, d):
        if len(copied) == 2:
            raise OSError("disk full")
        copied.append(d)
        real(s, d)

    monkeypatch.setattr(project_folder, "_copy_file", flaky)
    resp = client.post("/api/catalogs/project-folder/move", json={"path": str(dst)})
    assert resp.status_code == 400 and "disk full" in resp.json()["detail"]

    assert _files(src) == before
    assert not dst.exists()  # taken back out: this move created it
    assert model_dirs.get_model_dirs()[0] == src.resolve()
    last = client.get("/api/catalogs").json()["projectFolder"]["lastMove"]
    assert last["ok"] is False and "disk full" in last["error"]


def test_a_destination_with_other_files_is_merged_into(tmp_path):
    src = _project(tmp_path)
    dst = tmp_path / "shared"
    (dst / "sub").mkdir(parents=True)
    (dst / "theirs.py").write_text(MODEL)
    (dst / "sub" / "also_theirs.py").write_text(MODEL)

    assert client.post("/api/catalogs/project-folder/move", json={"path": str(dst)}).status_code == 200
    assert (dst / "theirs.py").exists() and (dst / "sub" / "also_theirs.py").exists()
    assert (dst / "stroop.py").exists() and (dst / "sub" / "nested.py").exists()


def test_a_destination_with_colliding_names_is_refused_and_nothing_moves(tmp_path):
    src = _project(tmp_path)
    before = _files(src)
    dst = tmp_path / "shared"
    (dst / "sub").mkdir(parents=True)
    (dst / "stroop.py").write_text("something else\n")
    (dst / "sub" / "nested.py").write_text("something else\n")
    (dst / "theirs.py").write_text(MODEL)

    resp = client.post("/api/catalogs/project-folder/move", json={"path": str(dst)})
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert "stroop.py" in detail and "sub/nested.py" in detail and "theirs.py" not in detail
    assert _files(src) == before
    assert (dst / "stroop.py").read_text() == "something else\n"
    assert model_dirs.get_model_dirs()[0] == src.resolve()


def test_the_environment_variable_wins(tmp_path, monkeypatch):
    src = _project(tmp_path)
    monkeypatch.setenv(model_dirs.MODELS_DIR_ENV, str(src))
    resp = client.post("/api/catalogs/project-folder/move", json={"path": str(tmp_path / "new")})
    assert resp.status_code == 400 and model_dirs.MODELS_DIR_ENV in resp.json()["detail"]
    assert client.get("/api/catalogs").json()["projectFolder"]["moveOffer"] is None


@pytest.mark.parametrize("where", ["inside", "outside", "same"])
def test_nested_or_same_destinations_are_refused(tmp_path, where):
    src = _project(tmp_path)
    dst = {"inside": src / "sub", "outside": tmp_path, "same": src}[where]
    resp = client.post("/api/catalogs/project-folder/move", json={"path": str(dst)})
    assert resp.status_code == 400
    assert (src / "stroop.py").exists()


def test_a_catalog_inside_the_folder_moves_with_it(tmp_path):
    src = _project(tmp_path)
    client.post("/api/catalogs", json={"path": str(src / "sub"), "name": "Nested"})
    dst = tmp_path / "new"
    assert client.post("/api/catalogs/project-folder/move", json={"path": str(dst)}).status_code == 200
    [catalog] = client.get("/api/catalogs").json()["catalogs"]
    assert catalog["path"] == str(dst / "sub") and catalog["exists"]


# ── The default folder, and the one-time offer ───────────────────────


@pytest.fixture
def mac_home(tmp_path, monkeypatch):
    """A Mac, running locally, with a throwaway home folder."""
    monkeypatch.setattr(model_dirs, "_platform", lambda: "darwin")
    monkeypatch.setattr(deployment_mode, "current_mode", lambda: deployment_mode.LOCAL)
    monkeypatch.setattr(model_dirs.Path, "home", classmethod(lambda cls: tmp_path / "home"))
    (tmp_path / "home").mkdir()
    monkeypatch.setattr(model_dirs, "REPO_MODELS_DIR", tmp_path / "repo" / "models")
    return tmp_path / "home"


def test_a_new_install_on_a_mac_gets_the_visible_default(mac_home):
    assert model_dirs.default_models_dir() == mac_home / "Documents" / "PsyNeuView-My-Models"
    assert model_dirs.VISIBLE_PROJECT_FOLDER == "Documents/PsyNeuView-My-Models"
    assert client.get("/api/catalogs").json()["projectFolder"]["moveOffer"] is None


@pytest.mark.parametrize("platform,mode", [("linux", deployment_mode.LOCAL), ("darwin", deployment_mode.CONTAINER)])
def test_other_platforms_and_deployments_keep_the_checkout_folder(mac_home, monkeypatch, platform, mode):
    monkeypatch.setattr(model_dirs, "_platform", lambda: platform)
    monkeypatch.setattr(deployment_mode, "current_mode", lambda: mode)
    assert model_dirs.default_models_dir() == model_dirs.REPO_MODELS_DIR


def test_an_existing_user_keeps_the_hidden_folder_and_is_offered_a_move_once(mac_home):
    hidden = mac_home / ".psyneuview" / "models"
    hidden.mkdir(parents=True)
    (hidden / "mine.py").write_text(MODEL)
    assert model_dirs.default_models_dir() == hidden

    offer = client.get("/api/catalogs").json()["projectFolder"]["moveOffer"]
    assert offer == {"from": str(hidden), "to": str(mac_home / "Documents" / "PsyNeuView-My-Models")}

    # "Not now" is remembered.
    assert client.post("/api/catalogs/project-folder/move-offer/dismiss").status_code == 200
    assert client.get("/api/catalogs").json()["projectFolder"]["moveOffer"] is None


def test_the_offer_and_move_share_the_migration(mac_home):
    hidden = mac_home / ".psyneuview" / "models"
    hidden.mkdir(parents=True)
    (hidden / "mine.py").write_text(MODEL)
    offer = client.get("/api/catalogs").json()["projectFolder"]["moveOffer"]
    resp = client.post("/api/catalogs/project-folder/move", json={"path": offer["to"]})
    assert resp.status_code == 200
    assert (mac_home / "Documents" / "PsyNeuView-My-Models" / "mine.py").exists()
    assert not hidden.exists()
    assert client.get("/api/catalogs").json()["projectFolder"]["moveOffer"] is None


def test_a_folder_the_user_chose_gets_no_offer(mac_home, tmp_path):
    chosen = tmp_path / "lab"
    chosen.mkdir()
    client.post("/api/catalogs/project-folder", json={"path": str(chosen)})
    assert client.get("/api/catalogs").json()["projectFolder"]["moveOffer"] is None
