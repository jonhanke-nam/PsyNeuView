"""Tests for app.services.github_files (#258).

Every test patches ``urlopen`` so behavior is deterministic and offline.
Covers tree filtering, the 1 MB content cap, the 403 split between
rate-limited and auth_required, input validation, cache TTL, and the
Authorization header path.
"""

from __future__ import annotations

import base64
import json
from unittest.mock import patch

import pytest
import urllib.error

from app.services import github_auth, github_files
from app.services.github_files import (
    GithubFilesError,
    TreeListing,
    clear_cache,
    get_file_content,
    list_tree,
)


def _http_response(body: object):
    class _Resp:
        def __init__(self, payload: bytes):
            self._payload = payload

        def read(self):
            return self._payload

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    return _Resp(json.dumps(body).encode())


def _http_error(url: str, code: int, headers: dict | None = None):
    class _Hdrs:
        def __init__(self, h: dict):
            self._h = h

        def get(self, k, default=None):
            return self._h.get(k, default)

    return urllib.error.HTTPError(url, code, "fail", _Hdrs(headers or {}), None)


def _raise_not_found(*args, **kwargs):
    raise FileNotFoundError("gh not available in tests")


@pytest.fixture(autouse=True)
def _clear_cache():
    clear_cache()
    yield
    clear_cache()


