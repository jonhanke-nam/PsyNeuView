"""The page secret (#381): a program on this machine can't act as the app's page.

Before #381 a request that named no site passed every assistant page route,
so ``curl``, another app, or Claude Code's own shell could read the MCP
token, turn the assistant on with the consent flag, accept proposals and
approve assistant-written code. These tests play that program: requests with
no ``Origin`` and no secret, then with an ``Origin`` it can forge but no
secret, then with a wrong secret. The last test is the review packet's
reproduction script (``how-to-run.md`` §5) step by step.
"""

from __future__ import annotations

import hashlib
import json
import os
import stat

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.assistant import page_secret, review
from app.services.assistant import settings as assistant_settings
from app.services.assistant.same_site import NO_ORIGIN, REASON, SECRET_MISSING, SECRET_WRONG, check
from tests.assistant_page import PAGE_SECRET
from tests.test_assistant_mcp import LOCAL, mcp_client, page, token_of, turn_on_mcp  # noqa: F401  (fixture)

SOURCE = "import psyneulink as pnl\nA = pnl.TransferMechanism(name='A')\n"


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def outsider(**headers) -> TestClient:
    """A program on this machine: right Host, no Origin, no secret unless given."""
    return TestClient(app, base_url="http://127.0.0.1", client=LOCAL, headers=headers)


def reason_of(resp) -> str | None:
    detail = resp.json().get("detail")
    return detail.get("reason") if isinstance(detail, dict) else None


def page_routes() -> list[tuple[str, str]]:
    """Every (method, path) under /api/assistant that the page uses: all but the MCP command's group."""
    out = []
    # From the OpenAPI listing: it names every mounted route, however routers nest.
    for path, ops in app.openapi()["paths"].items():
        if path.startswith("/api/assistant/") and not path.startswith("/api/assistant/mcp-client"):
            for method in sorted(m.upper() for m in ops if m in ("get", "put", "post", "delete", "patch")):
                out.append((method, path.replace("{proposal_id}", "p1").replace("{session_id}", "s1")))
    return out


def send(client: TestClient, method: str, path: str, **kw):
    if method in ("GET", "DELETE"):
        return client.request(method, path, **kw)
    return client.request(method, path, json={}, **kw)


# ── every page route ─────────────────────────────────────────────────────


def test_the_page_routes_are_all_listed():
    routes = page_routes()
    paths = {p for _, p in routes}
    for must in ["/api/assistant/settings", "/api/assistant/key", "/api/assistant/mcp/setup", "/api/assistant/mcp/token",
                 "/api/assistant/proposals/p1/accept", "/api/assistant/review/approve", "/api/assistant/test-connection"]:
        assert must in paths
    assert len(routes) >= 20


@pytest.mark.parametrize("method,path", page_routes())
def test_a_program_with_no_origin_and_no_secret_is_refused_everywhere(page, method, path):
    resp = send(outsider(), method, path)
    assert resp.status_code == 403, resp.text
    assert reason_of(resp) in (NO_ORIGIN, SECRET_MISSING)
    # The refusal says what happened in plain English.
    assert "Refused" in resp.json()["detail"]["message"]


@pytest.mark.parametrize("method,path", page_routes())
def test_a_forged_origin_without_the_secret_is_refused_everywhere(page, method, path):
    resp = send(outsider(origin="http://127.0.0.1"), method, path)
    assert resp.status_code == 403 and reason_of(resp) == SECRET_MISSING, resp.text


@pytest.mark.parametrize("method,path", page_routes())
def test_a_wrong_secret_is_refused_everywhere(page, method, path):
    resp = send(outsider(origin="http://127.0.0.1", **{page_secret.HEADER: "x" * 43}), method, path)
    assert resp.status_code == 403 and reason_of(resp) == SECRET_WRONG, resp.text


@pytest.mark.parametrize("method,path", [(m, p) for m, p in page_routes() if m != "GET"])
def test_a_change_with_the_secret_but_no_origin_is_refused(page, method, path):
    resp = send(outsider(**{page_secret.HEADER: PAGE_SECRET}), method, path)
    assert resp.status_code == 403 and reason_of(resp) == NO_ORIGIN, resp.text


def test_the_page_with_the_secret_gets_through(page):
    assert page.get("/api/assistant/settings").status_code == 200
    assert page.put("/api/assistant/settings", json={"keep_log": False}).status_code == 200
    # A read with the secret and no Origin is how a browser sends a same-site GET.
    reader = outsider(**{page_secret.HEADER: PAGE_SECRET})
    assert reader.get("/api/assistant/settings").status_code == 200


