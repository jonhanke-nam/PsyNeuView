"""Machine-readable start-up phase lines for the Mac app (PsyNeuView-MacApp#232).

The backend's start used to be opaque from outside: the Mac app saw nothing
between launching the process and ``/health`` answering, while the backend
migrated working copies, maybe installed a ready PsyNeuLink update, and spent
twenty-odd seconds importing PsyNeuLink in the model runner. Each step now
announces itself on **stdout**, one line per event, flushed at once::

    PNV-START <phase> <event> [elapsed=<seconds, 1 decimal>] [detail=<url-encoded text>]

``<event>`` is ``begin``, ``end`` or ``skip``; ``elapsed`` appears on ``end``
only. The phases, in order: ``migrate``, ``pnl-update``, ``import-psyneulink``,
``warm-worker``, and finally ``ready`` (an ``end`` alone, whose ``elapsed`` is
the whole start, since the process began). The same events go to the normal
logger in plain words, so the Logs window reads naturally.

Nothing here ever raises: a start must never fail because its progress
report did. The full contract is in ``docs/settings-and-mac-app.md``.
"""

from __future__ import annotations

import logging
import os
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from urllib.parse import quote

logger = logging.getLogger(__name__)

PREFIX = "PNV-START"
EVENTS = ("begin", "end", "skip")

# What each phase is, for the Logs window.
HUMAN_NAMES = {
    "migrate": "Moving working copies and layouts to their current folders",
    "pnl-update": "Installing a ready PsyNeuLink update",
    "import-psyneulink": "Loading PsyNeuLink in the model runner",
    "warm-worker": "Warming up the model runner",
    "ready": "Ready to serve",
}


def _process_started_at() -> float:
    """Wall-clock time the process began: from the OS when psutil is around
    (it usually is, as a dependency), else when this module was first
    imported, which is within the first imports of ``app.main``."""
    try:
        import psutil  # type: ignore[import-not-found]

        return float(psutil.Process(os.getpid()).create_time())
    except Exception:  # noqa: BLE001 — optional, and never worth failing for
        return time.time()


PROCESS_STARTED_AT = _process_started_at()


def seconds_since_process_start() -> float:
    return max(0.0, time.time() - PROCESS_STARTED_AT)


def format_line(
    phase: str,
    event: str,
    *,
    elapsed: float | None = None,
    detail: str | None = None,
) -> str:
    """The one line the Mac app parses. Pure: no I/O, no clock.

    ``detail`` is URL-encoded with nothing kept safe, so spaces, ``=``, ``&``,
    newlines and non-ASCII all survive a split on spaces. ``elapsed`` is
    rounded to one decimal and only written when given, whatever the event.
    """
    phase = str(phase).strip()
    event = str(event).strip()
    if not phase or " " in phase:
        raise ValueError(f"phase must be one word, got {phase!r}")
    if event not in EVENTS:
        raise ValueError(f"event must be one of {EVENTS}, got {event!r}")
    parts = [PREFIX, phase, event]
    if elapsed is not None:
        parts.append(f"elapsed={max(0.0, float(elapsed)):.1f}")
    if detail is not None:
        parts.append(f"detail={quote(str(detail), safe='')}")
    return " ".join(parts)


def _human(phase: str, event: str, elapsed: float | None, detail: str | None) -> str:
    name = HUMAN_NAMES.get(phase, phase)
    if event == "begin":
        return f"{name}…" + (f" ({detail})" if detail else "")
    if event == "skip":
        return f"{name}: skipped" + (f" ({detail})" if detail else "")
    took = f" in {elapsed:.1f}s" if elapsed is not None else ""
    if detail and detail.startswith("failed"):
        return f"{name}: {detail}" + (f" after {elapsed:.1f}s" if elapsed is not None else "")
    return f"{name}: done{took}" + (f" ({detail})" if detail else "")


def emit(
    phase: str,
    event: str,
    *,
    elapsed: float | None = None,
    detail: str | None = None,
) -> str | None:
    """Write one phase line to stdout (flushed) and one plain line to the log.
    Returns the line written, or None when it couldn't be; never raises."""
    try:
        line = format_line(phase, event, elapsed=elapsed, detail=detail)
    except Exception:
        logger.exception("startup_phases: could not format %r %r", phase, event)
        return None
    try:
        # Resolve sys.stdout at call time, so a redirected stream is honoured.
        out = sys.stdout
        out.write(line + "\n")
        out.flush()
    except Exception:  # noqa: BLE001 — a closed or broken stdout must not stop a start
        logger.debug("startup_phases: stdout refused %r", line)
    try:
        logger.info("%s", _human(phase, event, elapsed, detail))
    except Exception:  # noqa: BLE001, S110 — the log line is a courtesy; the stdout line is already out
        pass
    return line


class Phase:
    """One phase's lifecycle: ``begin()``, then exactly one of ``end()``,
    ``skip()`` or ``fail()``. A second finish is ignored, as is a finish
    without a begin for ``end``'s timing (elapsed counts from ``begin``, or
    from construction when ``begin`` was never called)."""

    def __init__(self, name: str):
        self.name = name
        self._t0 = time.monotonic()
        self.begun = False
        self.finished = False
        self.outcome: str | None = None  # "end" | "skip" | "failed"

    @property
    def elapsed(self) -> float:
        return time.monotonic() - self._t0

    def begin(self, detail: str | None = None) -> None:
        if self.begun:
            return
        self.begun = True
        self._t0 = time.monotonic()
        emit(self.name, "begin", detail=detail)

    def end(self, detail: str | None = None) -> None:
        if self.finished:
            return
        self.finished, self.outcome = True, "end"
        emit(self.name, "end", elapsed=self.elapsed, detail=detail)

    def skip(self, detail: str | None = None) -> None:
        if self.finished:
            return
        self.finished, self.outcome = True, "skip"
        emit(self.name, "skip", detail=detail)

    def fail(self, detail: str | None = None) -> None:
        """An ``end`` whose detail starts with ``failed``, so the app can show
        the step as failed rather than done."""
        if self.finished:
            return
        self.finished, self.outcome = True, "failed"
        text = "failed" if not detail else (detail if detail.startswith("failed") else f"failed: {detail}")
        emit(self.name, "end", elapsed=self.elapsed, detail=text)


@contextmanager
def phase(name: str, detail: str | None = None) -> Iterator[Phase]:
    """``with phase("migrate") as p:`` emits ``begin`` on entry and ``end``
    (with elapsed) on exit. Inside, ``p.skip(why)`` turns the finish into a
    ``skip`` and ``p.fail(why)`` into an ``end`` with ``detail=failed…``.
    An exception in the body emits ``end … detail=failed`` and is re-raised:
    the report never swallows the error, and never adds one of its own."""
    p = Phase(name)
    p.begin(detail)
    try:
        yield p
    except BaseException:
        p.fail("failed")
        raise
    else:
        p.end()


def ready() -> None:
    """The last line: the app can serve ``/health`` now."""
    emit("ready", "end", elapsed=seconds_since_process_start())
