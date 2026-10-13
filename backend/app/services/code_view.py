"""A view of source with comments and string bodies blanked out.

The file writers locate constructor boundaries by counting parentheses, and
they count every character in the line — including parentheses inside comments
and string literals. A comment such as::

    gain=1.0,   # the default is 1.0, see docs)

closes a declaration that was never opened there, so the writer decides the
constructor ends early, inserts its closing paren in the middle of the call,
and leaves the remaining arguments orphaned below. The result is a model file
that no longer parses — written by an ordinary parameter edit.

Blanking rather than deleting keeps every line the same length and keeps the
line count identical, so offsets computed against this view point at the same
place in the real source.
"""

from __future__ import annotations

import io
import tokenize


def code_only_lines(source: str) -> list[str]:
    """``source`` split into lines, with comments and string bodies blanked.

    Falls back to returning the lines untouched when the source cannot be
    tokenized. That happens mid-edit, and a writer working on a slightly wrong
    view is better than one that refuses to work at all — the callers already
    cope with not finding what they are looking for.
    """
    lines = source.splitlines()
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        return lines

    # Mutable rows so tokens can be blanked in place.
    rows = [list(line) for line in lines]

    for tok in tokens:
        if tok.type not in (tokenize.COMMENT, tokenize.STRING):
            continue
        (srow, scol), (erow, ecol) = tok.start, tok.end
        for row in range(srow, erow + 1):
            index = row - 1
            if index < 0 or index >= len(rows):
                continue
            begin = scol if row == srow else 0
            finish = ecol if row == erow else len(rows[index])
            for col in range(begin, min(finish, len(rows[index]))):
                # Keep the quote characters themselves so a blanked string is
                # still recognisable as a value; only the body is emptied.
                rows[index][col] = " "

    return ["".join(row) for row in rows]


def paren_delta(code_line: str) -> int:
    """Net parenthesis depth change for one already-blanked line."""
    return code_line.count("(") - code_line.count(")")


def code_only_text(text: str) -> str:
    """``text`` with comments and string bodies blanked, same length.

    Character offsets computed against the result index the original exactly,
    so a scanner can find a position here and apply it there.
    """
    blanked = code_only_lines(text)
    if not blanked:
        return text
    out = "\n".join(blanked)
    # splitlines drops a trailing newline; put back whatever the original ended
    # with so the lengths still agree.
    if len(out) < len(text):
        out += text[len(out):]
    return out[: len(text)]