def test_check_rules():
    own = "127.0.0.1:8000"
    origin = "http://127.0.0.1:8000"
    assert check("PUT", own, origin, PAGE_SECRET, "local") is None
    assert check("GET", own, None, PAGE_SECRET, "local") is None
    assert check("PUT", own, None, PAGE_SECRET, "local") == NO_ORIGIN
    assert check("DELETE", own, None, PAGE_SECRET, "local") == NO_ORIGIN
    assert check("PUT", own, origin, None, "local") == SECRET_MISSING
    assert check("GET", own, origin, "  ", "local") == SECRET_MISSING
    assert check("GET", own, origin, PAGE_SECRET + "x", "local") == SECRET_WRONG
    assert check("PUT", own, "https://evil.example", PAGE_SECRET, "local") == REASON
    assert check("PUT", "evil.example:8000", "http://evil.example:8000", PAGE_SECRET, "local") == REASON


# ── what the outside program used to be able to do ───────────────────────


def test_a_program_cant_read_the_mcp_token(page):
    token = token_of(page)
    for client in (outsider(), outsider(origin="http://127.0.0.1")):
        for method, path in (("GET", "/api/assistant/mcp/setup"), ("POST", "/api/assistant/mcp/token")):
            resp = send(client, method, path)
            assert resp.status_code == 403 and token not in resp.text
    assert token_of(page) == token  # and no new token was made


def test_a_program_cant_consent_or_change_settings(page, tmp_path):
    before = assistant_settings.get_settings()
    body = {"enabled": True, "agent": {"type": "claude_mcp"}, "confirm_raise": True,
            "folders": [{"path": str(tmp_path), "access": "read_write"}], "visibility": {"files": True}}
    for client in (outsider(), outsider(origin="http://127.0.0.1")):
        assert client.put("/api/assistant/settings", json=body).status_code == 403
        assert client.put("/api/assistant/key", json={"key": "sk-planted-0123456789"}).status_code == 403
        assert client.delete("/api/assistant/log").status_code == 403
    assert assistant_settings.get_settings() == before
    assert before["enabled"] is False


def test_a_program_cant_accept_a_proposal_or_approve_the_code(page, tmp_path):
    folder = tmp_path / "models"
    folder.mkdir()
    target = folder / "m.py"
    target.write_text(SOURCE)
    token = token_of(page)
    turn_on_mcp(page, tmp_path, visibility={"files": True}, folders=[{"path": str(folder), "access": "read_write"}])
    new_text = SOURCE + "B = 1\n"
    r = mcp_client(token).post("/api/assistant/mcp-client/tools/propose_file_write",
                               json={"arguments": {"path": str(target), "text": new_text, "summary": "x"}}).json()
    proposal_id = json.loads(r["content"].split("\n", 1)[1])["proposal_id"]
    for client in (outsider(), outsider(origin="http://127.0.0.1")):
        assert client.post(f"/api/assistant/proposals/{proposal_id}/accept", json={"current_hash": sha(SOURCE)}).status_code == 403
        assert client.post(f"/api/assistant/proposals/{proposal_id}/reject").status_code == 403
    assert target.read_text() == SOURCE
    # The user accepts it on the page; the file is now assistant-written and unreviewed.
    assert page.post(f"/api/assistant/proposals/{proposal_id}/accept", json={"current_hash": sha(SOURCE)}).status_code == 200
    for client in (outsider(), outsider(origin="http://127.0.0.1")):
        assert client.post("/api/assistant/review/status", json={"path": str(target)}).status_code == 403
        assert client.post("/api/assistant/review/approve", json={"path": str(target), "content_hash": sha(new_text)}).status_code == 403
    assert review.is_runnable(str(target), new_text) is False


