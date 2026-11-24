"""PsyNeuView's MCP server (#201), for Claude Desktop and Claude Code.

Run by the Claude program over stdio::

    PSYNEUVIEW_URL=http://127.0.0.1:8000 PSYNEUVIEW_MCP_TOKEN=... python -m app.mcp_server

It is a thin bridge. It holds no model, no settings and no file access of
its own: every tool call goes to the running PsyNeuView backend's token
checked route group (``/api/assistant/mcp-client``), which runs it through
the built-in assistant's own dispatcher, allowlist and checks. Proposals
appear in PsyNeuView's Assistant tab for the user to accept or reject.

The token is sent only to this machine: ``PSYNEUVIEW_URL`` must be plain
``http`` to ``127.0.0.1``, ``::1`` or ``localhost``. Settings ▸ AI assistant
gives the exact command, with the URL and the token filled in.

Only the standard library and the MCP SDK are used here, so it starts fast
and never imports PsyNeuLink.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import quote, urlsplit

import anyio
import mcp_types as types
from mcp.server import Server
from mcp.server.stdio import stdio_server

URL_ENV = "PSYNEUVIEW_URL"
TOKEN_ENV = "PSYNEUVIEW_MCP_TOKEN"
DEFAULT_URL = "http://127.0.0.1:8000"
HEARTBEAT_SECONDS = 30
TIMEOUT_SECONDS = 30
_LOOPBACK = {"127.0.0.1", "::1", "localhost"}

FALLBACK_INSTRUCTIONS = (
    "These tools work with PsyNeuView, a graphical editor for PsyNeuLink models. Changes are proposals the user "
    "accepts or rejects in PsyNeuView's Assistant tab."
)


class BackendError(Exception):
    """PsyNeuView couldn't be reached or refused; the message is for the user."""


#: ``(method, path, json body or None) -> (status, parsed body)``
Transport = Callable[[str, str, Any], Awaitable[tuple[int, Any]]]


def check_url(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme != "http" or (parts.hostname or "") not in _LOOPBACK:
        raise SystemExit(f"{URL_ENV} must be http://127.0.0.1:<port> (this machine only), not {url!r}")
    return url.rstrip("/")


def http_transport(base_url: str, token: str, client_name: Callable[[], str] = lambda: "") -> Transport:
    """Calls the backend with the token, in a worker thread."""
    base_url = check_url(base_url)

    def blocking(method: str, path: str, body: Any) -> tuple[int, Any]:
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(base_url + path, data=data, method=method)
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        name = client_name()
        if name:
            req.add_header("X-PsyNeuView-MCP-Client", name[:80])
        # No proxies: the request must go straight to this machine.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(req, timeout=TIMEOUT_SECONDS) as resp:
                return resp.status, _json(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, _json(e.read())
        except (urllib.error.URLError, OSError) as e:
            raise BackendError(f"PsyNeuView isn't answering at {base_url}. Is it running? ({getattr(e, 'reason', e)})") from None

    async def call(method: str, path: str, body: Any) -> tuple[int, Any]:
        return await anyio.to_thread.run_sync(blocking, method, path, body)

    return call


def _json(raw: bytes) -> Any:
    try:
        return json.loads(raw.decode("utf-8") or "null")
    except (ValueError, UnicodeDecodeError):
        return None


def _refusal(status: int, body: Any) -> str:
    detail = body.get("detail") if isinstance(body, dict) else None
    if isinstance(detail, dict) and detail.get("message"):
        return f"PsyNeuView refused: {detail['message']}"
    if isinstance(detail, str):
        return f"PsyNeuView refused: {detail}"
    return f"PsyNeuView answered HTTP {status}"


def build_server(transport: Transport) -> Server[Any]:
    """The MCP server: the backend's tools, forwarded."""

    async def list_tools(ctx: Any, params: types.PaginatedRequestParams | None) -> types.ListToolsResult:
        status, body = await transport("GET", "/api/assistant/mcp-client/tools", None)
        if status != 200 or not isinstance(body, dict):
            raise BackendError(_refusal(status, body))
        return types.ListToolsResult(
            tools=[types.Tool(name=t["name"], description=t["description"], input_schema=t["input_schema"]) for t in body.get("tools", [])],
        )

    async def call_tool(ctx: Any, params: types.CallToolRequestParams) -> types.CallToolResult:
        try:
            status, body = await transport(
                "POST", f"/api/assistant/mcp-client/tools/{quote(params.name, safe='')}", {"arguments": params.arguments or {}},
            )
        except BackendError as e:
            return _text(str(e), error=True)
        if status != 200 or not isinstance(body, dict):
            return _text(_refusal(status, body), error=True)
        return _text(str(body.get("content", "")), error=not body.get("ok", False))

    return Server(
        "psyneuview",
        title="PsyNeuView",
        instructions=FALLBACK_INSTRUCTIONS,
        on_list_tools=list_tools,
        on_call_tool=call_tool,
    )


def _text(text: str, *, error: bool) -> types.CallToolResult:
    return types.CallToolResult(content=[types.TextContent(type="text", text=text)], is_error=error)


async def heartbeat(transport: Transport) -> None:
    """Say hello now and every ``HEARTBEAT_SECONDS``, so Settings can show
    that a client is connected. A refusal is reported once, on stderr
    (Claude shows it in the server's log), and the loop carries on."""
    last = None
    while True:
        try:
            status, body = await transport("POST", "/api/assistant/mcp-client/hello", None)
            message = None if status == 200 else _refusal(status, body)
        except BackendError as e:
            message = str(e)
        if message and message != last:
            print(f"psyneuview-mcp: {message}", file=sys.stderr, flush=True)
        last = message
        await anyio.sleep(HEARTBEAT_SECONDS)


async def serve_stdio(transport: Transport) -> None:
    server = build_server(transport)
    async with stdio_server() as (read_stream, write_stream):
        async with anyio.create_task_group() as tg:
            tg.start_soon(heartbeat, transport)
            await server.run(read_stream, write_stream, server.create_initialization_options())
            tg.cancel_scope.cancel()


def main() -> None:
    token = os.environ.get(TOKEN_ENV, "").strip()
    if not token:
        raise SystemExit(f"{TOKEN_ENV} is not set. Copy the setup from PsyNeuView's Settings ▸ AI assistant.")
    url = os.environ.get(URL_ENV, DEFAULT_URL)
    anyio.run(serve_stdio, http_transport(url, token, client_name=lambda: "MCP client"))


if __name__ == "__main__":
    main()
