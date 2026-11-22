"""A version-bump-only diff lets CI skip its heavy jobs; nothing else may (#299).

`scripts/version_only_diff.py` is what every workflow's `changes` job asks
before skipping backend pytest and tutorials. A false "version only" would let a
real change merge untested, so most of these cases check that it says "run".

Each test builds a throwaway repo shaped like PsyNeuView's three version files
(PR #298 is the model bump) and checks the script's verdict on one commit.
"""

import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "version_only_diff.py"

INIT = '__version__ = "0.6.14"\n'
PYPROJECT = """\
[build-system]
requires = ["setuptools>=61"]
build-backend = "setuptools.build_meta"

[project]
name = "psyneuview"
version = "0.6.14"
description = "Web-first graphical interface for PsyNeuLink"
requires-python = ">=3.12,<3.15"
dependencies = [
    "fastapi>=0.110",
]
"""
LOCK = """\
version = 1
revision = 3

[[package]]
name = "fastapi"
version = "0.115.0"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "psyneuview"
version = "0.6.14"
source = { editable = "." }
dependencies = [
    { name = "fastapi" },
]
"""


def git(repo, *args):
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True, capture_output=True, text=True,
    ).stdout.strip()


def write(repo, rel, text):
    path = repo / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def bump(text):
    return text.replace('"0.6.14"', '"0.6.15"')


@pytest.fixture
def repo(tmp_path):
    r = tmp_path / "r"
    r.mkdir()
    git(r, "init", "-q", "-b", "main")
    git(r, "config", "user.email", "t@example.com")
    git(r, "config", "user.name", "t")
    write(r, "backend/app/__init__.py", INIT)
    write(r, "backend/pyproject.toml", PYPROJECT)
    write(r, "backend/uv.lock", LOCK)
    write(r, "backend/app/main.py", "print('hi')\n")
    git(r, "add", "-A")
    git(r, "commit", "-q", "-m", "base")
    return r


def commit(repo, files):
    for rel, text in files.items():
        write(repo, rel, text)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "--allow-empty", "-m", "change")


def version_only(repo, base="HEAD~1", head="HEAD"):
    result = subprocess.run(
        [sys.executable, str(SCRIPT), base, head],
        cwd=repo, capture_output=True, text=True,
    )
    assert result.returncode in (0, 1), result.stderr
    return result.returncode == 0


def bump_all():
    return {
        "backend/app/__init__.py": bump(INIT),
        "backend/pyproject.toml": bump(PYPROJECT),
        "backend/uv.lock": bump(LOCK),
    }


def test_bump_across_the_three_files_is_version_only(repo):
    commit(repo, bump_all())
    assert version_only(repo)


def test_bump_in_one_file_alone_is_version_only(repo):
    commit(repo, {"backend/app/__init__.py": bump(INIT)})
    assert version_only(repo)


def test_bump_plus_a_dependency_change_in_the_lock_runs(repo):
    files = bump_all()
    files["backend/uv.lock"] = files["backend/uv.lock"].replace('"0.115.0"', '"0.116.0"')
    commit(repo, files)
    assert not version_only(repo)


def test_bump_plus_a_new_line_in_our_lock_block_runs(repo):
    files = bump_all()
    files["backend/uv.lock"] = files["backend/uv.lock"].replace(
        '    { name = "fastapi" },\n', '    { name = "fastapi" },\n    { name = "numpy" },\n'
    )
    commit(repo, files)
    assert not version_only(repo)


def test_bump_plus_any_other_file_runs(repo):
    files = bump_all()
    files["backend/app/main.py"] = "print('bye')\n"
    commit(repo, files)
    assert not version_only(repo)


def test_a_non_version_line_in_pyproject_runs(repo):
    commit(repo, {"backend/pyproject.toml": PYPROJECT.replace(">=3.12", ">=3.13")})
    assert not version_only(repo)


def test_a_version_line_outside_the_project_table_runs(repo):
    commit(repo, {"backend/pyproject.toml": PYPROJECT + '\n[tool.x]\nversion = "1"\n'})
    assert not version_only(repo)


def test_an_empty_diff_runs(repo):
    commit(repo, {})
    assert not version_only(repo)


def test_a_bad_revision_runs(repo):
    assert not version_only(repo, base="no-such-ref")
