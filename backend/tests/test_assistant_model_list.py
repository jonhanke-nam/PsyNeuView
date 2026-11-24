"""The model list (#370): asked of the chosen service with the saved key,
parsed per service, errors in plain English, the key never in the answer or
the logs; and model aliases stored in settings.

The HTTP call is mocked at the adapter's opener, so the shared request
handling (redirects refused, statuses, network errors) is what runs.
"""

from __future__ import annotations

import io
import json
import logging
import urllib.error

import pytest
from app.main import app
from tests.assistant_page import page_client
from app.services.assistant import agents, keys
from fastapi.testclient import TestClient

SECRET = "sk-test-secret-never-shown-0123456789"
ROUTE = "/api/assistant/models"

ANTHROPIC_LIST = {
    "data": [
        {"type": "model", "id": "claude-opus-5-5", "display_name": "Claude Opus 5.5", "created_at": "2026-10-01T00:00:00Z"},
        {"type": "model", "id": "claude-haiku-5", "display_name": "Claude Haiku 5", "created_at": "2026-09-01T00:00:00Z"},
    ],
    "has_more": False,
}
OPENAI_LIST = {"object": "list", "data": [{"id": "llama3.2:latest", "object": "model", "owned_by": "library"}, {"id": "qwen3", "object": "model"}]}


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("PSYNEUVIEW_DEPLOYMENT_MODE", raising=False)
    keys.use_store(keys.MemoryStore())
    yield page_client()
    keys.use_store(None)


@pytest.fixture
def opener(monkeypatch):
    state = {"answer": ANTHROPIC_LIST, "requests": []}

    def fake_open(request, timeout=None):
        state["requests"].append({
            "url": request.full_url, "method": request.get_method(),
            "headers": {k.lower(): v for k, v in request.header_items()}, "timeout": timeout,
        })
        if isinstance(state["answer"], BaseException):
            raise state["answer"]
        return FakeResponse(json.dumps(state["answer"]).encode("utf-8"))

    monkeypatch.setattr(agents._opener, "open", fake_open)
    return state


def http_error(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError("https://api.anthropic.com/v1/models", code, "err", {}, io.BytesIO(b'{"error": {"message": "no"}}'))


def choose(client, agent: dict, *, key: str | None = SECRET):
    assert client.put("/api/assistant/settings", json={"agent": agent}).status_code == 200
    if key:
        assert client.put("/api/assistant/key", json={"key": key}).status_code == 200


def fetch(client) -> dict:
    r = client.get(ROUTE)
    assert r.status_code == 200, r.text
    assert SECRET not in r.text
    return r.json()


def test_anthropic_list_with_the_default_preselected(client, opener):
    choose(client, {"type": "anthropic"})
    body = fetch(client)
    assert body["ok"] is True and body["agent"] == "anthropic"
    assert body["models"] == [
        {"id": "claude-opus-5-5", "display_name": "Claude Opus 5.5"},
        {"id": "claude-haiku-5", "display_name": "Claude Haiku 5"},
    ]
    assert body["default"] == "claude-opus-5-5"
    [sent] = opener["requests"]
    assert sent["method"] == "GET" and sent["url"].startswith("https://api.anthropic.com/v1/models")
    assert sent["headers"]["x-api-key"] == SECRET and sent["timeout"] == agents.TEST_TIMEOUT_SECONDS


def test_anthropic_default_falls_back_to_the_newest(client, opener):
    choose(client, {"type": "anthropic"})
    opener["answer"] = {"data": [{"id": "claude-next", "display_name": "Claude Next"}]}
    assert fetch(client)["default"] == "claude-next"


def test_openai_compatible_and_ollama_lists(client, opener):
    choose(client, {"type": "openai_compatible", "base_url": "http://localhost:11434"}, key=None)
    opener["answer"] = OPENAI_LIST
    body = fetch(client)
    assert body["ok"] is True and body["default"] == ""
    assert body["models"] == [{"id": "llama3.2:latest", "display_name": "llama3.2:latest"}, {"id": "qwen3", "display_name": "qwen3"}]
    [sent] = opener["requests"]
    assert sent["url"] == "http://localhost:11434/v1/models" and "authorization" not in sent["headers"]
    # Ollama's own shape, and junk entries skipped.
    assert agents.parse_models({"models": [{"name": "llama3"}, {"model": "phi4"}, "junk", {"id": 3}]}) == [
        {"id": "llama3", "display_name": "llama3"}, {"id": "phi4", "display_name": "phi4"},
    ]
    assert agents.parse_models(["not", "a", "dict"]) == []


@pytest.mark.parametrize(
    "error, expected",
    [
        (http_error(401), "The key was refused (HTTP 401)"),
        (http_error(404), "api.anthropic.com has no model list (HTTP 404)"),
        (http_error(429), "Rate limited or out of credit"),
        (urllib.error.URLError("nodename nor servname provided"), "Couldn't reach api.anthropic.com"),
        (agents.AgentRedirected(302, "http://elsewhere.example/"), "The agent's server answered with a redirect"),
    ],
)
def test_errors_in_plain_english(client, opener, caplog, error, expected):
    choose(client, {"type": "anthropic"})
    opener["answer"] = error
    with caplog.at_level(logging.DEBUG):
        body = fetch(client)
    assert body["ok"] is False and body["models"] == []
    assert body["message"].startswith(expected), body["message"]
    assert SECRET not in caplog.text


def test_no_key_and_no_agent_send_nothing(client, opener):
    body = fetch(client)
    assert body["ok"] is False and body["message"] == "No agent is chosen."
    choose(client, {"type": "anthropic"}, key=None)
    body = fetch(client)
    assert body["ok"] is False and "No API key is saved" in body["message"]
    assert opener["requests"] == []


def test_other_sites_are_refused(client, opener):
    choose(client, {"type": "anthropic"})
    assert client.get(ROUTE, headers={"Origin": "https://evil.example"}).status_code == 403
    assert opener["requests"] == []


def test_aliases_are_stored_and_checked(client):
    r = client.put("/api/assistant/settings", json={"model_aliases": {"claude-haiku-5": "  fast  ", "claude-opus-5-5": ""}})
    assert r.status_code == 200 and r.json()["model_aliases"] == {"claude-haiku-5": "fast"}
    assert "needs_confirmation" not in r.json()
    assert client.get("/api/assistant/settings").json()["model_aliases"] == {"claude-haiku-5": "fast"}
    for bad in [{"model_aliases": []}, {"model_aliases": {"m": 3}}, {"model_aliases": {"m": "x" * 41}}]:
        assert client.put("/api/assistant/settings", json=bad).status_code == 400, bad
