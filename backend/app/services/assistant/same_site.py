"""Assistant page routes accept requests only from the app's own page (#179, #381).

A FastAPI dependency shared by every assistant page router (settings, key,
sessions, proposals, log, review, the MCP setup). Not the MCP command's
routes, which have their own check (``assistant_mcp_routes.mcp_client``).
In order:

1. **Where it came from.** An ``Origin`` that isn't this server's own site is
   refused, and in ``local`` and ``mac_app`` modes so is a ``Host`` that isn't
   this machine. 403 ``not_app_page``.
2. **A site must be named to change anything.** A request that changes state
   (anything but GET, HEAD and OPTIONS) with no ``Origin`` is refused: a
   browser always sends one for such requests, so only a program leaves it out.
   403 ``no_origin``.
3. **The page secret** (``page_secret.py``) in ``X-PsyNeuView-Session``, on
   every route, reads included: missing is 403 ``page_secret_missing``, wrong
   is 403 ``page_secret_wrong``. No HTTP route serves the secret, so a program
   on this machine that can send requests (``curl``, another app, Claude
   Code's shell) still can't act as the page.

Every refusal says in plain English what happened and what to do.
"""

from __future__ import annotations

from urllib.parse import urlsplit

from fastapi import HTTPException, Request

from app.services import deployment_mode
from app.services.assistant import page_secret

REASON = "not_app_page"
NO_ORIGIN = "no_origin"
SECRET_MISSING = "page_secret_missing"
SECRET_WRONG = "page_secret_wrong"
_LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}
_READS = {"GET", "HEAD", "OPTIONS"}

MESSAGES = {
    REASON: "Assistant routes accept requests only from the app's own page.",
    NO_ORIGIN: (
        "Refused: this request names no site. Changes to the assistant come only from PsyNeuView's own page; "
        "a program or script can't make them."
    ),
    SECRET_MISSING: (
        "Refused: this page doesn't hold this launch's assistant secret. In a browser, open PsyNeuView from the "
        "link the server printed when it started (it ends in #pnv-session=…); the Mac app supplies it itself."
    ),
    SECRET_WRONG: (
        "Refused: the assistant secret is from an earlier launch. PsyNeuView has restarted; open the link it "
        "printed this time, or reopen the Mac app's window."
    ),
}


def _hostname(netloc: str) -> str:
    """``host:port`` or ``[v6]:port`` to the bare host, lower-cased."""
    try:
        return (urlsplit("//" + netloc).hostname or "").lower()
    except ValueError:
        return ""


def is_own_page(host: str | None, origin: str | None, mode: str | None = None) -> bool:
    """True when ``Host`` and ``Origin`` (if any) say the app's own site.

    Only the first of the three checks; ``check`` runs all three."""
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


def check(method: str, host: str | None, origin: str | None, secret: str | None, mode: str | None = None) -> str | None:
    """The refusal reason for a request, or None when it is the app's page."""
    if not is_own_page(host, origin, mode):
        return REASON
    if origin is None and method.upper() not in _READS:
        return NO_ORIGIN
    if not secret or not secret.strip():
        return SECRET_MISSING
    if not page_secret.matches(secret):
        return SECRET_WRONG
    return None


async def same_site(request: Request) -> None:
    """Dependency: refuse anything that isn't the app's own page."""
    headers = request.headers
    reason = check(request.method, headers.get("host"), headers.get("origin"), headers.get(page_secret.HEADER))
    if reason is not None:
        raise HTTPException(status_code=403, detail={"detail": MESSAGES[reason], "message": MESSAGES[reason], "reason": reason})
