"""Tests for the /settings/info endpoint and supporting helpers (#120)."""

from importlib.metadata import PackageNotFoundError
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import github_auth, settings_info as si

client = TestClient(app)


@pytest.fixture(autouse=True)
def _unauth_github(monkeypatch):
    """Default github_auth to unauthenticated so get_settings_info() doesn't
    shell out or attempt /user probes during these tests."""
    monkeypatch.delenv("PSYNEUVIEW_GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    github_auth.clear()
    with monkeypatch.context() as mp:
        mp.setattr(github_auth.subprocess, "run", lambda *a, **kw: (_ for _ in ()).throw(FileNotFoundError()))
        github_auth.get_auth()
    yield
    github_auth.clear()


def _fake_dist(version: str, direct_url_text: str | None) -> MagicMock:
    dist = MagicMock()
    dist.version = version
    dist.read_text = MagicMock(return_value=direct_url_text)
    return dist


# ── settings_info helpers ────────────────────────────────────────────────


def test_psyneulink_pypi_install():
    """No direct_url.json → wheel from PyPI."""
    with patch.object(si, "distribution", return_value=_fake_dist("0.16.0.0", None)):
        out = si.get_psyneulink_info()
    assert out == {
        "version": "0.16.0.0",
        "source": "pypi",
        "branch": None,
        "repo": None,
        "commit": None,
        "path": None,
    }


def test_psyneulink_github_install():
    """direct_url.json with GitHub VCS info → source=github, branch carries the requested ref, repo is parsed."""
    direct_url = (
        '{"url": "https://github.com/PrincetonUniversity/PsyNeuLink.git",'
        ' "vcs_info": {"vcs": "git", "requested_revision": "devel",'
        ' "commit_id": "abc1234567890"}}'
    )
    with patch.object(si, "distribution", return_value=_fake_dist("0.16.0.0+devel", direct_url)):
        out = si.get_psyneulink_info()
    assert out == {
        "version": "0.16.0.0+devel",
        "source": "github",
        "branch": "devel",
        "repo": "PrincetonUniversity/PsyNeuLink",
        "commit": "abc1234",
        "path": None,
    }


def test_psyneulink_github_install_fork_repo():
    """Fork URL → repo field reports the fork's owner/repo."""
    direct_url = (
        '{"url": "https://github.com/jonhanke-nam/PsyNeuLink.git",'
        ' "vcs_info": {"vcs": "git", "requested_revision": "feature/foo"}}'
    )
    with patch.object(si, "distribution", return_value=_fake_dist("0.16.0.0+foo", direct_url)):
        out = si.get_psyneulink_info()
    assert out["repo"] == "jonhanke-nam/PsyNeuLink"
    assert out["source"] == "github"


def test_psyneulink_local_editable_install(tmp_path):
    """Editable install at a non-git directory → source=editable; path is surfaced."""
    direct_url = f'{{"url": "file://{tmp_path}", "dir_info": {{"editable": true}}}}'
    with patch.object(si, "distribution", return_value=_fake_dist("0.16.0.0", direct_url)):
        out = si.get_psyneulink_info()
    assert out["source"] == "editable"
    assert out["branch"] is None
    assert out["repo"] is None
    assert out["version"] == "0.16.0.0"
    assert out["path"] == str(tmp_path)
    assert out["commit"] is None


def test_psyneulink_editable_install_with_github_origin_reports_as_github(monkeypatch, tmp_path):
    """Managed-clone (#262) case: editable install at a clone with a github
    remote → reported as ``source=github`` so the gear panel can show
    repo/branch/commit just like a ``pip install git+...`` install would."""
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(tmp_path.parent))
    direct_url = f'{{"url": "file://{tmp_path}", "dir_info": {{"editable": true}}}}'
    monkeypatch.setattr(
        si,
        "_probe_local_clone",
        lambda p: {
            "repo": "jonhanke-nam/PsyNeuLink",
            "branch": "jonhanke-dev",
            "commit": "cce6f67",
        },
    )
    with patch.object(si, "distribution", return_value=_fake_dist("0.18.0.0+local", direct_url)):
        out = si.get_psyneulink_info()
    assert out == {
        "version": "0.18.0.0+local",
        "source": "github",
        "branch": "jonhanke-dev",
        "repo": "jonhanke-nam/PsyNeuLink",
        "commit": "cce6f67",
        "path": str(tmp_path),
    }


