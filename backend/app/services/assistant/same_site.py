"""Assistant routes accept requests only from the app's own page (#179).

A FastAPI dependency, small enough for every assistant router to share:

- An ``Origin`` header that isn't this server's own site is refused.
- In ``local`` and ``mac_app`` modes, a ``Host`` that isn't this machine is
  refused too.

Both answer 403 with ``reason: "not_app_page"``.
"""

from __future__ import annotations

from urllib.parse import urlsplit

from fastapi import HTTPException, Request

from app.services import deployment_mode

REASON = "not_app_page"
_LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}


def _hostname(netloc: str) -> str:
    """``host:port`` or ``[v6]:port`` to the bare host, lower-cased."""
    try:
        return (urlsplit("//" + netloc).hostname or "").lower()
    except ValueError:
        return ""


def is_own_page(host: str | None, origin: str | None, mode: str | None = None) -> bool:
    """True when the request can only have come from the app's own page."""
    host = (host or "").strip()
    if not host:
        return False
    if mode is None:
        mode = deployment_mode.current_mode()
    if mode in (deployment_mode.LOCAL, deployment_mode.MAC_APP) and _hostname(host) not in _LOCAL_HOSTS:
        return False
    if origin is not None:
        origin = origin.strip()
        if origin.lower() == "null":
            return False
        parts = urlsplit(origin)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            return False
        if parts.netloc.lower() != host.lower():
            return False
    return True


async def same_site(request: Request) -> None:
    """Dependency: refuse anything that isn't the app's own page."""
    if not is_own_page(request.headers.get("host"), request.headers.get("origin")):
        raise HTTPException(status_code=403, detail={
            "detail": "Assistant routes accept requests only from the app's own page.",
            "reason": REASON,
        })
