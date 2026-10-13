"""GitHub token resolution for branch lookup and install (#257 Phase 1).

Resolves a token at process start (and on demand) from one of:

1. ``PSYNEUVIEW_GITHUB_TOKEN`` — explicit override.
2. ``GITHUB_TOKEN`` — standard CI/automation convention.
3. ``gh auth token`` shellout — zero-setup for devs with the GitHub CLI.
4. None — falls back to current public-only behavior.

Tokens are validated via ``GET /user``. A token that fails to validate is
discarded so a stale ``gh`` session doesn't get used to attach bogus
``Authorization`` headers. The resolved ``GithubAuth`` is process-memory
only and never written to disk by this module.
"""

from __future__ import annotations

import json
import logging
import os
import ssl
import subprocess
import threading
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Optional

import certifi


logger = logging.getLogger(__name__)


USER_AGENT = "PsyNeuView/github-auth"
GH_AUTH_TOKEN_TIMEOUT_SECONDS = 2.0
USER_PROBE_TIMEOUT_SECONDS = 5.0

# Python.org's macOS installer ships without a usable CA bundle, so urllib's
# default SSL context fails CERTIFICATE_VERIFY_FAILED against api.github.com.
# Pin to certifi (already a transitive dep) so the /user probe works on every
# supported install.
_SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())


@dataclass(frozen=True)
class GithubAuth:
    token: Optional[str] = None
    source: str = "none"
    scopes: tuple[str, ...] = field(default_factory=tuple)
    user: Optional[str] = None

    @property
    def authenticated(self) -> bool:
        return self.token is not None

    @property
    def has_repo_scope(self) -> bool:
        return "repo" in self.scopes

    def header(self) -> dict[str, str]:
        if not self.token:
            return {}
        return {"Authorization": f"Bearer {self.token}"}


_cached: Optional[GithubAuth] = None
_lock = threading.Lock()


def get_auth() -> GithubAuth:
    """Return the cached resolution, computing it on first call."""
    global _cached
    with _lock:
        if _cached is None:
            _cached = _resolve_auth()
        return _cached


def refresh() -> GithubAuth:
    """Force re-resolution — call when env or `gh` login may have changed."""
    global _cached
    with _lock:
        _cached = _resolve_auth()
        return _cached


def clear() -> None:
    """Drop the cache (test helper)."""
    global _cached
    with _lock:
        _cached = None


def _resolve_auth() -> GithubAuth:
    # Deployments that aren't a single trusted user on their own machine get no
    # ambient credentials (#1062). `gh auth token` and a stray GITHUB_TOKEN both
    # belong to whoever runs the *server*; lending them to whoever opens the
    # page would hand a visitor the operator's GitHub account. Public read-only
    # access still works, which is all a container deployment needs.
    from app.services import deployment_mode

    if not deployment_mode.capabilities().github_token:
        return GithubAuth()

    candidate = _discover_token()
    if candidate is None:
        return GithubAuth()

    token, source = candidate
    probe = _probe_user(token)
    if probe is None:
        # Token didn't validate — discard. A 401 from /user means stale token
        # or revoked; using it would just attach a header that GitHub ignores
        # or rejects.
        logger.info("github_auth: token from %s failed /user probe; discarding", source)
        return GithubAuth()

    user, scopes = probe
    return GithubAuth(token=token, source=source, scopes=scopes, user=user)


def _discover_token() -> Optional[tuple[str, str]]:
    for env_var in ("PSYNEUVIEW_GITHUB_TOKEN", "GITHUB_TOKEN"):
        raw = os.environ.get(env_var, "").strip()
        if raw:
            return raw, f"env:{env_var}"

    gh_token = _try_gh_cli()
    if gh_token:
        return gh_token, "gh_cli"

    return None


def _try_gh_cli() -> Optional[str]:
    try:
        result = subprocess.run(
            ["gh", "auth", "token"],
            capture_output=True,
            text=True,
            timeout=GH_AUTH_TOKEN_TIMEOUT_SECONDS,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError) as e:
        logger.debug("github_auth: gh auth token unavailable (%s)", e)
        return None

    if result.returncode != 0:
        return None
    token = (result.stdout or "").strip()
    return token or None


def _probe_user(token: str) -> Optional[tuple[Optional[str], tuple[str, ...]]]:
    """``GET /user`` to confirm the token works and capture scopes.

    Returns ``(login, scopes_tuple)`` on success, ``None`` on any failure.
    """
    req = urllib.request.Request(
        "https://api.github.com/user",
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": USER_AGENT,
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=USER_PROBE_TIMEOUT_SECONDS, context=_SSL_CONTEXT) as resp:
            body = resp.read()
            scope_header = resp.headers.get("X-OAuth-Scopes") or ""
    except (urllib.error.HTTPError, urllib.error.URLError, OSError) as e:
        logger.debug("github_auth: /user probe failed: %s", e)
        return None

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return None

    login = payload.get("login") if isinstance(payload, dict) else None
    scopes = tuple(s.strip() for s in scope_header.split(",") if s.strip())
    return login, scopes
