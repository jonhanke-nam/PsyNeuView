"""The anchor collision detector must tell apart three fates (#1134).

`backend/` is the working directory when the app runs, so scratch models and
their sidecars pile up there. When one of those names later becomes tracked
upstream, the checkout stops fast-forwarding and quietly serves stale code.

Git treats the two populations in opposite ways, which is the whole reason the
script exists:

  untracked  the merge is refused and the files are named -- loud, recoverable
  ignored    the file is overwritten during checkout with no message at all

These build a throwaway repo containing one of each and assert the script sorts
them correctly, because getting the *ignored* case wrong means recommending a
sync that destroys someone's dragged node positions.
"""

import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check_anchor_collisions.py"


def git(repo, *args):
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True, capture_output=True, text=True,
    ).stdout


@pytest.fixture
def repo(tmp_path):
    """A repo whose `up` branch tracks four files the working tree also has."""
    r = tmp_path / "r"
    r.mkdir()
    git(r, "init", "-q", "-b", "main")
    git(r, "config", "user.email", "t@example.com")
    git(r, "config", "user.name", "t")
    (r / "README").write_text("base\n")
    git(r, "add", "-A")
    git(r, "commit", "-qm", "base")

    git(r, "checkout", "-q", "-b", "up")
    backend = r / "backend"
    backend.mkdir()
    for name, body in [
        ("same.pnlview.json", "UPSTREAM A\n"),
        ("mine.pnlview.json", "UPSTREAM B\n"),
        ("hidden.pnlview.json", "UPSTREAM C\n"),
    ]:
        (backend / name).write_text(body)
    git(r, "add", "-A")
    git(r, "commit", "-qm", "promote scratch models into the repo")

    git(r, "checkout", "-q", "main")
    backend.mkdir(exist_ok=True)
    (r / ".git" / "info" / "exclude").write_text("backend/hidden.pnlview.json\n")
    (backend / "same.pnlview.json").write_text("UPSTREAM A\n")   # identical twin
    (backend / "mine.pnlview.json").write_text("DRAGGED POSITIONS\n")
    (backend / "hidden.pnlview.json").write_text("HIDDEN POSITIONS\n")
    (backend / "scratch.py").write_text("no upstream twin\n")    # must be ignored
    return r


def run(repo, *extra):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--repo", str(repo), "--ref", "up", *extra],
        capture_output=True, text=True,
    )


def test_sorts_each_file_into_the_right_fate(repo):
    result = run(repo, "--scope", "backend/")
    assert result.returncode == 1, result.stdout

    blocked, _, silent = result.stdout.partition("SILENTLY OVERWRITTEN")
    # Refused by git, and differs -- the one worth rescuing.
    assert "backend/mine.pnlview.json" in blocked
    # Refused by git, but a byte-identical duplicate -- safe to delete.
    assert "backend/same.pnlview.json" in blocked
    # Ignored, so git would replace it without a word.
    assert "backend/hidden.pnlview.json" in silent
    assert "backend/hidden.pnlview.json" not in blocked
    # No upstream file of that name, so it collides with nothing.
    assert "scratch.py" not in result.stdout


def test_identical_and_differing_are_not_lumped_together(repo):
    out = run(repo, "--scope", "backend/").stdout
    rescue, _, safe = out.partition("safe to delete")
    assert "backend/mine.pnlview.json" in rescue
    assert "backend/same.pnlview.json" in safe


def test_clean_tree_reports_success(repo):
    for name in ("same.pnlview.json", "mine.pnlview.json", "hidden.pnlview.json"):
        (repo / "backend" / name).unlink()
    result = run(repo, "--scope", "backend/")
    assert result.returncode == 0
    assert "No collisions" in result.stdout


def test_scope_limits_the_search(repo):
    (repo / "other.txt").write_text("x\n")
    assert run(repo, "--scope", "does-not-exist/").returncode == 0


def test_missing_ref_is_an_error_not_a_pass(repo):
    """A typo'd or unfetched ref must not read as 'nothing would collide'."""
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--repo", str(repo), "--ref", "origin/nope"],
        capture_output=True, text=True,
    )
    assert result.returncode == 2
    assert "ref not found" in result.stderr
