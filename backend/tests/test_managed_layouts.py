"""Layouts and labels for read-only PsyNeuLink files live outside the
install, keyed by source, and the one-time move there (#1321).

A library model from a PyPI release or a ``git+`` install opens in place
from site-packages. Its layout and label files are PsyNeuView's, not
PsyNeuLink's, so they must not be written into the install — and they must
survive a reinstall, which an automatic update does. These pin the new
location for every managed kind, that a reinstall keeps the layout, that a
local checkout still keeps its sidecars beside the file, and the startup
move from the two old places (site-packages, and the managed copies' old
``.state/artifacts`` tree).

The install is faked through its distribution metadata, as in
``test_pnl_source_guard``. The preferences file and the layouts folder are
throwaway ones (conftest); tests about the default location and the
migration clear the variable and give ``Path.home`` a temp folder.
"""

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import deployment_mode, edit_lock, managed_layouts as ml, settings_info
from app.services import sidecar_placement as sp
from app.services.labels import labels_path, load_labels, save_labels
from app.services.layout import load_layout, save_layout, sidecar_path
from app.services.sidecar_index import index_path

MODEL = "import psyneulink as pnl\nA = pnl.TransferMechanism(name='A')\n"
REPO_KEY = "PsyNeuLink-PrincetonUniversity"
MODEL_REL = ("psyneulink", "library", "models")


class _FakeDist:
    def __init__(self, direct_url=None, site_packages=None, record=None):
        self._direct_url = direct_url
        self._site = site_packages
        self._record = record
        self.version = "9.9.9"

    def read_text(self, name):
        if name == "direct_url.json" and self._direct_url is not None:
            return json.dumps(self._direct_url)
        if name == "RECORD":
            return self._record
        return None

    def locate_file(self, rel):
        return self._site / rel


def _tree(root):
    models = root.joinpath(*MODEL_REL)
    models.mkdir(parents=True, exist_ok=True)
    model = models / "Model.py"
    model.write_text(MODEL)
    return model


def _declare(monkeypatch, fake):
    monkeypatch.setattr(settings_info, "distribution", lambda name: fake)


GIT_URL = {
    "url": "https://github.com/PrincetonUniversity/PsyNeuLink.git",
    "vcs_info": {"vcs": "git", "requested_revision": "devel", "commit_id": "72dde34"},
}


@pytest.fixture(autouse=True)
def clone_root(tmp_path, monkeypatch):
    root = tmp_path / "sources"
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(root))
    return root


@pytest.fixture
def pypi(tmp_path, monkeypatch):
    """An official release (or a kept one): no direct_url.json."""
    site = tmp_path / "venv" / "site-packages"
    model = _tree(site)
    _declare(monkeypatch, _FakeDist(site_packages=site))
    return site, model


@pytest.fixture
def git_install(tmp_path, monkeypatch):
    """``pip install git+https://github.com/…@devel``: read only, from GitHub."""
    site = tmp_path / "venv-git" / "site-packages"
    model = _tree(site)
    _declare(monkeypatch, _FakeDist(direct_url=GIT_URL, site_packages=site))
    return site, model


@pytest.fixture
def managed_copy(clone_root, monkeypatch):
    """A managed GitHub copy under the clone root, installed editable."""
    copy = clone_root / REPO_KEY
    model = _tree(copy)
    _declare(monkeypatch, _FakeDist(direct_url={"url": "file://" + str(copy), "dir_info": {"editable": True}}))
    return copy, model


@pytest.fixture
def local_checkout(tmp_path, monkeypatch):
    """The user's own checkout: editable, sidecars stay beside the file."""
    root = tmp_path / "my-psyneulink"
    model = _tree(root)
    _declare(monkeypatch, _FakeDist(direct_url={"url": "file://" + str(root), "dir_info": {"editable": True}}))
    return root, model


# ── Where ─────────────────────────────────────────────────────────────


