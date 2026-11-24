"""Test connection (#368): one small request to the saved agent with the saved
key, answered in plain English, and the key never in the answer or the logs.

The HTTP call is mocked at the adapter's opener, so ``_post_json``'s own
error handling (redirects refused, statuses, network errors) is what runs.
"""

from __future__ import annotations

import io
import json
import logging
import urllib.error

import pytest
from app.main import app
from app.services.assistant import agents, keys
from fastapi.testclient import TestClient

SECRET = "sk-test-secret-never-shown-0123456789"
ROUTE = "/api/assistant/test-connection"


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("PSYNEUVIEW_DEPLOYMENT_MODE", raising=False)
    keys.use_store(keys.MemoryStore())
    yield TestClient(app, base_url="http://127.0.0.1")
    keys.use_store(None)


@pytest.fixture
def opener(monkeypatch):
    """Replace the network: ``answer`` is a dict (a 200 with that JSON) or an
    exception to raise. Records every request sent."""
    state = {"answer": {"content": [{"type": "text", "text": "p"}]}, "requests": []}

    def fake_open(request, timeout=None):
        state["requests"].append({
            "url": request.full_url,
            "headers": {k.lower(): v for k, v in request.header_items()},
            "body": json.loads(request.data.decode("utf-8")),
            "timeout": timeout,
        })
        if isinstance(state["answer"], BaseException):
            raise state["answer"]
        return FakeResponse(json.dumps(state["answer"]).encode("utf-8"))

    monkeypatch.setattr(agents._opener, "open", fake_open)
    return state


def http_error(code: int, message: str = "") -> urllib.error.HTTPError:
    body = json.dumps({"error": {"message": message}}).encode("utf-8")
    return urllib.error.HTTPError("https://api.anthropic.com/v1/messages", code, "err", {}, io.BytesIO(body))


def choose(client, agent: dict, *, key: str | None = SECRET):
    r = client.put("/api/assistant/settings", json={"agent": agent, "confirm_raise": True})
    assert r.status_code == 200, r.text
    if key:
        assert client.put("/api/assistant/key", json={"key": key}).status_code == 200


def check(client):
    r = client.post(ROUTE)
    assert r.status_code == 200, r.text
    assert SECRET not in r.text
    return r.json()


def test_success_sends_one_minimal_request(client, opener):
    choose(client, {"type": "anthropic", "model": "claude-test"})
    body = check(client)
    assert body["ok"] is True and body["agent"] == "anthropic" and body["model"] == "claude-test"
    assert isinstance(body["ms"], int)
    assert body["message"].startswith("Connected to Anthropic, model claude-test, in ") and body["message"].endswith(" ms")
    [sent] = opener["requests"]
    assert sent["url"] == "https://api.anthropic.com/v1/messages"
    assert sent["body"] == {"model": "claude-test", "max_tokens": 1, "messages": [{"role": "user", "content": "ping"}]}
    assert "tools" not in sent["body"]
    assert sent["headers"]["x-api-key"] == SECRET
    assert sent["timeout"] == agents.TEST_TIMEOUT_SECONDS


def test_works_while_the_assistant_is_off(client, opener):
    choose(client, {"type": "anthropic"})
    assert client.get("/api/assistant/settings").json()["enabled"] is False
    assert check(client)["ok"] is True


def test_openai_compatible(client, opener):
    choose(client, {"type": "openai_compatible", "base_url": "http://localhost:11434", "model": "llama"}, key=None)
    body = check(client)
    assert body["ok"] is True and body["message"].startswith("Connected to the server at http://localhost:11434, model llama")
    [sent] = opener["requests"]
    assert sent["url"] == "http://localhost:11434/v1/chat/completions"
    assert sent["body"]["max_tokens"] == 1 and "tools" not in sent["body"]
    assert "authorization" not in sent["headers"]


@pytest.mark.parametrize(
    "error, expected",
    [
        (http_error(401, "invalid x-api-key"), "The key was refused (HTTP 401)"),
        (http_error(404, "model: nope"), "The model name isn't recognised: nope"),
        (http_error(429, "rate limit"), "Rate limited or out of credit"),
        (urllib.error.URLError("nodename nor servname provided"), "Couldn't reach api.anthropic.com"),
        (TimeoutError("timed out"), "Couldn't reach api.anthropic.com"),
    ],
)
def test_failures_in_plain_english(client, opener, caplog, error, expected):
    choose(client, {"type": "anthropic", "model": "nope"})
    opener["answer"] = error
    with caplog.at_level(logging.DEBUG):
        body = check(client)
    assert body["ok"] is False
    assert body["message"].startswith(expected), body["message"]
    assert SECRET not in caplog.text


def test_no_key_saved(client, opener):
    choose(client, {"type": "anthropic"}, key=None)
    body = check(client)
    assert body["ok"] is False and "No API key is saved" in body["message"]
    assert opener["requests"] == []


def test_no_agent_chosen(client, opener):
    assert client.put("/api/assistant/key", json={"key": SECRET}).status_code == 200
    body = check(client)
    assert body == {"ok": False, "agent": "none", "model": "", "ms": None, "message": body["message"]}
    assert "No agent is chosen" in body["message"]
    assert opener["requests"] == []


def test_redirect_is_refused(client, opener):
    choose(client, {"type": "anthropic"})
    opener["answer"] = agents.AgentRedirected(302, "http://elsewhere.example/")
    body = check(client)
    assert body["ok"] is False and "redirect" in body["message"]


def test_other_sites_are_refused(client, opener):
    choose(client, {"type": "anthropic"})
    r = client.post(ROUTE, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    assert opener["requests"] == []