def test_a_local_checkout_cloned_from_github_reads_as_a_local_checkout(monkeypatch, tmp_path):
    """#1276: a folder the user cloned themselves (the wizard's "Clone a new
    checkout") is installed editable from outside the managed clones. It reads
    as a local checkout with its path, keeping the origin repo, branch and
    commit as secondary detail, not as "GitHub @ devel"."""
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(tmp_path / "managed"))
    checkout = tmp_path / "PsyNeuLink-clone-test-1"
    checkout.mkdir()
    direct_url = f'{{"url": "file://{checkout}", "dir_info": {{"editable": true}}}}'
    monkeypatch.setattr(
        si,
        "_probe_local_clone",
        lambda p: {"repo": "PrincetonUniversity/PsyNeuLink", "branch": "devel", "commit": "72dde34"},
    )
    with patch.object(si, "distribution", return_value=_fake_dist("0.19.1.0", direct_url)):
        out = si.get_psyneulink_info()
    assert out == {
        "version": "0.19.1.0",
        "source": "editable",
        "branch": "devel",
        "repo": "PrincetonUniversity/PsyNeuLink",
        "commit": "72dde34",
        "path": str(checkout),
    }


def test_a_local_checkout_wins_over_a_stale_mac_app_source_variable(monkeypatch, tmp_path):
    """#1276: the Mac app's launch-time PSYNEUVIEW_PNL_SOURCE describes what it
    installed then; a local checkout chosen later from Settings is what runs."""
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(tmp_path / "managed"))
    monkeypatch.setenv("PSYNEUVIEW_PNL_SOURCE", "github")
    monkeypatch.setenv("PSYNEUVIEW_PNL_BRANCH", "devel")
    monkeypatch.setattr(si, "_probe_local_clone", lambda p: {})
    direct_url = f'{{"url": "file://{tmp_path}", "dir_info": {{"editable": true}}}}'
    with patch.object(si, "distribution", return_value=_fake_dist("0.19.1.0", direct_url)):
        out = si.get_psyneulink_info()
    assert out["source"] == "editable"
    assert out["path"] == str(tmp_path)


def test_psyneulink_non_github_git_install():
    """Git install from a non-GitHub host → source=unknown (we only flag GitHub)."""
    direct_url = (
        '{"url": "https://gitlab.com/user/PsyNeuLink.git",'
        ' "vcs_info": {"vcs": "git", "requested_revision": "main"}}'
    )
    with patch.object(si, "distribution", return_value=_fake_dist("0.16.0.0", direct_url)):
        out = si.get_psyneulink_info()
    assert out["source"] == "unknown"


def test_psyneulink_missing_distribution():
    """psyneulink not installed → graceful fallback."""
    with patch.object(si, "distribution", side_effect=PackageNotFoundError):
        out = si.get_psyneulink_info()
    assert out == {
        "version": None,
        "source": "unknown",
        "branch": None,
        "repo": None,
        "commit": None,
        "path": None,
    }


def test_psyneulink_malformed_direct_url():
    """Garbage direct_url.json doesn't crash the endpoint."""
    with patch.object(si, "distribution", return_value=_fake_dist("0.16.0.0", "{not-json")):
        out = si.get_psyneulink_info()
    assert out == {
        "version": "0.16.0.0",
        "source": "unknown",
        "branch": None,
        "repo": None,
        "commit": None,
        "path": None,
    }


_GITHUB_DEVEL_DIRECT_URL = (
    '{"url": "https://github.com/PrincetonUniversity/PsyNeuLink.git",'
    ' "vcs_info": {"vcs": "git", "requested_revision": "devel", "commit_id": "abcdef1234"}}'
)


def test_psyneulink_disk_beats_stale_env_github_over_pypi(monkeypatch):
    """MacApp#9: the Mac app's env still says GitHub devel, but an official
    release was installed since (no direct_url.json) → the release is shown."""
    monkeypatch.setenv("PSYNEUVIEW_PNL_SOURCE", "github")
    monkeypatch.setenv("PSYNEUVIEW_PNL_BRANCH", "devel")
    monkeypatch.delenv("PSYNEUVIEW_PNL_REPO", raising=False)
    with patch.object(si, "distribution", return_value=_fake_dist("0.16.0.0", None)):
        out = si.get_psyneulink_info()
    assert out == {
        "version": "0.16.0.0",
        "source": "pypi",
        "branch": None,
        "repo": None,
        "commit": None,
        "path": None,
    }


