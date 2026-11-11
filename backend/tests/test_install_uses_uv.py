"""Switching PsyNeuLink installs with uv when there is one, pip otherwise (#244).

The Mac app's own setup always used its bundled uv; the server's installs,
which every switch and refresh in Settings goes through, only knew pip, and
their steps said so. These pin which tool runs on each route, the fallback,
and that the log names the tool that actually ran.
"""

import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services import clone_manager, install_manager as im
from app.services.install_manager import InstallManager, _find_uv, _uv_args


class _Proc:
    def __init__(self, exit_code: int = 0):
        self.stdout = iter(["Resolved 1 package"])
        self._exit_code = exit_code

    def wait(self) -> int:
        return self._exit_code


class _Thread:
    def __init__(self, target, args, daemon=None):
        pass

    def start(self) -> None:
        pass


@pytest.fixture
def uv(tmp_path, monkeypatch):
    """A stand-in uv, named the way the Mac app names its own."""
    stub = tmp_path / "uv"
    stub.write_text("#!/bin/sh\n")
    stub.chmod(0o755)
    monkeypatch.setenv(im.UV_ENV, str(stub))
    return str(stub)


@pytest.fixture
def runs(monkeypatch):
    """Record every command; uv's exit code is set per test."""
    calls: list[list[str]] = []
    state = {"uv_exit": 0}

    def popen(cmd, **kwargs):
        calls.append(cmd)
        is_uv = Path(cmd[0]).name == "uv"
        return _Proc(state["uv_exit"] if is_uv else 0)

    monkeypatch.setattr(im.subprocess, "Popen", popen)
    monkeypatch.setattr(im.threading, "Thread", _Thread)
    monkeypatch.setattr(InstallManager, "_environment_ok_after_install", lambda self, job: True)
    return calls, state


def _tools(calls):
    return [Path(c[0]).name for c in calls]


# ── Finding uv ───────────────────────────────────────────────────────────


def test_off_means_pip(monkeypatch):
    monkeypatch.setenv(im.UV_ENV, "off")
    assert _find_uv() is None


def test_the_named_uv_is_used(uv):
    assert _find_uv() == uv


def test_a_named_uv_that_cannot_run_means_pip(tmp_path, monkeypatch):
    missing = tmp_path / "nowhere" / "uv"
    monkeypatch.setenv(im.UV_ENV, str(missing))
    assert _find_uv() is None


def test_unnamed_falls_back_to_a_uv_on_the_path(monkeypatch):
    monkeypatch.delenv(im.UV_ENV, raising=False)
    monkeypatch.setattr(im.shutil, "which", lambda name: "/opt/bin/uv" if name == "uv" else None)
    assert _find_uv() == "/opt/bin/uv"


# ── Translating pip's arguments ──────────────────────────────────────────


def test_a_reinstall_replaces_psyneulink_alone_and_asks_the_branch_again():
    args = _uv_args(["install", "--upgrade", "--force-reinstall", "--no-deps", "-e", "/src/PNL"])
    assert args[:5] == ["pip", "install", "--python", sys.executable, "--link-mode=clone"]
    assert "--force-reinstall" not in args
    assert "--no-deps" in args and "--upgrade" in args
    i = args.index("--reinstall-package")
    assert args[i + 1] == "psyneulink"
    assert args[args.index("--refresh-package") + 1] == "psyneulink"
    assert args[-2:] == ["-e", "/src/PNL"]


def test_a_release_install_keeps_its_find_links():
    args = _uv_args(["install", "--upgrade", "--find-links", "/kept", "psyneulink==0.19.1.0"])
    assert args[-4:] == ["--upgrade", "--find-links", "/kept", "psyneulink==0.19.1.0"]


def test_only_installs_translate():
    with pytest.raises(ValueError):
        _uv_args(["download", "psyneulink"])


# ── Each route ───────────────────────────────────────────────────────────


