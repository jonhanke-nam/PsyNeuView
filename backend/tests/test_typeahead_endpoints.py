"""Endpoint tests for the typeahead lookup routes (#251).

These cover the three routes added alongside the existing install endpoints:

- GET /api/settings/install/branches?repo=owner/name
- GET /api/settings/install/repos
- POST /api/settings/install — verifies (repo, ref) is recorded into history

We stub ``branch_lookup.list_branches`` for the GitHub side and point
the preferences file (``PSYNEUVIEW_CONFIG_FILE``) at a tmp_path for isolation (#1025).
"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.api import routes as api_routes
from app.main import app
from app.services import branch_lookup, source_history, install_manager as im
from app.services.app_config import CONFIG_ENV

client = TestClient(app)


@pytest.fixture
def loopback(monkeypatch):
    """TestClient identifies as `testclient`, not 127.0.0.1 — open the gate."""
    monkeypatch.setattr(api_routes, "_is_loopback", lambda request: True)


@pytest.fixture
def isolated_history(tmp_path, monkeypatch):
    """Each test gets its own throwaway config file — never touch ~/.psynewview.json."""
    config_path = tmp_path / ".psynewview.json"
    monkeypatch.setenv(CONFIG_ENV, str(config_path))
    yield config_path


@pytest.fixture(autouse=True)
def _clear_branch_cache():
    """The branch_lookup cache lives at module scope; reset per test."""
    branch_lookup.clear_cache()
    yield
    branch_lookup.clear_cache()


@pytest.fixture(autouse=True)
def _reset_install_manager_singleton():
    im._install_manager = None
    yield
    im._install_manager = None


# ── /settings/install/branches ─────────────────────────────────────────


def test_branches_happy_path(loopback, isolated_history):
    listing = branch_lookup.BranchListing(branches=["devel", "main"], default="devel")
    with patch.object(branch_lookup, "list_branches", return_value=listing) as mock:
        resp = client.get("/api/settings/install/branches", params={"repo": "o/r"})

    mock.assert_called_once_with("o/r")
    assert resp.status_code == 200
    assert resp.json() == {
        "branches": ["devel", "main"],
        "default": "devel",
        "recent_refs": [],
    }


def test_branches_includes_recent_refs(loopback, isolated_history):
    source_history.record_selection("o/r", "feature/x")
    source_history.record_selection("o/r", "devel")
    source_history.record_selection("other/repo", "main")

    listing = branch_lookup.BranchListing(branches=["devel", "feature/x", "main"], default="devel")
    with patch.object(branch_lookup, "list_branches", return_value=listing):
        resp = client.get("/api/settings/install/branches", params={"repo": "o/r"})

    body = resp.json()
    # Recent refs are newest-first and only for the queried repo — `other/repo`
    # selections must not bleed in.
    assert body["recent_refs"] == ["devel", "feature/x"]


def test_branches_invalid_slug_is_400(loopback, isolated_history):
    def boom(slug):
        raise branch_lookup.BranchLookupError("invalid_slug", "bad slug")
    with patch.object(branch_lookup, "list_branches", side_effect=boom):
        resp = client.get("/api/settings/install/branches", params={"repo": "not_a_slug"})
    assert resp.status_code == 400
    assert resp.json()["detail"]["reason"] == "invalid_slug"


def test_branches_not_found_is_404(loopback, isolated_history):
    def boom(slug):
        raise branch_lookup.BranchLookupError("not_found", "missing")
    with patch.object(branch_lookup, "list_branches", side_effect=boom):
        resp = client.get("/api/settings/install/branches", params={"repo": "ghost/repo"})
    assert resp.status_code == 404


def test_branches_rate_limited_is_429(loopback, isolated_history):
    def boom(slug):
        raise branch_lookup.BranchLookupError("rate_limited", "slow down")
    with patch.object(branch_lookup, "list_branches", side_effect=boom):
        resp = client.get("/api/settings/install/branches", params={"repo": "o/r"})
    assert resp.status_code == 429


def test_branches_route_does_not_collide_with_job_id(loopback, isolated_history):
    """Regression: ``branches`` is a literal segment, not a job_id match."""
    listing = branch_lookup.BranchListing(branches=[], default="main")
    with patch.object(branch_lookup, "list_branches", return_value=listing):
        resp = client.get("/api/settings/install/branches", params={"repo": "o/r"})
    # If route ordering ever regresses, this would hit the job_id route and
    # return 404 "job not found" instead.
    assert resp.status_code == 200


# ── /settings/install/repos ────────────────────────────────────────────


def test_repos_empty_history(loopback, isolated_history):
    resp = client.get("/api/settings/install/repos")
    assert resp.status_code == 200
    assert resp.json() == {"recent_repos": []}


def test_repos_returns_newest_first_no_dupes(loopback, isolated_history):
    source_history.record_selection("a/a", "main")
    source_history.record_selection("b/b", "main")
    source_history.record_selection("a/a", "devel")  # bumps a/a above b/b

    resp = client.get("/api/settings/install/repos")
    assert resp.json() == {"recent_repos": ["a/a", "b/b"]}


# ── POST /settings/install records into history ────────────────────────


def test_install_records_repo_and_ref(loopback, isolated_history, monkeypatch):
    """A successful submit pushes (repo, ref) into history. We mock the
    underlying install manager so no subprocess actually runs."""

    class _FakeJob:
        id = "fake"
        source = "github"
        ref = "devel"
        path = None
        repo = "o/r"
        version = None
        status = "pending"
        log: list[str] = []
        exit_code = None
        started_at = 0.0
        finished_at = None

    class _FakeManager:
        def start(self, source, ref, path, repo, version=None):
            return _FakeJob()

    monkeypatch.setattr(api_routes, "get_install_manager", lambda: _FakeManager())

    resp = client.post(
        "/api/settings/install",
        json={"source": "github", "ref": "devel", "repo": "o/r"},
    )
    assert resp.status_code == 200
    assert source_history.list_selections() == [
        {"repo": "o/r", "ref": "devel", "selected_at": pytest.approx(
            source_history.list_selections()[0]["selected_at"]
        )},
    ]


def test_install_records_default_repo_when_omitted(loopback, isolated_history, monkeypatch):
    """Leaving Repo blank still records — defaults to PrincetonUniversity/PsyNeuLink
    so the recent-refs list survives across blank-repo selections."""

    class _FakeJob:
        id = "fake"
        source = "github"
        ref = "main"
        path = None
        repo = None
        version = None
        status = "pending"
        log: list[str] = []
        exit_code = None
        started_at = 0.0
        finished_at = None

    class _FakeManager:
        def start(self, source, ref, path, repo, version=None):
            return _FakeJob()

    monkeypatch.setattr(api_routes, "get_install_manager", lambda: _FakeManager())

    client.post("/api/settings/install", json={"source": "github", "ref": "main"})
    entries = source_history.list_selections()
    assert len(entries) == 1
    assert entries[0]["repo"] == "PrincetonUniversity/PsyNeuLink"
    assert entries[0]["ref"] == "main"


def test_install_does_not_record_pypi_source(loopback, isolated_history, monkeypatch):
    """Only github-source installs go into source_history. PyPI and local
    don't have a (repo, ref) pair to remember."""

    class _FakeJob:
        id = "fake"
        source = "pypi"
        ref = None
        path = None
        repo = None
        version = None
        status = "pending"
        log: list[str] = []
        exit_code = None
        started_at = 0.0
        finished_at = None

    class _FakeManager:
        def start(self, source, ref, path, repo, version=None):
            return _FakeJob()

    monkeypatch.setattr(api_routes, "get_install_manager", lambda: _FakeManager())

    client.post("/api/settings/install", json={"source": "pypi"})
    assert source_history.list_selections() == []
