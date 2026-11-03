"""AI assistant settings, stored and enforced by the backend (#179).

Kept in the same ``~/.psynewview.json`` as the other app settings, under one
``assistant`` key, following :mod:`app_settings`. The defaults are the
contract's: off, no agent, no folders, suggest-only. Anything unset or
malformed in the file falls back to the default, so a hand-edited file can't
turn the assistant on or widen a permission by accident.

Raising a permission needs ``confirm_raise`` from the page, which asks the user
first. Lowering one applies at once. The agent has no route to any of this:
settings are only changed through the settings route, which is a page route.
"""

from __future__ import annotations

import copy
import threading
from pathlib import Path
from typing import Any, Optional

from app.services.app_config import app_config_path
from app.services.app_settings import _read_config, _write_config_atomic

_KEY = "assistant"

AGENT_TYPES = ("none", "anthropic", "openai_compatible")
AUTONOMY_LEVELS = ("answer", "suggest", "app_edits")
SAVING_MODES = ("always_ask", "structured_without_asking")
FOLDER_ACCESS = ("read", "read_write")
VISIBILITY_KEYS = ("model", "selection", "errors", "results", "files")

#: The highest limits a session may be given, whatever the file says.
MAX_TOOL_CALLS = 200
MAX_MINUTES = 120

DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "agent": {"type": "none", "model": "", "base_url": ""},
    "folders": [],
    "autonomy": "suggest",
    "saving": "always_ask",
    "visibility": {"model": True, "selection": True, "errors": True, "results": False, "files": False},
    "limits": {"tool_calls": 25, "minutes": 10},
    "keep_log": True,
}

_lock = threading.Lock()


class SettingsError(ValueError):
    """A value the settings can't take; routes answer 400."""


class RaiseNeedsConfirmation(Exception):
    """A change that widens what the assistant may do, sent without
    ``confirm_raise``; routes answer 409 naming what would be raised."""

    def __init__(self, raised: list[str]):
        super().__init__("raising a permission needs confirmation: " + ", ".join(raised))
        self.raised = raised


def defaults() -> dict:
    return copy.deepcopy(DEFAULTS)


def get_settings(*, config_file: Optional[Path] = None) -> dict:
    """The current settings, every field present, invalid parts defaulted."""
    path = config_file or app_config_path()
    with _lock:
        stored = _read_config(path).get(_KEY)
    return _normalize(stored if isinstance(stored, dict) else {})


def update_settings(changes: dict, *, confirm_raise: bool = False, config_file: Optional[Path] = None) -> dict:
    """Apply ``changes`` (a partial or full settings document) and return the result.

    Raises :class:`SettingsError` on a bad value and
    :class:`RaiseNeedsConfirmation` when the change widens a permission and
    ``confirm_raise`` is false.
    """
    if not isinstance(changes, dict):
        raise SettingsError("settings must be an object")
    path = config_file or app_config_path()
    with _lock:
        config = _read_config(path)
        current = _normalize(config.get(_KEY) if isinstance(config.get(_KEY), dict) else {})
        merged = _merge(current, changes)
        new = _validate(merged)
        raised = permission_raises(current, new)
        if raised and not confirm_raise:
            raise RaiseNeedsConfirmation(raised)
        config[_KEY] = new
        _write_config_atomic(path, config)
    return copy.deepcopy(new)


def is_enabled(*, config_file: Optional[Path] = None) -> bool:
    return bool(get_settings(config_file=config_file)["enabled"])


def permission_raises(old: dict, new: dict) -> list[str]:
    """Plain-English names of every permission ``new`` widens over ``old``."""
    raised: list[str] = []
    if new["enabled"] and not old["enabled"]:
        raised.append("turning the assistant on")
    if AUTONOMY_LEVELS.index(new["autonomy"]) > AUTONOMY_LEVELS.index(old["autonomy"]):
        raised.append(f"autonomy from {old['autonomy']} to {new['autonomy']}")
    if new["saving"] != old["saving"] and new["saving"] == "structured_without_asking":
        raised.append("saving structured edits without asking")
    for key in VISIBILITY_KEYS:
        if new["visibility"][key] and not old["visibility"][key]:
            raised.append(f"sharing {key}")
    old_folders = {f["path"]: f["access"] for f in old["folders"]}
    for folder in new["folders"]:
        before = old_folders.get(folder["path"])
        if before is None:
            raised.append(f"allowing folder {folder['path']} ({folder['access']})")
        elif before == "read" and folder["access"] == "read_write":
            raised.append(f"writing in folder {folder['path']}")
    for key in ("tool_calls", "minutes"):
        if new["limits"][key] > old["limits"][key]:
            raised.append(f"limit {key} from {old['limits'][key]} to {new['limits'][key]}")
    return raised


# ── validation ───────────────────────────────────────────────────────────


def _merge(current: dict, changes: dict) -> dict:
    merged = copy.deepcopy(current)
    for key, value in changes.items():
        if key == "confirm_raise":
            continue
        if key in ("agent", "visibility", "limits") and isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = {**merged[key], **value}
        else:
            merged[key] = value
    return merged


