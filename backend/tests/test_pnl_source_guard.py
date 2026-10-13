"""PsyNeuView writes a PsyNeuLink file only when its source allows it (#1225, #1305).

A library model opens in place, so the file on screen is a file of the active
PsyNeuLink. From GitHub or PyPI it must never change: those installs are
promised to match their source. A local checkout is the user's own repo:
editable by default, and protected only when they say so for that checkout.

The install is faked through its distribution metadata, as in
``test_active_psyneulink_dir``; the preferences file is already a throwaway
one (conftest).
"""

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import app_settings, file_writer, pnl_source_guard, settings_info
from app.services.app_config import app_config_path

client = TestClient(app)

MODEL = "import psyneulink as pnl\nA = pnl.TransferMechanism(name='A')\n"


class _FakeDist:
    def __init__(self, direct_url=None, site_packages=None):
        self._direct_url = direct_url
        self._site = site_packages
        self.version = "9.9.9"

    def read_text(self, name):
        if name == "direct_url.json" and self._direct_url is not None:
            return json.dumps(self._direct_url)
        return None

    def locate_file(self, rel):
        return self._site / rel


def _install(monkeypatch, root, editable):
    models = root / "psyneulink" / "library" / "models"
    models.mkdir(parents=True)
    model = models / "Model.py"
    model.write_text(MODEL)
    if editable:
        fake = _FakeDist(direct_url={"url": "file://" + str(root), "dir_info": {"editable": True}})
    else:
        fake = _FakeDist(site_packages=root)
    monkeypatch.setattr(settings_info, "distribution", lambda name: fake)
    return model


@pytest.fixture
def clone_root(tmp_path, monkeypatch):
    root = tmp_path / "sources"
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(root))
    return root


@pytest.fixture
def github_model(clone_root, monkeypatch):
    return _install(monkeypatch, clone_root / "PrincetonUniversity__PsyNeuLink", editable=True)


@pytest.fixture
def pypi_model(tmp_path, monkeypatch, clone_root):
    return _install(monkeypatch, tmp_path / "site-packages", editable=False)


@pytest.fixture
def git_install_model(tmp_path, monkeypatch, clone_root):
    """`pip install git+https://github.com/…@devel`: not editable, not a managed
    clone, but from GitHub all the same (#1280)."""
    root = tmp_path / "site-packages-git"
    model = _install(monkeypatch, root, editable=False)
    fake = _FakeDist(
        direct_url={
            "url": "https://github.com/PrincetonUniversity/PsyNeuLink.git",
            "vcs_info": {"vcs": "git", "requested_revision": "devel", "commit_id": "72dde34"},
        },
        site_packages=root,
    )
    monkeypatch.setattr(settings_info, "distribution", lambda name: fake)
    return model


@pytest.fixture
def local_model(tmp_path, monkeypatch, clone_root):
    return _install(monkeypatch, tmp_path / "my-psyneulink", editable=True)


@pytest.mark.parametrize("fixture,kind", [
    ("github_model", "github"), ("pypi_model", "pypi"), ("git_install_model", "github"),
])
def test_github_and_pypi_files_are_never_written(request, fixture, kind):
    model = request.getfixturevalue(fixture)
    with pytest.raises(pnl_source_guard.PsyNeuLinkFileIsProtected) as err:
        file_writer.write_model_source(model, "# changed\n")
    assert err.value.ownership["kind"] == kind
    assert model.read_text() == MODEL


@pytest.mark.parametrize("fixture", ["github_model", "pypi_model", "git_install_model"])
def test_github_and_pypi_cannot_be_allowed_edits(request, fixture):
    model = request.getfixturevalue(fixture)
    resp = client.post("/api/model/pnl-source/protect", json={"file_path": str(model), "protect": False})
    assert resp.status_code == 400
    with pytest.raises(pnl_source_guard.PsyNeuLinkFileIsProtected):
        file_writer.write_model_source(model, "# changed\n")


