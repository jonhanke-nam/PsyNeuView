"""The two agent adapters (#179) against a fake HTTP server on loopback.
No real service is called; the server records what it was sent."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from app.services.assistant import agents, tools

SECRET = "sk-fake-key-for-the-adapter-test"


class FakeProvider:
    def __init__(self, response: dict, status: int = 200):
        self.response = response
        self.status = status
        self.requests: list[dict] = []
        provider = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("content-length", 0))
                body = json.loads(self.rfile.read(length) or b"{}")
                provider.requests.append({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body})
                payload = json.dumps(provider.response).encode()
                self.send_response(provider.status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def provider():
    holder = []

    def make(response, status=200):
        p = FakeProvider(response, status)
        holder.append(p)
        return p

    yield make
    for p in holder:
        p.close()


HISTORY = [
    {"role": "user", "text": "hello"},
    {"role": "assistant", "text": "looking", "raw_message": None},
    {"role": "tool_results", "results": [{"id": "c0", "ok": True, "content": "data"}]},
]


def test_anthropic_adapter_sends_key_header_and_parses_tool_use(provider):
    p = provider({
        "stop_reason": "tool_use",
        "content": [{"type": "text", "text": "Let me look."},
                    {"type": "tool_use", "id": "toolu_1", "name": "read_open_model", "input": {}}],
    })
    agent = agents.AnthropicAgent(model="claude-opus-5-5", key=SECRET, base_url=p.url)
    reply = agent.reply(system="sys", history=HISTORY, tools=tools.TOOL_DEFINITIONS)
    assert reply.text == "Let me look."
    assert [(c.id, c.name, c.args) for c in reply.tool_calls] == [("toolu_1", "read_open_model", {})]
    assert reply.raw_message["role"] == "assistant"
    sent = p.requests[0]
    assert sent["path"] == "/v1/messages"
    assert sent["headers"]["x-api-key"] == SECRET and sent["headers"]["anthropic-version"]
    body = sent["body"]
    assert body["model"] == "claude-opus-5-5" and body["system"] == "sys"
    assert [t["name"] for t in body["tools"]] == list(tools.TOOL_ALLOWLIST)
    assert body["messages"][0] == {"role": "user", "content": "hello"}
    assert body["messages"][2]["content"][0]["type"] == "tool_result"
    assert "thinking" not in body  # adaptive by default on the default model


def test_anthropic_adapter_http_error_and_refusal(provider):
    p = provider({"error": {"type": "authentication_error", "message": "invalid x-api-key"}}, status=401)
    agent = agents.AnthropicAgent(model="m", key=SECRET, base_url=p.url)
    with pytest.raises(agents.AgentError) as e:
        agent.reply(system="s", history=HISTORY[:1], tools=[])
    assert "401" in str(e.value) and SECRET not in str(e.value)
    p2 = provider({"stop_reason": "refusal", "content": []})
    with pytest.raises(agents.AgentError, match="declined"):
        agents.AnthropicAgent(model="m", key=SECRET, base_url=p2.url).reply(system="s", history=HISTORY[:1], tools=[])


def test_openai_compatible_adapter(provider):
    p = provider({
        "choices": [{"message": {"role": "assistant", "content": "ok", "tool_calls": [
            {"id": "call_1", "type": "function", "function": {"name": "read_docs", "arguments": json.dumps({"query": "gain"})}},
        ]}}],
    })
    agent = agents.OpenAICompatibleAgent(model="local-model", key=None, base_url=p.url)
    reply = agent.reply(system="sys", history=HISTORY, tools=tools.TOOL_DEFINITIONS)
    assert reply.text == "ok" and reply.tool_calls[0].name == "read_docs" and reply.tool_calls[0].args == {"query": "gain"}
    sent = p.requests[0]
    assert sent["path"] == "/v1/chat/completions" and "authorization" not in sent["headers"]
    body = sent["body"]
    assert body["messages"][0] == {"role": "system", "content": "sys"}
    assert body["messages"][-1] == {"role": "tool", "tool_call_id": "c0", "content": "data"}
    assert body["tools"][0]["type"] == "function"
    # with a key, it goes in the bearer header
    agents.OpenAICompatibleAgent(model="m", key=SECRET, base_url=p.url).reply(system="s", history=HISTORY[:1], tools=[])
    assert p.requests[1]["headers"]["authorization"] == f"Bearer {SECRET}"


def test_openai_compatible_bad_answer(provider):
    p = provider({"unexpected": True})
    with pytest.raises(agents.AgentError, match="no message"):
        agents.OpenAICompatibleAgent(model="m", key=None, base_url=p.url).reply(system="s", history=HISTORY[:1], tools=[])


def test_unreachable_agent():
    agent = agents.OpenAICompatibleAgent(model="m", key=None, base_url="http://127.0.0.1:9")
    with pytest.raises(agents.AgentError, match="couldn't reach"):
        agent.reply(system="s", history=HISTORY[:1], tools=[])


def test_make_agent_needs_key_for_anthropic_only():
    with pytest.raises(agents.AgentError, match="no API key"):
        agents.make_agent({"type": "anthropic"}, key=None)
    assert agents.make_agent({"type": "anthropic"}, key=SECRET).model == agents.DEFAULT_ANTHROPIC_MODEL
    assert isinstance(agents.make_agent({"type": "openai_compatible", "base_url": "http://localhost:1"}, key=None), agents.OpenAICompatibleAgent)
    with pytest.raises(agents.AgentError):
        agents.make_agent({"type": "none"}, key=SECRET)
