"""Claude over MCP (#201): the token checked route group, and the MCP server
driven in-process with the MCP SDK's own client.

The connection token is required (401 without it); only this machine, and
never a web page, reaches the group; it answers only while the assistant is
on with Claude over MCP chosen; its tools are exactly the built-in agent's,
through the same dispatcher; proposals wait for the user; nothing it writes
runs before review; and no MCP route reads or changes settings, reads the
key, or accepts a proposal.
"""

from __future__ import annotations

import hashlib
import json

import anyio
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.mcp_server import build_server, check_url
from app.services.assistant import keys, mcp_link
from app.services.assistant import session as sessions
from app.services.assistant import tools as assistant_tools

LOCAL = ("127.0.0.1", 50000)
SOURCE = "import psyneulink as pnl\nA = pnl.TransferMechanism(name='A')\n"
SECRET = "sk-test-secret-never-shown-0123456789"


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@pytest.fixture
def page(tmp_path, monkeypatch):
    """The app's own page (same site, as the browser tests' client)."""
    monkeypatch.setenv("PSYNEUVIEW_ASSISTANT_LOG", str(tmp_path / "assistant-log.jsonl"))
    monkeypatch.delenv("PSYNEUVIEW_DEPLOYMENT_MODE", raising=False)
    keys.use_store(keys.MemoryStore())
    mcp_link.use_token_store(keys.MemoryStore())
    sessions.reset()
    mcp_link.reset()
    yield TestClient(app, base_url="http://127.0.0.1", client=LOCAL)
    sessions.reset()
    mcp_link.reset()
    keys.use_store(None)
    mcp_link.use_token_store(None)


def mcp_client(token: str | None, *, peer=LOCAL, base_url="http://127.0.0.1") -> TestClient:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return TestClient(app, base_url=base_url, client=peer, headers=headers)


def token_of(page: TestClient) -> str:
    return page.get("/api/assistant/mcp/setup").json()["token"]


