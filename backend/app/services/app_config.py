"""The one place that resolves the user-preferences file path (#1025).

Four modules — :mod:`app_settings`, :mod:`model_dirs`, :mod:`file_history` and
:mod:`source_history` — all read and write the *same* ``~/.psyneuview.json``.
Each used to hardcode the path as its own import-time
constant, which made the path impossible to redirect as a whole: an override
applied to one module would isolate part of the file and leave the rest writing
to the real one, which is worse than no override because it *looks* isolated.

The file was first named ``.psynewview.json``, the project's first spelling. It
is ``.psyneuview.json`` now; an existing one is moved on first use, with the old
name left as a symlink to it (#258).

Resolution is deliberately **per call** rather than at import. A server started
by the e2e harness inherits the environment, and an import-time constant would
have been frozen before the test process could influence it.
"""

from __future__ import annotations

import os
from pathlib import Path

#: Redirects the preferences file. Set by the Playwright harness so end-to-end
#: tests cannot write to the developer's real ``~/.psyneuview.json``; also useful
#: for running two app instances against separate preferences.
CONFIG_ENV = "PSYNEUVIEW_CONFIG_FILE"

DEFAULT_CONFIG_FILE = Path.home() / ".psyneuview.json"
#: The file's first name, from when the project was spelled "PsyNewView" (#258).
LEGACY_CONFIG_FILE = Path.home() / ".psynewview.json"

_migrated = False


def migrate_legacy_config(new: Path = DEFAULT_CONFIG_FILE, old: Path = LEGACY_CONFIG_FILE) -> bool:
    """Move ``~/.psynewview.json`` to ``~/.psyneuview.json``, once (#258).

    The old name is left as a symlink to the new file, so anything still using
    it (a Mac app from before the rename, which seeds the project folder there,
    or a developer's script) reads and writes the same preferences: nothing is
    lost, and they never split into two files. Does nothing when the new file
    exists already, or there is no old one. True when it moved the file.
    """
    try:
        if new.exists() or new.is_symlink() or old.is_symlink() or not old.is_file():
            return False
        old.rename(new)
        old.symlink_to(new.name)
        return True
    except OSError:
        return False


def app_config_path() -> Path:
    """The preferences file to read and write.

    ``PSYNEUVIEW_CONFIG_FILE`` wins when set to a non-empty value; otherwise the
    real one in the user's home directory. The value is *not* required to exist
    — callers already treat a missing file as "no preferences yet".
    """
    override = os.environ.get(CONFIG_ENV, "").strip()
    if override:
        return Path(override).expanduser()
    global _migrated
    if not _migrated:
        _migrated = True
        migrate_legacy_config()
    return DEFAULT_CONFIG_FILE
