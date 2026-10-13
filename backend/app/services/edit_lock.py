"""Whether a model may be edited from the canvas. (#1116)

From the design discussion, on whether the canvas is a view or an editor:

    The canvas is an editor, but we should be able to lock it so it's only a
    view as well.

This is the lock. A model can be marked view-only, and then edits to it are
refused — not merely hidden in the UI, because a lock enforced only in the UI
is not a lock.

What it covers (#1116, #1320): every write that changes the model's code —
structural changes from the canvas, parameter and function edits from the
inspector, renames and port changes, and a save from the code editor. For a
teaching lock ("explore, don't change") the code editor is the most direct
way to change a model, so it is covered too: the editor opens read only and
``save_source`` is refused.

What it leaves alone:

- **Layout.** Moving nodes, zooming, choosing a layout variant: those are
  recorded in the sidecar, not the model, and stay allowed so people can
  still arrange what they are looking at.
- **Save a copy as…** The copy takes the model's layout along (#1244,
  ``sidecar_copy``) but not the lock in it, so it starts unlocked, as it
  always did.

Two things it is deliberately not:

- **Not a global preference.** It travels in the model's sidecar, so a curated
  reference model can ship locked and stay locked for whoever opens it, rather
  than depending on one person's settings.
- **Not a security boundary.** Anyone can edit the sidecar, or the file in
  another editor. It protects against a stray keystroke, not against intent.

**The protection line (#1346, part 2).** A model's own ``.py`` can say
``# PsyNeuView: protected`` or ``# PsyNeuView: protected permanently`` near
the top (``protection_line``). Those are rules of the model too, so they are
answered here, with the lock, in one order (:func:`status`): protected
permanently, then protected (unless unlocked on this computer), then the
lock. Each refusal names its own rule and carries its own ``reason``.
"""

from __future__ import annotations

from typing import Literal, Optional, TypedDict

from app.services import protection_line
from app.services.layout import load_layout, save_layout

# Key in the sidecar dict. Namespaced so it cannot collide with layout data.
LOCK_KEY = "editLock"

VIEW_ONLY = "viewOnly"
EDITABLE = "editable"


#: Which rule makes a model read only (``None``: editable). Ordered strictest
#: first; the location rule (``pnl_source_guard``) comes before all of these.
Rule = Literal["protectedPermanently", "protected", "lock"]


class EditStatus(TypedDict):
    mode: str
    rule: Optional[Rule]
    can_unlock: bool
    unlocked_here: bool
    message: Optional[str]


def _sidecar_locked(model_path: str) -> bool:
    sidecar = load_layout(model_path) or {}
    return sidecar.get(LOCK_KEY) == VIEW_ONLY


def status(model_path: str) -> EditStatus:
    """Whether the model may be edited, and which rule says not (#1346).

    The model's own rules, strictest first:

    1. ``# PsyNeuView: protected permanently`` in the file → read only, no
       unlock in PsyNeuView;
    2. ``# PsyNeuView: protected`` in the file, unless unlocked on this
       computer → read only;
    3. the per-model lock in the layout file → read only;
    4. otherwise editable.

    Where the file lives (``pnl_source_guard``) is checked before any of
    these by the callers that write, since it outranks them all.
    """
    level = protection_line.level(model_path)
    unlocked_here = level == protection_line.PROTECTED and protection_line.is_unlocked_here(model_path)
    rule: Optional[Rule] = None
    if level == protection_line.PERMANENT:
        rule = "protectedPermanently"
    elif level == protection_line.PROTECTED and not unlocked_here:
        rule = "protected"
    elif _sidecar_locked(model_path):
        rule = "lock"
    return {
        "mode": VIEW_ONLY if rule else EDITABLE,
        "rule": rule,
        "can_unlock": rule in ("protected", "lock"),
        "unlocked_here": unlocked_here,
        "message": _MESSAGES[rule] if rule else None,
    }


def edit_mode(model_path: str) -> str:
    """``"editable"`` or ``"viewOnly"``. Unmarked models are editable."""
    return status(model_path)["mode"]


def is_view_only(model_path: str) -> bool:
    return edit_mode(model_path) == VIEW_ONLY


