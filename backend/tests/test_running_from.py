"""What PsyNeuView is running, and from where (#1356).

Settings ▸ About says whether this is the Mac app's included copy or a
checkout, and for a checkout its branch, commit, files changed, and how far
behind its remote branch and devel it is as last fetched; and, given the
page's build commit, whether the page is older than the server. Against
throwaway git repositories (a bare "remote" and clones of it), with git
itself mocked away for the no-git cases.
"""

import json
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import running_from as rf

client = TestClient(app)

ENV = {
    "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@x", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@x",
    "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
}


def git(*args, cwd: Path) -> str:
    return subprocess.check_output(
        ["git", *args], cwd=str(cwd), text=True, stderr=subprocess.STDOUT, env={**ENV, "HOME": str(cwd)},
    ).strip()


def commit_file(repo: Path, name: str) -> str:
    (repo / f"{name}.txt").write_text(f"{name}\n")
    git("add", f"{name}.txt", cwd=repo)
    git("commit", "-q", "-m", name, cwd=repo)
    return git("rev-parse", "--short", "HEAD", cwd=repo)


@pytest.fixture
def repos(tmp_path, monkeypatch):
    """``remote`` (bare, trunk devel), ``mine`` (the PsyNeuView checkout under
    test, on devel tracking origin/devel) and ``theirs`` (pushes new commits)."""
    remote = tmp_path / "remote.git"
    git("init", "-q", "--bare", "-b", "devel", str(remote), cwd=tmp_path)
    theirs = tmp_path / "theirs"
    git("clone", "-q", str(remote), str(theirs), cwd=tmp_path)
    git("checkout", "-q", "-b", "devel", cwd=theirs)
    commit_file(theirs, "one")
    git("push", "-q", "-u", "origin", "devel", cwd=theirs)
    mine = tmp_path / "mine"
    git("clone", "-q", "-b", "devel", str(remote), str(mine), cwd=tmp_path)
    monkeypatch.setattr(rf, "repo_root", lambda: mine)
    monkeypatch.setattr(rf, "_deployment", lambda: "local")
    monkeypatch.setattr(rf, "_version", lambda: "0.5.15")
    monkeypatch.setattr(rf, "_started_commit", None)
    monkeypatch.setattr(rf, "_start_noted", False)
    monkeypatch.delenv("PSYNEUVIEW_APP_FLAVOR", raising=False)
    return {"remote": remote, "theirs": theirs, "mine": mine}


def push_and_fetch(repos, *names: str) -> None:
    for name in names:
        commit_file(repos["theirs"], name)
    git("push", "-q", "origin", "devel", cwd=repos["theirs"])
    git("fetch", "-q", "origin", cwd=repos["mine"])


