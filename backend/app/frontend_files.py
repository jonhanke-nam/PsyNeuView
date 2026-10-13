"""The built page, served with cache headers that let an update show (#2).

The Mac app reuses its last port, so the page keeps one origin, and with it
WebKit's HTTP cache, across launches and app updates. Served without
``Cache-Control``, ``index.html`` could be taken from that cache after an
update, and with it the previous version's scripts: the window showed the old
page against the new server.

So the files that name everything else (``index.html``, ``build-info.json``,
anything outside ``assets/``) must be checked with the server each time, and
the hashed files under ``assets/`` never change and can be kept for good.
"""

from __future__ import annotations

import os

from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

REVALIDATE = "no-cache"
IMMUTABLE = "public, max-age=31536000, immutable"


def cache_control_for(path: str) -> str:
    """The ``Cache-Control`` for a path relative to the build folder."""
    p = path.replace(os.sep, "/").lstrip("./")
    return IMMUTABLE if p.startswith("assets/") else REVALIDATE


class FrontendFiles(StaticFiles):
    """``StaticFiles`` for the page, adding ``Cache-Control`` to every answer."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = cache_control_for(path)
        return response