@pytest.mark.parametrize("fixture,source", [
    ("github_model", "GitHub"), ("pypi_model", "PyPI"), ("git_install_model", "GitHub"),
])
def test_a_managed_install_says_to_use_your_own_checkout_in_settings(request, fixture, source):
    """The way out is Settings ▸ Developer, not the gear's old "Change install" (#1305)."""
    owned = pnl_source_guard.ownership(request.getfixturevalue(fixture))
    assert owned["editable"] is False
    assert f"PsyNeuLink from {source}" in owned["message"]
    assert "Settings ▸ Developer" in owned["message"]
    assert "Change install" not in owned["message"]


def test_a_local_checkout_is_editable_by_default(local_model):
    """Choosing your own checkout in Settings is the opt-in (#1305)."""
    status = client.post("/api/model/pnl-source", json={"file_path": str(local_model)}).json()
    assert status["owned"] and status["kind"] == "local" and status["editable"]
    assert "Editing your PsyNeuLink checkout" in status["message"]
    pnl_source_guard.guard_write(local_model)
    file_writer.write_model_source(local_model, "# changed\n")
    assert local_model.read_text() == "# changed\n"


def test_a_protected_local_checkout_refuses_writes_until_edits_are_allowed_again(local_model):
    resp = client.post("/api/model/pnl-source/protect", json={"file_path": str(local_model)})
    assert resp.status_code == 200 and resp.json()["editable"] is False
    assert "protected" in resp.json()["message"]
    with pytest.raises(pnl_source_guard.PsyNeuLinkFileIsProtected):
        file_writer.write_model_source(local_model, "# changed\n")
    assert local_model.read_text() == MODEL

    resp = client.post("/api/model/pnl-source/protect", json={"file_path": str(local_model), "protect": False})
    assert resp.status_code == 200 and resp.json()["editable"]
    file_writer.write_model_source(local_model, "# again\n")
    assert local_model.read_text() == "# again\n"


def _write_preferences(**keys):
    with app_settings._lock:
        config = app_settings._read_config(app_config_path())
        config.update(keys)
        app_settings._write_config_atomic(app_config_path(), config)


def test_a_root_allowed_under_the_old_opt_in_stays_editable(local_model):
    """Existing users' allow-lists keep working (#1305): an allowed root is
    editable even if it somehow also appears in the protected list."""
    root = pnl_source_guard.ownership(local_model)["root"]
    _write_preferences(**{pnl_source_guard.ALLOWED_KEY: [root], pnl_source_guard.PROTECTED_KEY: [root]})
    assert pnl_source_guard.ownership(local_model)["editable"] is True
    file_writer.write_model_source(local_model, "# changed\n")
    assert local_model.read_text() == "# changed\n"


def test_protecting_a_checkout_outranks_its_old_opt_in(local_model):
    root = pnl_source_guard.ownership(local_model)["root"]
    _write_preferences(**{pnl_source_guard.ALLOWED_KEY: [root]})
    client.post("/api/model/pnl-source/protect", json={"file_path": str(local_model)})
    assert pnl_source_guard.ownership(local_model)["editable"] is False
    with app_settings._lock:
        config = app_settings._read_config(app_config_path())
    assert root not in config.get(pnl_source_guard.ALLOWED_KEY, [])
    assert root in config[pnl_source_guard.PROTECTED_KEY]


def test_the_editor_save_writes_a_local_checkout_file(local_model):
    """The save the editor's Save button makes (#1305)."""
    resp = client.post("/api/model/save-source", json={
        "file_path": str(local_model), "source": MODEL + "# edited\n", "base_source": MODEL,
    })
    assert resp.status_code == 200, resp.text
    assert local_model.read_text() == MODEL + "# edited\n"