class TestACheckout:
    def test_up_to_date_on_devel(self, repos):
        out = rf.describe()
        assert out["kind"] == "checkout" and out["version"] == "0.5.15"
        g = out["git"]
        assert g["branch"] == "devel" and g["on_main_branch"] is True
        assert g["upstream"] == "origin/devel" and g["main_branch"] == "origin/devel"
        assert (g["ahead_by"], g["behind_by"], g["behind_main"], g["dirty_files"]) == (0, 0, 0, 0)
        assert g["commit"] == git("rev-parse", "--short", "HEAD", cwd=repos["mine"])
        assert out["git_error"] is None

    def test_behind_as_last_fetched_only(self, repos):
        commit_file(repos["theirs"], "two")
        git("push", "-q", "origin", "devel", cwd=repos["theirs"])
        # Not fetched yet: what's known locally says up to date.
        assert rf.describe()["git"]["behind_by"] == 0
        git("fetch", "-q", "origin", cwd=repos["mine"])
        g = rf.describe()["git"]
        assert g["behind_by"] == 1 and g["behind_main"] == 1
        assert g["last_fetched"] is not None

    def test_ahead_and_dirty(self, repos):
        commit_file(repos["mine"], "local")
        (repos["mine"] / "one.txt").write_text("changed\n")
        g = rf.describe()["git"]
        assert g["ahead_by"] == 1 and g["behind_by"] == 0 and g["dirty_files"] == 1

    def test_untracked_files_are_not_changes(self, repos):
        (repos["mine"] / "scratch.txt").write_text("x\n")
        assert rf.describe()["git"]["dirty_files"] == 0

    def test_another_branch_is_compared_with_devel_too(self, repos):
        git("checkout", "-q", "-b", "feature/x", cwd=repos["mine"])
        push_and_fetch(repos, "two", "three")
        g = rf.describe()["git"]
        assert g["branch"] == "feature/x" and g["on_main_branch"] is False
        assert g["upstream"] is None and g["behind_by"] is None
        assert g["behind_main"] == 2

    def test_detached_head(self, repos):
        git("checkout", "-q", "--detach", cwd=repos["mine"])
        out = rf.describe()
        assert out["git"]["branch"] is None and out["git"]["upstream"] is None
        assert "(no branch," in out["summary"]

    def test_summary_line(self, repos, monkeypatch):
        monkeypatch.setattr(rf.Path, "home", classmethod(lambda cls: repos["mine"].parent))
        (repos["mine"] / "one.txt").write_text("changed\n")
        out = rf.describe()
        commit = out["git"]["commit"]
        assert out["summary"] == f"PsyNeuView 0.5.15 running from your checkout at ~/mine (devel, {commit}, 1 file changed)"


class TestThePageAndTheServer:
    def test_same_commit(self, repos):
        head = git("rev-parse", "HEAD", cwd=repos["mine"])
        assert rf.describe(head[:10])["page"] == {"commit": head[:10], "relation": "same"}

    def test_page_older_than_the_server(self, repos):
        old = git("rev-parse", "--short", "HEAD", cwd=repos["mine"])
        push_and_fetch(repos, "two")
        git("merge", "-q", "--ff-only", "origin/devel", cwd=repos["mine"])
        assert rf.describe(old)["page"]["relation"] == "page_older"

    def test_page_newer_than_the_server(self, repos):
        rf.note_start()
        newer = commit_file(repos["mine"], "after-start")
        out = rf.describe(newer)
        assert out["page"]["relation"] == "page_newer"
        # And the checkout has moved on since the server started.
        assert out["started_commit"] != out["git"]["commit"]

    def test_unknown_commit_is_different(self, repos):
        assert rf.describe("deadbeef")["page"]["relation"] == "different"

    def test_the_built_page_files_against_the_server(self, repos):
        old = git("rev-parse", "--short", "HEAD", cwd=repos["mine"])
        dist = repos["mine"] / "frontend" / "dist"
        dist.mkdir(parents=True)
        (dist / "build-info.json").write_text(json.dumps({"version": "0.5.15", "commit": old}))
        assert rf.describe()["dist_relation"] == "same"
        push_and_fetch(repos, "two")
        git("merge", "-q", "--ff-only", "origin/devel", cwd=repos["mine"])
        out = rf.describe()
        assert out["dist"]["commit"] == old and out["dist_relation"] == "page_older"

    def test_endpoint_refuses_a_commit_that_isnt_one(self, repos):
        assert client.get("/api/settings/running", params={"page_commit": "--output=x"}).status_code == 400

    def test_endpoint_answers(self, repos):
        resp = client.get("/api/settings/running")
        assert resp.status_code == 200
        body = resp.json()
        assert body["kind"] == "checkout" and body["git"]["branch"] == "devel"


