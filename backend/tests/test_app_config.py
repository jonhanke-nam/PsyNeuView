"""The preferences-file path resolves through one accessor (#1025).

Four modules read and write the same ``~/.psynewview.json``. They used to
hardcode it separately, so an override could isolate one of them and leave the
rest writing to the developer's real file — isolation that *looks* like it
worked, which is worse than none. These tests pin the two properties that make
that impossible to reintroduce: the env var is honoured, and all four modules
land on the same path.
"""

import json
from pathlib import Path

import pytest

from app.services import app_settings, file_history, model_dirs, source_history
from app.services.app_config import CONFIG_ENV, DEFAULT_CONFIG_FILE, app_config_path


def test_defaults_to_the_real_home_file(monkeypatch):
    monkeypatch.delenv(CONFIG_ENV, raising=False)
    assert app_config_path() == DEFAULT_CONFIG_FILE
    assert app_config_path().name == ".psynewview.json"  # legacy spelling is load-bearing


def test_env_override_wins(monkeypatch, tmp_path):
    target = tmp_path / "prefs.json"
    monkeypatch.setenv(CONFIG_ENV, str(target))
    assert app_config_path() == target


def test_blank_env_falls_back_rather_than_writing_to_cwd(monkeypatch):
    # An empty value is how an unset var arrives from a shell; treating it as a
    # path would silently write "" -> the current directory.
    monkeypatch.setenv(CONFIG_ENV, "   ")
    assert app_config_path() == DEFAULT_CONFIG_FILE


def test_override_is_read_per_call_not_frozen_at_import(monkeypatch, tmp_path):
    # The e2e harness starts uvicorn as a separate process; an import-time
    # constant would be fixed before the environment could reach it.
    monkeypatch.setenv(CONFIG_ENV, str(tmp_path / "one.json"))
    first = app_config_path()
    monkeypatch.setenv(CONFIG_ENV, str(tmp_path / "two.json"))
    assert app_config_path() != first


def test_user_paths_are_expanded(monkeypatch):
    monkeypatch.setenv(CONFIG_ENV, "~/somewhere/prefs.json")
    assert app_config_path() == Path.home() / "somewhere" / "prefs.json"


def test_no_module_keeps_its_own_copy_of_the_path():
    """The regression that matters: a module reintroducing its own constant
    would be isolated from the override and quietly hit the real file."""
    for module in (app_settings, model_dirs, file_history, source_history):
        assert not hasattr(module, "CONFIG_FILE"), (
            f"{module.__name__} has its own CONFIG_FILE again — it will not "
            f"honour {CONFIG_ENV} and can write to the real preferences file"
        )


def test_all_four_modules_write_to_the_same_redirected_file(monkeypatch, tmp_path):
    """Isolating one module is not enough; they share a file and must move
    together."""
    target = tmp_path / "shared.json"
    monkeypatch.setenv(CONFIG_ENV, str(target))

    # A real-looking slug: ``owner/repo`` is a placeholder the history refuses
    # (#1292) — and this test, run before the override was honoured, is what
    # recorded one in a developer's real preferences file.
    app_settings.set_default_placement("dotfolder")
    source_history.record_selection("example-tests/PsyNeuLink", "devel")
    file_history.record_selection("example-tests/PsyNeuLink", "devel", "models/m.py")

    assert target.exists(), "writes did not land in the redirected file"
    assert app_settings.get_default_placement() == "dotfolder"
    assert source_history.list_selections()[0]["repo"] == "example-tests/PsyNeuLink"
    assert file_history.list_selections()[0]["path"] == "models/m.py"

    # model_dirs reads the same file; point it at a directory and confirm it is
    # read back from the override rather than from the real config.
    models = tmp_path / "models"
    models.mkdir()
    config = json.loads(target.read_text())
    config["model_dirs"] = [str(models)]
    target.write_text(json.dumps(config))
    monkeypatch.delenv("PSYNEWVIEW_MODELS_DIR", raising=False)
    assert models.resolve() in model_dirs.get_model_dirs()


def test_real_home_file_is_untouched_by_the_suite(monkeypatch, tmp_path):
    """A guard against the exact hazard #1025 was filed for."""
    monkeypatch.setenv(CONFIG_ENV, str(tmp_path / "prefs.json"))
    before = DEFAULT_CONFIG_FILE.read_bytes() if DEFAULT_CONFIG_FILE.exists() else None

    app_settings.set_default_placement("lateral")
    app_settings.set_default_placement(None)

    after = DEFAULT_CONFIG_FILE.read_bytes() if DEFAULT_CONFIG_FILE.exists() else None
    assert after == before, "the suite modified the developer's real ~/.psynewview.json"


def test_the_guard_names_a_test_that_writes_the_real_file(pytester, monkeypatch, tmp_path):
    """The session-wide guard (#1292): a test that gets past the per-test
    isolation and writes the real preferences file fails, by name. Run in a
    subprocess with HOME pointed at a temporary folder, so the "real" file is
    a throwaway one and the module-level default path is computed from it."""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    pytester.makeconftest((Path(__file__).parent / "conftest.py").read_text())
    pytester.makepyfile(
        test_writes="""
        from app.services import app_settings


        def test_writes_the_real_preferences_file(monkeypatch):
            monkeypatch.delenv("PSYNEUVIEW_CONFIG_FILE")
            app_settings.set_default_placement("dotfolder")


        def test_leaves_it_alone():
            assert app_settings.get_default_placement() in (None, "dotfolder", "lateral", "beside")
        """
    )
    result = pytester.runpytest_subprocess("-p", "no:cacheprovider", "-p", "no:randomly", "-q")
    result.assert_outcomes(passed=2, errors=1)
    result.stdout.fnmatch_lines(["*test_writes_the_real_preferences_file changed the real preferences file*"])
    assert (home / ".psynewview.json").exists()  # the write really happened, in the throwaway home
