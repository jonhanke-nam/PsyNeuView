"""One name everywhere: PsyNeuView, with the old spelling still understood (#258).

The project was first spelled "PsyNewView", and that spelling was left in the
package name, the settings file, environment variables and browser settings.
"""

import os
import subprocess
from pathlib import Path

import pytest

from app.services import app_config, env_names

REPO = Path(__file__).resolve().parents[2]

#: Where the old spelling is allowed: the code that understands it.
ALLOWED = {
    "backend/app/services/env_names.py",
    "backend/app/services/app_config.py",
    "backend/app/services/settings_info.py",
    "backend/tests/test_one_name.py",
    "frontend/src/migrateStorageNames.ts",
    "frontend/src/migrateStorageNames.test.ts",
    # The code scan's old-name check looks for it, and its tests write it (#243).
    "scripts/code_scan.py",
    "backend/tests/test_code_scan.py",
    # Generated from the test files (scripts/test_map.py, #319): they quote
    # the titles of the tests above, which name the old spelling.
    "docs/testing-coverage.md",
    "docs/testing-coverage-tests.md",
}


def test_the_old_spelling_appears_only_where_it_is_understood():
    tracked = subprocess.run(
        ["git", "grep", "-l", "-i", "psynewview"], cwd=REPO, capture_output=True, text=True
    ).stdout.split()
    assert sorted(set(tracked) - ALLOWED) == []


# ── Environment variables ────────────────────────────────────────────────


def test_the_new_name_is_read(monkeypatch):
    monkeypatch.delenv("PSYNEWVIEW_WORKING_DIR", raising=False)
    monkeypatch.setenv("PSYNEUVIEW_WORKING_DIR", "/new")
    assert env_names.env("WORKING_DIR") == "/new"
    assert env_names.set_by("WORKING_DIR") == "PSYNEUVIEW_WORKING_DIR"


def test_the_old_name_is_still_read(monkeypatch):
    # A Mac app from before the rename sets the old name.
    monkeypatch.delenv("PSYNEUVIEW_WORKING_DIR", raising=False)
    monkeypatch.setenv("PSYNEWVIEW_WORKING_DIR", "/old")
    assert env_names.env("WORKING_DIR") == "/old"
    assert env_names.set_by("WORKING_DIR") == "PSYNEWVIEW_WORKING_DIR"


def test_the_new_name_wins(monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_MODELS_DIR", "/new")
    monkeypatch.setenv("PSYNEWVIEW_MODELS_DIR", "/old")
    assert env_names.env("MODELS_DIR") == "/new"


def test_neither_gives_the_default(monkeypatch):
    monkeypatch.delenv("PSYNEUVIEW_LOG_LEVEL", raising=False)
    monkeypatch.delenv("PSYNEWVIEW_LOG_LEVEL", raising=False)
    assert env_names.env("LOG_LEVEL", "INFO") == "INFO"
    assert env_names.set_by("LOG_LEVEL") is None


# ── The settings file ────────────────────────────────────────────────────


def test_the_old_file_moves_and_its_name_still_works(tmp_path):
    old, new = tmp_path / ".psynewview.json", tmp_path / ".psyneuview.json"
    old.write_text('{"autosave": true}')
    assert app_config.migrate_legacy_config(new, old) is True
    assert new.read_text() == '{"autosave": true}'
    assert old.is_symlink() and old.resolve() == new.resolve()
    # Something still writing the old name writes the same file.
    old.write_text('{"autosave": false}')
    assert new.read_text() == '{"autosave": false}'


def test_an_existing_new_file_is_never_overwritten(tmp_path):
    old, new = tmp_path / ".psynewview.json", tmp_path / ".psyneuview.json"
    old.write_text('{"from": "old"}')
    new.write_text('{"from": "new"}')
    assert app_config.migrate_legacy_config(new, old) is False
    assert new.read_text() == '{"from": "new"}'
    assert old.read_text() == '{"from": "old"}'


def test_nothing_to_move(tmp_path):
    assert app_config.migrate_legacy_config(tmp_path / "n.json", tmp_path / "o.json") is False


def test_moving_twice_is_harmless(tmp_path):
    old, new = tmp_path / ".psynewview.json", tmp_path / ".psyneuview.json"
    old.write_text("{}")
    app_config.migrate_legacy_config(new, old)
    assert app_config.migrate_legacy_config(new, old) is False
    assert old.is_symlink()
