"""Tests for the install_manager service and /settings/install endpoints (#130)."""

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import routes as api_routes
from app.main import app
from app.services import clone_manager, github_auth, install_manager as im
from app.services.install_manager import (
    DEFAULT_GITHUB_REPO,
    InstallJob,
    InstallManager,
    _build_pip_args,
    _normalize_ref,
    _normalize_repo,
    _redact_token,
    _resolve_github_target,
    _venv_pip,
    local_checkout_problem,
)

client = TestClient(app)


@pytest.fixture
def loopback(monkeypatch):
    """Make the loopback guard pass — TestClient's client.host is "testclient", not 127.0.0.1."""
    monkeypatch.setattr(api_routes, "_is_loopback", lambda request: True)


@pytest.fixture(autouse=True)
def _reset_install_manager_singleton():
    """The InstallManager is a process-wide singleton; isolate tests from each other."""
    im._install_manager = None
    yield
    # Wait briefly for any spawned daemon threads to settle (Popen is mocked, so fast).
    time.sleep(0.05)
    im._install_manager = None


@pytest.fixture(autouse=True)
def _unauth_github(monkeypatch):
    """Default github_auth to unauthenticated. Otherwise _build_pip_args
    would inject the developer's real token into URLs inside tests."""
    monkeypatch.delenv("PSYNEUVIEW_GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    github_auth.clear()
    with monkeypatch.context() as mp:
        mp.setattr(github_auth.subprocess, "run", _raise_not_found)
        github_auth.get_auth()
    yield
    github_auth.clear()


def _raise_not_found(*args, **kwargs):
    raise FileNotFoundError("gh not available in tests")


def _prime_authenticated(monkeypatch, token: str) -> None:
    """Helper for tests that need github_auth in the authenticated state."""
    from unittest.mock import MagicMock

    monkeypatch.setenv("PSYNEUVIEW_GITHUB_TOKEN", token)
    github_auth.clear()
    probe = MagicMock()
    probe.read.return_value = b'{"login": "tester"}'
    probe.headers.get.return_value = "repo"
    probe.__enter__.return_value = probe
    probe.__exit__.return_value = False
    monkeypatch.setattr(github_auth.urllib.request, "urlopen", lambda *a, **kw: probe)
    github_auth.refresh()


# ── _build_pip_args ──────────────────────────────────────────────────────


def test_build_pip_args_pypi():
    args = _build_pip_args("pypi", None, None)
    assert args == ["install", "--upgrade", "--force-reinstall", "--no-deps", "psyneulink"]


def test_build_pip_args_github_now_delegates_to_clone_manager():
    """github source no longer goes through pip directly (#262)."""
    with pytest.raises(ValueError, match="handled via clone_manager"):
        _build_pip_args("github", "devel", None)


@pytest.mark.parametrize(
    "raw_ref",
    [
        "refactor/emcomposition/em_mech",            # already clean
        "refactor/emcomposition/em_mech/",           # trailing slash (the #248 repro)
        "/refactor/emcomposition/em_mech",           # leading slash
        "  refactor/emcomposition/em_mech  ",        # surrounding whitespace
        "  refactor/emcomposition/em_mech/  ",       # whitespace + trailing slash
    ],
)
def test_resolve_github_target_strips_ref(raw_ref):
    """All ref variants must resolve to the same cleaned value (#248)."""
    _, clean_ref = _resolve_github_target(raw_ref, None)
    assert clean_ref == "refactor/emcomposition/em_mech"


def test_resolve_github_target_requires_ref():
    with pytest.raises(ValueError, match="ref is required"):
        _resolve_github_target(None, None)


def test_resolve_github_target_empty_after_strip_is_clear_error():
    with pytest.raises(ValueError, match="empty after stripping"):
        _resolve_github_target("  //  ", None)


def test_resolve_github_target_blank_repo_falls_back_to_default():
    repo, _ = _resolve_github_target("devel", "   ")
    assert repo == DEFAULT_GITHUB_REPO


def test_resolve_github_target_custom_repo():
    repo, _ = _resolve_github_target("devel", "jonhanke-nam/PsyNeuLink")
    assert repo == "jonhanke-nam/PsyNeuLink"


def test_resolve_github_target_rejects_malformed_repo():
    with pytest.raises(ValueError, match="owner/repo"):
        _resolve_github_target("devel", "not-a-valid-thing")


def test_resolve_github_target_rejects_url_in_repo_field():
    with pytest.raises(ValueError, match="owner/repo"):
        _resolve_github_target("devel", "https://github.com/owner/repo.git")


def test_normalize_ref_strips_whitespace_and_slashes():
    assert _normalize_ref("  /devel/  ") == "devel"


def test_normalize_ref_rejects_none():
    with pytest.raises(ValueError, match="ref is required"):
        _normalize_ref(None)


def test_normalize_ref_rejects_empty_after_strip():
    with pytest.raises(ValueError, match="empty after stripping"):
        _normalize_ref("   ")


def test_normalize_repo_strips_whitespace():
    assert _normalize_repo("  jonhanke-nam/PsyNeuLink  ") == "jonhanke-nam/PsyNeuLink"


def test_normalize_repo_none_is_default():
    assert _normalize_repo(None) == DEFAULT_GITHUB_REPO


def _checkout(root):
    """The least that reads as a PsyNeuLink checkout (#1331)."""
    root.mkdir(parents=True, exist_ok=True)
    (root / "pyproject.toml").write_text('[project]\nname = "psyneulink"\n')
    (root / "psyneulink").mkdir()
    (root / "psyneulink" / "__init__.py").write_text("")
    return root


def test_build_pip_args_local_editable(tmp_path):
    checkout = _checkout(tmp_path / "PsyNeuLink")
    args = _build_pip_args("local", None, str(checkout))
    assert "-e" in args
    assert args[-1] == str(checkout)


def test_build_pip_args_local_accepts_a_setup_py_checkout(tmp_path):
    root = tmp_path / "PsyNeuLink"
    root.mkdir()
    (root / "setup.py").write_text("")
    (root / "psyneulink").mkdir()
    assert _build_pip_args("local", None, str(root))[-1] == str(root)


def test_build_pip_args_local_refuses_a_folder_that_is_not_a_checkout(tmp_path):
    """A typo, a parent folder or some other project: refused before pip is
    asked, with the reason (#1331)."""
    with pytest.raises(ValueError, match="no pyproject.toml or setup.py"):
        _build_pip_args("local", None, str(tmp_path))
    (tmp_path / "pyproject.toml").write_text("")
    with pytest.raises(ValueError, match="no psyneulink/ package"):
        _build_pip_args("local", None, str(tmp_path))
    assert local_checkout_problem(str(tmp_path / "PsyNeuLink")) is not None
    assert local_checkout_problem("") == "path is required for source=local"
    assert local_checkout_problem(str(_checkout(tmp_path / "PsyNeuLink"))) is None


def test_normalize_repo_refuses_the_placeholder():
    """``owner/repo`` has the right shape; it is still not a repo (#1292)."""
    for placeholder in ("owner/repo", "Owner/Repo", "your-org/your-repo", "owner/PsyNeuLink"):
        with pytest.raises(ValueError, match="placeholder"):
            _normalize_repo(placeholder)
    with pytest.raises(ValueError, match="placeholder"):
        _resolve_github_target("devel", "owner/repo")


def test_build_pip_args_local_requires_path():
    with pytest.raises(ValueError, match="path is required"):
        _build_pip_args("local", None, None)


def test_build_pip_args_local_path_must_exist():
    with pytest.raises(ValueError, match="not a directory"):
        _build_pip_args("local", None, "/does/not/exist/anywhere")


def test_build_pip_args_unknown_source():
    with pytest.raises(ValueError, match="unknown source"):
        _build_pip_args("garbage", None, None)  # type: ignore[arg-type]


# ── InstallManager state machine ─────────────────────────────────────────


class _FakeProc:
    """Minimal stand-in for subprocess.Popen for state-machine tests."""

    def __init__(self, lines: list[str], exit_code: int = 0):
        self.stdout = iter(lines)
        self._exit_code = exit_code

    def wait(self) -> int:
        return self._exit_code


def _run_synchronously(manager: InstallManager, job: InstallJob) -> None:
    """Run the worker body inline so the test doesn't have to wait on a thread."""
    manager._run(job)


def test_manager_success_runs_callback(monkeypatch):
    manager = InstallManager()

    callback_calls: list[bool] = []
    manager.register_on_success(lambda: callback_calls.append(True))

    fake_proc = _FakeProc(["Collecting psyneulink", "Successfully installed"], exit_code=0)
    monkeypatch.setattr(im.subprocess, "Popen", lambda *a, **kw: fake_proc)
    monkeypatch.setattr(im.threading, "Thread", lambda target, args, daemon: _NoopThread(target, args))

    job = manager.start("pypi", None, None)
    _run_synchronously(manager, job)

    assert job.status == "succeeded"
    assert job.exit_code == 0
    assert any("Collecting psyneulink" in line for line in job.log)
    assert callback_calls == [True]


def test_manager_failure_does_not_run_callback(monkeypatch):
    manager = InstallManager()

    callback_calls: list[bool] = []
    manager.register_on_success(lambda: callback_calls.append(True))

    fake_proc = _FakeProc(["ERROR: something broke"], exit_code=1)
    monkeypatch.setattr(im.subprocess, "Popen", lambda *a, **kw: fake_proc)
    monkeypatch.setattr(im.threading, "Thread", lambda target, args, daemon: _NoopThread(target, args))

    job = manager.start("pypi", None, None)
    _run_synchronously(manager, job)

    assert job.status == "failed"
    assert job.exit_code == 1
    assert callback_calls == []


def test_manager_rejects_concurrent_jobs(monkeypatch):
    manager = InstallManager()

    monkeypatch.setattr(im.threading, "Thread", lambda target, args, daemon: _NoopThread(target, args, run_now=False))

    job1 = manager.start("pypi", None, None)
    # Mark as running so the next start() sees the running guard.
    with manager._lock:
        job1.status = "running"

    with pytest.raises(RuntimeError, match="already running"):
        manager.start("pypi", None, None)


def test_manager_get_job_returns_none_for_unknown():
    manager = InstallManager()
    assert manager.get_job("nope") is None


def test_manager_callback_exception_does_not_break_job(monkeypatch):
    manager = InstallManager()

    def bad_callback():
        raise RuntimeError("boom")

    manager.register_on_success(bad_callback)
    fake_proc = _FakeProc(["ok"], exit_code=0)
    monkeypatch.setattr(im.subprocess, "Popen", lambda *a, **kw: fake_proc)
    monkeypatch.setattr(im.threading, "Thread", lambda target, args, daemon: _NoopThread(target, args))

    job = manager.start("pypi", None, None)
    _run_synchronously(manager, job)

    assert job.status == "succeeded"


class _NoopThread:
    """Thread shim that does nothing, or runs the target inline if requested."""

    def __init__(self, target, args, run_now: bool = False):
        self._target = target
        self._args = args
        if run_now:
            target(*args)

    def start(self) -> None:
        # Real Thread.start is a no-op for our purposes: the test calls _run directly.
        pass


# ── Capabilities endpoint ────────────────────────────────────────────────


def test_capabilities_local_no_mac_app(monkeypatch, loopback):
    monkeypatch.delenv("PSYNEUVIEW_MAC_APP", raising=False)
    resp = client.get("/api/settings/install/capabilities")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"enabled": True, "reason": None, "in_mac_app": False, "mode": "local"}


