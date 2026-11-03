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
    to show: it never contains the key or the request body."""


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
    raise AgentError("no agent is chosen in Settings")


# ── shared HTTP ──────────────────────────────────────────────────────────


def _post_json(url: str, headers: dict, body: dict) -> dict:
    data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST")
    request.add_header("Content-Type", "application/json")
    for name, value in headers.items():
        request.add_header(name, value)
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            payload = json.loads(e.read().decode("utf-8"))
            detail = str(payload.get("error", {}).get("message") or payload.get("error") or "")[:300]
        except Exception:
            pass
        raise AgentError(f"the agent answered HTTP {e.code}" + (f": {detail}" if detail else "")) from None
    except urllib.error.URLError as e:
        raise AgentError(f"couldn't reach the agent: {e.reason}") from None
    except (ValueError, TimeoutError) as e:
        raise AgentError(f"bad answer from the agent: {type(e).__name__}") from None


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
