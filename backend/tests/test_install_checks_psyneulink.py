"""A PsyNeuLink switch checks the result before calling it a success (#1396).

The switch to a local checkout reported success while the model runner's
``import psyneulink`` found an empty folder the old install left behind, and
every model then failed to load. Now the install clears such a folder and
checks the import in a fresh Python; and before it runs, it moves the layouts
PsyNeuView saved inside the old install out of it.
"""
import os
import sys
from pathlib import Path

from app.services import install_manager as im
from app.services import managed_layouts
from app.services.install_manager import InstallJob, InstallManager


def _env_with(path: Path) -> dict:
    return {**os.environ, "PYTHONPATH": str(path)}


def test_import_check_passes_for_a_whole_psyneulink(tmp_path):
    (tmp_path / "psyneulink").mkdir()
    (tmp_path / "psyneulink" / "__init__.py").write_text("Composition = object\n")
    assert im.psyneulink_import_problem(env=_env_with(tmp_path)) is None


def test_import_check_names_a_psyneulink_without_composition(tmp_path):
    (tmp_path / "psyneulink").mkdir()
    (tmp_path / "psyneulink" / "__init__.py").write_text("")
    problem = im.psyneulink_import_problem(env=_env_with(tmp_path))
    assert "something else named psyneulink is in the way" in problem


def test_import_check_reports_an_import_error(tmp_path):
    (tmp_path / "psyneulink").mkdir()
    (tmp_path / "psyneulink" / "__init__.py").write_text("raise ImportError('numpy is too old')\n")
    problem = im.psyneulink_import_problem(env=_env_with(tmp_path))
    assert problem == "import psyneulink failed: ImportError: numpy is too old"


def _job() -> InstallJob:
    return InstallJob(id="j1", source="local", ref=None, path="/x", repo=None, command=["pip"])


def test_a_switch_that_does_not_import_is_a_failure_and_still_restarts_the_runner(monkeypatch, tmp_path):
    monkeypatch.delenv(managed_layouts.LAYOUTS_DIR_ENV)
    monkeypatch.setattr(managed_layouts, "clear_leftover_packages_here", lambda: {
        "kept_in": str(tmp_path / "kept"), "failures": [], "ok": True,
    })
    monkeypatch.setattr(im, "psyneulink_import_problem", lambda: "import psyneulink failed: boom")
    manager = InstallManager()
    restarted: list[bool] = []
    manager.register_on_success(lambda: restarted.append(True))
    job = _job()

    manager._finalize(job, exit_code=0)

    assert job.status == "failed"
    assert any("kept its files in" in line for line in job.log)
    assert any(line == "PsyNeuLink was installed, but import psyneulink failed: boom." for line in job.log)
    assert restarted == [True]


def test_a_switch_that_imports_succeeds(monkeypatch):
    monkeypatch.delenv(managed_layouts.LAYOUTS_DIR_ENV)
    monkeypatch.setattr(managed_layouts, "clear_leftover_packages_here", lambda: None)
    monkeypatch.setattr(im, "psyneulink_import_problem", lambda: None)
    job = _job()
    InstallManager()._finalize(job, exit_code=0)
    assert job.status == "succeeded"


def test_checks_are_off_while_tests_redirect_the_layouts_folder(monkeypatch):
    def must_not_run():
        raise AssertionError("checked the real environment")

    monkeypatch.setattr(im, "psyneulink_import_problem", must_not_run)
    job = _job()
    InstallManager()._finalize(job, exit_code=0)
    assert job.status == "succeeded"


def test_layouts_leave_the_old_install_before_pip_runs(monkeypatch):
    monkeypatch.setattr(managed_layouts, "migrate_legacy_layouts", lambda: {"moved": 2, "to": "/layouts"})
    manager = InstallManager()
    job = _job()
    manager._before_install(job)
    assert job.log == ["Moved 2 layout file(s) out of the old PsyNeuLink to /layouts"]
