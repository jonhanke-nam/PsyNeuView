"""The AI assistant's routes (#179): settings, key, sessions, proposals, log.

Every route here accepts requests only from the app's own page, through the
``same_site`` dependency shared with the review routes. With the setting
off, every route but settings and key answers that the assistant is off, and
nothing is sent anywhere. Outside the deployment modes with the ``assistant``
capability the same answer comes with ``reason: "unavailable"``.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel

from app.services import deployment_mode
from app.services.assistant import agents, files, keys
from app.services.assistant import log as assistant_log
from app.services.assistant import session as sessions
from app.services.assistant import settings as assistant_settings
from app.services.assistant.same_site import same_site

logger = logging.getLogger(__name__)


def available() -> None:
    if not deployment_mode.capabilities().assistant:
        raise HTTPException(status_code=403, detail={"reason": "unavailable", "message": "the AI assistant isn't available in this deployment"})


def enabled() -> dict:
    available()
    current = assistant_settings.get_settings()
    if not current["enabled"]:
        raise HTTPException(status_code=403, detail={"reason": "off", "message": "the AI assistant is off (Settings: AI assistant)"})
    return current


router = APIRouter(prefix="/assistant", dependencies=[Depends(same_site)])


# ── settings and key ─────────────────────────────────────────────────────


@router.get("/settings")
async def get_settings():
    return {**assistant_settings.get_settings(), "available": deployment_mode.capabilities().assistant}


@router.put("/settings")
async def put_settings(body: dict = Body(...)):
    available()
    confirm = bool(body.get("confirm_raise", False))
    try:
        new = assistant_settings.update_settings(body, confirm_raise=confirm)
    except assistant_settings.RaiseNeedsConfirmation as e:
        # Not an error: nothing is saved and the page asks the user (#367). A
        # 200 keeps the browser console free of a red failed request.
        return {"needs_confirmation": True, "reason": "confirm_raise", "raised": e.raised, "message": str(e)}
    except assistant_settings.SandboxRequired as e:
        raise HTTPException(status_code=400, detail={"reason": "sandbox_required", "message": str(e)})
    except assistant_settings.SettingsError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {**new, "available": True}


@router.get("/sandbox")
async def get_sandbox():
    """Whether model runs are sandboxed by the operating system (#311), for
    Settings ▸ AI assistant: ``state`` is ``on``, ``unavailable`` (wanted
    but can't be applied, so runs are NOT sandboxed), ``available`` or
    ``off_unavailable``; ``reason`` says why one can't be applied."""
    from app.services import os_sandbox

    return os_sandbox.status()


@router.get("/key")
async def get_key():
    return {"set": keys.is_set()}


@router.put("/key")
async def put_key(body: dict = Body(...)):
    available()
    try:
        keys.set_key(body.get("key", ""))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except keys.NoSecureStore as e:
        raise HTTPException(status_code=501, detail=str(e))
    return {"set": True}


@router.delete("/key")
async def delete_key():
    available()
    keys.delete_key()
    return {"set": False}


#: What Test connection and the model list say while the assistant is off.
OFF_NOTHING_SENT = "Turn the assistant on first; nothing is sent until you do."


@router.post("/test-connection")
def test_connection():
    """Send one minimal request to the saved agent with the saved key (#368)
    and say whether it worked: ``{ok, agent, model, ms, message}``, always a
    200, the message plain English and never the key.

    Only while the assistant is on: turning it on is the one consent to
    sending anything to the chosen service (#369), so while it is off this
    answers ``OFF_NOTHING_SENT`` and sends nothing. A plain ``def`` so the
    up-to-15-second wait runs in the thread pool, not on the event loop."""
    available()
    current = assistant_settings.get_settings()
    agent_settings = current["agent"]
    if not current["enabled"]:
        return agents.ConnectionResult(
            ok=False, agent=agent_settings.get("type", "none"), model=agent_settings.get("model", ""), ms=None,
            message=OFF_NOTHING_SENT).as_dict() | {"reason": "off"}
    if agent_settings.get("type", "none") == "none":
        return agents.test_connection(agent_settings, key=None).as_dict()
    result = agents.test_connection(agent_settings, key=keys.get_key())
    logger.info("assistant test connection: agent=%s ok=%s ms=%s", result.agent, result.ok, result.ms)
    return result.as_dict()


@router.get("/models")
def get_models():
    """The models the saved agent's service offers (#370), fetched with the
    saved key: ``{ok, agent, models: [{id, display_name}], default,
    message}``, always a 200, never the key. Like Test connection, only
    while the assistant is on; while off it answers ``OFF_NOTHING_SENT``
    with no models and sends nothing."""
    available()
    current = assistant_settings.get_settings()
    agent_settings = current["agent"]
    if not current["enabled"]:
        return agents.ModelList(
            ok=False, agent=agent_settings.get("type", "none"), models=[], default="",
            message=OFF_NOTHING_SENT).as_dict() | {"reason": "off"}
    if agent_settings.get("type", "none") == "none":
        return agents.list_models(agent_settings, key=None).as_dict()
    result = agents.list_models(agent_settings, key=keys.get_key())
    logger.info("assistant model list: agent=%s ok=%s count=%d", result.agent, result.ok, len(result.models))
    return result.as_dict()


# ── sessions ─────────────────────────────────────────────────────────────


class MessageBody(BaseModel):
    text: str
    context: dict[str, Any] | None = None


@router.post("/sessions")
async def create_session(settings: dict = Depends(enabled)):
    try:
        session = sessions.create_session()
    except RuntimeError as e:
        raise HTTPException(status_code=429, detail=str(e))
    return {"id": session.id}


@router.post("/sessions/{session_id}/messages")
async def post_message(session_id: str, body: MessageBody, settings: dict = Depends(enabled)):
    session = _session(session_id)
    try:
        # The key is fetched here and handed to the adapter only; it never
        # goes in the environment, the session, or a response.
        agent = agents.make_agent(settings["agent"], key=keys.get_key())
    except agents.AgentError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        turn_id = session.start_turn(body.text, body.context or {}, agent=agent, settings=settings)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"turn_id": turn_id}


@router.get("/sessions/{session_id}/events")
async def get_events(session_id: str, after: int = Query(0, ge=0), settings: dict = Depends(enabled)):
    return _session(session_id).events_after(after)


@router.post("/sessions/{session_id}/stop")
async def stop_session(session_id: str, settings: dict = Depends(enabled)):
    _session(session_id).stop()
    return {"stopped": True}


# ── proposals ────────────────────────────────────────────────────────────


@router.post("/proposals/{proposal_id}/reject")
async def reject_proposal(proposal_id: str, settings: dict = Depends(enabled)):
    session, proposal = _proposal(proposal_id)
    if proposal["state"] != "pending":
        raise HTTPException(status_code=409, detail=f"proposal is {proposal['state']}")
    out = session.set_proposal_state(proposal_id, "rejected")
    assistant_log.record(
        session_id=session.id, tool=f"reject_{proposal['kind']}", args={"path": proposal.get("path")},
        allowed=False, ok=True, summary=proposal.get("summary", ""), approved_by="user", keep_log=settings["keep_log"],
    )
    return out


@router.post("/proposals/{proposal_id}/accept")
async def accept_proposal(proposal_id: str, body: dict = Body(default={}), settings: dict = Depends(enabled)):
    """Only the page calls this; there is no tool for it. A file write is
    applied here through ``files.py``; an app edit is applied by the page."""
    session, proposal = _proposal(proposal_id)
    if proposal["state"] != "pending":
        raise HTTPException(status_code=409, detail=f"proposal is {proposal['state']}")
    current_hash = body.get("current_hash")
    if proposal["base_hash"] is not None and current_hash != proposal["base_hash"]:
        session.set_proposal_state(proposal_id, "stale")
        _log_refused_accept(session, proposal, "stale", settings)
        raise HTTPException(status_code=409, detail={"reason": "stale", "message": "the source changed since the assistant looked; it has to look again"})
    if proposal["kind"] == "file_write":
        try:
            # Checks the path again, keeps the previous version, and marks
            # the result unreviewed so it doesn't run until approved.
            written = files.write_model_file(proposal["path"], proposal["after"], base_hash=proposal["base_hash"])
        except files.PathRefused as e:
            stale = e.reason in ("stale", "swapped")
            session.set_proposal_state(proposal_id, "stale" if stale else "rejected")
            _log_refused_accept(session, proposal, "stale" if stale else e.reason, settings)
            raise HTTPException(status_code=409, detail={"reason": "stale" if stale else e.reason, "message": str(e)})
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"couldn't write the file: {e.strerror or e}")
        assistant_log.record(
            session_id=session.id, tool="accept_file_write", args={"path": str(written)}, allowed=True, ok=True,
            summary=proposal["summary"], approved_by="user", keep_log=settings["keep_log"],
        )
    else:
        assistant_log.record(
            session_id=session.id, tool=f"accept_{proposal['kind']}", args={"path": proposal["path"]}, allowed=True, ok=True,
            summary=proposal["summary"], approved_by="user", keep_log=settings["keep_log"],
        )
    return session.set_proposal_state(proposal_id, "accepted")


