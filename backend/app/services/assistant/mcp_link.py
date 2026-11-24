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
- **Last seen**, the client's name and its tool calls in the current limit
  window, for the status line in Settings.
- **The discovery file** (``mcp_discovery.py``), so the MCP command finds
  this backend on whatever port it started on.
"""

from __future__ import annotations

import hmac
import logging
import os
import secrets
import shlex
import sys
import threading
import time
from collections import deque
from pathlib import Path

from app import __version__
from app.services.assistant import keys, mcp_discovery
from app.services.assistant import log as assistant_log
from app.services.assistant import session as sessions

logger = logging.getLogger(__name__)

AGENT_TYPE = "claude_mcp"
TOKEN_ACCOUNT = "mcp-connection-token"
TOKEN_ENV = "PSYNEUVIEW_MCP_TOKEN"
URL_ENV = "PSYNEUVIEW_URL"
#: Set by the Mac app on the backend: a launcher at a path that survives app
#: updates, which the setup text then names (docs/ai-assistant/mcp.md).
LAUNCHER_ENV = "PSYNEUVIEW_MCP_LAUNCHER"
SCRIPT_NAME = "psyneuview-mcp"
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


def status(settings: dict | None = None) -> dict:
    """Connected or not, the client's name, and (given the settings) how
    many tool calls it has made in the current ``limits.minutes`` window."""
    with _lock:
        last = _last_seen
        client = _client_name
    ago = None if last is None else max(0, int(time.time() - last))
    out = {"connected": ago is not None and ago <= CONNECTED_SECONDS, "last_seen": last, "seconds_ago": ago, "client": client}
    if settings is not None:
        out["tool_calls"] = {
            "used": calls_in_window(settings),
            "limit": settings["limits"]["tool_calls"],
            "minutes": settings["limits"]["minutes"],
        }
    return out


# ── the discovery file ───────────────────────────────────────────────────


def startup_port(argv: list[str] | None = None, environ: dict | None = None) -> int:
    """The port uvicorn was told to use (``--port N``, ``--port=N`` or
    ``UVICORN_PORT``), else uvicorn's default. A best guess at start; the
    page's routes correct it from the real request (``claim``)."""
    argv = sys.argv if argv is None else argv
    environ = os.environ if environ is None else environ
    for i, arg in enumerate(argv):
        value = argv[i + 1] if arg == "--port" and i + 1 < len(argv) else arg[7:] if arg.startswith("--port=") else None
        if value is not None and value.isdigit():
            return int(value)
    value = str(environ.get("UVICORN_PORT", "")).strip()
    return int(value) if value.isdigit() else 8000


_claimed_port: int | None = None
_held_mtime: int | None = None


def claim(port: int) -> bool:
    """Write the discovery file for this backend unless another live one
    holds it. Cheap to call often: it touches the disk only when the port
    changed or this backend doesn't hold the file yet."""
    global _claimed_port
    if _claimed_port == port and _holds_file():
        return True
    ok = mcp_discovery.write(port, __version__)
    _claimed_port = port if ok else None
    return ok


def _holds_file() -> bool:
    global _held_mtime
    try:
        st = mcp_discovery.path().stat()
    except OSError:
        return False
    # Re-read only when it changed since last time.
    if _held_mtime == st.st_mtime_ns:
        return True
    held = mcp_discovery._read_raw(mcp_discovery.path())
    if held and held.get("pid") == os.getpid() and held.get("port") == _claimed_port:
        _held_mtime = st.st_mtime_ns
        return True
    return False


def claim_at_start() -> None:
    """At start, when Claude over MCP is the chosen agent. Never raises."""
    try:
        from app.services.assistant import settings as assistant_settings

        if assistant_settings.get_settings()["agent"]["type"] == AGENT_TYPE:
            claim(startup_port())
    except Exception:  # never stop the start
        logger.exception("couldn't write the MCP discovery file")


def release() -> None:
    """At shutdown: remove the file if it still names this backend."""
    global _claimed_port
    mcp_discovery.remove()
    _claimed_port = None


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


def _drop_old(window: float, now: float) -> None:
    while _calls and now - _calls[0] > window:
        _calls.popleft()


def calls_in_window(settings: dict) -> int:
    """Tool calls in the last ``limits.minutes``: what the limit counts."""
    with _lock:
        _drop_old(settings["limits"]["minutes"] * 60, time.monotonic())
        return len(_calls)


def _over_limit(settings: dict) -> str | None:
    window = settings["limits"]["minutes"] * 60
    most = settings["limits"]["tool_calls"]
    now = time.monotonic()
    with _lock:
        _drop_old(window, now)
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


def command() -> tuple[str, list[str], dict]:
    """How Claude should start the MCP command: ``(command, args, extra env)``.

    1. The Mac app's launcher (``PSYNEUVIEW_MCP_LAUNCHER``), a path that
       survives app updates, when it names an executable file;
    2. else the ``psyneuview-mcp`` console script beside this Python, which
       ``pip install -e backend`` puts there;
    3. else ``python -m app.mcp_server``, the fallback.

    In 2 and 3 ``PYTHONPATH`` names this backend, so the command is this
    checkout's code even when the environment's install is another one's.
    """
    launcher = os.environ.get(LAUNCHER_ENV, "").strip()
    if launcher and os.path.isfile(launcher) and os.access(launcher, os.X_OK):
        return launcher, [], {}
    pythonpath = {"PYTHONPATH": str(backend_dir())}
    script = Path(sys.executable).parent / SCRIPT_NAME
    if script.is_file() and os.access(script, os.X_OK):
        return str(script), [], pythonpath
    return sys.executable, ["-m", "app.mcp_server"], pythonpath


def setup(token: str, port: int) -> dict:
    """What the user pastes into Claude Code or Claude Desktop. No address:
    the command finds the running backend through the discovery file, so the
    setup survives PsyNeuView starting on another port. Where the file isn't
    in its usual place (a redirected preferences file), its path is named."""
    import json

    cmd, args, extra = command()
    env = {TOKEN_ENV: token}
    if not mcp_discovery.is_default():
        env[mcp_discovery.DISCOVERY_ENV] = str(mcp_discovery.path())
    env.update(extra)
    env_flags = " ".join(f"-e {shlex.quote(f'{k}={v}')}" for k, v in env.items())
    # The name comes first: -e/--env takes several values, so a name after
    # them is read as one more variable ("Invalid environment variable format").
    claude_code = f"claude mcp add {SERVER_NAME} --transport stdio --scope user {env_flags} -- {' '.join(shlex.quote(a) for a in [cmd, *args])}"
    desktop = json.dumps({"mcpServers": {SERVER_NAME: {"command": cmd, "args": args, "env": env}}}, indent=2)
    return {
        "url": f"http://127.0.0.1:{port}",
        "command": cmd,
        "args": args,
        "env_names": list(env),
        "discovery_file": str(mcp_discovery.path()),
        "claude_code": claude_code,
        "claude_desktop": desktop,
    }


def reset() -> None:
    """Tests: forget the context, the session, last seen and the call window."""
    global _page_context, _session_id, _last_seen, _client_name
    with _lock:
        _page_context = None
        _session_id = None
        _last_seen = None
        _client_name = ""
        _calls.clear()