def test_capabilities_in_mac_app(monkeypatch, loopback):
    """The Mac app is allowed to install now (#132).

    `in_mac_app` is still reported — the UI may want to say where it is running
    — but it is no longer a reason to refuse.
    """
    monkeypatch.setenv("PSYNEUVIEW_MAC_APP", "1")
    resp = client.get("/api/settings/install/capabilities")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "enabled": True,
        "reason": None,
        "in_mac_app": True,
        "mode": "mac_app",
    }


def test_capabilities_non_loopback_when_no_mac_app(monkeypatch):
    """Without the loopback fixture, TestClient looks like a remote client."""
    monkeypatch.delenv("PSYNEUVIEW_MAC_APP", raising=False)
    resp = client.get("/api/settings/install/capabilities")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"enabled": False, "reason": "non_local", "in_mac_app": False, "mode": "local"}


def test_capabilities_container_mode_over_loopback(monkeypatch, loopback):
    """The #1062 bug, as a test.

    An Apptainer instance reached over an SSH tunnel presents a loopback
    client for a remote user, against a read-only squashfs venv. Under the old
    address heuristic that passed the guard and offered an install that could
    only fail partway through a pip run.
    """
    monkeypatch.delenv("PSYNEUVIEW_MAC_APP", raising=False)
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", "container")
    resp = client.get("/api/settings/install/capabilities")
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is False
    assert body["reason"] == "unavailable_in_deployment"
    assert body["mode"] == "container"


