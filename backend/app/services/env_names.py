"""PsyNeuView's environment variables, by their name and by the old one (#258).

The project was first spelled "PsyNewView", and its variables were
``PSYNEWVIEW_*``. They are ``PSYNEUVIEW_*`` now. The old names are still
accepted, so a Mac app, a CI workflow or a developer's shell that sets them
keeps working; the new name wins when both are set.
"""

from __future__ import annotations

import os
from typing import Optional

NEW_PREFIX = "PSYNEUVIEW_"
OLD_PREFIX = "PSYNEWVIEW_"


def env(name: str, default: Optional[str] = None) -> Optional[str]:
    """The value of ``PSYNEUVIEW_<name>``, else ``PSYNEWVIEW_<name>``, else ``default``."""
    for prefix in (NEW_PREFIX, OLD_PREFIX):
        value = os.environ.get(prefix + name)
        if value is not None:
            return value
    return default


def set_by(name: str) -> Optional[str]:
    """Which variable is setting ``name`` (to say so in the UI), or None."""
    for prefix in (NEW_PREFIX, OLD_PREFIX):
        if os.environ.get(prefix + name):
            return prefix + name
    return None