class TestCheckNow:
    def test_fetch_then_behind(self, repos):
        commit_file(repos["theirs"], "two")
        git("push", "-q", "origin", "devel", cwd=repos["theirs"])
        resp = client.post("/api/settings/running/check")
        body = resp.json()
        assert body["fetched"] is True and body["fetch_error"] is None
        assert body["git"]["behind_by"] == 1
        # Nothing was pulled.
        assert (repos["mine"] / "two.txt").exists() is False

    def test_unreachable_remote_is_said(self, repos):
        git("remote", "set-url", "origin", str(repos["mine"].parent / "gone.git"), cwd=repos["mine"])
        out = rf.fetch()
        assert out["fetched"] is False and "couldn't fetch origin" in out["fetch_error"]

    def test_a_slow_fetch_times_out(self, repos, monkeypatch):
        real = rf._git

        def slow(args, cwd, timeout=rf.GIT_TIMEOUT_S):
            if args[0] == "fetch":
                return 124, ""
            return real(args, cwd, timeout)

        monkeypatch.setattr(rf, "_git", slow)
        out = rf.fetch()
        assert out["fetched"] is False and "took longer than" in out["fetch_error"]


class TestNotACheckout:
    def test_the_mac_apps_included_copy(self, tmp_path, monkeypatch):
        root = tmp_path / "Library" / "Application Support" / "PsyNeuView" / "psyneuview-0.5.15"
        root.mkdir(parents=True)
        monkeypatch.setattr(rf, "_deployment", lambda: "mac_app")
        monkeypatch.setattr(rf, "_version", lambda: "0.5.15")
        monkeypatch.setenv("PSYNEUVIEW_APP_FLAVOR", "release")
        out = rf.describe("abc1234", root=root)
        assert out["kind"] == "included" and out["git"] is None and out["app_flavor"] == "release"
        assert out["page"]["relation"] == "unknown"
        assert out["summary"].startswith("PsyNeuView 0.5.15 running from the version included with the Mac app")

    def test_included_copy_compares_the_page_with_the_built_files(self, tmp_path, monkeypatch):
        root = tmp_path / "psyneuview-0.5.15"
        (root / "frontend" / "dist").mkdir(parents=True)
        (root / "frontend" / "dist" / "build-info.json").write_text(json.dumps({"commit": "abc1234"}))
        monkeypatch.setattr(rf, "_deployment", lambda: "mac_app")
        monkeypatch.setattr(rf, "_version", lambda: "0.5.15")
        assert rf.describe("abc1234", root=root)["page"]["relation"] == "same"
        assert rf.describe("1234abc", root=root)["page"]["relation"] == "different"

    def test_a_plain_copy_in_a_browser(self, tmp_path, monkeypatch):
        monkeypatch.setattr(rf, "_deployment", lambda: "local")
        monkeypatch.setattr(rf, "_version", lambda: "0.5.15")
        out = rf.describe(root=tmp_path)
        assert out["kind"] == "copy"
        assert out["summary"].endswith("(not a git checkout)")

    def test_no_git_installed(self, repos, monkeypatch):
        def no_git(*a, **k):
            raise FileNotFoundError("git")

        monkeypatch.setattr(rf.subprocess, "run", no_git)
        out = rf.describe("abc1234")
        assert out["kind"] == "checkout" and out["git"] is None
        assert out["git_error"].startswith("git couldn't run here")
        assert out["page"]["relation"] == "unknown"
        assert "git couldn't run here" in out["summary"]
        assert rf.fetch()["fetched"] is False
        assert rf.note_start() is None

    def test_git_hangs(self, repos, monkeypatch):
        def hang(*a, **k):
            raise subprocess.TimeoutExpired("git", 3)

        monkeypatch.setattr(rf.subprocess, "run", hang)
        out = rf.describe()
        assert out["git"]["commit"] is None and out["git_error"] == "git couldn't read this checkout"


def test_the_start_up_line_is_printed_and_is_not_a_phase_line(repos, capsys):
    from app import main

    main._announce_what_is_running()
    lines = capsys.readouterr().out.splitlines()
    assert len(lines) == 1
    assert lines[0].startswith("PsyNeuView 0.5.15 running from your checkout at ")
    assert not lines[0].startswith("PNV-START")
    assert rf._started_commit == git("rev-parse", "--short", "HEAD", cwd=repos["mine"])
