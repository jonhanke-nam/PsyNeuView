"""Update options for a developer's checkouts (#1304): the check reports
behind or up to date, the pull is fast-forward only, and it refuses with
uncommitted changes or a diverged branch and never switches branch. All
against throwaway git repositories: a bare "remote" and clones of it."""

import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import routes as api_routes
from app.main import app
from app.services import checkout_updates as cu

client = TestClient(app)


def git(*args, cwd: Path) -> str:
    return subprocess.check_output(
        ["git", *args], cwd=str(cwd), text=True, stderr=subprocess.STDOUT,
        env={"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@x", "GIT_COMMITTER_NAME": "t",
             "GIT_COMMITTER_EMAIL": "t@x", "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", "HOME": str(cwd)},
    ).strip()


@pytest.fixture
def repos(tmp_path):
    """``remote`` (bare), ``mine`` (the checkout under test, tracking
    origin/devel) and ``theirs`` (another clone that pushes new commits)."""
    remote = tmp_path / "remote.git"
    git("init", "-q", "--bare", "-b", "devel", str(remote), cwd=tmp_path)
    theirs = tmp_path / "theirs"
    git("clone", "-q", str(remote), str(theirs), cwd=tmp_path)
    git("checkout", "-q", "-b", "devel", cwd=theirs)
    (theirs / "a.txt").write_text("one\n")
    git("add", "a.txt", cwd=theirs)
    git("commit", "-q", "-m", "one", cwd=theirs)
    git("push", "-q", "-u", "origin", "devel", cwd=theirs)
    mine = tmp_path / "mine"
    git("clone", "-q", "-b", "devel", str(remote), str(mine), cwd=tmp_path)
    return {"remote": remote, "theirs": theirs, "mine": mine}


def push_new_commit(theirs: Path, name: str) -> str:
    (theirs / f"{name}.txt").write_text(f"{name}\n")
    git("add", f"{name}.txt", cwd=theirs)
    git("commit", "-q", "-m", name, cwd=theirs)
    git("push", "-q", "origin", "devel", cwd=theirs)
    return git("rev-parse", "--short", "HEAD", cwd=theirs)


class TestCheck:
    def test_up_to_date_names_the_remote_branch(self, repos):
        result = cu.check(repos["mine"], now=5.0)
        assert result["status"] == "current"
        assert result["upstream"] == "origin/devel" and result["branch"] == "devel"
        assert result["detail"] == "Up to date with origin/devel."
        assert result["checked_at"] == 5.0 and result["fetched"] is True
        assert cu.recorded(repos["mine"])["last_check"]["status"] == "current"

    def test_behind_counts_the_commits_after_a_fetch(self, repos):
        push_new_commit(repos["theirs"], "two")
        push_new_commit(repos["theirs"], "three")
        result = cu.check(repos["mine"])
        assert result["status"] == "behind" and result["behind_by"] == 2
        assert result["detail"] == "2 commits behind origin/devel."

    def test_uncommitted_changes_are_counted_and_said(self, repos):
        (repos["mine"] / "a.txt").write_text("edited\n")
        (repos["mine"] / "new.txt").write_text("new\n")
        result = cu.check(repos["mine"])
        assert result["dirty_files"] == 2
        assert result["detail"] == "Up to date with origin/devel. 2 files changed locally; not pulled."

    def test_an_unreachable_remote_reads_as_unknown_not_current(self, repos, monkeypatch):
        import shutil
        shutil.rmtree(repos["remote"])
        result = cu.check(repos["mine"])
        assert result["status"] == "unknown" and result["fetched"] is False
        assert "Couldn't check" in result["detail"]

    def test_a_folder_that_is_not_a_checkout(self, tmp_path):
        plain = tmp_path / "plain"
        plain.mkdir()
        assert cu.inspect(plain)["status"] == "not_a_checkout"


