"""Claude over MCP (#201): the backend's side of the connection.

With the agent set to ``claude_mcp``, no agent is called from here. Claude
Desktop or Claude Code, signed in with the user's own subscription, launches
``python -m app.mcp_server`` (``app/mcp_server.py``), which calls the token
checked route group in ``app/api/assistant_mcp_routes.py``. This module holds
what those routes share:

- **The connection token.** Random, made on first use, kept in the Keychain
  like the API key (a second item, ``mcp-connection-token``) and cached in
  this process. The MCP command sends it on every request; without it the
  answer is 401. It is shown to the user only in Settings, to copy into the
  Claude setup. Replacing it disconnects every client set up with the old one.
- **The page's context.** The built-in agent gets the open model with each
  message; here the page sends it whenever it changes (``PUT
  /api/assistant/mcp/context``). It is filtered by ``visibility`` when it
  arrives and again, with the settings as they are then, when a tool reads it.
- **One MCP session**, kept in the session registry so the accept and reject
  routes find its proposals, and so the Assistant tab shows its tool calls and
  proposals like any other session's. Tool calls go through
  ``Session.call_tool``, the built-in agent's own dispatcher: the same
  allowlist, permission checks, events and log.
- **Limits.** There is no turn to end, so ``limits.tool_calls`` applies to
  any ``limits.minutes``-long stretch. ``limits.max_tokens`` doesn't apply:
  PsyNeuView never sees the tokens, which the subscription pays for.
- **Last seen**, for the status line in Settings.
"""

from __future__ import annotations

import hmac
import os
import secrets
import shlex
import sys
import threading
import time
from collections import deque
from pathlib import Path

from app.services.assistant import keys
from app.services.assistant import log as assistant_log
from app.services.assistant import session as sessions

AGENT_TYPE = "claude_mcp"
TOKEN_ACCOUNT = "mcp-connection-token"
TOKEN_ENV = "PSYNEUVIEW_MCP_TOKEN"
URL_ENV = "PSYNEUVIEW_URL"
SERVER_NAME = "psyneuview"
#: A client counts as connected when it was heard from this recently. The
#: MCP command says hello every ``HEARTBEAT_SECONDS``.
CONNECTED_SECONDS = 90
HEARTBEAT_SECONDS = 30

_lock = threading.Lock()
_token_store: keys.KeyStore | None = None
_cached_token: str | None = None
_last_seen: float | None = None
_client_name: str = ""
_page_context: dict | None = None
_session_id: str | None = None
_calls: deque[float] = deque()


# ── the connection token ─────────────────────────────────────────────────


def token_store() -> keys.KeyStore:
    """The Keychain (a second item beside the API key), or memory when the
    key store is (the browser tests)."""
    global _token_store
    if _token_store is None:
        if os.environ.get(keys.STORE_ENV, "").strip().lower() == "memory":
            _token_store = keys.MemoryStore()
        elif sys.platform == "darwin":
            _token_store = keys.MacKeychain(account=TOKEN_ACCOUNT)
        else:
            _token_store = keys.RefusingStore()
    return _token_store


def use_token_store(replacement: keys.KeyStore | None) -> None:
    """Swap the store (tests); ``None`` goes back to the platform default."""
    global _token_store, _cached_token
    with _lock:
        _token_store = replacement
        _cached_token = None


def _read_token() -> str | None:
    global _cached_token
    with _lock:
        if _cached_token is None:
            _cached_token = token_store().get()
        return _cached_token


def get_or_create_token() -> str:
    """The token, made on first use. Raises ``keys.NoSecureStore`` where
    there's nowhere safe to keep it."""
    token = _read_token()
    return token if token else new_token()


def new_token() -> str:
    """A fresh token; any client set up with the old one is refused from now on."""
    global _cached_token
    token = secrets.token_urlsafe(32)
    with _lock:
        token_store().set(token)
        _cached_token = token
    return token


def token_matches(presented: str | None) -> bool:
    """Constant-time comparison; no token stored means nothing matches."""
    expected = _read_token()
    if not expected or not presented:
        return False
    return hmac.compare_digest(presented.encode("utf-8"), expected.encode("utf-8"))


# ── last seen ────────────────────────────────────────────────────────────


