"""AI assistant settings, stored and enforced by the backend (#179).

Kept in the same ``~/.psyneuview.json`` as the other app settings, under one
``assistant`` key, following :mod:`app_settings`. The defaults are the
contract's: off, no agent, no folders, suggest-only. Anything unset or
malformed in the file falls back to the default, so a hand-edited file can't
turn the assistant on or widen a permission by accident.

One clear consent (#369): ``confirm_raise`` from the page, which asks the user
first, is needed only to turn the assistant on, and to change where messages
go (the agent's type or server address) while it is on, since that changes
who receives the data. Every other change, widening or not, saves directly:
the page shows a current summary of what is shared and with whom instead of
asking each time. The agent has no route to any of this: settings are only
changed through the settings route, which is a page route on the same site.
"""

from __future__ import annotations

import copy
import threading
from pathlib import Path
from typing import Any

from app.services.app_config import app_config_path
from app.services.app_settings import _read_config, _write_config_atomic
from app.services.assistant import files as assistant_files

_KEY = "assistant"

AGENT_TYPES = ("none", "anthropic", "openai_compatible")
AUTONOMY_LEVELS = ("answer", "suggest", "app_edits")
SAVING_MODES = ("always_ask", "structured_without_asking")
FOLDER_ACCESS = ("read", "read_write")
VISIBILITY_KEYS = ("model", "selection", "errors", "results", "files")

#: The highest limits a session may be given, whatever the file says.
MAX_TOOL_CALLS = 200
MAX_MINUTES = 120
MAX_TOKENS = 10_000_000
LIMIT_KEYS = ("tool_calls", "minutes", "max_tokens")
SANDBOX_KEYS = ("all_runs", "require")

DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "agent": {"type": "none", "model": "", "base_url": ""},
    "folders": [],
    "autonomy": "suggest",
    "saving": "always_ask",
    "visibility": {"model": True, "selection": True, "errors": True, "results": False, "files": False},
    # max_tokens: the tokens the agent's service reports, input and output,
    # summed over the session; the turn ends with ``done: limit`` when reached.
    "limits": {"tool_calls": 25, "minutes": 10, "max_tokens": 100_000},
    "keep_log": True,
    # The operating-system sandbox for model runs (#311). all_runs: every
    # model run while the assistant is on, not only while something it wrote
    # is tracked (opening any shared model runs its code). require: the
    # assistant doesn't turn on where no sandbox can be applied.
    "sandbox": {"all_runs": True, "require": True},
}

_lock = threading.Lock()


class SettingsError(ValueError):
    """A value the settings can't take; routes answer 400."""


class RaiseNeedsConfirmation(Exception):
    """Turning the assistant on, or a new destination while it is on (#369),
    sent without ``confirm_raise``; the route answers 200 with
    ``needs_confirmation`` naming what needs consent, and saves nothing."""

    def __init__(self, raised: list[str]):
        super().__init__("raising a permission needs confirmation: " + ", ".join(raised))
        self.raised = raised


def defaults() -> dict:
    return copy.deepcopy(DEFAULTS)


def destination(agent: dict) -> str:
    """Where messages go for ``agent``, in plain words: the real address."""
    from app.services.assistant.agents import ANTHROPIC_URL

    if agent.get("type") == "anthropic":
        return agent.get("base_url") or ANTHROPIC_URL
    if agent.get("type") == "openai_compatible":
        return agent.get("base_url") or "(no server address yet)"
    return "nowhere (no agent)"


def get_settings(*, config_file: Path | None = None) -> dict:
    """The current settings, every field present, invalid parts defaulted."""
    path = config_file or app_config_path()
    with _lock:
        stored = _read_config(path).get(_KEY)
    return _normalize(stored if isinstance(stored, dict) else {})


def update_settings(changes: dict, *, confirm_raise: bool = False, config_file: Path | None = None) -> dict:
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
        raised = needs_consent(current, new)
        if raised and not confirm_raise:
            raise RaiseNeedsConfirmation(raised)
        _check_sandbox_for(current, new)
        config[_KEY] = new
        _write_config_atomic(path, config)
    return copy.deepcopy(new)


def is_enabled(*, config_file: Path | None = None) -> bool:
    return bool(get_settings(config_file=config_file)["enabled"])


