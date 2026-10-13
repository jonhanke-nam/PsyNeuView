"""Turn a failed worker's stderr into the reason it failed. (#1101)

PsyNeuLink writes a great many warnings, and the previous summary took the
last ten lines of stderr after dropping only ``FutureWarning``. For a model
that emits warnings in volume, those ten lines were all warnings and the
actual traceback had been pushed out of the window — so the user was shown
"Script execution failed:" followed by nothing that said why.

Two rules, in order:

1. If there is a traceback, show it. That is the answer, and it sits at the
   end of stderr, which is exactly where a fixed tail was clipping it.
2. Otherwise drop warnings as a class and show what remains.

Warnings are dropped as a class rather than by naming them one at a time,
because naming them is what let ``UserWarning`` through in the first place.
"""

from __future__ import annotations

import re

# `/path/to/mod.py:3041: UserWarning: BeforeNCalls(...) is dependent on ...`
# Any category, since the point is not to enumerate them.
_WARNING_LINE = re.compile(r"^.*?:\d+:\s*\w*(?:Warning|Error):\s", re.IGNORECASE)
_WARNING_CATEGORY_ONLY = re.compile(r"^\s*\w*Warning:\s")

_TRACEBACK_START = "Traceback (most recent call last):"

# Python 3.13 colourises tracebacks when it believes the output supports it, so
# stderr can arrive as `\x1b[1;35mValueError\x1b[0m: ...`. Those escapes would
# be shown to the user verbatim, and they also break any matching done on the
# text. Strip them before anything else looks at it.
_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def strip_ansi(text: str) -> str:
    """Remove ANSI colour escapes from ``text``."""
    return _ANSI.sub("", text or "")

# Startup noise the worker itself writes, which is never the reason for a
# failure.
_NOISE = ("functools.partial", "[perf]")


def _is_warning_header(line: str) -> bool:
    return bool(_WARNING_LINE.match(line) or _WARNING_CATEGORY_ONLY.match(line))


def strip_warnings(lines: list[str]) -> list[str]:
    """Drop warning headers, the source line each one echoes, and known noise.

    A Python warning prints two lines: the header, then the offending source
    indented beneath it. Dropping only the header leaves orphaned fragments
    like ``warnings.warn(warning_msg + f"...")``, which is most of what made
    the reported error unreadable.
    """
    out: list[str] = []
    skip_next_indented = False
    for line in lines:
        if any(noise in line for noise in _NOISE):
            skip_next_indented = False
            continue
        if _is_warning_header(line):
            skip_next_indented = True
            continue
        if skip_next_indented:
            skip_next_indented = False
            # The echoed source line is indented; anything else is real output
            # that happened to follow a warning.
            if line[:1] in (" ", "\t"):
                continue
        out.append(line)
    return out


def summarize(stderr: str, max_lines: int = 20) -> str:
    """The reason a run failed, for display.

    ``max_lines`` bounds a long traceback from the *front*, keeping the tail —
    the exception type and message are the last lines, and they matter most.
    """
    stderr = strip_ansi(stderr).strip()
    if not stderr:
        return "Unknown error"

    lines = stderr.splitlines()

    # A traceback is the answer. Take the last one: a caught-and-reraised
    # error prints several, and the final one is the failure that escaped.
    if _TRACEBACK_START in stderr:
        start = max(i for i, l in enumerate(lines) if _TRACEBACK_START in l.strip())
        trace = lines[start:]
        if len(trace) > max_lines:
            trace = [trace[0], f"  ... {len(trace) - max_lines} more frames ..."] + trace[-(max_lines - 2):]
        return "\n".join(trace).strip()

    kept = [l for l in strip_warnings(lines) if l.strip()]
    if not kept:
        # Everything was a warning, yet the process still failed. Say that,
        # rather than presenting warnings as though they were the error.
        return (
            "The run failed, but the worker reported only warnings — no error "
            "message or traceback. Check the Run panel output for what it "
            "managed before stopping."
        )
    return "\n".join(kept[-max_lines:]).strip()


def count_warnings(stderr: str) -> int:
    """How many warnings were suppressed, so the UI can say so."""
    return sum(
        1 for line in strip_ansi(stderr).splitlines() if _is_warning_header(line)
    )