def test_the_default_is_a_per_user_folder(tmp_path, monkeypatch):
    monkeypatch.delenv(ml.LAYOUTS_DIR_ENV, raising=False)
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(ml.Path, "home", classmethod(lambda cls: home))
    assert ml.layouts_dir() == home / ".psyneuview" / "layouts"
    assert not ml.fixed_by_env()


def test_a_pypi_release_layout_lands_outside_site_packages(pypi):
    site, model = pypi
    path = sidecar_path(str(model))
    assert path == ml.layouts_dir() / ml.PYPI_KEY / Path(*MODEL_REL, "Model.pnlview.json")
    assert not path.is_relative_to(site)

    save_layout(str(model), {"A": {"x": 1, "y": 2}})
    assert load_layout(str(model))["positions"]["A"] == {"x": 1, "y": 2}
    # Nothing written into the install: no lateral file, no dot-folder.
    assert not model.with_name("Model.pnlview.json").exists()
    assert not (model.parent / sp.DOT_DIRNAME).exists()


def test_labels_and_the_index_go_there_too(pypi):
    site, model = pypi
    save_labels(str(model), {"A": {"element_names": ["red"]}})
    assert load_labels(str(model)) == {"A": {"element_names": ["red"]}}
    for p in (labels_path(str(model)), index_path(str(model))):
        assert p.is_relative_to(ml.layouts_dir() / ml.PYPI_KEY)
        assert not p.is_relative_to(site)


def test_a_git_install_is_keyed_by_its_repo_not_its_commit(git_install):
    site, model = git_install
    path = sidecar_path(str(model))
    assert path == ml.layouts_dir() / REPO_KEY / Path(*MODEL_REL, "Model.pnlview.json")
    assert not path.is_relative_to(site)


def test_a_managed_copy_and_a_git_install_of_the_same_repo_share_layouts(managed_copy, tmp_path, monkeypatch):
    """Latest development from GitHub can be a clone or a ``git+`` install;
    the model is the same file either way, so the layout is too."""
    copy, model = managed_copy
    from_copy = sidecar_path(str(model))
    assert from_copy == ml.layouts_dir() / REPO_KEY / Path(*MODEL_REL, "Model.pnlview.json")
    assert not from_copy.is_relative_to(copy)

    site = tmp_path / "venv-git" / "site-packages"
    git_model = _tree(site)
    _declare(monkeypatch, _FakeDist(direct_url=GIT_URL, site_packages=site))
    assert sidecar_path(str(git_model)) == from_copy


def test_the_layout_survives_a_reinstall(pypi, monkeypatch):
    """What #1321 is for: a reinstall (an update, a switch of release) wipes
    site-packages/psyneulink and puts a new one there; the layout is still
    found, because the path depends on the source, not the install."""
    import shutil

    site, model = pypi
    save_layout(str(model), {"A": {"x": 10, "y": 20}})
    edit_lock.set_edit_mode(str(model), "viewOnly")
    before = sidecar_path(str(model))

    shutil.rmtree(site / "psyneulink")
    model = _tree(site)  # the new release's copy of the file
    model.write_text(MODEL + "# a newer version\n")
    _declare(monkeypatch, _FakeDist(site_packages=site))  # a fresh RECORD, same kind

    assert sidecar_path(str(model)) == before
    assert load_layout(str(model))["positions"]["A"] == {"x": 10, "y": 20}
    assert edit_lock.is_view_only(str(model))


def test_a_local_checkout_keeps_sidecars_beside_the_file(local_checkout):
    root, model = local_checkout
    path = sidecar_path(str(model))
    assert path.is_relative_to(root)
    assert not path.is_relative_to(ml.layouts_dir())
    assert ml.managed_source(model) is None
    assert sp.effective_placement(str(model))["managed"] is False


def test_a_file_of_the_users_is_untouched(tmp_path, pypi):
    mine = tmp_path / "models" / "mine.py"
    mine.parent.mkdir()
    mine.write_text(MODEL)
    assert ml.redirect_path(mine.with_name("mine.pnlview.json")) == mine.with_name("mine.pnlview.json")
    assert ml.managed_source(mine) is None


