"""Every decision goes to the assistant's log, with no secrets (#179, B5).

Rejecting a proposal, an accept the app refuses (stale), approving
assistant-written code at review, a review approval refused because the
file changed, and a run refused because its code isn't approved: each is
one entry, naming the file and who decided, never its text, the key or the
page secret.
"""

from __future__ import annotations

import json

from app.services.assistant import review
from tests.assistant_page import PAGE_SECRET
from tests.test_assistant_backend import (  # noqa: F401  (client and fake are fixtures)
    client,
    fake,
    run_turn,
    sha,
    turn_on,
)

SECRET_TEXT = "TOP_SECRET_MODEL_TEXT = 42\n"
KEY = "sk-ant-decisions-test-key"


def _log(client) -> list[dict]:
    return client.get("/api/assistant/log").json()["entries"]


def _no_secrets(entries) -> None:
    text = json.dumps(entries)
    for secret in (SECRET_TEXT.strip(), KEY, PAGE_SECRET):
        assert secret not in text


def _proposal(client, fake, tmp_path):
    _, events = run_turn(client, fake, [("", [("propose_app_edit", {
        "summary": "Rename", "ops": [{"op": "rename_node", "args": {"var_name": "a", "new_name": "b"}}]})])],
        context={"source": SECRET_TEXT})
    return [e for e in events if e["type"] == "proposal"][0]["proposal"]


def test_a_rejected_proposal_is_logged(client, tmp_path, fake):
    turn_on(client, tmp_path)
    client.put("/api/assistant/key", json={"key": KEY})
    proposal = _proposal(client, fake, tmp_path)
    assert client.post(f"/api/assistant/proposals/{proposal['id']}/reject").status_code == 200
    last = _log(client)[-1]
    assert last["tool"] == "reject_app_edit" and last["allowed"] is False and last["approved_by"] == "user"
    _no_secrets(_log(client))


def test_an_accept_refused_as_stale_is_logged(client, tmp_path, fake):
    turn_on(client, tmp_path)
    proposal = _proposal(client, fake, tmp_path)
    r = client.post(f"/api/assistant/proposals/{proposal['id']}/accept", json={"current_hash": sha("changed")})
    assert r.status_code == 409
    last = _log(client)[-1]
    assert last["tool"] == "accept_app_edit" and last["allowed"] is False and last["args"]["reason"] == "stale"
    _no_secrets(_log(client))


def test_review_approvals_and_refusals_are_logged(client, tmp_path):
    model = tmp_path / "wrote.py"
    model.write_text(SECRET_TEXT)
    review.mark_unreviewed(str(model), SECRET_TEXT)
    # Refused: the hash shown isn't what is on disk.
    r = client.post("/api/assistant/review/approve", json={"path": str(model), "content_hash": "0" * 64})
    assert r.status_code == 409
    refused = _log(client)[-1]
    assert refused["tool"] == "review_approve" and refused["allowed"] is False
    assert refused["args"]["path"] == str(model)
    # Approved.
    shown = client.post("/api/assistant/review/status", json={"path": str(model)}).json()
    r = client.post("/api/assistant/review/approve", json={"path": str(model), "content_hash": shown["content_hash"]})
    assert r.status_code == 200
    approved = _log(client)[-1]
    assert approved["tool"] == "review_approve" and approved["allowed"] is True and approved["approved_by"] == "user"
    _no_secrets(_log(client))


def test_a_run_refused_for_unapproved_code_is_logged(client, tmp_path):
    model = tmp_path / "wrote.py"
    model.write_text(SECRET_TEXT + "import psyneulink as pnl\ncomp = pnl.Composition(name='c')\n")
    review.mark_unreviewed(str(model), model.read_text())
    r = client.post("/api/model/load", json={"file_path": str(model)})
    assert r.status_code == 409
    last = _log(client)[-1]
    assert last["tool"] == "run_refused_unreviewed" and last["allowed"] is False
    assert last["args"]["path"] == str(model)
    _no_secrets(_log(client))


def test_keep_log_off_keeps_decisions_out_too(client, tmp_path, fake):
    turn_on(client, tmp_path, keep_log=False)
    proposal = _proposal(client, fake, tmp_path)
    client.post(f"/api/assistant/proposals/{proposal['id']}/reject")
    model = tmp_path / "wrote.py"
    model.write_text(SECRET_TEXT)
    review.mark_unreviewed(str(model), SECRET_TEXT)
    shown = client.post("/api/assistant/review/status", json={"path": str(model)}).json()
    client.post("/api/assistant/review/approve", json={"path": str(model), "content_hash": shown["content_hash"]})
    assert _log(client) == []
