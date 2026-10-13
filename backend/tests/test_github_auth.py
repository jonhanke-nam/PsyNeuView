"""Tests for app.services.github_auth.

Token discovery has a strict priority order, and a token that fails to
validate against ``/user`` must be discarded — these tests pin both. All
``subprocess`` and ``urlopen`` calls are patched, so the suite never
shells out or hits the network.
"""

from unittest.mock import patch, MagicMock

import pytest

from app.services import github_auth


def _ok_probe(login: str = "octocat", scopes: str = "repo, read:org"):
    """Build a urlopen context-manager mock for a successful /user response."""
    resp = MagicMock()
    resp.read.return_value = ('{"login": "' + login + '"}').encode()
    resp.headers.get.return_value = scopes
    resp.__enter__.return_value = resp
    resp.__exit__.return_value = False
    return resp


def _gh_proc(stdout: str = "", returncode: int = 0):
    completed = MagicMock()
    completed.stdout = stdout
    completed.returncode = returncode
    return completed


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch):
    """Tests must not pick up the developer's real env vars or gh login."""
    monkeypatch.delenv("PSYNEUVIEW_GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    github_auth.clear()
    yield
    github_auth.clear()


def test_no_env_no_gh_returns_unauthenticated():
    with patch.object(github_auth.subprocess, "run", side_effect=FileNotFoundError("no gh")):
        auth = github_auth.refresh()
    assert auth.authenticated is False
    assert auth.source == "none"
    assert auth.token is None
    assert auth.scopes == ()
    assert auth.header() == {}


def test_psyneuview_env_takes_precedence_over_github_token_and_gh(monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_GITHUB_TOKEN", "psy_tok")
    monkeypatch.setenv("GITHUB_TOKEN", "gh_env_tok")
    with patch.object(github_auth.subprocess, "run", return_value=_gh_proc("gh_cli_tok\n")), \
         patch.object(github_auth.urllib.request, "urlopen", return_value=_ok_probe()):
        auth = github_auth.refresh()
    assert auth.token == "psy_tok"
    assert auth.source == "env:PSYNEUVIEW_GITHUB_TOKEN"


def test_github_token_used_when_no_psyneuview_override(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "gh_env_tok")
    with patch.object(github_auth.subprocess, "run", return_value=_gh_proc("gh_cli_tok\n")), \
         patch.object(github_auth.urllib.request, "urlopen", return_value=_ok_probe()):
        auth = github_auth.refresh()
    assert auth.token == "gh_env_tok"
    assert auth.source == "env:GITHUB_TOKEN"


def test_gh_cli_used_when_no_env_vars():
    with patch.object(github_auth.subprocess, "run", return_value=_gh_proc("gho_abc\n")), \
         patch.object(github_auth.urllib.request, "urlopen", return_value=_ok_probe()):
        auth = github_auth.refresh()
    assert auth.token == "gho_abc"
    assert auth.source == "gh_cli"


def test_gh_cli_nonzero_exit_treated_as_no_token():
    with patch.object(github_auth.subprocess, "run", return_value=_gh_proc("", returncode=1)):
        auth = github_auth.refresh()
    assert auth.token is None
    assert auth.source == "none"


def test_gh_cli_empty_stdout_treated_as_no_token():
    with patch.object(github_auth.subprocess, "run", return_value=_gh_proc("   \n")):
        auth = github_auth.refresh()
    assert auth.token is None


def test_gh_cli_timeout_treated_as_no_token():
    import subprocess as sp
    err = sp.TimeoutExpired(cmd=["gh"], timeout=2.0)
    with patch.object(github_auth.subprocess, "run", side_effect=err):
        auth = github_auth.refresh()
    assert auth.token is None


def test_gh_cli_missing_treated_as_no_token():
    with patch.object(github_auth.subprocess, "run", side_effect=FileNotFoundError()):
        auth = github_auth.refresh()
    assert auth.token is None


def test_token_validation_failure_discards_token(monkeypatch):
    """A token that fails /user must be discarded — using it would just attach
    a header GitHub ignores or rejects."""
    monkeypatch.setenv("PSYNEUVIEW_GITHUB_TOKEN", "stale_token")
    import urllib.error
    with patch.object(
        github_auth.urllib.request,
        "urlopen",
        side_effect=urllib.error.HTTPError("u", 401, "unauth", {}, None),
    ):
        auth = github_auth.refresh()
    assert auth.token is None
    assert auth.source == "none"


def test_successful_probe_captures_login_and_scopes(monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_GITHUB_TOKEN", "good_token")
    with patch.object(
        github_auth.urllib.request,
        "urlopen",
        return_value=_ok_probe(login="jonhanke-nam", scopes="repo, gist, read:org"),
    ):
        auth = github_auth.refresh()
    assert auth.user == "jonhanke-nam"
    assert auth.scopes == ("repo", "gist", "read:org")
    assert auth.has_repo_scope is True


def test_no_repo_scope_when_token_only_has_user_scope(monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_GITHUB_TOKEN", "good_token")
    with patch.object(
        github_auth.urllib.request,
        "urlopen",
        return_value=_ok_probe(scopes="read:user"),
    ):
        auth = github_auth.refresh()
    assert auth.has_repo_scope is False


def test_header_helper_returns_bearer_when_authenticated(monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_GITHUB_TOKEN", "tok123")
    with patch.object(github_auth.urllib.request, "urlopen", return_value=_ok_probe()):
        auth = github_auth.refresh()
    assert auth.header() == {"Authorization": "Bearer tok123"}


def test_get_auth_is_cached(monkeypatch):
    """Subsequent get_auth() calls must not re-probe — the cache exists so we
    don't hammer /user on every branch lookup."""
    monkeypatch.setenv("PSYNEUVIEW_GITHUB_TOKEN", "tok")
    probe_calls = {"n": 0}

    def fake_urlopen(*args, **kwargs):
        probe_calls["n"] += 1
        return _ok_probe()

    with patch.object(github_auth.urllib.request, "urlopen", side_effect=fake_urlopen):
        github_auth.refresh()
        github_auth.get_auth()
        github_auth.get_auth()
    assert probe_calls["n"] == 1


def test_clear_then_get_re_resolves(monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_GITHUB_TOKEN", "tok")
    with patch.object(github_auth.urllib.request, "urlopen", return_value=_ok_probe()):
        github_auth.refresh()
    assert github_auth.get_auth().token == "tok"

    github_auth.clear()
    monkeypatch.delenv("PSYNEUVIEW_GITHUB_TOKEN", raising=False)
    with patch.object(github_auth.subprocess, "run", side_effect=FileNotFoundError()):
        # Cache cleared + env empty + no gh → re-resolution yields unauthenticated.
        assert github_auth.get_auth().token is None


# ── Deployment-mode gating (#1062) ───────────────────────────────────────


def test_container_mode_ignores_an_explicit_token(monkeypatch):
    """A token in the environment belongs to whoever runs the *server*.

    Handing it to whoever opens the page would give a visitor the operator's
    GitHub account, so container deployments resolve unauthenticated even when
    a credential is sitting right there.
    """
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", "container")
    monkeypatch.setenv("PSYNEUVIEW_GITHUB_TOKEN", "ghp_secret")
    auth = github_auth.refresh()
    assert not auth.authenticated
    assert auth.token is None
    assert auth.source == "none"


def test_container_mode_never_shells_out_to_gh(monkeypatch):
    """Not just discarded after the fact — never discovered at all, so no
    `gh auth token` subprocess and no /user probe."""
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", "container")
    with patch("app.services.github_auth.subprocess.run") as run, patch(
        "app.services.github_auth.urllib.request.urlopen"
    ) as urlopen:
        auth = github_auth.refresh()
    assert not auth.authenticated
    run.assert_not_called()
    urlopen.assert_not_called()


def test_local_mode_still_resolves_a_token(monkeypatch):
    """The gate must not cost the default deployment its credentials."""
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", "local")
    monkeypatch.setenv("PSYNEUVIEW_GITHUB_TOKEN", "ghp_secret")
    with patch(
        "app.services.github_auth.urllib.request.urlopen", return_value=_ok_probe()
    ):
        auth = github_auth.refresh()
    assert auth.authenticated
    assert auth.user == "octocat"
