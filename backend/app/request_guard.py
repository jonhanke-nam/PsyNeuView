"""Which requests this server accepts, by where they say they came from.

A model file is a program and opening one runs it, so a request that reaches
the model endpoints can run code as the user. Binding to loopback keeps other
machines out, but not a page in the user's own browser. This checks two things
for every HTTP request and WebSocket:

- ``Host``: on a local install it must name this machine. A page that has
  pointed its own domain at 127.0.0.1 still sends that domain here.
- ``Origin``: a browser sends it, and a page can't forge it. A request from
  another site may not change anything or open a WebSocket. CORS doesn't cover
  this: it only stops a page reading the answer, after the server has acted.

A request with no ``Origin`` isn't from a page, or is a same-site GET: the Mac
app's own calls, ``curl``, tests. Those programs already run on this machine,
which this doesn't try to defend against.
"""

import os
from urllib.parse import urlsplit

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.services.deployment_mode import LOCAL, MAC_APP, current_mode

ALLOWED_HOSTS_ENV = "PSYNEUVIEW_ALLOWED_HOSTS"

_LOOPBACK = {"localhost", "127.0.0.1", "::1"}
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _extra_hosts() -> set[str]:
    """Other names for this machine, for someone serving a local install on them."""
    raw = os.environ.get(ALLOWED_HOSTS_ENV, "")
    return {h.strip().lower() for h in raw.split(",") if h.strip()}


def _hostname(netloc: str) -> str:
    """The name in ``host:port``, lower case, without brackets on an IPv6 address."""
    try:
        return (urlsplit(f"//{netloc}").hostname or "").lower()
    except ValueError:
        return ""


def host_allowed(host: str, mode: str) -> bool:
    """Remote deployments are reached by names only their operator knows."""
    if mode not in (LOCAL, MAC_APP):
        return True
    name = _hostname(host)
    return name in _LOOPBACK or name in _extra_hosts()


def origin_allowed(origin: str, host: str, forwarded_host: str, mode: str) -> bool:
    """The page's own site, or on a plain local install its dev server's."""
    parts = urlsplit(origin) if origin != "null" else None
    if parts is None or not parts.hostname or parts.scheme not in ("http", "https"):
        return False
    netloc = parts.netloc.lower()
    if netloc == host.lower() or (forwarded_host and netloc == forwarded_host.lower()):
        return True
    name = parts.hostname.lower()
    if name in _extra_hosts():
        return True
    # The dev server is a page on another port. The Mac app has none.
    return mode == LOCAL and name in _LOOPBACK


class RequestGuard:
    """Refuse a request from the wrong place before anything acts on it."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        host = headers.get("host", "")
        origin = headers.get("origin")
        mode = current_mode()
        is_websocket = scope["type"] == "websocket"

        reason = None
        if not host_allowed(host, mode):
            reason = "this server doesn't answer to that address"
        elif origin is not None and (is_websocket or scope["method"] not in _SAFE_METHODS):
            forwarded = headers.get("x-forwarded-host", "").split(",")[0].strip()
            if not origin_allowed(origin, host, forwarded, mode):
                reason = "requests from another site aren't accepted"

        if reason is None:
            await self.app(scope, receive, send)
        elif is_websocket:
            await send({"type": "websocket.close", "code": 1008})
        else:
            await JSONResponse({"detail": f"Refused: {reason}."}, status_code=403)(scope, receive, send)