@pytest.mark.parametrize("fixture,kind,source", [
    ("github_model", "github", "GitHub"), ("pypi_model", "pypi", "PyPI"), ("git_install_model", "github", "GitHub"),
])
def test_the_editor_save_is_refused_for_a_managed_install(request, fixture, kind, source):
    model = request.getfixturevalue(fixture)
    resp = client.post("/api/model/save-source", json={
        "file_path": str(model), "source": MODEL + "# edited\n", "base_source": MODEL,
    })
    assert resp.status_code == 409
    body = resp.json()
    assert body["reason"] == "psyneulink_source_protected" and body["kind"] == kind
    assert f"PsyNeuLink from {source}" in body["detail"] and "Settings ▸ Developer" in body["detail"]
    assert model.read_text() == MODEL


def test_an_edit_route_answers_409_with_a_reason(github_model):
    """What the frontend sees: a refusal it can recognise, not a 500."""
    resp = client.post("/api/model/save-source", json={"file_path": str(github_model), "source": "# changed\n"})
    assert resp.status_code == 409
    body = resp.json()
    assert body["reason"] == "psyneulink_source_protected" and body["kind"] == "github"
    assert "GitHub" in body["detail"]  # readable wherever the app shows ``detail``
    assert github_model.read_text() == MODEL


def test_opening_a_protected_star_import_file_leaves_it_alone(github_model):
    star = "from psyneulink import *\nA = TransferMechanism(name='A')\n"
    github_model.write_text(star)
    client.post("/api/model/load", json={"file_path": str(github_model)})
    assert github_model.read_text() == star


def test_save_as_cannot_overwrite_a_protected_file(github_model):
    resp = client.post("/api/models/save-as", json={
        "file_name": github_model.name, "directory": str(github_model.parent),
        "source": "# changed\n", "overwrite": True,
    })
    assert resp.status_code == 409
    assert github_model.read_text() == MODEL


def test_ordinary_files_are_untouched_by_the_policy(tmp_path, github_model):
    mine = tmp_path / "mine.py"
    file_writer.write_model_source(mine, MODEL)
    assert mine.read_text() == MODEL
    assert client.post("/api/model/pnl-source", json={"file_path": str(mine)}).json() == {"owned": False}


def _with_example(model):
    """Give the fake install a Scripts/Examples next to its package."""
    root = model.parents[3]
    (root / "Scripts" / "Examples").mkdir(parents=True)
    (root / "Scripts" / "Examples" / "Demo.py").write_text(MODEL)
    return root / "Scripts" / "Examples" / "Demo.py"


def test_a_local_checkout_example_opens_in_place_and_editable(local_model):
    example = _with_example(local_model)
    resp = client.post("/api/psyneulink-examples/load", json={"name": "Demo"})
    assert resp.status_code == 200
    assert resp.json()["file_path"] == str(example)
    file_writer.write_model_source(example, "# changed\n")
    assert example.read_text() == "# changed\n"

    client.post("/api/model/pnl-source/protect", json={"file_path": str(example)})
    with pytest.raises(pnl_source_guard.PsyNeuLinkFileIsProtected):
        file_writer.write_model_source(example, "# again\n")


def test_a_github_example_opens_as_a_copy(github_model, tmp_path, monkeypatch):
    monkeypatch.setenv("PSYNEWVIEW_WORKING_DIR", str(tmp_path / "working"))
    example = _with_example(github_model)
    resp = client.post("/api/psyneulink-examples/load", json={"name": "Demo"})
    assert resp.status_code == 200
    assert resp.json()["file_path"] != str(example)


def test_a_git_install_is_called_github_not_pypi(git_install_model):
    """The badge and the editor's lock said "PyPI" for a `pip install git+…`
    from GitHub devel (#1280)."""
    owned = pnl_source_guard.ownership(git_install_model)
    assert owned["kind"] == "github"
    assert owned["editable"] is False
    assert "GitHub" in owned["message"]
    assert "PyPI" not in owned["message"]