def _log_refused_accept(session, proposal: dict, reason: str, settings: dict) -> None:
    """The user accepted, and the app refused to apply it (#179, B5)."""
    assistant_log.record(
        session_id=session.id, tool=f"accept_{proposal['kind']}", args={"path": proposal.get("path"), "reason": reason},
        allowed=False, ok=False, summary=proposal.get("summary", ""), approved_by="user", keep_log=settings["keep_log"],
    )


# ── log ──────────────────────────────────────────────────────────────────


@router.get("/log")
async def get_log(limit: int = Query(1000, ge=1, le=10000)):
    available()
    return {"entries": assistant_log.read_entries(limit), "keep_log": assistant_settings.get_settings()["keep_log"]}


@router.delete("/log")
async def clear_log():
    available()
    assistant_log.clear()
    return {"entries": [], "cleared": True}


# ── helpers ──────────────────────────────────────────────────────────────


def _session(session_id: str) -> sessions.Session:
    try:
        return sessions.get_session(session_id)
    except sessions.SessionNotFound:
        raise HTTPException(status_code=404, detail="no such session")


def _proposal(proposal_id: str) -> tuple[sessions.Session, dict]:
    try:
        return sessions.find_proposal(proposal_id)
    except sessions.SessionNotFound:
        raise HTTPException(status_code=404, detail="no such proposal")


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
