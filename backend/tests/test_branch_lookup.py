"""Tests for app.services.branch_lookup.

We never actually hit GitHub — every test patches ``urlopen`` so the
behavior is deterministic and offline. Covers:

- Happy path: two endpoints called, default + sorted branch list returned.
- Pagination: stops after the last partial page.
- Slug validation rejects malformed input before any network call.
- 404 / 403 / network errors map to typed ``BranchLookupError`` reasons.
- The 5-min cache returns the same listing without re-hitting the network.
"""

import io
import json
from unittest.mock import patch

import pytest
import urllib.error

from app.services import branch_lookup, github_auth
from app.services.branch_lookup import (
    BranchListing,
    BranchLookupError,
    list_branches,
    clear_cache,
)


def _http_response(body: object, status: int = 200):
    """Build a urlopen-compatible context-manager mock returning ``body`` as JSON."""

    class _Resp:
        def __init__(self, payload: bytes):
            self._payload = payload
            self.status = status

        def read(self):
            return self._payload

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    return _Resp(json.dumps(body).encode())


def _route(url_to_payload: dict):
    """Return a fake urlopen that routes requests by URL."""
    def fake(req, timeout=10, **kwargs):
        # Request objects expose the URL via .full_url; raw URLs come through as str.
        url = getattr(req, "full_url", req)
        for prefix, payload in url_to_payload.items():
            if url.startswith(prefix):
                return _http_response(payload)
        raise AssertionError(f"unexpected url in test: {url}")
    return fake


@pytest.fixture(autouse=True)
def _clear_branch_cache():
    """Reset the module-level cache between tests so the 5-min TTL doesn't
    leak listings across cases."""
    clear_cache()
    yield
    clear_cache()


@pytest.fixture(autouse=True)
def _unauth_github(monkeypatch):
    """Pin github_auth to unauthenticated for branch tests by default.

    Otherwise the first list_branches() call would resolve the developer's
    real `gh auth token` and try to probe /user — which the patched
    urlopen doesn't route, and which would attach a real Authorization
    header on a developer machine. Tests that want to verify the
    auth-header path opt in by calling github_auth.refresh() inside a
    suitable env+probe patch.
    """
    monkeypatch.delenv("PSYNEUVIEW_GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    github_auth.clear()
    # Prime the cache with an unauthenticated GithubAuth so resolution
    # short-circuits without trying gh / urlopen.
    with monkeypatch.context() as mp:
        mp.setattr(github_auth.subprocess, "run", _raise_not_found)
        github_auth.get_auth()
    yield
    github_auth.clear()


def _raise_not_found(*args, **kwargs):
    raise FileNotFoundError("gh not available in tests")


def test_happy_path_returns_sorted_branches_and_default():
    # Order matters: the branches prefix is more specific than /repos/o/r
    # and must come first, since _route uses a prefix-startswith match.
    routes = _route({
        "https://api.github.com/repos/o/r/branches": [
            {"name": "main"}, {"name": "Devel"}, {"name": "feature/x"},
        ],
        "https://api.github.com/repos/o/r": {"default_branch": "devel"},
    })

    with patch.object(branch_lookup.urllib.request, "urlopen", side_effect=routes):
        result = list_branches("o/r")

    assert isinstance(result, BranchListing)
    assert result.default == "devel"
    # Case-insensitive sort — "Devel" comes before "feature/x" alphabetically.
    assert result.branches == ["Devel", "feature/x", "main"]


def test_pagination_stops_on_partial_page():
    """A page shorter than ``PER_PAGE`` is the last page — no further fetches."""
    page1 = [{"name": f"b{i}"} for i in range(branch_lookup.PER_PAGE)]
    page2 = [{"name": "tail"}]  # shorter than PER_PAGE => last page

    fetched_urls: list[str] = []

    def fake(req, timeout=10, **kwargs):
        url = getattr(req, "full_url", req)
        fetched_urls.append(url)
        if url.endswith("/repos/o/r"):
            return _http_response({"default_branch": "main"})
        # Match the `&page=N` suffix tightly — naive substring matching
        # collides with `per_page=100`.
        if url.endswith("&page=1"):
            return _http_response(page1)
        if url.endswith("&page=2"):
            return _http_response(page2)
        raise AssertionError(f"unexpected page: {url}")

    with patch.object(branch_lookup.urllib.request, "urlopen", side_effect=fake):
        result = list_branches("o/r")

    assert "tail" in result.branches
    assert len(result.branches) == branch_lookup.PER_PAGE + 1
    # 3 fetches total — repo metadata + page 1 + page 2. No page 3 request.
    assert sum(1 for u in fetched_urls if "page=" in u) == 2


def test_invalid_slug_rejected_without_network_call():
    called = []

    def fake(*args, **kwargs):
        called.append(args)
        return _http_response({})

    with patch.object(branch_lookup.urllib.request, "urlopen", side_effect=fake):
        with pytest.raises(BranchLookupError) as exc:
            list_branches("not_a_slug")

    assert exc.value.reason == "invalid_slug"
    assert called == []


def test_404_maps_to_not_found():
    def fake(req, timeout=10, **kwargs):
        raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, None)

    with patch.object(branch_lookup.urllib.request, "urlopen", side_effect=fake):
        with pytest.raises(BranchLookupError) as exc:
            list_branches("ghost/repo")

    assert exc.value.reason == "not_found"