def test_capabilities_hosted_mode_over_loopback(monkeypatch, loopback):
    """Same for a same-host reverse proxy, which is loopback for everyone."""
    monkeypatch.delenv("PSYNEUVIEW_MAC_APP", raising=False)
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", "hosted")
    body = client.get("/api/settings/install/capabilities").json()
    assert body["enabled"] is False
    assert body["reason"] == "unavailable_in_deployment"


def test_capabilities_unknown_mode_falls_back_to_local(monkeypatch, loopback):
    """A typo in a deploy script must not silently grant more than intended —
    it lands on `local`, which still requires loopback."""
    monkeypatch.delenv("PSYNEUVIEW_MAC_APP", raising=False)
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", "conatiner")
    body = client.get("/api/settings/install/capabilities").json()
    assert body["mode"] == "local"


# ── POST /settings/install guards ────────────────────────────────────────


def test_install_post_allowed_in_mac_app(monkeypatch, loopback):
    """Accepted rather than refused with "use Cmd+, Preferences" (#132).

    The refusal existed because the Mac app kept its own record of the wanted
    source and reinstalled from it on the next update, undoing anything chosen
    here. It reads the installed state now, so this is safe to accept.
    """
    monkeypatch.setenv("PSYNEUVIEW_MAC_APP", "1")
    # Don't actually launch pip. Unstubbed, this ran a real
    # `pip install --force-reinstall psyneulink` into the test venv mid-suite,
    # swapping CI's pinned PsyNeuLink for PyPI's and rewriting its files under
    # whatever model the warm worker was running (#1208).
    monkeypatch.setattr(im.subprocess, "Popen", lambda *a, **kw: _FakeProc(["ok"], exit_code=0))
    resp = client.post("/api/settings/install", json={"source": "pypi"})
    assert resp.status_code == 200
    assert resp.json()["source"] == "pypi"


