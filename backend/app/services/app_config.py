"""The one place that resolves the user-preferences file path (#1025).

Four modules — :mod:`app_settings`, :mod:`model_dirs`, :mod:`file_history` and
:mod:`source_history` — all read and write the *same* ``~/.psynewview.json``.
Each used to hardcode ``Path.home() / ".psynewview.json"`` as its own import-time
constant, which made the path impossible to redirect as a whole: an override
applied to one module would isolate part of the file and leave the rest writing
to the real one, which is worse than no override because it *looks* isolated.

Note the legacy misspelling in the filename — ``.psynewview.json``, not
``.psyneuview.json``. It is load-bearing; existing installs have that file.

Resolution is deliberately **per call** rather than at import. A server started
by the e2e harness inherits the environment, and an import-time constant would
have been frozen before the test process could influence it.
"""

from __future__ import annotations

import os
from pathlib import Path

#: Redirects the preferences file. Set by the Playwright harness so end-to-end
#: tests cannot write to the developer's real ``~/.psynewview.json``; also useful
#: for running two app instances against separate preferences.
CONFIG_ENV = "PSYNEUVIEW_CONFIG_FILE"

DEFAULT_CONFIG_FILE = Path.home() / ".psynewview.json"


def app_config_path() -> Path:
    """The preferences file to read and write.

    ``PSYNEUVIEW_CONFIG_FILE`` wins when set to a non-empty value; otherwise the
    real one in the user's home directory. The value is *not* required to exist
    — callers already treat a missing file as "no preferences yet".
    """
    override = os.environ.get(CONFIG_ENV, "").strip()
    if override:
        return Path(override).expanduser()
    return DEFAULT_CONFIG_FILE