def needs_consent(old: dict, new: dict) -> list[str]:
    """What in ``new`` needs the user's consent first (#369): turning the
    assistant on, or, while it stays on, sending messages somewhere new.
    Everything else saves directly. Plain English, for the page to show."""
    if new["enabled"] and not old["enabled"]:
        return ["turning the assistant on", f"sending messages to {destination(new['agent'])}"]
    destination_changed = (new["agent"]["type"], new["agent"]["base_url"]) != (old["agent"]["type"], old["agent"]["base_url"])
    # No agent, or an OpenAI-compatible one with no address yet, sends
    # nothing anywhere; the address, when it is given, is what asks.
    sends = new["agent"]["type"] == "anthropic" or bool(new["agent"]["base_url"])
    if old["enabled"] and new["enabled"] and destination_changed and sends:
        return [f"sending messages to {destination(new['agent'])} instead of {destination(old['agent'])}"]
    return []


class SandboxRequired(SettingsError):
    """Turning the assistant on where no sandbox can be applied, with
    ``sandbox.require`` set (#311). Routes answer 400 with the reason."""


def _check_sandbox_for(old: dict, new: dict) -> None:
    """The assistant turns on only where model runs can be sandboxed,
    unless the user has said it may run without (#311)."""
    if not new["enabled"] or not new["sandbox"]["require"]:
        return
    if old["enabled"] and old["sandbox"]["require"]:
        return  # already on under the same rule; the state is shown, not re-checked
    from app.services import os_sandbox

    if not os_sandbox.available():
        reason = os_sandbox.capability().get("reason") or "no sandbox on this system"
        raise SandboxRequired(
            "The assistant can't be turned on: model runs can't be sandboxed here "
            f"({reason}). Turn off \"Require the sandbox\" to use it without one."
        )


# ── validation ───────────────────────────────────────────────────────────


def _merge(current: dict, changes: dict) -> dict:
    merged = copy.deepcopy(current)
    for key, value in changes.items():
        if key == "confirm_raise":
            continue
        if key == "agent" and isinstance(value, dict) and isinstance(merged.get(key), dict):
            # A base_url belongs to the type it was given for: changing the
            # type without giving one drops it, so a custom address never
            # applies to another agent silently.
            kept = dict(merged[key])
            if "type" in value and value["type"] != kept.get("type") and "base_url" not in value:
                kept["base_url"] = ""
            merged[key] = {**kept, **value}
        elif key in ("visibility", "limits", "sandbox") and isinstance(value, dict) and isinstance(merged.get(key), dict):
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
    # An openai_compatible agent without a base_url is allowed to be stored
    # (the address field appears once the type is chosen); sending a message
    # is what needs the address, and make_agent says so then.
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
    if not isinstance(limits, dict) or set(limits) - set(LIMIT_KEYS):
        raise SettingsError(f"limits keys are {', '.join(LIMIT_KEYS)}")
    for key, cap in (("tool_calls", MAX_TOOL_CALLS), ("minutes", MAX_MINUTES), ("max_tokens", MAX_TOKENS)):
        value = limits.get(key, DEFAULTS["limits"][key])
        if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= cap:
            raise SettingsError(f"limits.{key} must be a whole number from 1 to {cap}")
        out["limits"][key] = value

    if not isinstance(doc.get("keep_log", True), bool):
        raise SettingsError("keep_log must be true or false")
    out["keep_log"] = doc.get("keep_log", True)

    sandbox = doc.get("sandbox", {})
    if not isinstance(sandbox, dict) or set(sandbox) - set(SANDBOX_KEYS):
        raise SettingsError(f"sandbox keys are {', '.join(SANDBOX_KEYS)}")
    for key in SANDBOX_KEYS:
        value = sandbox.get(key, DEFAULTS["sandbox"][key])
        if not isinstance(value, bool):
            raise SettingsError(f"sandbox.{key} must be true or false")
        out["sandbox"][key] = value
    return out


def _check_folder_allowed(path: str) -> None:
    """Folder designation rules are ``files.validate_folder``'s: home itself,
    system, app and install folders and hidden folders are refused."""
    try:
        assistant_files.validate_folder(path)
    except assistant_files.PathRefused as e:
        raise SettingsError(str(e)) from e


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


# ``files.py`` asks here for the designated folders, so the one place they
# are stored is the one place they are read from.
assistant_files.set_folders_provider(lambda: get_settings()["folders"])