def test_psyneulink_disk_beats_stale_env_pypi_over_github(monkeypatch):
    """Env says pypi, disk says a GitHub install → the GitHub install is shown."""
    monkeypatch.setenv("PSYNEUVIEW_PNL_SOURCE", "pypi")
    with patch.object(si, "distribution", return_value=_fake_dist("0.16.0.0", _GITHUB_DEVEL_DIRECT_URL)):
        out = si.get_psyneulink_info()
    assert out["source"] == "github"
    assert out["branch"] == "devel"
    assert out["repo"] == "PrincetonUniversity/PsyNeuLink"


def test_psyneulink_disk_beats_stale_env_fork_branch(monkeypatch):
    """Env names a fork branch from an earlier setup; disk has Princeton devel."""
    monkeypatch.setenv("PSYNEUVIEW_PNL_SOURCE", "github")
    monkeypatch.setenv("PSYNEUVIEW_PNL_BRANCH", "feature/foo")
    monkeypatch.setenv("PSYNEUVIEW_PNL_REPO", "jonhanke-nam/PsyNeuLink")
    with patch.object(si, "distribution", return_value=_fake_dist("0.16.0.0", _GITHUB_DEVEL_DIRECT_URL)):
        out = si.get_psyneulink_info()
    assert (out["source"], out["branch"], out["repo"]) == ("github", "devel", "PrincetonUniversity/PsyNeuLink")


def test_psyneulink_env_fills_in_when_disk_record_unreadable(monkeypatch):
    """An unreadable direct_url.json → the Mac app's env is the best answer left."""
    monkeypatch.setenv("PSYNEUVIEW_PNL_SOURCE", "github")
    monkeypatch.setenv("PSYNEUVIEW_PNL_BRANCH", "devel")
    monkeypatch.setenv("PSYNEUVIEW_PNL_REPO", "jonhanke-nam/PsyNeuLink")
    with patch.object(si, "distribution", return_value=_fake_dist("0.16.0.0+devel", "{not json")):
        out = si.get_psyneulink_info()
    assert out == {
        "version": "0.16.0.0+devel",
        "source": "github",
        "branch": "devel",
        "repo": "jonhanke-nam/PsyNeuLink",
        "commit": None,
        "path": None,
    }


def test_psyneulink_env_override_invalid_value_falls_through(monkeypatch):
    """Unrecognized PSYNEUVIEW_PNL_SOURCE value → ignore, fall back to introspection."""
    monkeypatch.setenv("PSYNEUVIEW_PNL_SOURCE", "unknown")
    with patch.object(si, "distribution", return_value=_fake_dist("0.16.0.0", None)):
        out = si.get_psyneulink_info()
    assert out["source"] == "pypi"  # introspection result


def test_psyneulink_env_override_missing_pkg(monkeypatch):
    """Override with the package missing → version is None but source still wins."""
    monkeypatch.setenv("PSYNEUVIEW_PNL_SOURCE", "github")
    monkeypatch.setenv("PSYNEUVIEW_PNL_BRANCH", "devel")
    monkeypatch.delenv("PSYNEUVIEW_PNL_REPO", raising=False)
    with patch.object(si, "distribution", side_effect=PackageNotFoundError):
        out = si.get_psyneulink_info()
    assert out == {
        "version": None,
        "source": "github",
        "branch": "devel",
        "repo": None,
        "commit": None,
        "path": None,
    }


def test_modeci_mdf_missing():
    with patch.object(si, "_safe_version", return_value=None):
        assert si.get_modeci_mdf_info() == {"version": "unknown"}


def test_psyneuview_falls_back_to_app_version_without_pip_install():
    """When the project isn't pip-installed, fall back to ``app.__version__``."""
    with patch.object(si, "_safe_version", return_value=None):
        out = si.get_psyneuview_info()
    from app import __version__
    assert out["version"] == __version__


# ── /api/settings/info endpoint ─────────────────────────────────────────