def touch(client: str = "") -> None:
    global _last_seen, _client_name
    with _lock:
        _last_seen = time.time()
        if client:
            _client_name = client[:80]


def status() -> dict:
    with _lock:
        last = _last_seen
        client = _client_name
    ago = None if last is None else max(0, int(time.time() - last))
    return {"connected": ago is not None and ago <= CONNECTED_SECONDS, "last_seen": last, "seconds_ago": ago, "client": client}


# ── the page's context ───────────────────────────────────────────────────


def set_page_context(context: dict | None, visibility: dict) -> None:
    global _page_context
    filtered = sessions.filter_context(context, visibility)
    with _lock:
        _page_context = filtered


def page_context() -> dict | None:
    """What the page last shared, or ``None`` if no page has yet."""
    with _lock:
        return None if _page_context is None else dict(_page_context)


# ── the session and its tool calls ───────────────────────────────────────


def session() -> sessions.Session:
    """The one MCP session, made when first needed and remade if the
    registry was cleared."""
    global _session_id
    with _lock:
        sid = _session_id
    if sid is not None:
        try:
            return sessions.get_session(sid)
        except sessions.SessionNotFound:
            pass
    made = sessions.create_session(pinned=True)
    with _lock:
        _session_id = made.id
    return made


def _over_limit(settings: dict) -> str | None:
    window = settings["limits"]["minutes"] * 60
    most = settings["limits"]["tool_calls"]
    now = time.monotonic()
    with _lock:
        while _calls and now - _calls[0] > window:
            _calls.popleft()
        if len(_calls) >= most:
            return f"the tool-call limit is reached ({most} in {settings['limits']['minutes']} minutes; Settings: AI assistant)"
        _calls.append(now)
    return None


def call_tool(name: str, args: object, settings: dict) -> dict:
    """Run one tool for the MCP client: ``{ok, content}``, the same text the
    built-in agent gets back."""
    s = session()
    args = args if isinstance(args, dict) else {}
    limited = _over_limit(settings)
    if limited:
        s.emit("refused", tool=name, reason=limited)
        assistant_log.record(session_id=s.id, tool=name, args=args, allowed=False, summary=limited, approved_by="", keep_log=settings["keep_log"])
        return {"ok": False, "content": f"Refused: {limited}"}
    context = page_context()
    if context is None and name in ("read_open_model", "propose_app_edit"):
        reason = "PsyNeuView isn't open in a browser or the Mac app, so there's no open model yet"
        s.emit("refused", tool=name, reason=reason)
        assistant_log.record(session_id=s.id, tool=name, args=args, allowed=False, summary=reason, approved_by="", keep_log=settings["keep_log"])
        return {"ok": False, "content": f"Refused: {reason}"}
    ok, content = s.call_tool(name, args, context or {}, via="mcp")
    return {"ok": ok, "content": content}


# ── setup text ───────────────────────────────────────────────────────────


def backend_dir() -> Path:
    return Path(__file__).resolve().parents[3]


def setup(token: str, port: int) -> dict:
    """What the user pastes into Claude Code or Claude Desktop."""
    url = f"http://127.0.0.1:{port}"
    python = sys.executable
    env = {URL_ENV: url, TOKEN_ENV: token, "PYTHONPATH": str(backend_dir())}
    args = ["-m", "app.mcp_server"]
    env_flags = " ".join(f"-e {shlex.quote(f'{k}={v}')}" for k, v in env.items())
    # The name comes first: -e/--env takes several values, so a name after
    # them is read as one more variable ("Invalid environment variable format").
    claude_code = f"claude mcp add {SERVER_NAME} --transport stdio --scope user {env_flags} -- {shlex.quote(python)} {' '.join(args)}"
    import json

    desktop = json.dumps({"mcpServers": {SERVER_NAME: {"command": python, "args": args, "env": env}}}, indent=2)
    return {"url": url, "command": python, "args": args, "env_names": list(env), "claude_code": claude_code, "claude_desktop": desktop}


def reset() -> None:
    """Tests: forget the context, the session, last seen and the call window."""
    global _page_context, _session_id, _last_seen, _client_name
    with _lock:
        _page_context = None
        _session_id = None
        _last_seen = None
        _client_name = ""
        _calls.clear()
