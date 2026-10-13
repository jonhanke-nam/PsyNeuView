"""Small app-wide user preferences persisted in ``~/.psynewview.json`` — the
same config file that holds ``model_dirs`` / ``source_history`` (note the legacy
misspelling of the filename; it is *not* ``.psyneuview.json``).

Two settings live here, both in Settings ▸ General ▸ Model files:

* the **global sidecar-placement default** (#933): where new sidecars go for a
  model that has no explicit per-model override — ``lateral`` (next to the
  ``.py``), ``dotfolder`` (a hidden ``.psyneuview/``), or ``auto`` (the
  built-in rule);
* **autosave** (#1347): off (the default), or on with the number of seconds
  without an edit after which the page saves. The page does the saving, with
  the same request a manual Save sends; the backend only remembers the choice.

Reads degrade to the defaults on a missing/malformed file; writes are atomic +
lock-serialized, the same pattern as :mod:`source_history`.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Optional

from app.services.app_config import app_config_path

_PLACEMENT_KEY = "sidecar_placement_default"
_VALID = ("auto", "lateral", "dotfolder")

_AUTOSAVE_KEY = "autosave"
#: Autosave is off unless the user turns it on (#1347): with it off, a model's
#: ``.py`` changes only when Save is pressed, which is what an external editor
#: (PyCharm) open on the same file needs (#1029, #1027).
AUTOSAVE_DEFAULT_ENABLED = False
AUTOSAVE_DEFAULT_SECONDS = 10
AUTOSAVE_MIN_SECONDS = 2
AUTOSAVE_MAX_SECONDS = 600

_lock = threading.Lock()


def get_default_placement(*, config_file: Optional[Path] = None) -> Optional[str]:
    """The global placement default, or ``None`` if unset/invalid (caller then
    falls back to ``auto``)."""
    path = config_file or app_config_path()
    with _lock:
        value = _read_config(path).get(_PLACEMENT_KEY)
    return value if value in _VALID else None


def set_default_placement(value: Optional[str], *, config_file: Optional[Path] = None) -> None:
    """Persist the global placement default. ``None`` (or an invalid value)
    clears it, so the built-in ``auto`` rule applies again.

    Raises ``ValueError`` for a non-null value outside the accepted set, so a
    route can surface a 400 rather than silently writing garbage."""
    if value is not None and value not in _VALID:
        raise ValueError(f"invalid placement: {value!r} (expected one of {_VALID} or null)")
    path = config_file or app_config_path()
    with _lock:
        config = _read_config(path)
        if value is None:
            config.pop(_PLACEMENT_KEY, None)
        else:
            config[_PLACEMENT_KEY] = value
        _write_config_atomic(path, config)


def get_autosave(*, config_file: Optional[Path] = None) -> dict:
    """``{"enabled": bool, "seconds": int}``; the defaults for anything unset
    or invalid, so a hand-edited file can't switch autosave on by accident."""
    path = config_file or app_config_path()
    with _lock:
        stored = _read_config(path).get(_AUTOSAVE_KEY)
    stored = stored if isinstance(stored, dict) else {}
    enabled = stored.get("enabled")
    seconds = stored.get("seconds")
    return {
        "enabled": enabled if isinstance(enabled, bool) else AUTOSAVE_DEFAULT_ENABLED,
        "seconds": seconds if _valid_seconds(seconds) else AUTOSAVE_DEFAULT_SECONDS,
    }


def set_autosave(
    *,
    enabled: Optional[bool] = None,
    seconds: Optional[int] = None,
    config_file: Optional[Path] = None,
) -> dict:
    """Change either or both parts of the autosave setting; returns the result.

    Raises ``ValueError`` for seconds outside
    ``AUTOSAVE_MIN_SECONDS``–``AUTOSAVE_MAX_SECONDS``, so a route can answer 400
    rather than store a value the page would have to second-guess."""
    if seconds is not None and not _valid_seconds(seconds):
        raise ValueError(
            f"seconds must be a whole number from {AUTOSAVE_MIN_SECONDS} to {AUTOSAVE_MAX_SECONDS}"
        )
    path = config_file or app_config_path()
    with _lock:
        config = _read_config(path)
        current = config.get(_AUTOSAVE_KEY)
        current = dict(current) if isinstance(current, dict) else {}
        if enabled is not None:
            current["enabled"] = bool(enabled)
        if seconds is not None:
            current["seconds"] = int(seconds)
        config[_AUTOSAVE_KEY] = current
        _write_config_atomic(path, config)
    return get_autosave(config_file=path)


def _valid_seconds(value: object) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and AUTOSAVE_MIN_SECONDS <= value <= AUTOSAVE_MAX_SECONDS
    )


def _read_config(path: Path) -> dict:
    """Best-effort read of the JSON config file. Returns ``{}`` on any failure."""
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _write_config_atomic(path: Path, config: dict) -> None:
    """Write ``config`` to ``path`` atomically via tempfile + os.replace, so a
    crash mid-write never leaves half-written JSON (mirrors ``source_history``)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".psynewview.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(config, f, indent=2, sort_keys=True)
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