def turn_on_mcp(page: TestClient, tmp_path, **extra) -> None:
    body = {"enabled": True, "agent": {"type": "claude_mcp"}, "confirm_raise": True, **extra}
    r = page.put("/api/assistant/settings", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["agent"]["type"] == "claude_mcp"


def share(page: TestClient, context: dict) -> None:
    r = page.put("/api/assistant/mcp/context", json={"context": context})
    assert r.status_code == 200, r.text


def call(client: TestClient, name: str, arguments: dict | None = None):
    return client.post(f"/api/assistant/mcp-client/tools/{name}", json={"arguments": arguments or {}})


# ── the token, the machine, the state ────────────────────────────────────


def test_token_is_required(page, tmp_path):
    token = token_of(page)
    assert len(token) >= 40
    turn_on_mcp(page, tmp_path)
    for client in (mcp_client(None), mcp_client("not-the-token"), mcp_client(token[:-1] + "x")):
        for method, path in [("get", "/api/assistant/mcp-client/tools"), ("post", "/api/assistant/mcp-client/hello"),
                             ("post", "/api/assistant/mcp-client/tools/read_open_model")]:
            r = getattr(client, method)(path)
            assert r.status_code == 401, (path, r.text)
            assert r.json()["detail"]["reason"] == "bad_token"
            assert r.headers["www-authenticate"].startswith("Bearer")
    assert mcp_client(token).get("/api/assistant/mcp-client/tools").status_code == 200


def test_no_token_stored_means_nothing_matches(page, tmp_path):
    turn_on_mcp(page, tmp_path)
    # No setup was ever shown, so no token exists: even an empty one is refused.
    assert mcp_client("").get("/api/assistant/mcp-client/tools").status_code == 401
    assert mcp_client("None").get("/api/assistant/mcp-client/tools").status_code == 401


def test_a_new_token_refuses_the_old_one(page, tmp_path):
    old = token_of(page)
    turn_on_mcp(page, tmp_path)
    new = page.post("/api/assistant/mcp/token").json()["token"]
    assert new != old
    assert mcp_client(old).get("/api/assistant/mcp-client/tools").status_code == 401
    assert mcp_client(new).get("/api/assistant/mcp-client/tools").status_code == 200
    assert token_of(page) == new


def test_localhost_only_and_never_a_web_page(page, tmp_path):
    token = token_of(page)
    turn_on_mcp(page, tmp_path)
    other_machine = mcp_client(token, peer=("192.168.1.20", 50000))
    r = other_machine.get("/api/assistant/mcp-client/tools")
    assert r.status_code == 403 and r.json()["detail"]["reason"] == "not_local"
    wrong_host = mcp_client(token, base_url="http://psyneuview.example.com")
    assert wrong_host.get("/api/assistant/mcp-client/tools").status_code == 403
    # A browser always sends Origin; even this server's own page may not use the group.
    for origin in ("http://127.0.0.1", "https://evil.example"):
        r = mcp_client(token).get("/api/assistant/mcp-client/tools", headers={"origin": origin})
        assert r.status_code == 403, origin


def test_only_while_on_with_claude_over_mcp_chosen(page, tmp_path):
    token = token_of(page)
    client = mcp_client(token)
    r = client.get("/api/assistant/mcp-client/tools")
    assert r.status_code == 403 and r.json()["detail"]["reason"] == "off"
    page.put("/api/assistant/settings", json={"enabled": True, "agent": {"type": "anthropic"}, "confirm_raise": True})
    r = client.get("/api/assistant/mcp-client/tools")
    assert r.status_code == 403 and r.json()["detail"]["reason"] == "not_chosen"
    page.put("/api/assistant/settings", json={"agent": {"type": "claude_mcp"}, "confirm_raise": True})
    assert client.get("/api/assistant/mcp-client/tools").status_code == 200
    page.put("/api/assistant/settings", json={"enabled": False})
    assert client.post("/api/assistant/mcp-client/tools/read_docs", json={"arguments": {"query": "x"}}).status_code == 403


def test_choosing_claude_over_mcp_while_on_asks_first(page, tmp_path):
    page.put("/api/assistant/settings", json={"enabled": True, "agent": {"type": "openai_compatible", "base_url": "http://localhost:11434/v1"}, "confirm_raise": True})
    r = page.put("/api/assistant/settings", json={"agent": {"type": "claude_mcp"}})
    assert r.json().get("needs_confirmation") is True
    assert "Claude Desktop or Claude Code" in " ".join(r.json()["raised"])


def test_status_shows_last_seen(page, tmp_path):
    token = token_of(page)
    turn_on_mcp(page, tmp_path)
    before = page.get("/api/assistant/mcp/status").json()
    assert before["connected"] is False and before["last_seen"] is None and before["active"] is True
    mcp_client(token).post("/api/assistant/mcp-client/hello", headers={"X-PsyNeuView-MCP-Client": "claude-code"})
    after = page.get("/api/assistant/mcp/status").json()
    assert after["connected"] is True and after["client"] == "claude-code" and after["session_id"]


# ── the tools ────────────────────────────────────────────────────────────


def test_tools_are_the_built_in_agents(page, tmp_path):
    token = token_of(page)
    turn_on_mcp(page, tmp_path)
    tools = mcp_client(token).get("/api/assistant/mcp-client/tools").json()["tools"]
    assert tools == assistant_tools.TOOL_DEFINITIONS
    assert tuple(t["name"] for t in tools) == assistant_tools.TOOL_ALLOWLIST


def test_read_open_model_respects_visibility(page, tmp_path):
    token = token_of(page)
    turn_on_mcp(page, tmp_path)
    client = mcp_client(token)
    r = call(client, "read_open_model").json()
    assert r["ok"] is False and "isn't open" in r["content"]
    share(page, {"file_path": "/m/model.py", "source": SOURCE, "selection": "A", "errors": [], "results": {"secret": 1}, "extra": 1})
    content = call(client, "read_open_model").json()["content"]
    assert content.startswith("[untrusted data")
    seen = json.loads(content.split("\n", 1)[1])
    assert seen == {"file_path": "/m/model.py", "source": SOURCE, "selection": "A", "errors": []}
    # Lowered after the page shared it: applies at once.
    page.put("/api/assistant/settings", json={"visibility": {"model": False}})
    seen = json.loads(call(client, "read_open_model").json()["content"].split("\n", 1)[1])
    assert "source" not in seen and "file_path" not in seen


def test_propose_makes_a_pending_proposal_in_the_assistant_tab(page, tmp_path):
    token = token_of(page)
    turn_on_mcp(page, tmp_path)
    share(page, {"file_path": "/m/model.py", "source": SOURCE})
    ops = [{"op": "update_param", "args": {"var_name": "A", "param_name": "noise", "new_value": "0.5"}}]
    r = call(mcp_client(token), "propose_app_edit", {"summary": "More noise", "ops": ops}).json()
    assert r["ok"] is True
    proposal_id = json.loads(r["content"].split("\n", 1)[1])["proposal_id"]
    sid = page.get("/api/assistant/mcp/status").json()["session_id"]
    events = page.get(f"/api/assistant/sessions/{sid}/events?after=0").json()["events"]
    proposals = [e["proposal"] for e in events if e["type"] == "proposal"]
    assert proposals[-1]["id"] == proposal_id and proposals[-1]["state"] == "pending"
    assert proposals[-1]["base_hash"] == sha(SOURCE)
    assert any(e["type"] == "tool_call" and e.get("via") == "mcp" for e in events)
    # Only the page accepts it.
    assert page.post(f"/api/assistant/proposals/{proposal_id}/accept", json={"current_hash": sha(SOURCE)}).json()["state"] == "accepted"


def test_cannot_approve_change_settings_or_read_the_key(page, tmp_path):
    page.put("/api/assistant/key", json={"key": SECRET})
    token = token_of(page)
    turn_on_mcp(page, tmp_path)
    client = mcp_client(token)
    for name in ("accept_proposal", "approve", "update_settings", "put_settings", "get_key", "run_model", "review_approve"):
        r = call(client, name).json()
        assert r == {"ok": False, "content": "Refused: no such tool"}, name
    for method, path in [("get", "/api/assistant/mcp-client/settings"), ("put", "/api/assistant/mcp-client/settings"),
                         ("get", "/api/assistant/mcp-client/key"), ("post", "/api/assistant/mcp-client/proposals/x/accept"),
                         ("post", "/api/assistant/mcp-client/review/approve"), ("post", "/api/assistant/mcp-client/token")]:
        assert getattr(client, method)(path).status_code in (404, 405), path
    # The page's MCP routes are same-site: the MCP client's token doesn't open them to a web page.
    assert page.get("/api/assistant/mcp/setup", headers={"origin": "https://evil.example"}).status_code == 403
    assert page.put("/api/assistant/mcp/context", json={"context": {}}, headers={"origin": "https://evil.example"}).status_code == 403
    assert SECRET not in json.dumps(page.get("/api/assistant/mcp/setup").json())


def test_nothing_it_writes_runs_before_review(page, tmp_path):
    folder = tmp_path / "models"
    folder.mkdir()
    target = folder / "model.py"
    target.write_text(SOURCE)
    token = token_of(page)
    turn_on_mcp(page, tmp_path, visibility={"files": True}, folders=[{"path": str(folder), "access": "read_write"}])
    client = mcp_client(token)
    new_text = SOURCE + "import subprocess\n"
    r = call(client, "propose_file_write", {"path": str(target), "text": new_text, "summary": "Rewrite"}).json()
    assert r["ok"] is True and target.read_text() == SOURCE  # a proposal, nothing written
    proposal_id = json.loads(r["content"].split("\n", 1)[1])["proposal_id"]
    r = page.post(f"/api/assistant/proposals/{proposal_id}/accept", json={"current_hash": sha(SOURCE)})
    assert r.status_code == 200 and target.read_text() == new_text
    from app.services.assistant import review

    assert review.is_runnable(str(target), new_text) is False
    r = page.post("/api/model/load", json={"file_path": str(target)})
    assert r.status_code == 409 and "unreviewed" in json.dumps(r.json())


def test_tool_call_limit_applies(page, tmp_path):
    token = token_of(page)
    turn_on_mcp(page, tmp_path, limits={"tool_calls": 2, "minutes": 10, "max_tokens": 1000})
    client = mcp_client(token)
    assert call(client, "read_docs", {"query": "assistant"}).json()["ok"] is True
    assert call(client, "read_docs", {"query": "assistant"}).json()["ok"] is True
    r = call(client, "read_docs", {"query": "assistant"}).json()
    assert r["ok"] is False and "limit" in r["content"]


def test_the_mcp_command_sends_the_token_only_to_this_machine():
    assert check_url("http://127.0.0.1:8353") == "http://127.0.0.1:8353"
    for bad in ("https://127.0.0.1:8353", "http://example.com:8353", "http://192.168.1.2:80", "file:///x"):
        with pytest.raises(SystemExit):
            check_url(bad)


# ── the MCP server, through the SDK's own client ─────────────────────────


def test_mcp_server_in_process(page, tmp_path):
    """List the tools, read the model, propose an edit: a proposal appears."""
    from mcp import Client

    token = token_of(page)
    turn_on_mcp(page, tmp_path)
    share(page, {"file_path": "/m/model.py", "source": SOURCE, "selection": "A"})
    backend = mcp_client(token)

    async def transport(method: str, path: str, body):
        def blocking():
            r = backend.request(method, path, json=body)
            return r.status_code, r.json()

        return await anyio.to_thread.run_sync(blocking)

    async def scenario():
        async with Client(build_server(transport)) as client:
            listed = await client.list_tools()
            names = [t.name for t in listed.tools]
            assert tuple(names) == assistant_tools.TOOL_ALLOWLIST
            read = await client.call_tool("read_open_model", {})
            assert not read.is_error and "TransferMechanism" in read.content[0].text
            ops = [{"op": "rename_node", "args": {"var_name": "A", "new_name": "Input layer"}}]
            proposed = await client.call_tool("propose_app_edit", {"summary": "Rename A", "ops": ops})
            assert not proposed.is_error, proposed.content[0].text
            refused = await client.call_tool("approve_proposal", {"id": "x"})
            assert refused.is_error and "no such tool" in refused.content[0].text
            return json.loads(proposed.content[0].text.split("\n", 1)[1])["proposal_id"]

    proposal_id = anyio.run(scenario)
    sid = page.get("/api/assistant/mcp/status").json()["session_id"]
    events = page.get(f"/api/assistant/sessions/{sid}/events?after=0").json()["events"]
    pending = [e["proposal"] for e in events if e["type"] == "proposal" and e["proposal"]["id"] == proposal_id]
    assert pending and pending[-1]["state"] == "pending" and pending[-1]["kind"] == "app_edit"


def test_mcp_server_reports_a_bad_token(page, tmp_path):
    from mcp import Client

    token_of(page)
    turn_on_mcp(page, tmp_path)
    backend = mcp_client("wrong")

    async def transport(method, path, body):
        r = await anyio.to_thread.run_sync(lambda: backend.request(method, path, json=body))
        return r.status_code, r.json()

    async def scenario():
        async with Client(build_server(transport)) as client:
            result = await client.call_tool("read_open_model", {})
            assert result.is_error and "token" in result.content[0].text

    anyio.run(scenario)


def test_claude_code_setup_line_puts_the_name_before_the_env_flags():
    """-e takes several values: a name after it is read as a variable (#201)."""
    from app.services.assistant import mcp_link
    line = mcp_link.setup("tok", 8353)["claude_code"]
    assert line.startswith("claude mcp add psyneuview ")
    assert line.index(" -- ") > line.rindex("-e ")
    assert " --env " not in line



def test_a_refused_tool_list_reaches_claude_with_its_reason():
    """Claude sees why, not "Internal server error" (#201): e.g. the wrong agent chosen."""
    from mcp import Client, MCPError

    async def refused(method: str, path: str, body):
        return 403, {"detail": {"reason": "not_chosen", "message": "Which agent isn't set to Claude over MCP"}}

    async def scenario():
        async with Client(build_server(refused)) as client:
            with pytest.raises(MCPError, match="Which agent isn't set to Claude over MCP"):
                await client.list_tools()

    anyio.run(scenario)


# ── finding the running backend: the discovery file ──────────────────────


def _dead_pid() -> int:
    import subprocess
    import sys

    proc = subprocess.Popen([sys.executable, "-c", "pass"])
    proc.wait()
    return proc.pid


@pytest.fixture
def discovery(tmp_path, monkeypatch):
    from app.services.assistant import mcp_discovery

    target = tmp_path / "state" / "mcp-backend.json"
    monkeypatch.setenv(mcp_discovery.DISCOVERY_ENV, str(target))
    return target


def test_discovery_file_is_for_the_user_only_and_names_this_backend(discovery):
    import os
    import stat

    from app.services.assistant import mcp_discovery

    old = os.umask(0)  # even with a permissive umask
    try:
        assert mcp_discovery.write(8393, "1.2.3") is True
    finally:
        os.umask(old)
    assert stat.S_IMODE(discovery.stat().st_mode) == 0o600
    data = json.loads(discovery.read_text())
    assert data["pid"] == os.getpid() and data["port"] == 8393 and data["host"] == "127.0.0.1"
    assert "token" not in json.dumps(data).lower()
    assert mcp_discovery.find_url() == "http://127.0.0.1:8393"
    assert not list(discovery.parent.glob(".*.tmp"))  # written whole, then moved into place


def test_discovery_refuses_a_file_others_can_read_or_write(discovery):
    import os

    from app.services.assistant import mcp_discovery

    mcp_discovery.write(8393)
    os.chmod(discovery, 0o644)
    with pytest.raises(mcp_discovery.NotFound, match="readable by you only"):
        mcp_discovery.find_url()
    os.chmod(discovery, 0o600)
    real = discovery.with_name("real.json")
    discovery.rename(real)
    discovery.symlink_to(real)
    with pytest.raises(mcp_discovery.NotFound, match="isn't a plain file"):
        mcp_discovery.find_url()


def test_discovery_says_plainly_when_psyneuview_has_stopped(discovery):
    import os

    from app.mcp_server import BackendError, discovered_url
    from app.services.assistant import mcp_discovery

    with pytest.raises(BackendError, match="doesn't seem to be running"):
        discovered_url()
    dead = _dead_pid()
    mcp_discovery.write(8393, pid=dead, force=True)
    with pytest.raises(BackendError, match=f"process {dead}, has stopped"):
        discovered_url()
    # A file that names another machine is refused, whatever the pid.
    discovery.write_text(json.dumps({"pid": os.getpid(), "port": 8393, "host": "10.0.0.5"}))
    os.chmod(discovery, 0o600)
    with pytest.raises(BackendError, match="not this machine"):
        discovered_url()


def test_one_live_holder_and_a_stale_one_is_replaced(discovery):
    import os

    from app.services.assistant import mcp_discovery

    me = os.getpid()
    parent = os.getppid()  # alive, and not this process
    assert mcp_discovery.write(8001, pid=parent) is True
    assert mcp_discovery.write(8002, pid=me) is False  # the live holder keeps it
    assert json.loads(discovery.read_text())["port"] == 8001
    mcp_discovery.remove(pid=me)  # not ours: left alone
    assert discovery.exists()
    mcp_discovery.write(8001, pid=_dead_pid(), force=True)
    assert mcp_discovery.write(8002, pid=me) is True  # the holder stopped: taken over
    assert mcp_discovery.find_url() == "http://127.0.0.1:8002"
    mcp_discovery.remove(pid=me)
    assert not discovery.exists()


def test_the_backend_claims_the_file_at_start_and_releases_it(page, tmp_path, monkeypatch, discovery):
    """With Claude over MCP chosen, starting the app writes the file and stopping it removes it."""
    turn_on_mcp(page, tmp_path)
    monkeypatch.setattr("sys.argv", ["uvicorn", "app.main:app", "--port", "8393"])
    with TestClient(app, base_url="http://127.0.0.1", client=LOCAL):
        assert json.loads(discovery.read_text())["port"] == 8393
    assert not discovery.exists()


def test_the_status_route_corrects_the_port_from_the_real_request(page, tmp_path, discovery):
    from app.services.assistant import mcp_discovery

    turn_on_mcp(page, tmp_path)
    mcp_link.claim(1234)  # a wrong guess at start
    TestClient(app, base_url="http://127.0.0.1:8393", client=LOCAL).get("/api/assistant/mcp/status")
    assert mcp_discovery.find_url() == "http://127.0.0.1:8393"
    mcp_link.release()


def test_startup_port_reads_uvicorns_arguments():
    assert mcp_link.startup_port(["uvicorn", "app.main:app", "--port", "8130"], {}) == 8130
    assert mcp_link.startup_port(["uvicorn", "app.main:app", "--port=9000"], {}) == 9000
    assert mcp_link.startup_port(["uvicorn"], {"UVICORN_PORT": "8500"}) == 8500
    assert mcp_link.startup_port(["uvicorn"], {}) == 8000


def test_setup_names_no_address(monkeypatch, tmp_path):
    from app.services.assistant import mcp_discovery

    monkeypatch.delenv(mcp_discovery.DISCOVERY_ENV, raising=False)
    monkeypatch.delenv(mcp_discovery.CONFIG_ENV, raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    out = mcp_link.setup("tok", 8393)
    assert "PSYNEUVIEW_URL" not in out["claude_code"] and "PSYNEUVIEW_URL" not in out["claude_desktop"]
    assert "8393" not in out["claude_code"] and "8393" not in out["claude_desktop"]
    assert out["env_names"][0] == "PSYNEUVIEW_MCP_TOKEN" and mcp_discovery.DISCOVERY_ENV not in out["env_names"]
    # A redirected preferences file (a test or trial backend): the setup names where to look.
    monkeypatch.setenv(mcp_discovery.CONFIG_ENV, str(tmp_path / "trial" / "config.json"))
    out = mcp_link.setup("tok", 8393)
    assert json.loads(out["claude_desktop"])["mcpServers"]["psyneuview"]["env"][mcp_discovery.DISCOVERY_ENV] == str(tmp_path / "trial" / "mcp-backend.json")


def test_the_mcp_command_finds_the_backend_through_the_file(page, tmp_path, discovery, monkeypatch):
    """No PSYNEUVIEW_URL: the transport looks the backend up for each request."""
    from app import mcp_server
    from app.services.assistant import mcp_discovery

    seen = []

    class Reply:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{"ok": true}'

    class Opener:
        def open(self, req, timeout):
            seen.append(req.full_url)
            return Reply()

    monkeypatch.setattr(mcp_server.urllib.request, "build_opener", lambda *a: Opener())
    call = mcp_server.http_transport(mcp_server.discovered_url, "tok")
    mcp_discovery.write(8393)
    assert anyio.run(call, "POST", "/api/assistant/mcp-client/hello", None) == (200, {"ok": True})
    mcp_discovery.write(8394, force=True)  # PsyNeuView restarted on another port
    anyio.run(call, "POST", "/api/assistant/mcp-client/hello", None)
    assert seen == ["http://127.0.0.1:8393/api/assistant/mcp-client/hello", "http://127.0.0.1:8394/api/assistant/mcp-client/hello"]


# ── check_proposal: read-only ────────────────────────────────────────────


def _propose(client: TestClient) -> str:
    ops = [{"op": "update_param", "args": {"var_name": "A", "param_name": "noise", "new_value": "0.5"}}]
    r = call(client, "propose_app_edit", {"summary": "More noise", "ops": ops}).json()
    assert r["ok"] is True, r
    return json.loads(r["content"].split("\n", 1)[1])["proposal_id"]


def _state(client: TestClient, proposal_id: str) -> dict:
    r = call(client, "check_proposal", {"id": proposal_id}).json()
    assert r["ok"] is True, r
    return json.loads(r["content"].split("\n", 1)[1])


def test_check_proposal_follows_the_users_decision_and_changes_nothing(page, tmp_path):
    token = token_of(page)
    turn_on_mcp(page, tmp_path)
    share(page, {"file_path": "/m/model.py", "source": SOURCE})
    client = mcp_client(token)
    first, second = _propose(client), _propose(client)
    s = mcp_link.session()
    before = {pid: dict(s.proposal(pid)) for pid in (first, second)}
    for _ in range(3):
        assert _state(client, first) == {"id": first, "state": "pending"}
    assert {pid: dict(s.proposal(pid)) for pid in (first, second)} == before  # nothing changed
    events = page.get(f"/api/assistant/sessions/{s.id}/events?after=0").json()["events"]
    assert sum(e["type"] == "proposal" for e in events) == 2  # no proposal event from checking
    page.post(f"/api/assistant/proposals/{first}/accept", json={"current_hash": sha(SOURCE)})
    page.post(f"/api/assistant/proposals/{second}/reject")
    assert _state(client, first)["state"] == "accepted"
    assert _state(client, second)["state"] == "rejected"


def test_check_proposal_sees_only_its_own_sessions_proposals(page, tmp_path):
    token = token_of(page)
    turn_on_mcp(page, tmp_path)
    other = sessions.create_session()
    theirs = other.add_proposal(kind="app_edit", summary="Someone else's", ops=[])
    client = mcp_client(token)
    for bad in ({"id": theirs["id"]}, {"id": "nope"}, {}, {"id": ""}):
        r = call(client, "check_proposal", bad).json()
        assert r["ok"] is False and r["content"].startswith("Refused"), bad
    assert other.proposal(theirs["id"])["state"] == "pending"


def test_check_proposal_is_in_both_tool_sets():
    assert "check_proposal" in assistant_tools.TOOL_ALLOWLIST
    defs = {t["name"]: t for t in assistant_tools.TOOL_DEFINITIONS}
    assert defs["check_proposal"]["input_schema"]["required"] == ["id"]
    assert "Read-only" in defs["check_proposal"]["description"]


def test_mcp_server_check_proposal_in_process(page, tmp_path):
    """Through the SDK's own client: propose, check pending, the user accepts, check accepted."""
    from mcp import Client

    token = token_of(page)
    turn_on_mcp(page, tmp_path)
    share(page, {"file_path": "/m/model.py", "source": SOURCE, "selection": "A"})
    backend = mcp_client(token)

    async def transport(method: str, path: str, body):
        r = await anyio.to_thread.run_sync(lambda: backend.request(method, path, json=body))
        return r.status_code, r.json()

    def accept(proposal_id: str) -> None:
        assert page.post(f"/api/assistant/proposals/{proposal_id}/accept", json={"current_hash": sha(SOURCE)}).status_code == 200

    async def scenario():
        async with Client(build_server(transport)) as client:
            assert "check_proposal" in [t.name for t in (await client.list_tools()).tools]
            ops = [{"op": "rename_node", "args": {"var_name": "A", "new_name": "Input layer"}}]
            proposed = await client.call_tool("propose_app_edit", {"summary": "Rename A", "ops": ops})
            proposal_id = json.loads(proposed.content[0].text.split("\n", 1)[1])["proposal_id"]
            checked = await client.call_tool("check_proposal", {"id": proposal_id})
            assert not checked.is_error and json.loads(checked.content[0].text.split("\n", 1)[1])["state"] == "pending"
            await anyio.to_thread.run_sync(accept, proposal_id)
            checked = await client.call_tool("check_proposal", {"id": proposal_id})
            assert json.loads(checked.content[0].text.split("\n", 1)[1]) == {"id": proposal_id, "state": "accepted"}

    anyio.run(scenario)


# ── status details ───────────────────────────────────────────────────────


def test_status_counts_tool_calls_in_the_limit_window(page, tmp_path):
    token = token_of(page)
    turn_on_mcp(page, tmp_path, limits={"tool_calls": 5, "minutes": 10, "max_tokens": 1000})
    client = mcp_client(token)
    client.post("/api/assistant/mcp-client/hello", headers={"X-PsyNeuView-MCP-Client": "claude-code 2.1"})
    assert page.get("/api/assistant/mcp/status").json()["tool_calls"] == {"used": 0, "limit": 5, "minutes": 10}
    for _ in range(3):
        call(client, "read_docs", {"query": "assistant"})
    status = page.get("/api/assistant/mcp/status").json()
    assert status["client"] == "claude-code 2.1" and status["tool_calls"]["used"] == 3


# ── the console entry point ──────────────────────────────────────────────


def test_psyneuview_mcp_entry_point_is_declared_and_resolves():
    import importlib
    import tomllib
    from pathlib import Path

    project = tomllib.loads((Path(mcp_link.backend_dir()) / "pyproject.toml").read_text())
    target = project["project"]["scripts"]["psyneuview-mcp"]
    module, func = target.split(":")
    assert callable(getattr(importlib.import_module(module), func))


def test_the_command_refuses_to_start_without_a_token(tmp_path):
    """The fallback form, `python -m app.mcp_server`, run for real."""
    import os
    import subprocess
    import sys

    env = {k: v for k, v in os.environ.items() if k not in ("PSYNEUVIEW_MCP_TOKEN", "PSYNEUVIEW_URL")}
    env["PYTHONPATH"] = str(mcp_link.backend_dir())
    r = subprocess.run([sys.executable, "-m", "app.mcp_server"], check=False, env=env, capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL)
    assert r.returncode != 0 and "PSYNEUVIEW_MCP_TOKEN is not set" in r.stderr


def test_setup_prefers_the_mac_apps_launcher(monkeypatch, tmp_path):
    launcher = tmp_path / "bin" / "psyneuview-mcp"
    launcher.parent.mkdir()
    launcher.write_text("#!/bin/sh\n")
    monkeypatch.setenv(mcp_link.LAUNCHER_ENV, str(launcher))
    assert mcp_link.command()[0] != str(launcher)  # not executable: falls back
    launcher.chmod(0o755)
    cmd, args, extra = mcp_link.command()
    assert (cmd, args, extra) == (str(launcher), [], {})
    out = mcp_link.setup("tok", 8393)
    assert out["claude_code"].endswith(f"-- {launcher}") and "PYTHONPATH" not in out["claude_code"]