def test_403_maps_to_rate_limited():
    def fake(req, timeout=10, **kwargs):
        raise urllib.error.HTTPError(req.full_url, 403, "rate limited", {}, None)

    with patch.object(branch_lookup.urllib.request, "urlopen", side_effect=fake):
        with pytest.raises(BranchLookupError) as exc:
            list_branches("o/r")

    assert exc.value.reason == "rate_limited"


def test_url_error_maps_to_network():
    def fake(req, timeout=10, **kwargs):
        raise urllib.error.URLError("dns lookup failed")

    with patch.object(branch_lookup.urllib.request, "urlopen", side_effect=fake):
        with pytest.raises(BranchLookupError) as exc:
            list_branches("o/r")

    assert exc.value.reason == "network"


def test_cache_avoids_second_network_call():
    routes = _route({
        "https://api.github.com/repos/o/r/branches": [{"name": "main"}],
        "https://api.github.com/repos/o/r": {"default_branch": "main"},
    })

    calls = {"n": 0}

    def fake(req, timeout=10, **kwargs):
        calls["n"] += 1
        return routes(req, timeout)

    with patch.object(branch_lookup.urllib.request, "urlopen", side_effect=fake):
        first = list_branches("o/r")
        second = list_branches("o/r")

    assert first == second
    # 2 network calls total (default + branches page 1) — second list_branches
    # call returns from cache.
    assert calls["n"] == 2


def test_cache_respects_ttl(monkeypatch):
    monkeypatch.setattr(branch_lookup, "CACHE_TTL_SECONDS", 0.0)

    routes = _route({
        "https://api.github.com/repos/o/r/branches": [{"name": "main"}],
        "https://api.github.com/repos/o/r": {"default_branch": "main"},
    })

    calls = {"n": 0}

    def fake(req, timeout=10, **kwargs):
        calls["n"] += 1
        return routes(req, timeout)

    with patch.object(branch_lookup.urllib.request, "urlopen", side_effect=fake):
        list_branches("o/r")
        list_branches("o/r")

    # TTL=0 means even the immediate second call re-fetches.
    assert calls["n"] == 4


def test_auth_header_attached_when_authenticated(monkeypatch):
    """When github_auth has a token, branch_lookup requests must carry
    Authorization: Bearer ... — this is the whole point of #257 Phase 1."""
    github_auth.clear()
    monkeypatch.setenv("PSYNEUVIEW_GITHUB_TOKEN", "secret_token")

    # Stage 1: prime the github_auth cache via a fake /user probe.
    user_probe = _http_response({"login": "tester"})
    user_probe.headers = type("H", (), {"get": lambda self, k: "repo, gist"})()
    with patch.object(github_auth.urllib.request, "urlopen", return_value=user_probe):
        github_auth.refresh()
    assert github_auth.get_auth().token == "secret_token"

    # Stage 2: every branch_lookup request should now carry the bearer header.
    seen_headers: list[dict] = []

    def fake_urlopen(req, timeout=10, **kwargs):
        seen_headers.append(dict(req.header_items()))
        url = getattr(req, "full_url", req)
        if url.endswith("/repos/o/r"):
            return _http_response({"default_branch": "main"})
        return _http_response([{"name": "main"}])

    routes_with_capture = _route({
        "https://api.github.com/repos/o/r/branches": [{"name": "main"}],
        "https://api.github.com/repos/o/r": {"default_branch": "main"},
    })

    with patch.object(branch_lookup.urllib.request, "urlopen", side_effect=fake_urlopen):
        list_branches("o/r")

    assert len(seen_headers) >= 1
    # urllib lowercases header names internally — match case-insensitively.
    for headers in seen_headers:
        bearer = next(
            (v for k, v in headers.items() if k.lower() == "authorization"),
            None,
        )
        assert bearer == "Bearer secret_token", headers


def test_no_auth_header_when_unauthenticated():
    """Default fixture leaves github_auth unauthenticated → no Authorization
    header on outgoing requests."""
    seen_headers: list[dict] = []

    def fake_urlopen(req, timeout=10, **kwargs):
        seen_headers.append(dict(req.header_items()))
        url = getattr(req, "full_url", req)
        if url.endswith("/repos/o/r"):
            return _http_response({"default_branch": "main"})
        return _http_response([{"name": "main"}])

    with patch.object(branch_lookup.urllib.request, "urlopen", side_effect=fake_urlopen):
        list_branches("o/r")

    for headers in seen_headers:
        assert not any(k.lower() == "authorization" for k in headers)
