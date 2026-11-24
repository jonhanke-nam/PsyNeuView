"""Review of assistant-written files (#179): approve, and ask.

Kept apart from the assistant's own routes so the execution guard works with
the assistant off: a file the assistant wrote earlier stays blocked until the
user approves it here, whatever the setting says now.

Like every assistant route, these accept requests only from the app's own
page (``same_site``).
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.services.assistant import review
from app.services.assistant.same_site import same_site

router = APIRouter(prefix="/assistant/review", tags=["assistant"], dependencies=[Depends(same_site)])

CHANGED = "assistant_code_changed"


class StatusRequest(BaseModel):
    path: str


class ApproveRequest(BaseModel):
    path: str
    #: sha256 of the content the user was shown. Only that content is approved.
    content_hash: str


def _read(path: str) -> str:
    try:
        return Path(path).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        raise HTTPException(status_code=404, detail=f"Can't read {path}: {e}")


@router.post("/status")
def review_status(request: StatusRequest) -> dict:
    """Whether the file is assistant-written and, if so, approved as it is
    now, with the content and its hash so the page shows exactly what an
    approval would cover."""
    if not review.is_tracked(request.path):
        return {"path": request.path, "tracked": False, "runnable": True}
    text = _read(request.path)
    return {
        "path": request.path, "tracked": True,
        "runnable": review.is_runnable(request.path, text),
        "content": text, "content_hash": review.content_hash(text),
    }


@router.post("/approve")
def approve(request: ApproveRequest):
    """The user has reviewed the content hashing to ``content_hash`` and
    approves it. The file is read once; if what is on disk now hashes
    differently, nothing is approved and the answer is 409 with
    ``reason: "assistant_code_changed"``. Only the approved content runs; any
    later change makes it unreviewed again. A file the assistant never wrote
    needs no approval and is left untracked.
    """
    if not review.is_tracked(request.path):
        return {"path": request.path, "tracked": False, "runnable": True}
    text = _read(request.path)
    on_disk = review.content_hash(text)
    if on_disk != (request.content_hash or "").strip().lower():
        return JSONResponse(status_code=409, content={
            "detail": f"{Path(request.path).name} changed since it was shown; look at it again before approving.",
            "reason": CHANGED, "path": request.path, "content_hash": on_disk,
        })
    # The same text that was hashed is what gets approved: no second read.
    review.mark_reviewed(request.path, text)
    return {"path": request.path, "tracked": True, "runnable": True, "content_hash": on_disk}
