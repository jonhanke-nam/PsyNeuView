"""Fetch tree listings and file contents from GitHub repos for #258.

Backs the Load Model → "From GitHub repo…" modal. Two operations:

- ``list_tree(slug, ref)`` — one recursive call to GitHub's Git Tree API,
  filtered to ``.py`` files and sorted. Cached 5 min, same TTL as
  ``branch_lookup`` (small payload, deduplicated by slug+ref).
- ``get_file_content(slug, ref, path)`` — Contents API, base64-decoded,
  size-capped at 1 MB. **Not cached** — file payloads can be large and the
  user expects fresh content when a branch moves; we'd rather re-fetch than
  bloat the worker's memory.

Auth, SSL setup, and error reporting all mirror ``branch_lookup`` so the
route layer can treat the two services uniformly.
"""

from __future__ import annotations

import base64
import json
import re
import ssl
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from urllib.parse import quote

import certifi

from app.services import github_auth


# python.org's macOS Python doesn't ship a usable CA bundle; pin to certifi
# so api.github.com calls don't fail with CERTIFICATE_VERIFY_FAILED.
_SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())


SLUG_PATTERN = re.compile(r"^[\w.-]+/[\w.-]+$")
GITHUB_API = "https://api.github.com"
CACHE_TTL_SECONDS = 300  # 5 min — matches branch_lookup
MAX_FILE_BYTES = 1_000_000  # 1 MB cap per #258 spec
USER_AGENT = "PsyNeuView/github-files"


@dataclass(frozen=True)
class TreeListing:
    paths: list[str]    # .py files only, sorted case-insensitively
    truncated: bool     # GitHub flag — set when the recursive tree
                        # exceeded the API's per-call limit


class GithubFilesError(Exception):
    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason


_tree_cache: dict[tuple[str, str], tuple[float, TreeListing]] = {}
_lock = threading.Lock()


def list_tree(repo_slug: str, ref: str) -> TreeListing:
    """Return all ``.py`` paths in ``repo_slug`` at ``ref``.

    Cached for ``CACHE_TTL_SECONDS`` keyed by (slug, ref). Validates inputs
    before any network call.
    """
    slug = (repo_slug or "").strip()
    ref = (ref or "").strip()
    if not SLUG_PATTERN.match(slug):
        raise GithubFilesError(
            "invalid_slug",
            f"Repo must be in 'owner/name' form, got {repo_slug!r}.",
        )
    if not ref:
        raise GithubFilesError("invalid_ref", "ref must not be empty.")

    key = (slug, ref)
    now = time.time()
    with _lock:
        cached = _tree_cache.get(key)
        if cached is not None and now - cached[0] < CACHE_TTL_SECONDS:
            return cached[1]

    listing = _fetch_tree(slug, ref)
    with _lock:
        _tree_cache[key] = (now, listing)
    return listing


def get_file_content(repo_slug: str, ref: str, path: str) -> bytes:
    """Return raw file bytes for ``path`` at ``ref`` in ``repo_slug``.

    Capped at ``MAX_FILE_BYTES``. Refuses directory paths and any response
    that isn't an inline base64 blob (large files come back with
    ``encoding="none"`` from the Contents API — we don't follow the
    download_url since we're already past the cap).
    """
    slug = (repo_slug or "").strip()
    ref = (ref or "").strip()
    path = (path or "").strip().lstrip("/")
    if not SLUG_PATTERN.match(slug):
        raise GithubFilesError(
            "invalid_slug",
            f"Repo must be in 'owner/name' form, got {repo_slug!r}.",
        )
    if not ref:
        raise GithubFilesError("invalid_ref", "ref must not be empty.")
    if not path:
        raise GithubFilesError("invalid_path", "path must not be empty.")
    # Defense in depth — GitHub would resolve a normalized path, but reject
    # traversal segments before they leave the process.
    if ".." in path.split("/"):
        raise GithubFilesError("invalid_path", "path must not contain '..'.")

    return _fetch_file(slug, ref, path)


def clear_cache() -> None:
    """Test helper — drop the tree cache."""
    with _lock:
        _tree_cache.clear()


