"""The AI assistant's routes (#179): settings, key, sessions, proposals, log.

Every route here accepts requests only from the app's own page: a request
whose ``Origin`` is another site is refused, and in the ``local`` and
``mac_app`` modes so is a ``Host`` that isn't this machine. With the setting
off, every route but settings and key answers that the assistant is off, and
nothing is sent anywhere. Outside the deployment modes with the ``assistant``
capability the same answer comes with ``reason: "unavailable"``.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from app.services import deployment_mode
from app.services.assistant import agents, keys
from app.services.assistant import log as assistant_log
from app.services.assistant import session as sessions
from app.services.assistant import settings as assistant_settings
from app.services.assistant import tools as assistant_tools

logger = logging.getLogger(__name__)

_LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost", "[::1]"}


def same_site(request: Request) -> None:
    """Assistant routes accept requests only from the app's own page."""
    origin = request.headers.get("origin")
    host = request.headers.get("host", "")
    host_name = urlparse(f"//{host}").hostname or host
    if origin:
        parsed = urlparse(origin)
        origin_host = parsed.hostname or ""
        own_hosts = {host_name}
        if host_name in _LOCAL_HOSTS:
            own_hosts |= _LOCAL_HOSTS
        if parsed.scheme not in ("http", "https") or origin_host not in own_hosts:
            raise HTTPException(status_code=403, detail="assistant routes accept requests only from the app's own page")
    if deployment_mode.current_mode() in (deployment_mode.LOCAL, deployment_mode.MAC_APP) and host_name not in _LOCAL_HOSTS:
        raise HTTPException(status_code=403, detail="assistant routes accept requests only from the app's own page")


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
        raise HTTPException(status_code=409, detail={"reason": "confirm_raise", "raised": e.raised, "message": str(e)})
    except assistant_settings.SettingsError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {**new, "available": True}


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
    return session.set_proposal_state(proposal_id, "rejected")


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
        raise HTTPException(status_code=409, detail={"reason": "stale", "message": "the source changed since the assistant looked; it has to look again"})
    if proposal["kind"] == "file_write":
        files = assistant_tools.files
        review = assistant_tools.review
        try:
            written = files.write_model_file(proposal["path"], proposal["after"], base_hash=proposal["base_hash"])
        except assistant_tools.PathRefused as e:
            session.set_proposal_state(proposal_id, "stale")
            raise HTTPException(status_code=409, detail={"reason": "stale", "message": str(e)})
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"couldn't write the file: {e.strerror or e}")
        if proposal["freeform_python"]:
            review.mark_unreviewed(str(written), proposal["after"])
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
