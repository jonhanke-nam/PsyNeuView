"""A protection line in the model's own ``.py`` (#1346, part 2).

A comment near the top of a model file can ask PsyNeuView not to change it:

    # PsyNeuLink Model File
    # Format Version: 1.0
    # PsyNeuView: protected

Two levels:

- ``# PsyNeuView: protected`` — the model opens read only, like a locked
  model. The usual unlock (the "view only" tag, Layout ▸ Unlock this model,
  the editor's Unlock button) works, and is remembered for that file on this
  computer. The line stays in the file.
- ``# PsyNeuView: protected permanently`` — read only, and PsyNeuView offers
  no unlock. Removing the line outside PsyNeuView (another editor, git) is
  the only way to change it.

Because the line is in the file, it travels with the repo and git: everyone
who opens the file in PsyNeuView sees the same rule. It is a convention, not
security — anyone can edit the file in another program. The prefix names
PsyNeuView on purpose, so it can't be mistaken for a PsyNeuLink setting.

**Where the line is looked for.** Anywhere in the file's leading comment
block: the lines before the first one that is neither blank nor a comment.
That is where the standard header (``# PsyNeuLink Model File``) sits, so the
line can go beside it, and a commented-out ``# PsyNeuView: protected`` in the
middle of a model (an example in a docstring, say) never counts. Matching is
case-insensitive and tolerant of spaces: ``#psyneuview:PROTECTED`` and
``#  PsyNeuView :  protected   permanently`` both count. Anything else after
the level (``# PsyNeuView: protected, please``) does not, so a typo reads as
no protection rather than a guess.

**Where an unlock is remembered.** In PsyNeuView's preferences file
(``~/.psynewview.json``, ``protected_models_unlocked``: a list of resolved
file paths), the same place the protected checkouts are kept
(``pnl_source_guard``). Not in the layout file: that file sits beside the
model and may be committed with it, and an unlock is one person's choice on
one computer, while the line is the file's own statement for everyone.

The rules this feeds, and their order, are in ``edit_lock``.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Literal, Optional

from app.services import app_settings
from app.services.app_config import app_config_path

Level = Literal["protected", "permanent"]

PROTECTED: Level = "protected"
PERMANENT: Level = "permanent"

#: Preferences key: resolved paths of ``protected`` files unlocked on this
#: computer. A ``protected permanently`` file is never added.
UNLOCKED_KEY = "protected_models_unlocked"

# "# PsyNeuView: protected" or "# PsyNeuView: protected permanently", any
# case, any spacing around the words, nothing else on the line.
_LINE = re.compile(r"^\s*#\s*psyneuview\s*:\s*protected(\s+permanently)?\s*$", re.IGNORECASE)


def _header(source: str) -> list[str]:
    """The leading comment block: lines up to the first that is neither
    blank nor a comment. A ``#!`` line or an encoding line is a comment too."""
    lines: list[str] = []
    for line in source.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            break
        lines.append(line)
    return lines


def level_in_source(source: str) -> Optional[Level]:
    """The protection the text asks for, or None. If both lines are present
    the stricter one wins."""
    found: Optional[Level] = None
    for line in _header(source):
        match = _LINE.match(line)
        if not match:
            continue
        if match.group(1):
            return PERMANENT
        found = PROTECTED
    return found


def level(path: str | Path) -> Optional[Level]:
    """The protection the file on disk asks for, or None (also when it can't
    be read: an unreadable file is not a protected one, and the write that
    follows will say what's wrong with it)."""
    try:
        text = Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    return level_in_source(text)


def strip_from_source(source: str) -> str:
    """The text without its protection lines, for **Save a copy as…**.

    A copy is the user's own file to work on, as the per-model lock already
    has it (``sidecar_copy`` drops the lock): it starts unprotected. Only the
    protection lines go; the rest of the header, and every other line, is
    kept exactly, line endings included.
    """
    header_len = len(_header(source))
    lines = source.splitlines(keepends=True)
    kept = [
        line for i, line in enumerate(lines)
        if not (i < header_len and _LINE.match(line.rstrip("\r\n")))
    ]
    return "".join(kept)


# ── unlocked on this computer ────────────────────────────────────────────

def _key(path: str | Path) -> str:
    try:
        return str(Path(path).resolve())
    except OSError:
        return str(path)


def _unlocked() -> set[str]:
    with app_settings._lock:
        return set(app_settings._read_config(app_config_path()).get(UNLOCKED_KEY, []) or [])


def is_unlocked_here(path: str | Path) -> bool:
    """Whether a ``protected`` file was unlocked on this computer."""
    return _key(path) in _unlocked()


def set_unlocked_here(path: str | Path, unlocked: bool) -> None:
    """Remember (or forget) that a ``protected`` file was unlocked here."""
    key = _key(path)
    config_path = app_config_path()
    with app_settings._lock:
        config = app_settings._read_config(config_path)
        paths = set(config.get(UNLOCKED_KEY, []) or [])
        if (key in paths) == unlocked:
            return
        (paths.add if unlocked else paths.discard)(key)
        if paths:
            config[UNLOCKED_KEY] = sorted(paths)
        else:
            config.pop(UNLOCKED_KEY, None)
        app_settings._write_config_atomic(config_path, config)
