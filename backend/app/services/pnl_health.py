"""Whether the installed PsyNeuLink actually works (#1143).

Settings reports PsyNeuLink's version, source and branch. None of that
establishes that it *works*: `importlib.metadata` reads installed metadata,
which says a package was installed once — not that ``import psyneulink``
succeeds now.

The two come apart in the case we actively encourage. An editable install from
a local checkout keeps its metadata in the venv, and that metadata outlives the
source folder being moved, renamed, deleted, or switched to a branch that does
not import. The app would report a healthy version and then fail at the first
model load with a traceback instead of a diagnosis.

What is reported here is deliberately specific, because the remedies differ. A
generic "PsyNeuLink is unavailable" would be true and useless.
"""

from __future__ import annotations

import json
from importlib.metadata import PackageNotFoundError, distribution
from pathlib import Path
from typing import Literal, Optional, TypedDict

Status = Literal["ok", "not_installed", "source_missing", "import_failed"]


class Health(TypedDict):
    status: Status
    detail: str
    #: The folder an editable install points at, when that is the problem.
    path: Optional[str]


def _editable_path(dist) -> Optional[Path]:
    """The directory an editable install points at, or None.

    pip records this in PEP 610 ``direct_url.json``. Read rather than guessed:
    the path is what the user would need to restore or repoint.
    """
    try:
        raw = dist.read_text("direct_url.json")
    except Exception:
        return None
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    url = data.get("url") or ""
    if not url.startswith("file://"):
        return None
    if not (data.get("dir_info") or {}).get("editable"):
        return None
    return Path(url[len("file://") :])


def check() -> Health:
    """Report whether PsyNeuLink is installed, present, and importable.

    Ordered so the most specific answer wins. A missing source folder is
    checked before attempting the import: the import would fail anyway, but
    "the folder this points at is gone, here is the path" is a far more useful
    thing to be told than an ImportError.
    """
    try:
        dist = distribution("psyneulink")
    except PackageNotFoundError:
        return {
            "status": "not_installed",
            "detail": "PsyNeuLink is not installed in this environment.",
            "path": None,
        }

    source = _editable_path(dist)
    if source is not None and not source.exists():
        return {
            "status": "source_missing",
            "detail": (
                f"PsyNeuLink is installed from {source}, but that folder is no "
                "longer there. Point it at the folder again, or reinstall."
            ),
            "path": str(source),
        }

    try:
        import psyneulink  # noqa: F401
    except Exception as exc:
        # The actual error, not a summary of it: an ImportError naming a
        # missing dependency is what someone needs to act on.
        return {
            "status": "import_failed",
            "detail": f"PsyNeuLink is installed but will not import: {exc}",
            "path": str(source) if source else None,
        }

    return {
        "status": "ok",
        "detail": f"PsyNeuLink {dist.version} is installed and imports.",
        "path": str(source) if source else None,
    }


def is_usable(health: Health) -> bool:
    """Whether model loading can be expected to work at all."""
    return health["status"] == "ok"
