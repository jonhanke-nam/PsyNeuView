"""The connection to the agent (#179): one small interface, two adapters.

An adapter takes the conversation and the tool definitions, makes one request,
and returns what the model said: text and the tool calls it wants. The session
loop in :mod:`session` runs the tools and calls again; the adapter never runs
anything itself.

* ``anthropic`` — the Claude Messages API, with the key from the keychain.
* ``openai_compatible`` — a chat-completions endpoint at ``base_url``: a local
  model server, or another provider. The key is sent only when one is set.

Both use the standard library's HTTP client, so connecting to an agent adds
no dependency for the supply-chain review to clear. ``base_url`` must be
``https`` unless it is loopback, so model contents never go over plain HTTP
to another machine.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

#: The default Claude model when the user hasn't chosen one.
DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5"
ANTHROPIC_URL = "https://api.anthropic.com"
ANTHROPIC_VERSION = "2023-06-01"
REQUEST_TIMEOUT_SECONDS = 120
MAX_OUTPUT_TOKENS = 8192

_LOOPBACK = {"127.0.0.1", "::1", "localhost"}


def check_base_url(url: str) -> None:
    """``https`` anywhere; plain ``http`` only to this machine."""
    from app.services.assistant.settings import SettingsError

    parsed = urlparse(url)
    if parsed.scheme == "https" and parsed.hostname:
        return
    if parsed.scheme == "http" and (parsed.hostname or "") in _LOOPBACK:
        return
    raise SettingsError("base_url must be https, or http to this machine only (localhost)")


@dataclass
class ToolCall:
    id: str
    name: str
    args: dict


@dataclass
class AgentReply:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    #: The provider's own assistant message, replayed verbatim next turn.
    raw_message: Any = None
    #: Tokens the service reported for this request, input and output, or 0
    #: when it reported none. The session sums them against ``limits.max_tokens``.
    tokens: int = 0


def _usage_tokens(usage: Any, *keys: str) -> int:
    if not isinstance(usage, dict):
        return 0
    total = 0
    for key in keys:
        value = usage.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
            total += int(value)
    return total


class AgentError(Exception):
    """The agent couldn't be reached or answered badly. The message is safe
    to show: it never contains the key or the request body.

    ``status`` is the HTTP status the agent answered with, when it answered
    with an error; ``unreachable`` is true when no answer came at all (no
    network, refused, timed out). Test connection (#368) words its message
    from these."""

    def __init__(self, message: str, *, status: int | None = None, detail: str = "", unreachable: bool = False):
        super().__init__(message)
        self.status = status
        self.detail = detail
        self.unreachable = unreachable


class Agent(Protocol):
    def reply(self, *, system: str, history: list[dict], tools: list[dict]) -> AgentReply: ...


def make_agent(agent_settings: dict, *, key: str | None) -> Agent:
    """Build the adapter the settings name. ``key`` stays inside the adapter."""
    kind = agent_settings.get("type", "none")
    if kind == "anthropic":
        if not key:
            raise AgentError("no API key is set for the Anthropic agent")
        return AnthropicAgent(
            model=agent_settings.get("model") or DEFAULT_ANTHROPIC_MODEL,
            key=key,
            base_url=agent_settings.get("base_url") or ANTHROPIC_URL,
        )
    if kind == "openai_compatible":
        if not agent_settings.get("base_url"):
            raise AgentError("the OpenAI-compatible agent needs a server address (Settings: AI assistant)")
        return OpenAICompatibleAgent(
            model=agent_settings.get("model") or "",
            key=key,
            base_url=agent_settings["base_url"],
        )
    if kind == "claude_mcp":
        raise AgentError("with Claude over MCP, talk to the assistant in Claude Desktop or Claude Code; proposals appear here")
    raise AgentError("no agent is chosen in Settings")


# ── shared HTTP ──────────────────────────────────────────────────────────


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect would resend the key to whatever host the answer names,
    https to http included. The request stops here and the user is told."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise AgentRedirected(code, newurl)


class AgentRedirected(Exception):
    def __init__(self, code: int, where: str):
        self.code = code
        self.where = where
        super().__init__(f"the agent's server answered with a redirect (HTTP {code}); not followed, so the key stays where it was sent")


_opener = urllib.request.build_opener(_NoRedirect())


def _post_json(url: str, headers: dict, body: dict, *, timeout: float = REQUEST_TIMEOUT_SECONDS) -> dict:
    data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST")
    request.add_header("Content-Type", "application/json")
    return _send(request, headers, timeout)


def _get_json(url: str, headers: dict, *, timeout: float = REQUEST_TIMEOUT_SECONDS) -> dict:
    """A GET with the same handling as :func:`_post_json`: redirects
    refused, errors worded without the key (#370, the model list)."""
    return _send(urllib.request.Request(url, method="GET"), headers, timeout)


def _send(request: urllib.request.Request, headers: dict, timeout: float) -> dict:
    for name, value in headers.items():
        request.add_header(name, value)
    try:
        with _opener.open(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except AgentRedirected as e:
        raise AgentError(str(e)) from None
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            payload = json.loads(e.read().decode("utf-8"))
            detail = str(payload.get("error", {}).get("message") or payload.get("error") or "")[:300]
        except Exception:
            pass
        raise AgentError(f"the agent answered HTTP {e.code}" + (f": {detail}" if detail else ""), status=e.code, detail=detail) from None
    except urllib.error.URLError as e:
        raise AgentError(f"couldn't reach the agent: {e.reason}", unreachable=True) from None
    except TimeoutError:
        raise AgentError("couldn't reach the agent: it didn't answer in time", unreachable=True) from None
    except OSError as e:
        raise AgentError(f"couldn't reach the agent: {e.strerror or type(e).__name__}", unreachable=True) from None
    except ValueError as e:
        raise AgentError(f"bad answer from the agent: {type(e).__name__}") from None


# ── Test connection (#368) ───────────────────────────────────────────────

#: Test connection waits this long, not the two minutes a real turn may take.
TEST_TIMEOUT_SECONDS = 15


@dataclass
class ConnectionResult:
    ok: bool
    agent: str
    model: str
    ms: int | None
    message: str

    def as_dict(self) -> dict:
        return {"ok": self.ok, "agent": self.agent, "model": self.model, "ms": self.ms, "message": self.message}


def test_connection(agent_settings: dict, *, key: str | None, timeout: float = TEST_TIMEOUT_SECONDS) -> ConnectionResult:
    """Send one minimal request to the agent the settings name and say, in
    plain English, whether it worked. No tools, one output token, the text
    "ping". The message never contains the key."""
    import time

    kind = agent_settings.get("type", "none")
    if kind == "anthropic":
        model = agent_settings.get("model") or DEFAULT_ANTHROPIC_MODEL
        base = (agent_settings.get("base_url") or ANTHROPIC_URL).rstrip("/")
        name = "Anthropic"
        if not key:
            return ConnectionResult(False, kind, model, None, "No API key is saved. Paste the key and press Save key first.")
        url = f"{base}/v1/messages"
        headers = {"x-api-key": key, "anthropic-version": ANTHROPIC_VERSION}
        body = {"model": model, "max_tokens": 1, "messages": [{"role": "user", "content": "ping"}]}
    elif kind == "openai_compatible":
        model = agent_settings.get("model") or ""
        base = (agent_settings.get("base_url") or "").rstrip("/")
        if not base:
            return ConnectionResult(False, kind, model, None, "No server address is set for the OpenAI-compatible agent.")
        name = f"the server at {base}"
        url = f"{base}/v1/chat/completions"
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        body = {"model": model, "max_tokens": 1, "messages": [{"role": "user", "content": "ping"}]}
    elif kind == "claude_mcp":
        # Nothing to send from here: Claude connects to us (#201).
        from app.services.assistant import mcp_link

        seen = mcp_link.status()
        if seen["connected"]:
            return ConnectionResult(True, kind, "", None, f"Claude is connected (last heard from {seen['seconds_ago']} s ago)")
        return ConnectionResult(False, kind, "", None, "No Claude client is connected yet. Add PsyNeuView in Claude Code or Claude Desktop with the setup below.")
    else:
        return ConnectionResult(False, "none", "", None, "No agent is chosen. Choose one under Which agent first.")

    host = urlparse(url).hostname or base
    model_words = model or "(the server's default)"
    started = time.monotonic()
    try:
        _post_json(url, headers, body, timeout=timeout)
    except AgentError as e:
        ms = int((time.monotonic() - started) * 1000)
        return ConnectionResult(False, kind, model, ms, _connection_message(e, host=host, model=model_words))
    ms = int((time.monotonic() - started) * 1000)
    return ConnectionResult(True, kind, model, ms, f"Connected to {name}, model {model_words}, in {ms} ms")


def _connection_message(e: AgentError, *, host: str, model: str) -> str:
    detail = (e.detail or "").lower()
    if e.unreachable:
        return f"Couldn't reach {host}. Check the network and the server address."
    if e.status in (401, 403):
        return f"The key was refused (HTTP {e.status})"
    if e.status == 404 or (e.status == 400 and "model" in detail):
        return f"The model name isn't recognised: {model}"
    if e.status == 429:
        return "Rate limited or out of credit (HTTP 429)"
    if e.status is not None:
        return f"The agent answered HTTP {e.status}" + (f": {e.detail}" if e.detail else "")
    # A redirect refused, or an answer that wasn't JSON: the message is safe.
    return str(e)[:1].upper() + str(e)[1:]


# ── The model list (#370) ────────────────────────────────────────────────


@dataclass
class ModelList:
    ok: bool
    agent: str
    #: ``[{"id", "display_name"}]``, in the service's order (Anthropic: newest first).
    models: list[dict]
    #: The one to preselect when none is saved, or "" for the server's own.
    default: str
    message: str

    def as_dict(self) -> dict:
        return {"ok": self.ok, "agent": self.agent, "models": self.models, "default": self.default, "message": self.message}


MAX_MODELS = 500


def list_models(agent_settings: dict, *, key: str | None, timeout: float = TEST_TIMEOUT_SECONDS) -> ModelList:
    """Ask the chosen service which models it offers: ``GET /v1/models``
    on Anthropic's API or the OpenAI-compatible server (Ollama answers the
    same path). Only the chosen service is asked, with the saved key, and
    the message never contains the key."""
    kind = agent_settings.get("type", "none")
    if kind == "anthropic":
        base = (agent_settings.get("base_url") or ANTHROPIC_URL).rstrip("/")
        if not key:
            return ModelList(False, kind, [], DEFAULT_ANTHROPIC_MODEL, "No API key is saved, so the list can't be fetched. Paste the key and press Save key.")
        url = f"{base}/v1/models?limit=1000"
        headers = {"x-api-key": key, "anthropic-version": ANTHROPIC_VERSION}
    elif kind == "openai_compatible":
        base = (agent_settings.get("base_url") or "").rstrip("/")
        if not base:
            return ModelList(False, kind, [], "", "No server address is set, so the list can't be fetched.")
        url = f"{base}/v1/models"
        headers = {"Authorization": f"Bearer {key}"} if key else {}
    elif kind == "claude_mcp":
        return ModelList(False, kind, [], "", "The model is chosen in Claude Desktop or Claude Code.")
    else:
        return ModelList(False, "none", [], "", "No agent is chosen.")

    try:
        payload = _get_json(url, headers, timeout=timeout)
    except AgentError as e:
        host = urlparse(url).hostname or base
        message = f"{host} has no model list (HTTP 404)" if e.status == 404 else _connection_message(e, host=host, model="")
        return ModelList(False, kind, [], DEFAULT_ANTHROPIC_MODEL if kind == "anthropic" else "", message)
    models = parse_models(payload)
    if not models:
        return ModelList(False, kind, [], DEFAULT_ANTHROPIC_MODEL if kind == "anthropic" else "", "The service listed no models.")
    ids = [m["id"] for m in models]
    if kind == "anthropic":
        default = DEFAULT_ANTHROPIC_MODEL if DEFAULT_ANTHROPIC_MODEL in ids else ids[0]
    else:
        default = ""
    return ModelList(True, kind, models, default, f"{len(models)} model{'s' if len(models) != 1 else ''} offered.")


def parse_models(payload: Any) -> list[dict]:
    """``{"data": [{"id", "display_name"?}]}`` from either service, or
    Ollama's own ``{"models": [{"name"|"model"}]}``; anything else is
    skipped. Ids and names are plain strings, cut to a sane length."""
    if not isinstance(payload, dict):
        return []
    items = payload.get("data")
    if not isinstance(items, list):
        items = payload.get("models") if isinstance(payload.get("models"), list) else []
    out: list[dict] = []
    seen: set[str] = set()
    for item in items[:MAX_MODELS]:
        if not isinstance(item, dict):
            continue
        model_id = item.get("id") or item.get("model") or item.get("name")
        if not isinstance(model_id, str) or not model_id.strip() or model_id in seen:
            continue
        model_id = model_id.strip()[:200]
        seen.add(model_id)
        name = item.get("display_name")
        out.append({"id": model_id, "display_name": name.strip()[:200] if isinstance(name, str) and name.strip() else model_id})
    return out


# ── Anthropic ────────────────────────────────────────────────────────────


class AnthropicAgent:
    def __init__(self, *, model: str, key: str, base_url: str = ANTHROPIC_URL):
        self.model = model
        self._key = key
        self._base_url = base_url.rstrip("/")

    def __repr__(self) -> str:  # never show the key
        return f"AnthropicAgent(model={self.model!r})"

    def reply(self, *, system: str, history: list[dict], tools: list[dict]) -> AgentReply:
        body = {
            "model": self.model,
            "max_tokens": MAX_OUTPUT_TOKENS,
            "system": system,
            "messages": [self._message(m) for m in history],
            "tools": [
                {"name": t["name"], "description": t["description"], "input_schema": t["input_schema"]}
                for t in tools
            ],
        }
        headers = {"x-api-key": self._key, "anthropic-version": ANTHROPIC_VERSION}
        payload = _post_json(f"{self._base_url}/v1/messages", headers, body)
        if payload.get("stop_reason") == "refusal":
            raise AgentError("the agent declined this request")
        reply = AgentReply(
            raw_message={"role": "assistant", "content": payload.get("content", [])},
            tokens=_usage_tokens(payload.get("usage"), "input_tokens", "output_tokens"),
        )
        for block in payload.get("content", []):
            if block.get("type") == "text":
                reply.text += block.get("text", "")
            elif block.get("type") == "tool_use":
                args = block.get("input")
                reply.tool_calls.append(ToolCall(id=block["id"], name=block["name"], args=args if isinstance(args, dict) else {}))
        return reply

    @staticmethod
    def _message(m: dict) -> dict:
        """Turn the session's neutral history into Messages API shape."""
        if m["role"] == "assistant":
            return m["raw_message"] if m.get("raw_message") else {"role": "assistant", "content": m.get("text", "") or "(no reply)"}
        if m["role"] == "tool_results":
            return {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": r["id"], "content": r["content"], "is_error": not r["ok"]}
                    for r in m["results"]
                ],
            }
        return {"role": "user", "content": m["text"]}


# ── OpenAI-compatible ────────────────────────────────────────────────────


class OpenAICompatibleAgent:
    def __init__(self, *, model: str, key: str | None, base_url: str):
        self.model = model
        self._key = key
        self._base_url = base_url.rstrip("/")

    def __repr__(self) -> str:
        return f"OpenAICompatibleAgent(model={self.model!r}, base_url={self._base_url!r})"

    def reply(self, *, system: str, history: list[dict], tools: list[dict]) -> AgentReply:
        messages: list[dict] = [{"role": "system", "content": system}]
        for m in history:
            messages.extend(self._messages(m))
        body = {
            "model": self.model,
            "messages": messages,
            "tools": [
                {"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["input_schema"]}}
                for t in tools
            ],
        }
        headers = {"Authorization": f"Bearer {self._key}"} if self._key else {}
        payload = _post_json(f"{self._base_url}/v1/chat/completions", headers, body)
        try:
            message = payload["choices"][0]["message"]
        except (KeyError, IndexError, TypeError):
            raise AgentError("the agent's answer had no message") from None
        usage = payload.get("usage")
        tokens = _usage_tokens(usage, "total_tokens") or _usage_tokens(usage, "prompt_tokens", "completion_tokens")
        reply = AgentReply(text=message.get("content") or "", raw_message=message, tokens=tokens)
        for call in message.get("tool_calls") or []:
            function = call.get("function", {})
            try:
                args = json.loads(function.get("arguments") or "{}")
            except ValueError:
                args = {}
            reply.tool_calls.append(ToolCall(id=call.get("id", ""), name=function.get("name", ""), args=args if isinstance(args, dict) else {}))
        return reply

    @staticmethod
    def _messages(m: dict) -> list[dict]:
        if m["role"] == "assistant":
            return [m["raw_message"] if m.get("raw_message") else {"role": "assistant", "content": m.get("text", "")}]
        if m["role"] == "tool_results":
            return [{"role": "tool", "tool_call_id": r["id"], "content": r["content"]} for r in m["results"]]
        return [{"role": "user", "content": m["text"]}]
