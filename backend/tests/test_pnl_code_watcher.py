"""A change to PsyNeuLink's own code in a local checkout reloads (#1225).

The model runner imports PsyNeuLink once, so an edit to the checkout's
``psyneulink/`` package went unseen until the app restarted. The watcher
restarts the runner and reports the changed files. Real filesystem events on a
fake checkout; the runner restart is stubbed.
"""

import json
import threading

import pytest

from app.services import pnl_code_watcher as pcw
from app.services import settings_info


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


@pytest.fixture
def watcher(monkeypatch, tmp_path):
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(tmp_path / "sources"))
    restarts = []
    monkeypatch.setattr(pcw.sandbox, "restart_warm_worker", lambda: restarts.append(1) or True)
    w = pcw.PsyNeuLinkCodeWatcher(debounce_s=0.2)
    w.restarts = restarts
    yield w
    w.stop()


def _use(monkeypatch, fake):
    monkeypatch.setattr(settings_info, "distribution", lambda name: fake)


def _checkout(root):
    (root / "psyneulink" / "core").mkdir(parents=True)
    (root / "psyneulink" / "core" / "mechanism.py").write_text("X = 1\n")
    return root


def test_an_edit_to_the_checkout_restarts_the_runner_and_reports_it(watcher, monkeypatch, tmp_path):
    root = _checkout(tmp_path / "my-psyneulink")
    _use(monkeypatch, _FakeDist(direct_url={"url": "file://" + str(root), "dir_info": {"editable": True}}))
    reloaded = threading.Event()
    got = []
    assert watcher.ensure(lambda files: (got.extend(files), reloaded.set()), lambda p: False) == (root / "psyneulink").resolve()

    (root / "psyneulink" / "core" / "mechanism.py").write_text("X = 2\n")
    assert reloaded.wait(5), "no reload after editing PsyNeuLink's code"
    assert watcher.restarts == [1]
    assert any(f.endswith("mechanism.py") for f in got)


def test_non_python_and_ignored_files_do_not_reload(watcher, monkeypatch, tmp_path):
    root = _checkout(tmp_path / "my-psyneulink")
    _use(monkeypatch, _FakeDist(direct_url={"url": "file://" + str(root), "dir_info": {"editable": True}}))
    reloaded = threading.Event()
    open_model = root / "psyneulink" / "core" / "open_model.py"
    watcher.ensure(lambda files: reloaded.set(), lambda p: p.endswith("open_model.py"))

    (root / "psyneulink" / "notes.txt").write_text("hi\n")
    open_model.write_text("# the open model, watched on its own\n")
    assert not reloaded.wait(1)
    assert watcher.restarts == []


def test_github_and_pypi_installs_are_not_watched(watcher, monkeypatch, tmp_path):
    clone = _checkout(tmp_path / "sources" / "PrincetonUniversity__PsyNeuLink")
    _use(monkeypatch, _FakeDist(direct_url={"url": "file://" + str(clone), "dir_info": {"editable": True}}))
    assert watcher.ensure(lambda files: None, lambda p: False) is None

    site = _checkout(tmp_path / "site-packages")
    _use(monkeypatch, _FakeDist(site_packages=site))
    assert watcher.ensure(lambda files: None, lambda p: False) is None