@pytest.mark.parametrize("fixture", ["pypi", "git_install", "managed_copy"])
def test_placement_is_reported_as_managed(request, fixture):
    """The UI's placement picker doesn't apply: companions are redirected."""
    _, model = request.getfixturevalue(fixture)
    assert sp.effective_placement(str(model))["managed"] is True


def test_the_redirect_is_idempotent(pypi):
    _, model = pypi
    once = ml.redirect_path(model.with_name("Model.pnlview.json"))
    assert ml.redirect_path(once) == once


@pytest.mark.parametrize("url,key", [
    ("https://github.com/PrincetonUniversity/PsyNeuLink.git", REPO_KEY),
    ("git+https://github.com/PrincetonUniversity/PsyNeuLink", REPO_KEY),
    ("git+ssh://git@github.com/jonhanke-nam/PsyNeuLink.git", "PsyNeuLink-jonhanke-nam"),
    ("https://gitlab.example.org/lab/PsyNeuLink.git", "PsyNeuLink-git-gitlab.example.org-lab-PsyNeuLink"),
    ("", "PsyNeuLink-git-unknown"),
])
def test_source_keys_name_the_repo(url, key):
    assert ml.source_key_for_url(url) == key


def test_locations_reports_the_folder(pypi):
    data = TestClient(app).get("/api/locations").json()
    assert data["appData"]["layouts"] == str(ml.layouts_dir())
    assert data["appData"]["layoutsFixedBy"] == ml.LAYOUTS_DIR_ENV
    assert data["appData"]["layoutsLastMigration"] is None


# ── The move ──────────────────────────────────────────────────────────


@pytest.fixture
def home(tmp_path, monkeypatch):
    """No PSYNEUVIEW_LAYOUTS_DIR, a temp home, a local deployment: the
    migration runs, into ``<home>/.psyneuview/layouts``."""
    monkeypatch.delenv(ml.LAYOUTS_DIR_ENV, raising=False)
    h = tmp_path / "home"
    h.mkdir()
    monkeypatch.setattr(ml.Path, "home", classmethod(lambda cls: h))
    monkeypatch.setattr(deployment_mode, "current_mode", lambda: deployment_mode.LOCAL)
    return h


RECORD = "\n".join([
    "psyneulink/__init__.py,sha256=abc,10",
    "psyneulink/library/models/Model.py,sha256=abc,10",
    "psyneulink/library/models/Shipped.pnlview.json,sha256=abc,2",
    "psyneulink-9.9.9.dist-info/RECORD,,",
]) + "\n"

#: Companions PsyNeuView wrote into a PyPI install before #1321 (lateral,
#: in the dot-folder, a named variant, a backup), and where they go.
STRAY = {
    "psyneulink/library/models/.psyneuview/Model.pnlview.json": '{"positions": {"A": {"x": 1, "y": 2}}, "editLock": "viewOnly"}',
    "psyneulink/library/models/Model.labels.yaml": "A:\n  element_names: [red]\n",
    "psyneulink/library/models/Model.alt.pnlview.json": "{}",
    "psyneulink/library/models/.psyneuview/Model.psyneuview.json": '{"activeLayout": "alt"}',
    "psyneulink/library/models/Model.original.py": "# backup\n",
}
MOVED = {
    "psyneulink/library/models/Model.pnlview.json",
    "psyneulink/library/models/Model.labels.yaml",
    "psyneulink/library/models/Model.alt.pnlview.json",
    "psyneulink/library/models/Model.psyneuview.json",
    "psyneulink/library/models/Model.original.py",
}
#: Things in the install that are not PsyNeuView's, and must stay.
KEEP = {
    "psyneulink/__init__.py": "",
    "psyneulink/library/models/Shipped.pnlview.json": "{}",   # the install's own, per RECORD
    "psyneulink/library/models/notes.txt": "not a sidecar\n",
}