def test_install_get_allowed_in_mac_app(monkeypatch, loopback):
    """Job polling is no longer refused either — 404 for a job that does not
    exist, which is a different and correct answer."""
    monkeypatch.setenv("PSYNEUVIEW_MAC_APP", "1")
    resp = client.get("/api/settings/install/somejob")
    assert resp.status_code == 404


def test_install_post_blocked_when_non_loopback(monkeypatch):
    """No loopback fixture → non-Mac-app non-local request gets 403."""
    monkeypatch.delenv("PSYNEUVIEW_MAC_APP", raising=False)
    resp = client.post("/api/settings/install", json={"source": "pypi"})
    assert resp.status_code == 403
    assert resp.json()["detail"]["reason"] == "non_local"


def test_install_post_blocked_in_container_mode(monkeypatch, loopback):
    """Enforcement must match what /capabilities advertises — a UI that hides
    the control is not a guard."""
    monkeypatch.delenv("PSYNEUVIEW_MAC_APP", raising=False)
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", "container")
    resp = client.post("/api/settings/install", json={"source": "pypi"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "unavailable_in_deployment"


def test_install_get_blocked_in_container_mode(monkeypatch, loopback):
    monkeypatch.delenv("PSYNEUVIEW_MAC_APP", raising=False)
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", "container")
    assert client.get("/api/settings/install/somejob").status_code == 409


def test_install_post_validation_error_for_github_without_ref(monkeypatch, loopback):
    monkeypatch.delenv("PSYNEUVIEW_MAC_APP", raising=False)
    resp = client.post("/api/settings/install", json={"source": "github"})
    # Pydantic accepts the payload (ref is Optional), so the ValueError
    # comes from _resolve_github_target inside manager.start() and
    # surfaces as 400.
    assert resp.status_code == 400


def test_install_post_returns_job_response(monkeypatch, loopback):
    monkeypatch.delenv("PSYNEUVIEW_MAC_APP", raising=False)

    # Don't actually launch pip — replace Popen with a fake that finishes immediately.
    fake_proc = _FakeProc(["ok"], exit_code=0)
    monkeypatch.setattr(im.subprocess, "Popen", lambda *a, **kw: fake_proc)

    resp = client.post("/api/settings/install", json={"source": "pypi"})
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) >= {
        "id",
        "source",
        "ref",
        "path",
        "repo",
        "status",
        "log",
        "exit_code",
        "started_at",
        "finished_at",
    }
    assert body["source"] == "pypi"


def test_install_post_with_custom_repo(monkeypatch, loopback):
    """github source kicks off a managed-clone job; the daemon thread
    can run anywhere — stub the clone_manager surface so the test
    doesn't try real git I/O."""
    monkeypatch.delenv("PSYNEUVIEW_MAC_APP", raising=False)
    _stub_clone_manager_for_route_tests(monkeypatch)
    fake_proc = _FakeProc(["ok"], exit_code=0)
    monkeypatch.setattr(im.subprocess, "Popen", lambda *a, **kw: fake_proc)

    resp = client.post(
        "/api/settings/install",
        json={"source": "github", "ref": "devel", "repo": "jonhanke-nam/PsyNeuLink"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["repo"] == "jonhanke-nam/PsyNeuLink"


def _stub_clone_manager_for_route_tests(monkeypatch):
    """Replace clone_manager's network-touching functions with no-ops.

    Used by route-level tests that go through TestClient — the daemon
    thread spawned by manager.start() runs for real, so we can't let it
    fire actual git/pip subprocesses.
    """
    monkeypatch.setattr(im.clone_manager, "ensure_clone", lambda repo, token, on_line: Path("/tmp/fake-clone"))
    monkeypatch.setattr(im.clone_manager, "checkout", lambda path, ref, on_line: "deadbeef" * 5)
    monkeypatch.setattr(
        im.clone_manager,
        "editable_state",
        lambda path: im.clone_manager.EditableState(pointing_here=True, pyproject_unchanged=True),
    )
    monkeypatch.setattr(im.clone_manager, "mark_installed", lambda path: None)


def test_install_post_rejects_malformed_repo(monkeypatch, loopback):
    monkeypatch.delenv("PSYNEUVIEW_MAC_APP", raising=False)
    resp = client.post(
        "/api/settings/install",
        json={"source": "github", "ref": "devel", "repo": "not-a-valid-thing"},
    )
    assert resp.status_code == 400


def test_install_get_unknown_job_returns_404(monkeypatch, loopback):
    monkeypatch.delenv("PSYNEUVIEW_MAC_APP", raising=False)
    resp = client.get("/api/settings/install/does-not-exist")
    assert resp.status_code == 404


# ── _venv_pip points to a sibling of sys.executable ─────────────────────


def test_venv_pip_path_is_sibling_of_python():
    import sys
    from pathlib import Path

    expected = str(Path(sys.executable).parent / "pip")
    assert _venv_pip() == expected


# ── github_auth token injection + redaction (#257 Phase 1) ──────────────


def test_pypi_install_unaffected_by_authentication(monkeypatch):
    """The token only matters for github source — pypi pip args stay plain."""
    _prime_authenticated(monkeypatch, "ghp_secret123")
    args = _build_pip_args("pypi", None, None)
    assert args == ["install", "--upgrade", "--force-reinstall", "--no-deps", "psyneulink"]


def test_redact_token_masks_credential_segment():
    """Defensive: even though the new clone_manager path uses
    -c http.extraheader instead of x-access-token:TOKEN@host, the
    install_manager log still scrubs URL-form tokens in case anything
    else surfaces one."""
    line = (
        "Collecting psyneulink from "
        "git+https://x-access-token:ghp_secret123@github.com/owner/repo.git@devel"
    )
    redacted = _redact_token(line)
    assert "ghp_secret123" not in redacted
    assert "x-access-token:***@github.com" in redacted


def test_redact_token_no_op_when_no_token_in_text():
    line = "Successfully installed psyneulink-0.18.0"
    assert _redact_token(line) == line


# ── managed-clone github flow (#262) ────────────────────────────────────


def _stub_clone_manager(
    monkeypatch,
    *,
    pointing_here: bool = False,
    pyproject_unchanged: bool = False,
    ensure_clone_lines: tuple[str, ...] = (),
    checkout_lines: tuple[str, ...] = (),
    sha: str = "deadbeef" * 5,
    clone_path: Path = Path("/tmp/managed-clone-fake"),
):
    """Replace the clone_manager surface used by ``_run_github`` with
    fakes. Returns a dict recording which calls were made so tests
    can assert on them."""
    calls: dict[str, list] = {
        "ensure_clone": [],
        "checkout": [],
        "editable_state": [],
        "mark_installed": [],
    }

    def fake_ensure_clone(repo, token, on_line):
        calls["ensure_clone"].append((repo, token))
        for line in ensure_clone_lines:
            on_line(line)
        return clone_path

    def fake_checkout(path, ref, on_line):
        calls["checkout"].append((path, ref))
        for line in checkout_lines:
            on_line(line)
        return sha

    def fake_editable_state(path):
        calls["editable_state"].append(path)
        return clone_manager.EditableState(
            pointing_here=pointing_here,
            pyproject_unchanged=pyproject_unchanged,
        )

    def fake_mark_installed(path):
        calls["mark_installed"].append(path)

    monkeypatch.setattr(im.clone_manager, "ensure_clone", fake_ensure_clone)
    monkeypatch.setattr(im.clone_manager, "checkout", fake_checkout)
    monkeypatch.setattr(im.clone_manager, "editable_state", fake_editable_state)
    monkeypatch.setattr(im.clone_manager, "mark_installed", fake_mark_installed)
    return calls


def test_github_flow_runs_pip_when_state_changed(monkeypatch):
    """First-time install (nothing pointing here) → pip install -e runs."""
    manager = InstallManager()
    callback_calls: list[bool] = []
    manager.register_on_success(lambda: callback_calls.append(True))

    calls = _stub_clone_manager(
        monkeypatch,
        pointing_here=False,
        pyproject_unchanged=False,
        ensure_clone_lines=("Cloning https://github.com/o/r.git → /tmp/c",),
        checkout_lines=("Resetting to origin/devel",),
    )
    fake_proc = _FakeProc(
        ["Successfully installed psyneulink-0.18.0.dev0"], exit_code=0
    )
    monkeypatch.setattr(im.subprocess, "Popen", lambda *a, **kw: fake_proc)
    monkeypatch.setattr(
        im.threading, "Thread", lambda target, args, daemon: _NoopThread(target, args)
    )

    job = manager.start("github", "devel", None, repo="o/r")
    _run_synchronously(manager, job)

    assert job.status == "succeeded"
    assert calls["ensure_clone"] == [("o/r", None)]
    assert calls["checkout"] == [(Path("/tmp/managed-clone-fake"), "devel")]
    assert len(calls["mark_installed"]) == 1  # only when pip ran successfully
    assert callback_calls == [True]
    # The log shows the planned actions and at least one streamed line.
    full_log = "\n".join(job.log)
    assert "Cloning" in full_log
    assert "pip install -e" in full_log


def test_github_flow_skips_pip_when_already_editable_and_unchanged(monkeypatch):
    """Fast path: pip's already pointing here and pyproject hasn't changed."""
    manager = InstallManager()
    callback_calls: list[bool] = []
    manager.register_on_success(lambda: callback_calls.append(True))

    calls = _stub_clone_manager(
        monkeypatch,
        pointing_here=True,
        pyproject_unchanged=True,
    )

    # If pip is wrongly invoked, this Popen would explode the test —
    # use a sentinel that fails loudly.
    def boom(*a, **kw):
        pytest.fail("pip subprocess should not run on skip-pip path")

    monkeypatch.setattr(im.subprocess, "Popen", boom)
    monkeypatch.setattr(
        im.threading, "Thread", lambda target, args, daemon: _NoopThread(target, args)
    )

    job = manager.start("github", "devel", None, repo="o/r")
    _run_synchronously(manager, job)

    assert job.status == "succeeded"
    assert job.exit_code == 0
    assert calls["mark_installed"] == []  # didn't re-run pip → no remark
    assert any("skipping pip install -e" in line for line in job.log)
    assert callback_calls == [True]


def test_github_flow_marks_failed_when_clone_manager_raises(monkeypatch):
    """CloneError (e.g. mismatched origin) → job failed with message in log."""
    manager = InstallManager()
    callback_calls: list[bool] = []
    manager.register_on_success(lambda: callback_calls.append(True))

    def raise_clone_error(repo, token, on_line):
        raise clone_manager.CloneError("origin mismatch at /x")

    monkeypatch.setattr(im.clone_manager, "ensure_clone", raise_clone_error)
    monkeypatch.setattr(
        im.threading, "Thread", lambda target, args, daemon: _NoopThread(target, args)
    )

    job = manager.start("github", "devel", None, repo="o/r")
    _run_synchronously(manager, job)

    assert job.status == "failed"
    assert job.exit_code == -1
    assert any("origin mismatch" in line for line in job.log)
    assert callback_calls == []  # callback only fires on success


def test_github_flow_forwards_token_to_clone_manager(monkeypatch):
    """An authenticated github_auth must hand the token to ensure_clone."""
    _prime_authenticated(monkeypatch, "ghp_secret123")
    manager = InstallManager()
    calls = _stub_clone_manager(
        monkeypatch,
        pointing_here=True,
        pyproject_unchanged=True,
    )
    monkeypatch.setattr(
        im.threading, "Thread", lambda target, args, daemon: _NoopThread(target, args)
    )

    job = manager.start("github", "devel", None, repo="o/r")
    _run_synchronously(manager, job)

    assert calls["ensure_clone"] == [("o/r", "ghp_secret123")]
    # The token must not leak into the log (clone_manager redacts it
    # before any line reaches install_manager, and install_manager
    # re-redacts as a belt-and-braces measure).
    full_log = "\n".join(job.log)
    assert "ghp_secret123" not in full_log


def test_github_flow_displays_summary_command(monkeypatch):
    """job.command for github is a one-line summary, not a pip CLI string."""
    _stub_clone_manager(monkeypatch, pointing_here=True, pyproject_unchanged=True)
    monkeypatch.setattr(
        im.threading, "Thread", lambda target, args, daemon: _NoopThread(target, args)
    )
    manager = InstallManager()

    job = manager.start("github", "devel", None, repo="jonhanke-nam/PsyNeuLink")
    assert job.command == ["# managed clone: jonhanke-nam/PsyNeuLink@devel"]


# ── timing instrumentation (#264) ────────────────────────────────────────


def test_github_flow_emits_per_step_timings_and_total(monkeypatch):
    """Skip-pip path still reports clone/checkout/probe timings + Total."""
    _stub_clone_manager(monkeypatch, pointing_here=True, pyproject_unchanged=True)
    monkeypatch.setattr(
        im.threading, "Thread", lambda target, args, daemon: _NoopThread(target, args)
    )
    manager = InstallManager()

    job = manager.start("github", "devel", None, repo="o/r")
    _run_synchronously(manager, job)

    log = "\n".join(job.log)
    assert "✓ clone/fetch in" in log
    assert "✓ checkout devel in" in log
    assert "✓ editable-state probe in" in log
    # Final summary line so the user sees total wall time without summing steps.
    assert any(line.startswith("Total: ") and line.endswith("s") for line in job.log)


def test_pip_flow_emits_total_timing(monkeypatch):
    """pypi/local path also reports the install step and a Total line."""
    manager = InstallManager()
    fake_proc = _FakeProc(["Successfully installed psyneulink-0.18.0"], exit_code=0)
    monkeypatch.setattr(im.subprocess, "Popen", lambda *a, **kw: fake_proc)
    monkeypatch.setattr(
        im.threading, "Thread", lambda target, args, daemon: _NoopThread(target, args)
    )

    job = manager.start("pypi", None, None)
    _run_synchronously(manager, job)

    log = "\n".join(job.log)
    assert "✓ pip install in" in log
    assert any(line.startswith("Total: ") for line in job.log)