def test_pypi_installs_with_uv_and_says_so(uv, runs):
    calls, _ = runs
    manager = InstallManager()
    job = manager.start("pypi", None, None)
    assert job.command[0] == uv, "what the panel shows is what runs"
    manager._run(job)
    assert job.status == "succeeded", job.log
    assert _tools(calls) == ["uv"]
    assert calls[0][-1] == "psyneulink"
    log = "\n".join(job.log)
    assert "✓ install with uv in" in log
    assert "with pip" not in log


def test_uv_failing_hands_the_same_install_to_pip(uv, runs):
    calls, state = runs
    state["uv_exit"] = 2
    manager = InstallManager()
    job = manager.start("pypi", None, None)
    manager._run(job)
    assert job.status == "succeeded", job.log
    assert _tools(calls) == ["uv", "pip"]
    assert calls[1][1:] == ["install", "--upgrade", "--force-reinstall", "--no-deps", "psyneulink"]
    log = "\n".join(job.log)
    assert "uv exited with code 2 — retrying with pip" in log
    assert "✓ install with pip in" in log


def test_without_uv_pip_runs_as_before(runs):
    calls, _ = runs
    manager = InstallManager()
    job = manager.start("pypi", None, None)
    manager._run(job)
    assert job.status == "succeeded", job.log
    assert _tools(calls) == ["pip"]
    assert "with uv" not in "\n".join(job.log)


def test_a_kept_release_downloads_with_pip_and_installs_with_uv(uv, runs, tmp_path, monkeypatch):
    from app.services import pnl_releases

    calls, _ = runs
    monkeypatch.setattr(pnl_releases, "releases_dir", lambda: tmp_path / "releases")
    monkeypatch.setattr(pnl_releases, "kept_file_for", lambda version: None)
    manager = InstallManager()
    job = manager.start("pypi", None, None, version="0.19.1.0")
    manager._run(job)
    assert job.status == "succeeded", job.log
    # uv has no download command; the install is uv's.
    assert _tools(calls) == ["pip", "uv"]
    assert calls[0][1] == "download"
    log = "\n".join(job.log)
    assert "✓ download with pip in" in log and "✓ install with uv in" in log


def test_a_managed_clone_installs_editable_with_uv(uv, runs, monkeypatch):
    calls, _ = runs
    clone = Path("/tmp/managed-clone-fake")
    monkeypatch.setattr(clone_manager, "ensure_clone", lambda repo, token, on_line: clone)
    monkeypatch.setattr(clone_manager, "checkout", lambda path, ref, on_line: "a" * 40)
    monkeypatch.setattr(
        clone_manager, "editable_state",
        lambda path: clone_manager.EditableState(pointing_here=False, pyproject_unchanged=False),
    )
    monkeypatch.setattr(clone_manager, "mark_installed", lambda path: None)
    monkeypatch.setattr(im.github_auth, "get_auth", lambda: SimpleNamespace(token=None))
    manager = InstallManager()
    job = manager.start("github", "devel", None, repo="o/r")
    manager._run(job)
    assert job.status == "succeeded", job.log
    assert _tools(calls) == ["uv"]
    assert calls[0][-2:] == ["-e", str(clone)]
    assert "✓ install -e with uv in" in "\n".join(job.log)


def test_the_mac_apps_cache_reaches_uv(uv, runs, monkeypatch, tmp_path):
    """No environment of its own: uv inherits the server's, where the Mac app
    puts its UV_CACHE_DIR, so a switch reuses what setup downloaded."""
    seen: dict = {}

    def popen(cmd, **kwargs):
        seen["env"] = kwargs.get("env")
        return _Proc(0)

    monkeypatch.setattr(im.subprocess, "Popen", popen)
    monkeypatch.setenv("UV_CACHE_DIR", str(tmp_path / "uv-cache"))
    manager = InstallManager()
    job = manager.start("pypi", None, None)
    manager._run(job)
    assert seen["env"] is None, "None means the server's own environment"
    assert os.environ["UV_CACHE_DIR"] == str(tmp_path / "uv-cache")
