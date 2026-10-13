"""The Library offers each model's file under its real name (#1254).

A checkout can hold a library file in a different case from the name
PsyNeuView expects, e.g. ``Giallanza2024_ego_study2.py`` where PsyNeuLink now
has ``Giallanza2024_EGO_Study2.py``. On a case-insensitive filesystem the
expected path still "exists", so the Library used to offer it as-is, and the
file watchers, which compare names exactly, never matched an outside edit.
"""

from pathlib import Path

from app.api.routes import LIBRARY_MODEL_NAMES, library_model_files


def _write(d: Path, filename: str) -> Path:
    p = d / filename
    p.write_text("# model\n")
    return p


def test_a_file_in_the_expected_case_is_listed_as_is(tmp_path):
    real = _write(tmp_path, "GilzenratModel.py")
    assert dict(library_model_files(tmp_path))["GilzenratModel"] == real


def test_a_file_in_another_case_is_listed_under_its_real_name(tmp_path):
    real = _write(tmp_path, "Giallanza2024_ego_study2.py")
    path = dict(library_model_files(tmp_path))["Giallanza2024_EGO_Study2"]
    # The name on disk, not the expected spelling: that's what the watchers see.
    assert path.name == "Giallanza2024_ego_study2.py"
    assert path == real


def test_files_that_arent_known_models_are_not_listed(tmp_path):
    _write(tmp_path, "GilzenratModel.py")
    _write(tmp_path, "scratch_experiment.py")
    assert [name for name, _ in library_model_files(tmp_path)] == ["GilzenratModel"]


def test_missing_models_are_simply_absent(tmp_path):
    assert library_model_files(tmp_path) == []


def test_the_order_follows_the_known_list(tmp_path):
    for name in reversed(LIBRARY_MODEL_NAMES):
        _write(tmp_path, f"{name.lower()}.py")
    assert [name for name, _ in library_model_files(tmp_path)] == LIBRARY_MODEL_NAMES
