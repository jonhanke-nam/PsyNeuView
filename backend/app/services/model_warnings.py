"""Warnings raised while a model loads or runs, split into signal and noise.

Loading one real model (Giallanza2024_ego_study2) raises **35** warnings. The
split that works is category plus origin::

    14  PyparsingDeprecationWarning   a library (matplotlib)
    10  FutureWarning                 a library (graph_scheduler, torch)
    11  UserWarning                   PsyNeuLink

PsyNeuLink uses ``UserWarning`` for things it wants the modeller to know about
— a scheduler condition it had to reinterpret, a learning target it cannot
reach. The deprecation and future warnings are library housekeeping that the
person writing the model did not cause and cannot act on.

A note on what does *not* work, since it looks like it should: filtering by
whether the warning points at the user's file. PsyNeuLink raises its warnings
without ``stacklevel``, so every one of them — including the substantive
``targets`` warning — reports a filename inside PsyNeuLink itself. Provenance
identifies the library that complained, never the line that caused it.

That also means these cannot currently offer to jump to a line. The messages do
name nodes (``ProcessingMechanism CONTEXT [QUERY]``), and the app already keeps
a var-name-to-line map, so matching the two is a plausible way to get there
later.
"""

from __future__ import annotations

from typing import Any, TypedDict

# Categories PsyNeuLink uses to address the modeller. Everything else —
# Deprecation, Future, Pending, Resource, Import — is housekeeping.
_MODELLER_CATEGORIES = {"UserWarning", "RuntimeWarning"}

_PSYNEULINK_MARKER = "/psyneulink/"


class CapturedWarning(TypedDict):
    category: str
    message: str
    filename: str
    lineno: int
    # True when this is PsyNeuLink addressing the modeller, rather than a
    # library complaining about itself.
    is_model: bool


def _is_modeller_warning(category: str, filename: str) -> bool:
    if category not in _MODELLER_CATEGORIES:
        return False
    return _PSYNEULINK_MARKER in (filename or "")


def describe(warning: Any, model_path: str | None = None) -> CapturedWarning:
    """Turn a ``warnings.WarningMessage`` into something JSON-serialisable."""
    filename = getattr(warning, "filename", "") or ""
    category = getattr(getattr(warning, "category", None), "__name__", "Warning")
    return {
        "category": category,
        "message": str(getattr(warning, "message", "")),
        "filename": filename,
        "lineno": int(getattr(warning, "lineno", 0) or 0),
        "is_model": _is_modeller_warning(category, filename),
    }


def collect(captured: list, model_path: str | None = None) -> list[CapturedWarning]:
    """Describe every captured warning, in the order they were raised."""
    return [describe(w, model_path) for w in captured]


def classify(raw: list[dict]) -> list[CapturedWarning]:
    """Classify warnings the worker serialised.

    The worker cannot do this itself: it runs as a script in a subprocess where
    `app` does not resolve, so it sends plain dicts and the decision is made
    here, in the backend process.
    """
    out: list[CapturedWarning] = []
    for w in raw or []:
        category = w.get("category", "Warning")
        filename = w.get("filename", "") or ""
        out.append({
            "category": category,
            "message": w.get("message", ""),
            "filename": filename,
            "lineno": int(w.get("lineno", 0) or 0),
            "is_model": _is_modeller_warning(category, filename),
        })
    return out


def split(warnings_list: list[CapturedWarning]) -> tuple[list[CapturedWarning], int]:
    """``(warnings worth showing, how many others there were)``.

    Deduplicated on the message: PsyNeuLink raises the same notice more than
    once for a single condition, and the repeats say nothing the first does
    not. On the model above this turns 11 into 6.
    """
    shown: list[CapturedWarning] = []
    seen: set[str] = set()
    others = 0
    for w in warnings_list:
        if not w.get("is_model"):
            others += 1
            continue
        message = w.get("message", "")
        if message in seen:
            continue
        seen.add(message)
        shown.append(w)
    return shown, others