class TestPull:
    def test_fast_forwards_when_behind(self, repos):
        head = push_new_commit(repos["theirs"], "two")
        result = cu.pull(repos["mine"])
        assert result["outcome"] == "pulled"
        assert result["to_commit"] == head
        assert result["detail"] == "Pulled 1 commit from origin/devel."
        assert git("rev-parse", "--short", "HEAD", cwd=repos["mine"]) == head
        assert git("symbolic-ref", "--short", "HEAD", cwd=repos["mine"]) == "devel"
        assert cu.recorded(repos["mine"])["last_check"]["status"] == "current"

    def test_already_up_to_date(self, repos):
        result = cu.pull(repos["mine"])
        assert result["outcome"] == "up_to_date"
        assert result["detail"] == "Already up to date with origin/devel."

    def test_refuses_with_uncommitted_changes(self, repos):
        push_new_commit(repos["theirs"], "two")
        (repos["mine"] / "a.txt").write_text("my edit\n")
        (repos["mine"] / "b.txt").write_text("mine\n")
        (repos["mine"] / "c.txt").write_text("mine\n")
        before = git("rev-parse", "HEAD", cwd=repos["mine"])
        result = cu.pull(repos["mine"])
        assert result["outcome"] == "refused"
        assert result["detail"] == "3 files changed locally; not pulled."
        assert git("rev-parse", "HEAD", cwd=repos["mine"]) == before
        assert (repos["mine"] / "a.txt").read_text() == "my edit\n"

    def test_refuses_a_diverged_branch(self, repos):
        push_new_commit(repos["theirs"], "two")
        (repos["mine"] / "local.txt").write_text("local\n")
        git("add", "local.txt", cwd=repos["mine"])
        git("commit", "-q", "-m", "local work", cwd=repos["mine"])
        before = git("rev-parse", "HEAD", cwd=repos["mine"])
        result = cu.pull(repos["mine"])
        assert result["outcome"] == "refused"
        assert result["detail"] == "Your branch has 1 commit origin/devel doesn't; not pulled."
        assert git("rev-parse", "HEAD", cwd=repos["mine"]) == before
        assert cu.recorded(repos["mine"])["last_check"]["status"] == "diverged"

    def test_never_switches_branch(self, repos):
        push_new_commit(repos["theirs"], "two")
        git("checkout", "-q", "-b", "experiment", cwd=repos["mine"])
        result = cu.pull(repos["mine"])
        assert result["outcome"] == "refused"
        assert "tracks no remote branch" in result["detail"]
        assert git("symbolic-ref", "--short", "HEAD", cwd=repos["mine"]) == "experiment"

    def test_refuses_off_a_branch(self, repos):
        git("checkout", "-q", "--detach", cwd=repos["mine"])
        result = cu.pull(repos["mine"])
        assert result["outcome"] == "refused"
        assert "detached" in result["detail"]


class TestPrefs:
    def test_both_switches_are_off_by_default_and_stored_per_checkout(self, repos):
        assert cu.prefs(repos["mine"]) == {"check": False, "pull_on_launch": False}
        assert cu.set_prefs(repos["mine"], pull_on_launch=True) == {"check": False, "pull_on_launch": True}
        assert cu.set_prefs(repos["mine"], check=True) == {"check": True, "pull_on_launch": True}
        assert cu.prefs(repos["theirs"]) == {"check": False, "pull_on_launch": False}

    def test_pull_on_launch_pulls_only_those_that_asked(self, repos, monkeypatch):
        from app.services import source_history
        source_history.remember_source("local", path=str(repos["mine"]))
        source_history.remember_source("local", path=str(repos["theirs"]))
        push_new_commit(repos["theirs"], "two")
        monkeypatch.setattr(cu, "list_checkouts", lambda **kw: [
            {"id": cu._key(repos["mine"]), "kind": "psyneulink", "name": "mine", "path": str(repos["mine"]),
             "exists": True, "in_use": False, "is_checkout": True, "check": False, "pull_on_launch": True},
            {"id": cu._key(repos["theirs"]), "kind": "psyneulink", "name": "theirs", "path": str(repos["theirs"]),
             "exists": True, "in_use": False, "is_checkout": True, "check": True, "pull_on_launch": False},
        ])
        results = cu.pull_on_launch()
        assert [r["outcome"] for r in results] == ["pulled"]
        checked = cu.check_enabled()
        assert len(checked) == 1 and checked[0]["branch"] == "devel"


@pytest.fixture
def loopback(monkeypatch):
    monkeypatch.setattr(api_routes, "_is_loopback", lambda request: True)


class TestRoutes:
    def test_a_known_psyneulink_checkout_is_listed_with_its_switches_and_can_be_checked(self, repos, loopback):
        from app.services import source_history
        source_history.remember_source("local", path=str(repos["mine"]))
        push_new_commit(repos["theirs"], "two")

        listed = client.get("/api/settings/pnl-updates").json()["checkouts"]
        mine = next(c for c in listed if c["id"] == cu._key(repos["mine"]))
        assert mine["kind"] == "psyneulink" and mine["upstream"] == "origin/devel"
        assert mine["check"] is False and mine["pull_on_launch"] is False
        assert mine["last_check"] is None

        r = client.post("/api/settings/checkout-updates/prefs", json={"path": str(repos["mine"]), "check": True})
        assert r.status_code == 200
        mine = next(c for c in r.json()["checkouts"] if c["id"] == cu._key(repos["mine"]))
        assert mine["check"] is True

        r = client.post("/api/settings/checkout-updates/check", json={"path": str(repos["mine"])})
        assert r.json()["result"]["status"] == "behind" and r.json()["result"]["behind_by"] == 1

        r = client.post("/api/settings/checkout-updates/pull", json={"path": str(repos["mine"])})
        assert r.json()["result"]["outcome"] == "pulled"

    def test_an_unknown_folder_is_refused(self, tmp_path, loopback):
        r = client.post("/api/settings/checkout-updates/check", json={"path": str(tmp_path / "nope")})
        assert r.status_code == 404
