"""The AI assistant backend (#179): off by default, every refusal, limits,
Stop, the visibility filter, stale proposals, and the key staying out of
responses, logs and the runner's environment. No network, no key, no agent:
a fake adapter plays the agent."""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time

import pytest
from app.main import app
from app.services import deployment_mode
from app.services.assistant import agents, keys
from app.services.assistant import session as sessions
from app.services.assistant import settings as assistant_settings
from fastapi.testclient import TestClient

SECRET = "sk-test-secret-never-shown-0123456789"


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class FakeAgent:
    """Replies from a script: each item is a (text, [(tool, args), ...])."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []
        self.release = threading.Event()
        self.release.set()

    def reply(self, *, system, history, tools):
        self.release.wait(5)
        self.calls.append({"system": system, "history": history, "tools": tools})
        if not self.script:
            return agents.AgentReply(text="done")
        text, calls = self.script.pop(0)
        return agents.AgentReply(
            text=text, tool_calls=[agents.ToolCall(id=f"c{i}", name=n, args=a) for i, (n, a) in enumerate(calls)],
        )


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_ASSISTANT_LOG", str(tmp_path / "assistant-log.jsonl"))
    monkeypatch.delenv("PSYNEUVIEW_DEPLOYMENT_MODE", raising=False)
    keys.use_store(keys.MemoryStore())
    sessions.reset()
    yield TestClient(app, base_url="http://127.0.0.1")
    sessions.reset()
    keys.use_store(None)


@pytest.fixture
def fake(monkeypatch):
    holder = {"agent": FakeAgent([])}
    monkeypatch.setattr(agents, "make_agent", lambda agent_settings, key: holder["agent"])
    return holder


def turn_on(client, tmp_path, **extra):
    folder = tmp_path / "models"
    folder.mkdir(exist_ok=True)
    body = {"enabled": True, "agent": {"type": "anthropic"}, "confirm_raise": True, **extra}
    r = client.put("/api/assistant/settings", json=body)
    assert r.status_code == 200, r.text
    return folder


def run_turn(client, fake, script, text="hi", context=None):
    fake["agent"] = FakeAgent(script)
    sid = client.post("/api/assistant/sessions").json()["id"]
    r = client.post(f"/api/assistant/sessions/{sid}/messages", json={"text": text, "context": context or {}})
    assert r.status_code == 200, r.text
    return sid, wait_done(client, sid)


def wait_done(client, sid, seconds=5):
    deadline = time.time() + seconds
    events = []
    while time.time() < deadline:
        r = client.get(f"/api/assistant/sessions/{sid}/events?after=0").json()
        events = r["events"]
        if not r["running"] and any(e["type"] == "done" for e in events):
            return events
        time.sleep(0.02)
    raise AssertionError(f"turn never finished: {events}")


# ── off by default, capability ───────────────────────────────────────────


def test_off_by_default(client):
    s = client.get("/api/assistant/settings").json()
    assert s["enabled"] is False and s["agent"]["type"] == "none" and s["folders"] == []
    assert s["autonomy"] == "suggest" and s["visibility"]["files"] is False
    assert s["limits"] == {"tool_calls": 25, "minutes": 10, "max_tokens": 100_000}
    for method, path in [("post", "/api/assistant/sessions"), ("get", "/api/assistant/sessions/x/events"),
                         ("post", "/api/assistant/sessions/x/stop"), ("post", "/api/assistant/proposals/x/accept")]:
        r = getattr(client, method)(path)
        assert r.status_code == 403 and r.json()["detail"]["reason"] == "off", (path, r.text)


def test_capability_off_in_container_and_hosted(client, monkeypatch):
    assert deployment_mode.capabilities(deployment_mode.LOCAL).assistant
    assert deployment_mode.capabilities(deployment_mode.MAC_APP).assistant
    assert not deployment_mode.capabilities(deployment_mode.CONTAINER).assistant
    assert not deployment_mode.capabilities(deployment_mode.HOSTED).assistant
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", "container")
    assert client.get("/api/assistant/settings").json()["available"] is False
    r = client.put("/api/assistant/settings", json={"enabled": True, "confirm_raise": True})
    assert r.status_code == 403 and r.json()["detail"]["reason"] == "unavailable"
    assert client.post("/api/assistant/sessions").status_code == 403
    assert client.put("/api/assistant/key", json={"key": SECRET}).status_code == 403


# ── settings ─────────────────────────────────────────────────────────────


def test_raising_needs_confirmation_lowering_does_not(client, tmp_path):
    r = client.put("/api/assistant/settings", json={"enabled": True})
    assert r.status_code == 409 and "turning the assistant on" in r.json()["detail"]["raised"]
    assert client.get("/api/assistant/settings").json()["enabled"] is False
    turn_on(client, tmp_path, autonomy="app_edits", visibility={"files": True})
    r = client.put("/api/assistant/settings", json={"autonomy": "answer", "visibility": {"files": False}})
    assert r.status_code == 200 and r.json()["autonomy"] == "answer"
    r = client.put("/api/assistant/settings", json={"folders": [{"path": str(tmp_path), "access": "read_write"}]})
    assert r.status_code == 409


def test_settings_reject_bad_values_and_folders(client):
    for body in [{"autonomy": "root"}, {"limits": {"tool_calls": 0}}, {"limits": {"tool_calls": 10_000}},
                 {"agent": {"type": "openai_compatible", "base_url": "http://example.com"}},
                 {"folders": [{"path": "~", "access": "read"}]}, {"folders": [{"path": "/", "access": "read"}]},
                 {"folders": [{"path": "~/.ssh", "access": "read"}]}, {"shell": True}]:
        r = client.put("/api/assistant/settings", json={**body, "confirm_raise": True})
        assert r.status_code == 400, (body, r.text)


def test_base_url_https_or_loopback():
    for ok in ["https://api.example.com/v1", "http://localhost:11434", "http://127.0.0.1:8000"]:
        agents.check_base_url(ok)
    for bad in ["http://example.com", "ftp://x", "http://10.0.0.5:11434", "not a url"]:
        with pytest.raises(assistant_settings.SettingsError):
            agents.check_base_url(bad)


def test_same_site_check(tmp_path):
    keys.use_store(keys.MemoryStore())
    try:
        other_site = TestClient(app, base_url="http://127.0.0.1")
        assert other_site.get("/api/assistant/settings", headers={"origin": "https://evil.example"}).status_code == 403
        assert other_site.get("/api/assistant/settings", headers={"origin": "http://127.0.0.1"}).status_code == 200
        wrong_host = TestClient(app, base_url="http://psyneuview.example.com")
        assert wrong_host.get("/api/assistant/settings").status_code == 403
    finally:
        keys.use_store(None)


# ── key ──────────────────────────────────────────────────────────────────


def test_key_never_in_responses_logs_settings_or_environment(client, tmp_path, fake):
    assert client.get("/api/assistant/key").json() == {"set": False}
    assert client.put("/api/assistant/key", json={"key": SECRET}).json() == {"set": True}
    assert client.get("/api/assistant/key").json() == {"set": True}
    turn_on(client, tmp_path)
    sid, events = run_turn(client, fake, [("hello", [("read_open_model", {})])])
    everything = json.dumps(events) + json.dumps(client.get("/api/assistant/settings").json())
    everything += json.dumps(client.get("/api/assistant/log").json())
    everything += (tmp_path / "user-prefs.json").read_text()
    assert SECRET not in everything
    assert SECRET not in json.dumps(dict(os.environ))
    assert SECRET not in repr(agents.AnthropicAgent(model="m", key=SECRET))
    assert client.delete("/api/assistant/key").json() == {"set": False}


def test_no_secure_store_refuses_to_save(client):
    keys.use_store(keys.RefusingStore())
    r = client.put("/api/assistant/key", json={"key": SECRET})
    assert r.status_code == 501
    assert client.get("/api/assistant/key").json() == {"set": False}


# ── misbehaving agent ────────────────────────────────────────────────────


def test_non_allowlisted_tools_are_refused(client, tmp_path, fake):
    turn_on(client, tmp_path)
    for tool in ["run_model", "shell", "set_settings", "accept_proposal", "fetch_url"]:
        _, events = run_turn(client, fake, [("", [(tool, {"cmd": "rm -rf /"})])])
        refused = [e for e in events if e["type"] == "refused"]
        assert refused and refused[0]["tool"] == tool and refused[0]["reason"] == "no such tool"
        assert events[-1] == {**events[-1], "type": "done", "reason": "finished"}
    # the agent was told, and the settings are unchanged
    assert "Refused" in fake["agent"].calls[-1]["history"][-1]["results"][0]["content"]
    assert client.get("/api/assistant/settings").json()["autonomy"] == "suggest"
    log = client.get("/api/assistant/log").json()["entries"]
    assert all(e["allowed"] is False for e in log) and len(log) == 5


def test_files_outside_folders_and_without_visibility(client, tmp_path, fake):
    folder = turn_on(client, tmp_path)
    outside = tmp_path / "outside.py"
    outside.write_text("import os\n")
    # files not shared: list/read/open refused
    _, events = run_turn(client, fake, [("", [("list_files", {}), ("read_file", {"path": str(folder / "a.py")})])])
    assert [e["tool"] for e in events if e["type"] == "refused"] == ["list_files", "read_file"]
    # shared, but the file is outside every allowed folder; a symlink in doesn't help
    link = folder / "link.py"
    link.symlink_to(outside)
    client.put("/api/assistant/settings", json={"confirm_raise": True, "visibility": {"files": True},
                                                "folders": [{"path": str(folder), "access": "read"}]})
    _, events = run_turn(client, fake, [("", [("read_file", {"path": str(outside)}), ("read_file", {"path": str(link)}),
                                            ("read_file", {"path": str(folder / ".." / "outside.py")}),
                                            ("propose_open_file", {"path": "/etc/passwd"}),
                                            ("propose_file_write", {"path": str(folder / "b.py"), "text": "x", "summary": "s"})])])
    refused = [e for e in events if e["type"] == "refused"]
    assert len(refused) == 5, events
    assert not any(e["type"] == "proposal" for e in events)


def test_app_edit_refused_when_answer_only(client, tmp_path, fake):
    turn_on(client, tmp_path, autonomy="answer")
    _, events = run_turn(client, fake, [("", [("propose_app_edit", {"summary": "s", "ops": [{"op": "update_param", "args": {}}]})])])
    assert [e["type"] for e in events if e["type"] in ("refused", "proposal")] == ["refused"]


def test_tool_call_limit(client, tmp_path, fake):
    turn_on(client, tmp_path, limits={"tool_calls": 2, "minutes": 1})
    _, events = run_turn(client, fake, [("", [("read_open_model", {})] * 3)])
    assert [e["type"] for e in events].count("tool_result") == 2
    assert events[-1]["reason"] == "limit"


def test_time_limit(client, tmp_path, fake, monkeypatch):
    turn_on(client, tmp_path, limits={"tool_calls": 25, "minutes": 1})
    clock = [0.0]
    monkeypatch.setattr(sessions.time, "monotonic", lambda: clock[0])
    script = [("", [("read_open_model", {})])] * 5

    class SlowAgent(FakeAgent):
        def reply(self, **kw):
            clock[0] += 40
            return super().reply(**kw)

    fake["agent"] = SlowAgent(script)
    sid = client.post("/api/assistant/sessions").json()["id"]
    client.post(f"/api/assistant/sessions/{sid}/messages", json={"text": "go"})
    events = wait_done(client, sid)
    assert events[-1]["reason"] == "limit" and len(fake["agent"].calls) <= 3


def test_stop_ends_the_turn_at_once(client, tmp_path, fake):
    turn_on(client, tmp_path)
    fake["agent"] = FakeAgent([("", [("read_open_model", {})])] * 50)
    fake["agent"].release.clear()
    sid = client.post("/api/assistant/sessions").json()["id"]
    client.post(f"/api/assistant/sessions/{sid}/messages", json={"text": "go"})
    assert client.get(f"/api/assistant/sessions/{sid}/events").json()["running"] is True
    client.post(f"/api/assistant/sessions/{sid}/stop")
    fake["agent"].release.set()
    events = wait_done(client, sid)
    assert events[-1]["reason"] == "stopped"
    assert not any(e["type"] == "tool_result" for e in events)


def test_visibility_filter(client, tmp_path, fake):
    turn_on(client, tmp_path)
    context = {"file_path": "/m.py", "source": "SRC", "selection": ["a"], "errors": ["e"], "results": {"x": 1}, "token": "nope"}
    _, events = run_turn(client, fake, [("", [("read_open_model", {})])], context=context)
    seen = json.loads(fake["agent"].calls[-1]["history"][-1]["results"][0]["content"].split("\n", 1)[1])
    assert seen == {"file_path": "/m.py", "source": "SRC", "selection": ["a"], "errors": ["e"]}
    assert sessions.filter_context(context, {"model": False, "selection": False, "errors": False, "results": True}) == {"results": {"x": 1}}


# ── proposals ────────────────────────────────────────────────────────────


def test_stale_app_edit_proposal(client, tmp_path, fake):
    turn_on(client, tmp_path)
    _, events = run_turn(client, fake, [("", [("propose_app_edit", {"summary": "Raise gain", "ops": [{"op": "update_param", "args": {"var_name": "a", "param_name": "gain", "new_value": "2"}}]})])],
                         context={"source": "v1"})
    proposal = [e for e in events if e["type"] == "proposal"][0]["proposal"]
    assert proposal["kind"] == "app_edit" and proposal["base_hash"] == sha("v1") and proposal["state"] == "pending"
    r = client.post(f"/api/assistant/proposals/{proposal['id']}/accept", json={"current_hash": sha("v2")})
    assert r.status_code == 409 and r.json()["detail"]["reason"] == "stale"
    assert client.post(f"/api/assistant/proposals/{proposal['id']}/accept", json={"current_hash": sha("v1")}).status_code == 409


def test_file_write_accept_keeps_previous_and_marks_unreviewed(client, tmp_path, fake):
    folder = turn_on(client, tmp_path)
    target = folder / "model.py"
    target.write_text("old = 1\n")
    client.put("/api/assistant/settings", json={"confirm_raise": True, "visibility": {"files": True},
                                                "folders": [{"path": str(folder), "access": "read_write"}]})
    new_text = "import subprocess\nnew = 2\n"
    _, events = run_turn(client, fake, [("", [("propose_file_write", {"path": str(target), "text": new_text, "summary": "Rewrite"})])])
    proposal = [e for e in events if e["type"] == "proposal"][0]["proposal"]
    assert proposal["kind"] == "file_write" and proposal["freeform_python"] is True
    assert any("subprocess" in w for w in proposal["warnings"]) and any("imports" in w for w in proposal["warnings"])
    assert proposal["before"] == "old = 1\n" and proposal["after"] == new_text
    # the user changed the file meanwhile: stale, nothing written
    target.write_text("old = 3\n")
    r = client.post(f"/api/assistant/proposals/{proposal['id']}/accept", json={"current_hash": sha("old = 3\n")})
    assert r.status_code == 409 and target.read_text() == "old = 3\n"
    # a fresh proposal, accepted
    target.write_text("old = 1\n")
    _, events = run_turn(client, fake, [("", [("propose_file_write", {"path": str(target), "text": new_text, "summary": "Rewrite"})])])
    proposal = [e for e in events if e["type"] == "proposal"][0]["proposal"]
    r = client.post(f"/api/assistant/proposals/{proposal['id']}/accept", json={"current_hash": proposal["base_hash"]})
    assert r.status_code == 200 and r.json()["state"] == "accepted"
    assert target.read_text() == new_text
    from app.services.assistant import files as assistant_files
    from app.services.assistant import review

    assert any(v["name"].endswith(".bak") for v in assistant_files.previous_versions(str(target)))
    assert review.is_tracked(str(target)) and review.is_runnable(str(target), new_text) is False
    log = client.get("/api/assistant/log").json()["entries"]
    assert log[-1]["tool"] == "accept_file_write" and log[-1]["approved_by"] == "user"
    assert new_text not in json.dumps(log)


def test_reject_and_no_accept_tool(client, tmp_path, fake):
    turn_on(client, tmp_path)
    _, events = run_turn(client, fake, [("", [("propose_app_edit", {"summary": "s", "ops": [{"op": "rename_node", "args": {"var_name": "a", "new_name": "b"}}]})])])
    pid = [e for e in events if e["type"] == "proposal"][0]["proposal"]["id"]
    assert client.post(f"/api/assistant/proposals/{pid}/reject").json()["state"] == "rejected"
    from app.services.assistant.tools import TOOL_ALLOWLIST

    assert not any("accept" in t or "run" in t or "setting" in t for t in TOOL_ALLOWLIST)


# ── log ──────────────────────────────────────────────────────────────────


def test_keep_log_off_and_clear(client, tmp_path, fake):
    turn_on(client, tmp_path, keep_log=False)
    run_turn(client, fake, [("", [("read_open_model", {})])])
    assert client.get("/api/assistant/log").json()["entries"] == []
    client.put("/api/assistant/settings", json={"keep_log": True, "confirm_raise": True})
    run_turn(client, fake, [("", [("read_docs", {"query": "assistant"})])])
    entries = client.get("/api/assistant/log").json()["entries"]
    assert len(entries) == 1 and entries[0]["tool"] == "read_docs" and entries[0]["allowed"] is True
    assert client.delete("/api/assistant/log").json()["cleared"] is True
    assert client.get("/api/assistant/log").json()["entries"] == []


def test_agent_error_is_an_event_not_a_crash(client, tmp_path, fake):
    turn_on(client, tmp_path)

    class Broken:
        def reply(self, **kw):
            raise agents.AgentError("couldn't reach the agent")

    fake["agent"] = Broken()
    sid = client.post("/api/assistant/sessions").json()["id"]
    client.post(f"/api/assistant/sessions/{sid}/messages", json={"text": "go"})
    events = wait_done(client, sid)
    assert events[0]["type"] == "error" and events[-1]["reason"] == "finished"