def test_the_review_packets_reproduction_is_refused_at_every_step(page, tmp_path):
    """known-gaps.md B1, how-to-run.md §5, as an outside program would run it.

    Before #381 every step answered 200 and the model's code ran. Now the
    first step gets no token; the later steps are tried with what such a
    program could still do, and each is refused, so nothing it wrote runs."""
    models = tmp_path / "models"
    models.mkdir()
    f = models / "m.py"
    ran = models / "ran.txt"
    sh = outsider()
    # TOK=$(curl -s $B/mcp/setup | …["token"])
    r = sh.get("/api/assistant/mcp/setup")
    assert r.status_code == 403 and "token" not in r.json()
    # curl -X PUT $B/settings -d '{"enabled":true,"agent":{"type":"claude_mcp"},"confirm_raise":true,…}'
    r = sh.put("/api/assistant/settings", json={
        "enabled": True, "agent": {"type": "claude_mcp"}, "confirm_raise": True,
        "folders": [{"path": str(models), "access": "read_write"}], "visibility": {"files": True}})
    assert r.status_code == 403
    assert assistant_settings.get_settings()["enabled"] is False
    # The rest needs the assistant on and a proposal; let the user's page do
    # that, so the outsider's remaining steps are tested on their own.
    token = token_of(page)
    turn_on_mcp(page, tmp_path, visibility={"files": True}, folders=[{"path": str(models), "access": "read_write"}])
    code = f"import psyneulink as pnl\nopen({str(ran)!r},'w').write('ran')\n"
    r = mcp_client(token).post("/api/assistant/mcp-client/tools/propose_file_write",
                               json={"arguments": {"path": str(f), "text": code, "summary": "x"}}).json()
    pid = json.loads(r["content"].split("\n", 1)[1])["proposal_id"]
    # curl -X POST $B/proposals/$PID/accept -d '{}'
    assert sh.post(f"/api/assistant/proposals/{pid}/accept", json={}).status_code == 403
    assert not f.exists()
    page.post(f"/api/assistant/proposals/{pid}/accept", json={})  # the user accepts; still unreviewed
    # H=$(curl -X POST $B/review/status -d '{"path":…}' | …["content_hash"])
    assert sh.post("/api/assistant/review/status", json={"path": str(f)}).status_code == 403
    # curl -X POST /api/model/load → 409 before approval
    assert sh.post("/api/model/load", json={"file_path": str(f)}).status_code == 409
    # curl -X POST $B/review/approve -d '{"path":…,"content_hash":H}'
    assert sh.post("/api/assistant/review/approve", json={"path": str(f), "content_hash": sha(code)}).status_code == 403
    # curl -X POST /api/model/load → still 409: nothing was approved
    assert sh.post("/api/model/load", json={"file_path": str(f)}).status_code == 409
    assert not ran.exists()


# ── where the secret comes from ──────────────────────────────────────────


@pytest.fixture
def fresh(monkeypatch):
    """Forget the run's fixed secret for one test, and put it back after."""
    for name in ("PSYNEUVIEW_PAGE_SECRET", "PSYNEUVIEW_PAGE_SECRET_FILE", "PSYNEWVIEW_PAGE_SECRET", "PSYNEWVIEW_PAGE_SECRET_FILE"):
        monkeypatch.delenv(name, raising=False)
    page_secret.use_for_tests(None)
    yield monkeypatch
    page_secret.use_for_tests(PAGE_SECRET)


def test_the_mac_apps_file_is_read_once_deleted_and_left_out_of_the_environment(fresh, tmp_path):
    secret = "s" * 43
    f = tmp_path / "page-secret"
    f.write_text(secret + "\n")
    os.chmod(f, stat.S_IRUSR | stat.S_IWUSR)
    fresh.setenv("PSYNEUVIEW_PAGE_SECRET_FILE", str(f))
    assert page_secret.load() == secret
    assert page_secret.source() == "file"
    assert not f.exists()
    assert "PSYNEUVIEW_PAGE_SECRET_FILE" not in os.environ
    # The Mac app injects it itself, so no link with it goes to the log.
    assert page_secret.announce(8000) is None
    assert page_secret.matches(secret) and not page_secret.matches(secret[:-1]) and not page_secret.matches(None)


def test_the_variable_is_taken_out_of_the_environment(fresh):
    fresh.setenv("PSYNEUVIEW_PAGE_SECRET", "e" * 40)
    assert page_secret.load() == "e" * 40
    assert page_secret.source() == "environment"
    assert "PSYNEUVIEW_PAGE_SECRET" not in os.environ


def test_a_short_secret_is_replaced_and_none_means_one_is_made(fresh):
    fresh.setenv("PSYNEUVIEW_PAGE_SECRET", "short")
    made = page_secret.load()
    assert made != "short" and len(made) >= page_secret.MIN_LENGTH and page_secret.source() == "generated"
    page_secret.use_for_tests(None)
    other = page_secret.load()
    assert other != made  # a new launch, a new secret


def test_the_printed_link_carries_the_secret_in_the_fragment(fresh):
    fresh.setenv("PSYNEUVIEW_PAGE_SECRET", "f" * 40)
    line = page_secret.announce(8353, environ={})
    assert line and line.endswith("http://127.0.0.1:8353/#pnv-session=" + "f" * 40)
    line = page_secret.announce(8353, environ={"PSYNEUVIEW_PAGE_URL": "http://localhost:5353"})
    assert line.endswith("http://localhost:5353/#pnv-session=" + "f" * 40)


def test_no_route_serves_the_secret(page):
    """Outside test mode nothing answers with it; the test route isn't mounted here."""
    for method, path in page_routes():
        resp = send(page, method, path)
        assert PAGE_SECRET not in resp.text, path
    if os.environ.get("PSYNEUVIEW_TEST_MODE") != "1":
        assert PAGE_SECRET not in page.get("/api/test/page-secret").text