def _fetch_tree(slug: str, ref: str) -> TreeListing:
    url = f"{GITHUB_API}/repos/{slug}/git/trees/{quote(ref, safe='/')}?recursive=1"
    payload = _get_json(url)
    if not isinstance(payload, dict):
        raise GithubFilesError(
            "network", f"Unexpected tree response shape from {url}."
        )
    tree = payload.get("tree", [])
    if not isinstance(tree, list):
        raise GithubFilesError(
            "network", f"Unexpected tree shape from {url}: tree not a list."
        )
    paths = [
        entry["path"]
        for entry in tree
        if isinstance(entry, dict)
        and entry.get("type") == "blob"
        and isinstance(entry.get("path"), str)
        and entry["path"].endswith(".py")
    ]
    paths.sort(key=str.lower)
    return TreeListing(paths=paths, truncated=bool(payload.get("truncated", False)))


def _fetch_file(slug: str, ref: str, path: str) -> bytes:
    url = (
        f"{GITHUB_API}/repos/{slug}/contents/{quote(path, safe='/')}"
        f"?ref={quote(ref, safe='/')}"
    )
    payload = _get_json(url)

    # Contents API returns a list for directories. The path validator can't
    # detect that ahead of time, so we recognize and refuse here.
    if isinstance(payload, list):
        raise GithubFilesError("not_a_file", f"{path} is a directory, not a file.")
    if not isinstance(payload, dict):
        raise GithubFilesError(
            "network", f"Unexpected contents response shape from {url}."
        )

    size = payload.get("size")
    if isinstance(size, int) and size > MAX_FILE_BYTES:
        raise GithubFilesError(
            "too_large",
            f"File is {size} bytes; capped at {MAX_FILE_BYTES} bytes.",
        )

    encoding = payload.get("encoding")
    content_b64 = payload.get("content")
    if encoding != "base64" or not isinstance(content_b64, str):
        # Files larger than ~1 MB come back with encoding="none" and an
        # empty content — GitHub expects callers to fetch via download_url.
        # We're already past our cap, so refuse rather than follow.
        raise GithubFilesError(
            "too_large",
            f"File at {path} is not returned inline (likely larger than 1 MB).",
        )

    try:
        decoded = base64.b64decode(content_b64, validate=False)
    except (ValueError, TypeError) as e:
        raise GithubFilesError(
            "network", f"Could not decode contents response: {e}"
        ) from e

    if len(decoded) > MAX_FILE_BYTES:
        raise GithubFilesError(
            "too_large",
            f"File is {len(decoded)} bytes; capped at {MAX_FILE_BYTES} bytes.",
        )
    return decoded


def _get_json(url: str) -> object:
    """Synchronous urlopen → JSON, with structured error mapping.

    403 responses are split into ``rate_limited`` (when GitHub reports
    ``X-RateLimit-Remaining: 0``) vs ``auth_required`` (anything else —
    typically a private repo the current token can't reach, or no token).
    The split lets the UI render an actionable message instead of a single
    catch-all.
    """
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
            raise GithubFilesError("not_found", f"Not found: {url}") from e
        if e.code == 401:
            raise GithubFilesError(
                "auth_required",
                "GitHub returned 401 — authentication required or token invalid.",
            ) from e
        if e.code == 403:
            remaining = None
            try:
                remaining = e.headers.get("X-RateLimit-Remaining")
            except AttributeError:
                pass
            if remaining == "0":
                raise GithubFilesError(
                    "rate_limited",
                    "GitHub API rate limit exceeded — try again in a few minutes.",
                ) from e
            raise GithubFilesError(
                "auth_required",
                "GitHub returned 403 — sign in or grant repo scope to view this resource.",
            ) from e
        raise GithubFilesError("network", f"HTTP {e.code} from {url}") from e
    except urllib.error.URLError as e:
        raise GithubFilesError(
            "network", f"Network error contacting {url}: {e.reason}"
        ) from e

    try:
        return json.loads(body)
    except json.JSONDecodeError as e:
        raise GithubFilesError(
            "network", f"Malformed JSON from {url}: {e}"
        ) from e
