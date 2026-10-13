"""Endpoint tests for the GitHub file-loader routes (#258).

Covers:

- GET /api/model/github/tree — happy path, recents merging, error → status mapping
- GET /api/model/github/file — happy path, file_history recording, error → status mapping,
  non-UTF-8 surface as 400

The service layer (github_files) is stubbed so we can hit deterministic
errors without patching urlopen at every test. The preferences file is
redirected to a tmp_path so we never touch ~/.psynewview.json.
"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import file_history, github_files
from app.services.app_config import CONFIG_ENV

client = TestClient(app)


@pytest.fixture
def isolated_file_history(tmp_path, monkeypatch):
    config_path = tmp_path / ".psynewview.json"
    monkeypatch.setenv(CONFIG_ENV, str(config_path))
    yield config_path


@pytest.fixture(autouse=True)
def _clear_github_cache():
    github_files.clear_cache()
    yield
    github_files.clear_cache()


# ── /model/github/tree ──────────────────────────────────────────────────


def test_tree_happy_path_returns_paths_and_no_recents(isolated_file_history):
    listing = github_files.TreeListing(
        paths=["a.py", "tests/b.py"], truncated=False
    )
    with patch.object(github_files, "list_tree", return_value=listing) as mock:
        resp = client.get("/api/model/github/tree", params={"repo": "o/r", "ref": "main"})

    mock.assert_called_once_with("o/r", "main")
    assert resp.status_code == 200
    assert resp.json() == {
        "paths": ["a.py", "tests/b.py"],
        "truncated": False,
        "recent": [],
    }


def test_tree_includes_recents_scoped_to_repo_and_ref(isolated_file_history):
    """Recents shown alongside the tree are filtered to the same (repo, ref)."""
    file_history.record_selection("o/r", "main",  "x.py")
    file_history.record_selection("o/r", "devel", "should-not-appear.py")
    file_history.record_selection("o/r", "main",  "y.py")
    file_history.record_selection("other/repo", "main", "z.py")

    listing = github_files.TreeListing(paths=["x.py", "y.py"], truncated=False)
    with patch.object(github_files, "list_tree", return_value=listing):
        resp = client.get("/api/model/github/tree", params={"repo": "o/r", "ref": "main"})

    body = resp.json()
    assert resp.status_code == 200
    recent_paths = [r["path"] for r in body["recent"]]
    assert recent_paths == ["y.py", "x.py"]  # newest first


def test_tree_surfaces_truncated_flag(isolated_file_history):
    listing = github_files.TreeListing(paths=["a.py"], truncated=True)
    with patch.object(github_files, "list_tree", return_value=listing):
        resp = client.get("/api/model/github/tree", params={"repo": "o/r", "ref": "main"})

    assert resp.json()["truncated"] is True


@pytest.mark.parametrize(
    "reason, expected_status",
    [
        ("invalid_slug",  400),
        ("invalid_ref",   400),
        ("not_found",     404),
        ("auth_required", 403),
        ("rate_limited",  429),
        ("network",       502),
    ],
)
def test_tree_error_reasons_map_to_status_codes(isolated_file_history, reason, expected_status):
    err = github_files.GithubFilesError(reason, "stub")
    with patch.object(github_files, "list_tree", side_effect=err):
        resp = client.get("/api/model/github/tree", params={"repo": "o/r", "ref": "main"})

    assert resp.status_code == expected_status
    detail = resp.json()["detail"]
    assert detail["reason"] == reason


# ── /model/github/file ──────────────────────────────────────────────────


def test_file_happy_path_returns_decoded_content(isolated_file_history):
    src = b"def f():\n    return 1\n"
    with patch.object(github_files, "get_file_content", return_value=src) as mock:
        resp = client.get(
            "/api/model/github/file",
            params={"repo": "o/r", "ref": "main", "path": "f.py"},
        )

    mock.assert_called_once_with("o/r", "main", "f.py")
    body = resp.json()
    assert resp.status_code == 200
    assert body == {
        "repo": "o/r",
        "ref": "main",
        "path": "f.py",
        "content": "def f():\n    return 1\n",
    }


def test_file_records_into_file_history_on_success(isolated_file_history):
    with patch.object(github_files, "get_file_content", return_value=b"src"):
        resp = client.get(
            "/api/model/github/file",
            params={"repo": "o/r", "ref": "main", "path": "f.py"},
        )

    assert resp.status_code == 200
    recents = file_history.list_selections()
    assert len(recents) == 1
    assert recents[0]["repo"] == "o/r"
    assert recents[0]["ref"] == "main"
    assert recents[0]["path"] == "f.py"


def test_file_does_not_record_into_history_on_error(isolated_file_history):
    err = github_files.GithubFilesError("not_found", "stub")
    with patch.object(github_files, "get_file_content", side_effect=err):
        resp = client.get(
            "/api/model/github/file",
            params={"repo": "o/r", "ref": "main", "path": "f.py"},
        )

    assert resp.status_code == 404
    assert file_history.list_selections() == []


def test_file_non_utf8_content_returns_400(isolated_file_history):
    """A .py path that contains non-UTF-8 bytes (binary file misnamed) is
    surfaced as 400 with a clear reason rather than corrupting bytes."""
    binary = b"\xff\xfe\xfd not utf-8"
    with patch.object(github_files, "get_file_content", return_value=binary):
        resp = client.get(
            "/api/model/github/file",
            params={"repo": "o/r", "ref": "main", "path": "f.py"},
        )

    assert resp.status_code == 400
    assert resp.json()["detail"]["reason"] == "not_utf8"
    # Failed UTF-8 decode must also short-circuit the history record.
    assert file_history.list_selections() == []


@pytest.mark.parametrize(
    "reason, expected_status",
    [
        ("invalid_slug", 400),
        ("invalid_ref",  400),
        ("invalid_path", 400),
        ("not_a_file",   400),
        ("not_found",    404),
        ("auth_required", 403),
        ("rate_limited", 429),
        ("too_large",    413),
        ("network",      502),
    ],
)
def test_file_error_reasons_map_to_status_codes(isolated_file_history, reason, expected_status):
    err = github_files.GithubFilesError(reason, "stub")
    with patch.object(github_files, "get_file_content", side_effect=err):
        resp = client.get(
            "/api/model/github/file",
            params={"repo": "o/r", "ref": "main", "path": "f.py"},
        )

    assert resp.status_code == expected_status
    assert resp.json()["detail"]["reason"] == reason