def _old_install(tmp_path, monkeypatch):
    site = tmp_path / "venv" / "site-packages"
    model = _tree(site)
    for rel, text in {**STRAY, **KEEP}.items():
        p = site / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    # A symlink with a sidecar name is never one PsyNeuView wrote.
    os.symlink("Model.labels.yaml", site / "psyneulink" / "library" / "models" / "Link.labels.yaml")
    _declare(monkeypatch, _FakeDist(site_packages=site, record=RECORD))
    return site, model


def _old_clone_artifacts(clone_root):
    old = clone_root / ".state" / "artifacts" / "PsyNeuLink-owner" / "Scripts"
    old.mkdir(parents=True)
    (old / "m.pnlview.json").write_text('{"positions": {}}')
    (old / "m.labels.yaml").write_text("m: {}\n")
    return old


def _files(folder):
    return sorted(
        str(p.relative_to(folder)) for p in folder.rglob("*") if p.is_file() or p.is_symlink()
    )


def test_moves_companions_out_of_both_old_places(home, tmp_path, clone_root, monkeypatch):
    site, model = _old_install(tmp_path, monkeypatch)
    _old_clone_artifacts(clone_root)

    record = ml.migrate_legacy_layouts()

    assert record is not None and record["ok"], record
    assert record["moved"] == len(STRAY) + 2
    assert record["conflicts"] == [] and record["failures"] == []
    assert set(record["from"]) == {str(clone_root / ".state" / "artifacts"), str(site / "psyneulink")}
    dest = home / ".psyneuview" / "layouts"
    assert record["to"] == str(dest)
    assert set(_files(dest)) == {f"{ml.PYPI_KEY}/{rel}" for rel in MOVED} | {
        "PsyNeuLink-owner/Scripts/m.pnlview.json", "PsyNeuLink-owner/Scripts/m.labels.yaml",
    }
    # The install keeps what is its own (and the symlink); PsyNeuView's are gone,
    # and so is the emptied dot-folder.
    assert set(_files(site)) == set(KEEP) | {"psyneulink/library/models/Model.py", "psyneulink/library/models/Link.labels.yaml"}
    assert not (site / "psyneulink" / "library" / "models" / ".psyneuview").exists()
    assert not (clone_root / ".state" / "artifacts").exists()
    # Recorded, for Report a Problem.
    assert ml.last_migration() == record
    assert TestClient(app).get("/api/locations").json()["appData"]["layoutsLastMigration"] == record


def test_a_moved_layout_and_lock_are_found_at_the_new_path(home, tmp_path, monkeypatch):
    site, model = _old_install(tmp_path, monkeypatch)
    ml.migrate_legacy_layouts()
    assert sidecar_path(str(model)) == home / ".psyneuview" / "layouts" / ml.PYPI_KEY / "psyneulink" / "library" / "models" / "Model.pnlview.json"
    assert load_layout(str(model))["positions"] == {"A": {"x": 1, "y": 2}}
    assert edit_lock.is_view_only(str(model))
    assert load_labels(str(model)) == {"A": {"element_names": ["red"]}}


def test_a_second_run_finds_nothing(home, tmp_path, clone_root, monkeypatch):
    site, _ = _old_install(tmp_path, monkeypatch)
    _old_clone_artifacts(clone_root)
    first = ml.migrate_legacy_layouts()
    dest = home / ".psyneuview" / "layouts"
    before = {rel: (dest / rel).read_text() for rel in _files(dest)}

    assert ml.migrate_legacy_layouts() is None
    assert {rel: (dest / rel).read_text() for rel in _files(dest)} == before
    assert ml.last_migration() == first