def set_edit_mode(model_path: str, mode: str) -> str:
    """Mark a model view-only or editable. Returns the mode now in force.

    Unlocking clears every rule PsyNeuView may undo: the layout file's lock,
    and for a file with ``# PsyNeuView: protected`` it remembers the unlock
    on this computer (the line itself stays). A ``protected permanently``
    file can't be unlocked here (:class:`ModelIsProtectedPermanently`).

    Locking a ``protected`` file forgets that unlock, which puts its own
    rule back; any other model gets the layout file's lock.
    """
    if mode not in (VIEW_ONLY, EDITABLE):
        raise ValueError(f"unknown edit mode {mode!r}; expected {EDITABLE!r} or {VIEW_ONLY!r}")

    level = protection_line.level(model_path)
    if mode == EDITABLE:
        if level == protection_line.PERMANENT:
            raise ModelIsProtectedPermanently(model_path)
        if level == protection_line.PROTECTED:
            protection_line.set_unlocked_here(model_path, True)
        # Only touch the layout file when there's a lock in it, so unlocking
        # a protected file doesn't make a layout file it never had.
        if _sidecar_locked(model_path):
            # Written through save_layout rather than around it. That function
            # owns the sidecar's shape — lateral-vs-dot-folder placement, the
            # managed-clone redirect — and rebuilds the file from a whitelist,
            # so anything written behind its back is dropped on the next drag.
            save_layout(model_path, edit_lock="")
    elif level == protection_line.PROTECTED:
        protection_line.set_unlocked_here(model_path, False)
    elif level is None:
        save_layout(model_path, edit_lock=VIEW_ONLY)
    return edit_mode(model_path)


class ModelIsViewOnly(Exception):
    """Raised when an edit is attempted on a locked model.

    The base of the three refusals a model's own rules give (#1346); each
    carries the ``reason`` the API answers with."""

    reason = "model_view_only"

    def __init__(self, model_path: str):
        # Names the two ways out (#1309): the "view only" tag, which is the only
        # sign of the lock now that an unlocked model shows nothing, and the
        # menu item beside it. Since #1320 the code editor is covered too, so
        # "edit the code directly" is no longer a way around it.
        super().__init__(_MESSAGES["lock"])
        self.model_path = model_path


class ModelIsProtected(ModelIsViewOnly):
    """Raised when an edit is attempted on a file marked
    ``# PsyNeuView: protected`` that wasn't unlocked on this computer."""

    reason = "model_protected"

    def __init__(self, model_path: str):
        Exception.__init__(self, _MESSAGES["protected"])
        self.model_path = model_path


class ModelIsProtectedPermanently(ModelIsViewOnly):
    """Raised when an edit (or an unlock) is attempted on a file marked
    ``# PsyNeuView: protected permanently``."""

    reason = "model_protected_permanently"

    def __init__(self, model_path: str):
        Exception.__init__(self, _MESSAGES["protectedPermanently"])
        self.model_path = model_path


_MESSAGES: dict[str, str] = {
    "protectedPermanently": (
        "This model's file says \"# PsyNeuView: protected permanently\" near the top, so "
        "PsyNeuView won't change it: not from the graph, the inspector or the code editor, "
        "and it offers no unlock. To work on it, use Save a copy as… (the copy starts "
        "unprotected). To make this file editable, remove that line in another editor or "
        "with git."
    ),
    "protected": (
        "This model's file says \"# PsyNeuView: protected\" near the top, so it opens read "
        "only: not from the graph, the inspector or the code editor. To edit it, click the "
        "\"view only\" tag in the toolbar, or choose Layout ▸ Unlock this model; the unlock "
        "is remembered for this file on this computer, and the line stays in the file."
    ),
    "lock": (
        "This model is locked (view only), so it can't be changed here: "
        "not from the graph, the inspector or the code editor. To edit it, "
        "click the \"view only\" tag in the toolbar, or choose Layout ▸ "
        "Unlock this model. Save a copy as… still works."
    ),
}


def guard(model_path: str) -> None:
    """Refuse an edit (structural, parameter, or a code-editor save) when the
    model is read only by one of its own rules, naming the strictest."""
    rule = status(model_path)["rule"]
    if rule == "protectedPermanently":
        raise ModelIsProtectedPermanently(model_path)
    if rule == "protected":
        raise ModelIsProtected(model_path)
    if rule == "lock":
        raise ModelIsViewOnly(model_path)