def test_settings_info_endpoint_shape():
    """End-to-end: endpoint returns the documented JSON shape."""
    resp = client.get("/api/settings/info")
    assert resp.status_code == 200
    data = resp.json()

    assert set(data.keys()) == {
        "psyneulink",
        "psyneuview",
        "modeci_mdf",
        "github_auth",
        # Whether PsyNeuLink actually imports, not only that it is recorded as
        # installed (#1143).
        "health",
        "features",
        "deployment",
        # How current PsyNeuLink is, for Report a Problem (#1304).
        "updates",
    }

    pnl = data["psyneulink"]
    assert set(pnl.keys()) == {"version", "source", "branch", "repo", "commit", "path"}
    assert pnl["source"] in ("pypi", "github", "editable", "unknown")

    pv = data["psyneuview"]
    assert set(pv.keys()) == {"version", "commit"}
    assert isinstance(pv["version"], str)
    assert isinstance(pv["commit"], str)

    mdf = data["modeci_mdf"]
    assert set(mdf.keys()) == {"version"}
    assert isinstance(mdf["version"], str)

    gh = data["github_auth"]
    assert set(gh.keys()) == {"source", "user", "scopes", "has_repo_scope"}
    assert isinstance(gh["scopes"], list)
    assert isinstance(gh["has_repo_scope"], bool)

    features = data["features"]
    assert set(features.keys()) == {"debugger_hook", "level"}
    assert isinstance(features["debugger_hook"], bool)
    assert features["level"] in ("full", "basic")

    deployment = data["deployment"]
    assert set(deployment.keys()) == {"mode", "capabilities"}
    assert deployment["mode"] in ("local", "mac_app", "container", "hosted")
    caps = deployment["capabilities"]
    assert set(caps.keys()) == {"install", "github_token"}
    assert all(isinstance(v, bool) for v in caps.values())


def test_settings_info_reports_declared_deployment_mode(monkeypatch):
    """The frontend hides controls off this, so it has to reflect the
    environment rather than a default."""
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", "container")
    data = client.get("/api/settings/info").json()
    assert data["deployment"]["mode"] == "container"
    assert data["deployment"]["capabilities"] == {
        "install": False,
        "github_token": False,
    }


def test_github_auth_info_reflects_unauthenticated():
    """With the unauth fixture pinned, the endpoint must surface source=none
    and never leak a token in any field."""
    resp = client.get("/api/settings/info")
    gh = resp.json()["github_auth"]
    assert gh == {
        "source": "none",
        "user": None,
        "scopes": [],
        "has_repo_scope": False,
    }


def test_github_auth_info_reflects_authenticated(monkeypatch):
    """When a token is resolved, the endpoint surfaces source/user/scopes —
    but never the token characters themselves."""
    monkeypatch.setenv("PSYNEUVIEW_GITHUB_TOKEN", "ghp_supersecret")
    github_auth.clear()
    probe = MagicMock()
    probe.read.return_value = b'{"login": "jonhanke-nam"}'
    probe.headers.get.return_value = "repo, read:org"
    probe.__enter__.return_value = probe
    probe.__exit__.return_value = False
    monkeypatch.setattr(github_auth.urllib.request, "urlopen", lambda *a, **kw: probe)
    github_auth.refresh()

    resp = client.get("/api/settings/info")
    body = resp.text
    assert "ghp_supersecret" not in body

    gh = resp.json()["github_auth"]
    assert gh["source"] == "env:PSYNEUVIEW_GITHUB_TOKEN"
    assert gh["user"] == "jonhanke-nam"
    assert gh["scopes"] == ["repo", "read:org"]
    assert gh["has_repo_scope"] is True


def test_settings_info_in_openapi_schema():
    """Endpoint should appear in the auto-generated OpenAPI schema."""
    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    schema = resp.json()
    assert "/api/settings/info" in schema["paths"]
    assert "get" in schema["paths"]["/api/settings/info"]


def test_settings_info_reports_whether_psyneulink_works():
    """The version alone can be reported by an install that no longer imports.

    An editable install keeps its metadata after its source folder has moved,
    so "what version is this" and "does this work" are different questions
    (#1143).
    """
    data = client.get("/api/settings/info").json()
    health = data["health"]
    assert health["status"] in {"ok", "not_installed", "source_missing", "import_failed"}
    assert health["detail"]
