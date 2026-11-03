"""Review of assistant-written files (#179): approve, and ask.

Kept apart from the assistant's own routes so the execution guard works with
the assistant off: a file the assistant wrote earlier stays blocked until the
user approves it here, whatever the setting says now.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.assistant import review

router = APIRouter(prefix="/assistant/review", tags=["assistant"])


class ReviewRequest(BaseModel):
    path: str


@router.post("/status")
def review_status(request: ReviewRequest) -> dict:
    """Whether the file is assistant-written and, if so, approved as it is now."""
    return {"path": request.path, **review.status(request.path)}


@router.post("/approve")
def approve(request: ReviewRequest) -> dict:
    """The user has reviewed the file as it is on disk now and approves it.

    Only this content runs; any later change makes it unreviewed again. A file
    the assistant never wrote needs no approval and is left untracked.
    """
    if not review.is_tracked(request.path):
        return {"path": request.path, "tracked": False, "runnable": True}
    try:
        text = Path(request.path).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        raise HTTPException(status_code=404, detail=f"Can't read {request.path}: {e}")
    review.mark_reviewed(request.path, text)
    return {"path": request.path, "tracked": True, "runnable": True}