def test_a_file_already_there_is_never_overwritten(home, tmp_path, monkeypatch):
    site, model = _old_install(tmp_path, monkeypatch)
    dest = home / ".psyneuview" / "layouts" / ml.PYPI_KEY / "psyneulink" / "library" / "models"
    dest.mkdir(parents=True)
    # Different content: the one in the new folder wins, the old one stays.
    (dest / "Model.pnlview.json").write_text('{"positions": {"A": {"x": 99, "y": 99}}}')
    # Identical content: the old one is simply removed.
    (dest / "Model.labels.yaml").write_text(STRAY["psyneulink/library/models/Model.labels.yaml"])

    record = ml.migrate_legacy_layouts()

    assert record["ok"]
    assert record["conflicts"] == [str(site / "psyneulink/library/models/.psyneuview/Model.pnlview.json")]
    assert record["duplicates_removed"] == 1
    assert record["moved"] == len(STRAY) - 2
    assert (site / "psyneulink/library/models/.psyneuview/Model.pnlview.json").exists()
    assert not (site / "psyneulink/library/models/Model.labels.yaml").exists()
    assert json.loads((dest / "Model.pnlview.json").read_text())["positions"]["A"] == {"x": 99, "y": 99}


def test_a_failed_copy_leaves_the_original(home, tmp_path, monkeypatch):
    site, _ = _old_install(tmp_path, monkeypatch)
    real_copy = ml._copy_file

    def flaky(src, dst):
        if src.name == "Model.labels.yaml":
            dst.write_text("half")
            raise OSError("disk full")
        real_copy(src, dst)

    monkeypatch.setattr(ml, "_copy_file", flaky)
    record = ml.migrate_legacy_layouts()

    assert record["ok"] is False
    assert [f["file"] for f in record["failures"]] == [str(site / "psyneulink/library/models/Model.labels.yaml")]
    assert "disk full" in record["failures"][0]["error"]
    assert (site / "psyneulink/library/models/Model.labels.yaml").read_text() == STRAY["psyneulink/library/models/Model.labels.yaml"]
    dest = home / ".psyneuview" / "layouts" / ml.PYPI_KEY / "psyneulink" / "library" / "models"
    assert not (dest / "Model.labels.yaml").exists()   # the partial copy is gone
    assert record["moved"] == len(STRAY) - 1           # the rest still moved


def test_an_install_without_a_record_is_left_alone(home, tmp_path, clone_root, monkeypatch):
    """Without RECORD there is no telling PsyNeuView's files from the
    install's own, so nothing in it is touched; the old artifacts tree
    still moves."""
    site, _ = _old_install(tmp_path, monkeypatch)
    _declare(monkeypatch, _FakeDist(site_packages=site, record=None))
    _old_clone_artifacts(clone_root)
    before = _files(site)

    record = ml.migrate_legacy_layouts()

    assert _files(site) == before
    assert record["moved"] == 2 and record["from"] == [str(clone_root / ".state" / "artifacts")]


def test_a_local_checkout_is_never_scanned(home, tmp_path, monkeypatch):
    root = tmp_path / "my-psyneulink"
    model = _tree(root)
    stray = model.parent / ".psyneuview" / "Model.pnlview.json"
    stray.parent.mkdir()
    stray.write_text("{}")
    _declare(monkeypatch, _FakeDist(direct_url={"url": "file://" + str(root), "dir_info": {"editable": True}}, record=RECORD))

    assert ml.migrate_legacy_layouts() is None
    assert stray.exists()


def test_nothing_moves_while_the_folder_is_fixed_by_the_environment(tmp_path, clone_root, monkeypatch):
    """The test suites and the e2e harness set the variable; a developer's
    real files must never be moved into a temp folder."""
    _old_install(tmp_path, monkeypatch)
    _old_clone_artifacts(clone_root)
    assert ml.fixed_by_env()
    assert ml.migrate_legacy_layouts() is None
    assert (clone_root / ".state" / "artifacts").exists()


def test_nothing_moves_in_a_remote_deployment(home, tmp_path, clone_root, monkeypatch):
    _old_install(tmp_path, monkeypatch)
    _old_clone_artifacts(clone_root)
    monkeypatch.setattr(deployment_mode, "current_mode", lambda: deployment_mode.CONTAINER)
    assert ml.migrate_legacy_layouts() is None
    assert (clone_root / ".state" / "artifacts").exists()


def test_nothing_to_move_leaves_no_record(home, pypi):
    assert ml.migrate_legacy_layouts() is None
    assert ml.last_migration() is None