@pytest.fixture(autouse=True)
def _unauth_github(monkeypatch):
    """Pin github_auth unauthenticated so tests don't probe the dev's real
    `gh auth token` or attach a live Authorization header. Tests that want
    the authenticated path call ``github_auth.refresh()`` explicitly."""
    monkeypatch.delenv("PSYNEUVIEW_GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    github_auth.clear()
    with monkeypatch.context() as mp:
        mp.setattr(github_auth.subprocess, "run", _raise_not_found)
        github_auth.get_auth()
    yield
    github_auth.clear()


# ── list_tree ──────────────────────────────────────────────────────────


def test_list_tree_filters_to_py_blobs_only():
    """Drops directories, non-.py files, and malformed entries."""
    payload = {
        "tree": [
            {"path": "README.md",                       "type": "blob"},
            {"path": "scripts/run.py",                  "type": "blob"},
            {"path": "tests/__init__.py",               "type": "blob"},
            {"path": "tests/composition/test_zzz.py",   "type": "blob"},
            {"path": "tests/composition",               "type": "tree"},  # directory
            {"path": "not-a-py.txt",                    "type": "blob"},
            {"type": "blob"},                                              # no path
            "malformed string entry",
        ],
        "truncated": False,
    }

    with patch.object(github_files.urllib.request, "urlopen",
                      return_value=_http_response(payload)):
        result = list_tree("o/r", "main")

    assert isinstance(result, TreeListing)
    assert result.truncated is False
    assert result.paths == [
        "scripts/run.py",
        "tests/__init__.py",
        "tests/composition/test_zzz.py",
    ]


def test_list_tree_surfaces_truncated_flag():
    payload = {"tree": [{"path": "a.py", "type": "blob"}], "truncated": True}

    with patch.object(github_files.urllib.request, "urlopen",
                      return_value=_http_response(payload)):
        result = list_tree("o/r", "main")

    assert result.truncated is True


def test_list_tree_rejects_bad_slug_without_network_call():
    called = []

    def fake(*args, **kwargs):
        called.append(args)
        return _http_response({})

    with patch.object(github_files.urllib.request, "urlopen", side_effect=fake):
        with pytest.raises(GithubFilesError) as exc:
            list_tree("not_a_slug", "main")

    assert exc.value.reason == "invalid_slug"
    assert called == []


def test_list_tree_rejects_empty_ref():
    with pytest.raises(GithubFilesError) as exc:
        list_tree("o/r", "")
    assert exc.value.reason == "invalid_ref"


def test_list_tree_404_maps_to_not_found():
    def fake(req, timeout=10, **kwargs):
        raise _http_error(req.full_url, 404)

    with patch.object(github_files.urllib.request, "urlopen", side_effect=fake):
        with pytest.raises(GithubFilesError) as exc:
            list_tree("ghost/repo", "main")
    assert exc.value.reason == "not_found"


def test_list_tree_403_with_zero_remaining_is_rate_limited():
    def fake(req, timeout=10, **kwargs):
        raise _http_error(req.full_url, 403, {"X-RateLimit-Remaining": "0"})

    with patch.object(github_files.urllib.request, "urlopen", side_effect=fake):
        with pytest.raises(GithubFilesError) as exc:
            list_tree("o/r", "main")
    assert exc.value.reason == "rate_limited"


def test_list_tree_403_with_quota_remaining_is_auth_required():
    """403 without exhausted quota means SSO / private-repo / scope issue,
    not rate limit — surface as auth_required so the UI can route the user
    to Settings instead of telling them to wait."""
    def fake(req, timeout=10, **kwargs):
        raise _http_error(req.full_url, 403, {"X-RateLimit-Remaining": "4823"})

    with patch.object(github_files.urllib.request, "urlopen", side_effect=fake):
        with pytest.raises(GithubFilesError) as exc:
            list_tree("o/r", "main")
    assert exc.value.reason == "auth_required"


def test_list_tree_401_maps_to_auth_required():
    def fake(req, timeout=10, **kwargs):
        raise _http_error(req.full_url, 401)

    with patch.object(github_files.urllib.request, "urlopen", side_effect=fake):
        with pytest.raises(GithubFilesError) as exc:
            list_tree("o/r", "main")
    assert exc.value.reason == "auth_required"


def test_list_tree_url_error_maps_to_network():
    def fake(req, timeout=10, **kwargs):
        raise urllib.error.URLError("dns lookup failed")

    with patch.object(github_files.urllib.request, "urlopen", side_effect=fake):
        with pytest.raises(GithubFilesError) as exc:
            list_tree("o/r", "main")
    assert exc.value.reason == "network"


def test_list_tree_caches_within_ttl():
    payload = {"tree": [{"path": "a.py", "type": "blob"}], "truncated": False}
    calls = {"n": 0}

    def fake(req, timeout=10, **kwargs):
        calls["n"] += 1
        return _http_response(payload)

    with patch.object(github_files.urllib.request, "urlopen", side_effect=fake):
        first = list_tree("o/r", "main")
        second = list_tree("o/r", "main")

    assert first.paths == second.paths
    assert calls["n"] == 1


def test_list_tree_cache_keyed_by_ref():
    payload_main = {"tree": [{"path": "a.py", "type": "blob"}], "truncated": False}
    payload_devel = {"tree": [{"path": "b.py", "type": "blob"}], "truncated": False}

    def fake(req, timeout=10, **kwargs):
        url = req.full_url
        if "/trees/main" in url:
            return _http_response(payload_main)
        return _http_response(payload_devel)

    with patch.object(github_files.urllib.request, "urlopen", side_effect=fake):
        a = list_tree("o/r", "main")
        b = list_tree("o/r", "devel")

    assert a.paths == ["a.py"]
    assert b.paths == ["b.py"]


def test_list_tree_cache_respects_ttl(monkeypatch):
    monkeypatch.setattr(github_files, "CACHE_TTL_SECONDS", 0.0)
    payload = {"tree": [{"path": "a.py", "type": "blob"}], "truncated": False}
    calls = {"n": 0}

    def fake(req, timeout=10, **kwargs):
        calls["n"] += 1
        return _http_response(payload)

    with patch.object(github_files.urllib.request, "urlopen", side_effect=fake):
        list_tree("o/r", "main")
        list_tree("o/r", "main")

    assert calls["n"] == 2


# ── get_file_content ───────────────────────────────────────────────────


def test_get_file_content_decodes_base64_inline_payload():
    source = b"def f():\n    return 1\n"
    payload = {
        "size": len(source),
        "encoding": "base64",
        "content": base64.b64encode(source).decode(),
    }

    with patch.object(github_files.urllib.request, "urlopen",
                      return_value=_http_response(payload)):
        result = get_file_content("o/r", "main", "foo.py")

    assert result == source


def test_get_file_content_rejects_file_over_cap_by_size_field(monkeypatch):
    """GitHub reports size up front — refuse before decoding."""
    monkeypatch.setattr(github_files, "MAX_FILE_BYTES", 100)
    payload = {
        "size": 200,
        "encoding": "base64",
        "content": base64.b64encode(b"x" * 200).decode(),
    }

    with patch.object(github_files.urllib.request, "urlopen",
                      return_value=_http_response(payload)):
        with pytest.raises(GithubFilesError) as exc:
            get_file_content("o/r", "main", "big.py")
    assert exc.value.reason == "too_large"


def test_get_file_content_rejects_non_inline_content():
    """Files >1 MB come back with encoding='none' from the Contents API;
    refuse rather than chase the download_url since we'd just reject the
    download anyway."""
    payload = {"size": 100, "encoding": "none", "content": ""}

    with patch.object(github_files.urllib.request, "urlopen",
                      return_value=_http_response(payload)):
        with pytest.raises(GithubFilesError) as exc:
            get_file_content("o/r", "main", "foo.py")
    assert exc.value.reason == "too_large"


def test_get_file_content_refuses_directory_response():
    """Contents API returns a list when path is a directory."""
    with patch.object(github_files.urllib.request, "urlopen",
                      return_value=_http_response([{"type": "dir"}])):
        with pytest.raises(GithubFilesError) as exc:
            get_file_content("o/r", "main", "some/dir")
    assert exc.value.reason == "not_a_file"


def test_get_file_content_validates_inputs():
    with pytest.raises(GithubFilesError) as exc:
        get_file_content("not_a_slug", "main", "f.py")
    assert exc.value.reason == "invalid_slug"

    with pytest.raises(GithubFilesError) as exc:
        get_file_content("o/r", "", "f.py")
    assert exc.value.reason == "invalid_ref"

    with pytest.raises(GithubFilesError) as exc:
        get_file_content("o/r", "main", "")
    assert exc.value.reason == "invalid_path"

    with pytest.raises(GithubFilesError) as exc:
        get_file_content("o/r", "main", "tests/../etc/passwd")
    assert exc.value.reason == "invalid_path"


def test_get_file_content_is_not_cached():
    """Files can be large and the user expects fresh content; re-fetching
    on every call avoids unbounded memory growth and stale content."""
    source = b"hi"
    payload = {
        "size": len(source),
        "encoding": "base64",
        "content": base64.b64encode(source).decode(),
    }
    calls = {"n": 0}

    def fake(req, timeout=10, **kwargs):
        calls["n"] += 1
        return _http_response(payload)

    with patch.object(github_files.urllib.request, "urlopen", side_effect=fake):
        get_file_content("o/r", "main", "f.py")
        get_file_content("o/r", "main", "f.py")

    assert calls["n"] == 2


# ── auth header pass-through ──────────────────────────────────────────


def test_requests_carry_bearer_when_authenticated(monkeypatch):
    """When github_auth has a token, github_files requests must carry
    Authorization: Bearer ... — same wiring as branch_lookup."""
    github_auth.clear()
    monkeypatch.setenv("PSYNEUVIEW_GITHUB_TOKEN", "secret_token")

    user_probe = _http_response({"login": "tester"})
    user_probe.headers = type(
        "H", (), {"get": lambda self, k: "repo, gist" if k == "X-OAuth-Scopes" else None}
    )()
    with patch.object(github_auth.urllib.request, "urlopen", return_value=user_probe):
        github_auth.refresh()
    assert github_auth.get_auth().token == "secret_token"

    seen_headers: list[dict] = []

    def fake(req, timeout=10, **kwargs):
        seen_headers.append(dict(req.header_items()))
        return _http_response({"tree": [], "truncated": False})

    with patch.object(github_files.urllib.request, "urlopen", side_effect=fake):
        list_tree("o/r", "main")

    assert seen_headers
    for headers in seen_headers:
        bearer = next(
            (v for k, v in headers.items() if k.lower() == "authorization"),
            None,
        )
        assert bearer == "Bearer secret_token", headers


def test_no_auth_header_when_unauthenticated():
    seen_headers: list[dict] = []

    def fake(req, timeout=10, **kwargs):
        seen_headers.append(dict(req.header_items()))
        return _http_response({"tree": [], "truncated": False})

    with patch.object(github_files.urllib.request, "urlopen", side_effect=fake):
        list_tree("o/r", "main")

    for headers in seen_headers:
        assert not any(k.lower() == "authorization" for k in headers)
