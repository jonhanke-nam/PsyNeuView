"""Where things live: /api/locations and removing a managed copy (#1295)."""

import os
import subprocess

import pytest
from fastapi.testclient import TestClient

from app.api import routes as api_routes
from app.main import app
from app.services import locations, model_dirs

client = TestClient(app)


@pytest.fixture(autouse=True)
def loopback(monkeypatch):
    """Removing a copy is gated like install; TestClient's host isn't loopback."""
    monkeypatch.setattr(api_routes, "_is_loopback", lambda request: True)


@pytest.fixture
def sources(tmp_path, monkeypatch):
    """A throwaway sources folder with two managed copies, one of them a real
    git clone with an origin, plus a symlink pointing out of the folder."""
    root = tmp_path / "sources"
    root.mkdir()
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(root))
    monkeypatch.delenv(model_dirs.MODELS_DIR_ENV, raising=False)
    princeton = root / "PsyNeuLink-PrincetonUniversity"
    princeton.mkdir()
    subprocess.run(["git", "init", "-q", str(princeton)], check=True)
    subprocess.run(
        ["git", "-C", str(princeton), "remote", "add", "origin",
         "https://github.com/PrincetonUniversity/PsyNeuLink.git"], check=True,
    )
    (princeton / "pyproject.toml").write_text("[project]\nname='psyneulink'\n")
    fork = root / "PsyNeuLink-jonhanke-nam"
    fork.mkdir()
    (fork / "big.bin").write_bytes(b"x" * 4096)
    (root / ".state").mkdir()
    (root / ".state" / "PsyNeuLink-jonhanke-nam.json").write_text("{}")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "huge.bin").write_bytes(b"y" * 100_000)
    os.symlink(outside, root / "escape")
    locations._size_cache.clear()
    return root


def test_locations_lists_every_place_with_a_path(sources, tmp_path):
    folder = tmp_path / "project"
    folder.mkdir()
    client.post("/api/catalogs/project-folder", json={"path": str(folder)})
    lab = tmp_path / "lab"
    lab.mkdir()
    client.post("/api/catalogs", json={"path": str(lab), "name": "Lab"})

    data = client.get("/api/locations").json()
    assert data["psyneuview"]["path"] and data["psyneuview"]["kind"] in ("checkout", "included")
    assert data["psyneuview"]["editable"] == (data["psyneuview"]["kind"] == "checkout")
    assert "path" in data["psyneulink"] and data["psyneulink"]["managed"] == (
        data["psyneulink"]["source"] in ("github", "pypi")
    )
    assert data["projectFolder"]["path"] == str(folder.resolve())
    assert [c["name"] for c in data["catalogs"]] == ["Lab"]
    assert data["appData"]["sources"] == str(sources)
    assert data["appData"]["configFile"].endswith("user-prefs.json")

    copies = {c["name"]: c for c in data["managedCopies"]}
    # The symlink out of the folder is not a managed copy.
    assert set(copies) == {"PsyNeuLink-PrincetonUniversity", "PsyNeuLink-jonhanke-nam"}
    assert copies["PsyNeuLink-PrincetonUniversity"]["repo"] == "PrincetonUniversity/PsyNeuLink"
    assert copies["PsyNeuLink-jonhanke-nam"]["size_bytes"] >= 4096
    assert all(c["size_complete"] and not c["in_use"] for c in copies.values())


def test_folder_size_never_follows_symlinks_and_is_bounded(sources):
    size, complete = locations.folder_size(sources)
    assert complete and size < 100_000
    locations._size_cache.clear()
    size, complete = locations.folder_size(sources, budget_s=0)
    assert complete is False  # hit the cap: a lower bound, said so


def test_removing_a_managed_copy_deletes_only_that_folder(sources):
    resp = client.delete("/api/locations/managed-copies/PsyNeuLink-jonhanke-nam")
    assert resp.status_code == 200, resp.text
    assert not (sources / "PsyNeuLink-jonhanke-nam").exists()
    assert not (sources / ".state" / "PsyNeuLink-jonhanke-nam.json").exists()
    assert (sources / "PsyNeuLink-PrincetonUniversity").exists()
    assert (sources.parent / "outside" / "huge.bin").exists()


@pytest.mark.parametrize("name", ["escape", "..", ".state", "nope", "PsyNeuLink-PrincetonUniversity/sub"])
def test_removing_anything_else_is_refused(sources, name):
    resp = client.delete(f"/api/locations/managed-copies/{name}")
    assert resp.status_code in (400, 404, 405)
    assert (sources.parent / "outside" / "huge.bin").exists()
    assert (sources / "PsyNeuLink-PrincetonUniversity").exists()


def test_the_copy_in_use_cannot_be_removed(sources, monkeypatch):
    in_use = sources / "PsyNeuLink-PrincetonUniversity"
    monkeypatch.setattr(locations, "_active_pnl_path", lambda: in_use.resolve())
    copies = {c["name"]: c["in_use"] for c in client.get("/api/locations").json()["managedCopies"]}
    assert copies == {"PsyNeuLink-PrincetonUniversity": True, "PsyNeuLink-jonhanke-nam": False}
    resp = client.delete("/api/locations/managed-copies/PsyNeuLink-PrincetonUniversity")
    assert resp.status_code == 400 and "in use" in resp.json()["detail"]
    assert in_use.exists()
