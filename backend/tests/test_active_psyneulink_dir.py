"""What PsyNeuView lists *from* PsyNeuLink follows the active install (#1225).

The PsyNeuLink library models, examples and tests were found through
``psyneulink.__file__``. The backend's main process imports psyneulink once and
keeps it, and switching the source restarts only the model runner, so after a
switch those lists went on pointing at the *previous* install until the app
restarted. A user editing their local checkout's library models saw nothing
change. They're now read from the installed distribution's metadata, fresh.

These tests fake that metadata: really reinstalling PsyNeuLink inside a test
isn't practical. ``psyneulink`` itself stays imported throughout, as it is in
the running backend, which is the point.
"""

import json

import psyneulink  # noqa: F401  kept imported on purpose, like the live backend
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import settings_info

client = TestClient(app)


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


def _checkout(root):
    """A minimal PsyNeuLink checkout: package, one library model, one example."""
    (root / "psyneulink" / "library" / "models").mkdir(parents=True)
    (root / "psyneulink" / "library" / "models" / "Cohen_Huston1994.py").write_text("# from the checkout\n")
    (root / "Scripts" / "Examples").mkdir(parents=True)
    return root


@pytest.fixture
def editable_checkout(tmp_path, monkeypatch):
    root = _checkout(tmp_path / "My PsyNeuLink")  # a space, as in real paths
    url = "file://" + str(root).replace(" ", "%20")
    fake = _FakeDist(direct_url={"url": url, "dir_info": {"editable": True}})
    monkeypatch.setattr(settings_info, "distribution", lambda name: fake)
    return root


def test_an_editable_install_resolves_to_the_checkout(editable_checkout):
    assert settings_info.active_psyneulink_package_dir() == editable_checkout / "psyneulink"


def test_the_library_list_follows_a_switch_without_a_restart(editable_checkout):
    """The bug: psyneulink stays imported from the old install, yet the list
    must come from the checkout that's now installed."""
    models = client.get("/api/library-models").json()["models"]
    paths = [m["path"] for m in models]
    assert paths == [str(editable_checkout / "psyneulink" / "library" / "models" / "Cohen_Huston1994.py")]


def test_a_wheel_install_resolves_to_site_packages(tmp_path, monkeypatch):
    site = tmp_path / "site-packages"
    (site / "psyneulink").mkdir(parents=True)
    monkeypatch.setattr(settings_info, "distribution", lambda name: _FakeDist(site_packages=site))
    assert settings_info.active_psyneulink_package_dir() == (site / "psyneulink").resolve()


def test_no_install_resolves_to_none(monkeypatch):
    def missing(name):
        raise settings_info.PackageNotFoundError(name)

    monkeypatch.setattr(settings_info, "distribution", missing)
    assert settings_info.active_psyneulink_package_dir() is None
    assert client.get("/api/library-models").json()["models"] == []


def test_an_editable_path_that_is_gone_resolves_to_none(tmp_path, monkeypatch):
    url = "file://" + str(tmp_path / "deleted-checkout")
    fake = _FakeDist(direct_url={"url": url, "dir_info": {"editable": True}})
    monkeypatch.setattr(settings_info, "distribution", lambda name: fake)
    assert settings_info.active_psyneulink_package_dir() is None
