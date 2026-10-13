"""Look up the branch list for a public GitHub repo, with a small in-process
cache to stay under the unauthenticated rate limit (60 req/hr per IP).

Used by the Branch / ref typeahead in #251 to populate the *All branches*
section of the combobox. Recent selections come from
``app.services.source_history``; this module's job is the "what does
GitHub currently have on this repo" half.

Failure modes are surfaced as ``BranchLookupError`` with a structured
``reason`` — ``invalid_slug`` / ``not_found`` / ``rate_limited`` /
``network``. The endpoint layer converts those to HTTP responses;
the frontend renders the same "type manually" fallback regardless,
so callers don't need to discriminate, but the reason helps with logs
and tests.
"""

from __future__ import annotations

import json
import re
import ssl
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Optional

import certifi

from app.services import github_auth


# python.org's macOS Python doesn't ship a usable CA bundle; pin to certifi
# so api.github.com calls don't fail with CERTIFICATE_VERIFY_FAILED.
_SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())


SLUG_PATTERN = re.compile(r"^[\w.-]+/[\w.-]+$")
GITHUB_API = "https://api.github.com"
CACHE_TTL_SECONDS = 300  # 5 min, per #251 spec
PER_PAGE = 100
MAX_PAGES = 5  # 500 branches is far more than any sane repo
USER_AGENT = "PsyNeuView/branch-lookup"


@dataclass(frozen=True)
class BranchListing:
    branches: list[str]
    default: str


class BranchLookupError(Exception):
    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason


_cache: dict[str, tuple[float, BranchListing]] = {}
_lock = threading.Lock()


def list_branches(repo_slug: str) -> BranchListing:
    """Return the branch list and default branch for ``owner/repo``.

    Cached for ``CACHE_TTL_SECONDS``. Validates the slug shape locally
    before any network call.
    """
    slug = (repo_slug or "").strip()
    if not SLUG_PATTERN.match(slug):
        raise BranchLookupError(
            "invalid_slug",
            f"Repo must be in 'owner/name' form, got {repo_slug!r}.",
        )

    now = time.time()
    with _lock:
        cached = _cache.get(slug)
        if cached is not None and now - cached[0] < CACHE_TTL_SECONDS:
            return cached[1]

    listing = _fetch_branches(slug)
    with _lock:
        _cache[slug] = (now, listing)
    return listing


def clear_cache() -> None:
    """Test helper — drop all cached entries."""
    with _lock:
        _cache.clear()


def _fetch_branches(slug: str) -> BranchListing:
    """Two GitHub API calls — repo metadata for the default branch, then
    paginated branch list."""
    default = _fetch_default_branch(slug)
    branches = _fetch_all_branch_names(slug)
    branches.sort(key=str.lower)
    return BranchListing(branches=branches, default=default)


def _fetch_default_branch(slug: str) -> str:
    payload = _get_json(f"{GITHUB_API}/repos/{slug}")
    default = payload.get("default_branch")
    if not isinstance(default, str) or not default:
        raise BranchLookupError(
            "network",
            f"GitHub returned no default_branch for {slug}.",
        )
    return default


def _fetch_all_branch_names(slug: str) -> list[str]:
    names: list[str] = []
    for page in range(1, MAX_PAGES + 1):
        url = f"{GITHUB_API}/repos/{slug}/branches?per_page={PER_PAGE}&page={page}"
        page_payload = _get_json(url)
        if not isinstance(page_payload, list):
            raise BranchLookupError(
                "network",
                f"Unexpected response shape from {url}: not a list.",
            )
        if not page_payload:
            break
        for entry in page_payload:
            if isinstance(entry, dict) and isinstance(entry.get("name"), str):
                names.append(entry["name"])
        if len(page_payload) < PER_PAGE:
            break
    return names


def _get_json(url: str) -> object:
    """Synchronous urlopen → JSON. Maps HTTP failures to BranchLookupError."""
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": "2022-11-28",
    }
    headers.update(github_auth.get_auth().header())
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10, context=_SSL_CONTEXT) as resp:
            body = resp.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise BranchLookupError("not_found", f"Repo not found: {url}") from e
        if e.code == 403:
            # GitHub returns 403 with x-ratelimit-remaining=0 for rate-limited
            # unauthenticated callers. We can't always distinguish auth from
            # quota without parsing headers, so report quota — the message
            # the user sees is the same either way.
            raise BranchLookupError(
                "rate_limited",
                "GitHub API rate limit exceeded — try again in a few minutes.",
            ) from e
        raise BranchLookupError("network", f"HTTP {e.code} from {url}") from e
    except urllib.error.URLError as e:
        raise BranchLookupError("network", f"Network error contacting {url}: {e.reason}") from e

    try:
        return json.loads(body)
    except json.JSONDecodeError as e:
        raise BranchLookupError("network", f"Malformed JSON from {url}: {e}") from e