def _validate(doc: dict) -> dict:
    """Strict validation for a document the page sent: unknown keys and bad
    values are errors rather than defaulted, so nothing is silently dropped."""
    unknown = set(doc) - set(DEFAULTS)
    if unknown:
        raise SettingsError(f"unknown settings: {', '.join(sorted(unknown))}")
    out = defaults()
    if not isinstance(doc.get("enabled", False), bool):
        raise SettingsError("enabled must be true or false")
    out["enabled"] = doc.get("enabled", False)

    agent = doc.get("agent", {})
    if not isinstance(agent, dict):
        raise SettingsError("agent must be an object")
    agent_type = agent.get("type", "none")
    if agent_type not in AGENT_TYPES:
        raise SettingsError(f"agent.type must be one of {', '.join(AGENT_TYPES)}")
    model = agent.get("model", "")
    base_url = agent.get("base_url", "")
    if not isinstance(model, str) or not isinstance(base_url, str):
        raise SettingsError("agent.model and agent.base_url must be strings")
    if base_url:
        from app.services.assistant.agents import check_base_url

        check_base_url(base_url)  # raises SettingsError
    if agent_type == "openai_compatible" and not base_url:
        raise SettingsError("an openai_compatible agent needs a base_url")
    out["agent"] = {"type": agent_type, "model": model.strip(), "base_url": base_url.strip()}

    folders = doc.get("folders", [])
    if not isinstance(folders, list):
        raise SettingsError("folders must be a list")
    seen: set[str] = set()
    out_folders = []
    for folder in folders:
        if not isinstance(folder, dict) or not isinstance(folder.get("path"), str) or not folder["path"].strip():
            raise SettingsError("each folder needs a path")
        access = folder.get("access", "read")
        if access not in FOLDER_ACCESS:
            raise SettingsError(f"folder access must be one of {', '.join(FOLDER_ACCESS)}")
        path = folder["path"].strip()
        _check_folder_allowed(path)
        if path in seen:
            raise SettingsError(f"folder listed twice: {path}")
        seen.add(path)
        out_folders.append({"path": path, "access": access})
    out["folders"] = out_folders

    if doc.get("autonomy", "suggest") not in AUTONOMY_LEVELS:
        raise SettingsError(f"autonomy must be one of {', '.join(AUTONOMY_LEVELS)}")
    out["autonomy"] = doc.get("autonomy", "suggest")
    if doc.get("saving", "always_ask") not in SAVING_MODES:
        raise SettingsError(f"saving must be one of {', '.join(SAVING_MODES)}")
    out["saving"] = doc.get("saving", "always_ask")

    visibility = doc.get("visibility", {})
    if not isinstance(visibility, dict) or set(visibility) - set(VISIBILITY_KEYS):
        raise SettingsError(f"visibility keys are {', '.join(VISIBILITY_KEYS)}")
    for key in VISIBILITY_KEYS:
        value = visibility.get(key, DEFAULTS["visibility"][key])
        if not isinstance(value, bool):
            raise SettingsError(f"visibility.{key} must be true or false")
        out["visibility"][key] = value

    limits = doc.get("limits", {})
    if not isinstance(limits, dict) or set(limits) - {"tool_calls", "minutes"}:
        raise SettingsError("limits keys are tool_calls and minutes")
    for key, cap in (("tool_calls", MAX_TOOL_CALLS), ("minutes", MAX_MINUTES)):
        value = limits.get(key, DEFAULTS["limits"][key])
        if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= cap:
            raise SettingsError(f"limits.{key} must be a whole number from 1 to {cap}")
        out["limits"][key] = value

    if not isinstance(doc.get("keep_log", True), bool):
        raise SettingsError("keep_log must be true or false")
    out["keep_log"] = doc.get("keep_log", True)
    return out


def _check_folder_allowed(path: str) -> None:
    """Folder designation rules are owned by ``files.py``; use its check when
    it is there, and a minimal one otherwise."""
    try:
        from app.services.assistant import files  # noqa: WPS433

        checker = getattr(files, "check_folder_designation", None)
    except ImportError:
        checker = None
    if checker is not None:
        try:
            checker(path)
        except Exception as e:  # the files module's own refusal type
            raise SettingsError(str(e)) from e
        return
    expanded = Path(path).expanduser()
    if not expanded.is_absolute():
        raise SettingsError(f"folder must be an absolute path: {path}")
    resolved = expanded.resolve()
    home = Path.home().resolve()
    if resolved in (home, Path("/")) or any(part.startswith(".") for part in resolved.parts):
        raise SettingsError(f"folder can't be designated: {path}")


def _normalize(stored: dict) -> dict:
    """Lenient read: any invalid part becomes its default."""
    out = defaults()
    try:
        return _validate({k: v for k, v in stored.items() if k in DEFAULTS})
    except SettingsError:
        pass
    # Field by field, so one bad entry doesn't discard the rest.
    for key in DEFAULTS:
        if key not in stored:
            continue
        trial = defaults()
        trial[key] = stored[key]
        try:
            out[key] = _validate(trial)[key]
        except SettingsError:
            continue
    return out
