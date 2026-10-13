"""Whether PsyNeuView may write a file that belongs to the active PsyNeuLink (#1225, #1305).

The PsyNeuLink library models and examples open in place: the file on screen
*is* a file inside the installed PsyNeuLink. What PsyNeuView may do to it
depends on where that PsyNeuLink came from:

- **GitHub** (a managed clone under the clone root, or a ``git+`` install
  such as "Latest development") and **PyPI** (a regular install, kept
  releases included): never written. Those installs are promised to match
  their source; an edit would silently break that promise. Someone who wants
  to change PsyNeuLink's files uses their own checkout and selects it in
  Settings ▸ Developer.
- **A local checkout** (an editable install anywhere else): the user's own
  repo, and editable by default — choosing it in Settings is the opt-in
  (#1305). Changing the model, or PsyNeuLink itself, and seeing it in
  PsyNeuView is the point of selecting a checkout. A checkout can still be
  *protected* from edits, per checkout, when the user says so.

Enforced where every model write happens (``file_writer.write_model_source``),
not only in the UI: a protection the UI alone enforces isn't one.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal, Optional, TypedDict
from urllib.parse import unquote

from app.services import app_settings, settings_info
from app.services.app_config import app_config_path
from app.services.clone_manager import clone_root

# Preferences key: resolved roots of local checkouts the user protected from
# edits (#1305). Absent from the list means editable.
PROTECTED_KEY = "psyneulink_checkouts_protected"

# The older opt-in list (#1225): roots the user allowed edits in back when a
# checkout was protected until they said otherwise. Still read, so a root
# allowed then stays editable; protecting a checkout drops it from here.
ALLOWED_KEY = "psyneulink_checkout_edits_allowed"

Kind = Literal["github", "pypi", "local"]


class PnlOwnership(TypedDict):
    kind: Kind
    root: str
    editable: bool
    message: str


class PsyNeuLinkFileIsProtected(Exception):
    """A write to a file of the active PsyNeuLink that isn't allowed."""

    def __init__(self, path: str, ownership: PnlOwnership):
        super().__init__(ownership["message"])
        self.path = path
        self.ownership = ownership


def _active_install() -> Optional[tuple[Kind, Path]]:
    """(kind, root) of the active PsyNeuLink, read fresh from disk."""
    pkg = settings_info.active_psyneulink_package_dir()
    if pkg is None:
        return None
    try:
        dist = settings_info.distribution("psyneulink")
        text = dist.read_text("direct_url.json")
        direct_url = json.loads(text) if text else {}
    except Exception:
        direct_url = {}
    url = direct_url.get("url", "") or ""
    editable = (direct_url.get("dir_info") or {}).get("editable") and url.startswith("file://")
    if not editable:
        # A regular install: its files are the package directory itself.
        # Installed from git (`pip install git+…@devel`, the Setup Wizard's
        # "Latest development version") it is GitHub's code, not PyPI's, and
        # must be called that (#1280). Read-only either way.
        if direct_url.get("vcs_info") or url.startswith("git+") or "github.com" in url:
            return "github", pkg.resolve()
        return "pypi", pkg.resolve()
    root = Path(unquote(url[len("file://"):])).resolve()
    try:
        root.relative_to(clone_root().resolve())
        return "github", root
    except ValueError:
        return "local", root


def active_kind() -> Optional[Kind]:
    """Where the active PsyNeuLink came from, or None if none is installed."""
    active = _active_install()
    return active[0] if active else None


def _roots(key: str) -> set[str]:
    with app_settings._lock:
        return set(app_settings._read_config(app_config_path()).get(key, []) or [])


def _local_checkout_editable(root: Path) -> bool:
    """Editable unless protected; a root from the old allow-list stays editable."""
    key = str(root)
    return key not in _roots(PROTECTED_KEY) or key in _roots(ALLOWED_KEY)


def _message(kind: Kind, root: Path, editable: bool) -> str:
    if kind == "local":
        if editable:
            return f"Editing your PsyNeuLink checkout at {root}: changes are saved to its files."
        return (
            f"This file is part of your PsyNeuLink checkout at {root}, which you've protected "
            "from edits. To change it, allow edits to this checkout: click its tag in the toolbar."
        )
    source = "GitHub" if kind == "github" else "PyPI"
    return (
        f"This file is part of PsyNeuLink from {source}, which PsyNeuView keeps identical to "
        "its source, so it can't be edited here. To edit PsyNeuLink's files, use your own "
        "checkout: Settings ▸ Developer."
    )


def ownership(path: str | Path) -> Optional[PnlOwnership]:
    """How the active PsyNeuLink owns ``path``, or None if it's not one of its files."""
    active = _active_install()
    if active is None:
        return None
    kind, root = active
    try:
        Path(path).resolve().relative_to(root)
    except (ValueError, OSError):
        return None
    editable = kind == "local" and _local_checkout_editable(root)
    return {"kind": kind, "root": str(root), "editable": editable, "message": _message(kind, root, editable)}


def guard_write(path: str | Path) -> None:
    """Refuse a write to a protected file of the active PsyNeuLink."""
    owned = ownership(path)
    if owned is not None and not owned["editable"]:
        raise PsyNeuLinkFileIsProtected(str(path), owned)


def set_checkout_protected(path: str | Path, protect: bool) -> PnlOwnership:
    """Protect from edits (or allow edits in) the local checkout that owns ``path``.

    Managed installs can't be changed either way: they are always protected.
    """
    owned = ownership(path)
    if owned is None or owned["kind"] != "local":
        raise ValueError(
            "Only your own PsyNeuLink checkout can be protected or allowed edits; "
            "a PsyNeuLink that PsyNeuView manages is always protected."
        )
    config_path = app_config_path()
    with app_settings._lock:
        config = app_settings._read_config(config_path)
        protected = set(config.get(PROTECTED_KEY, []) or [])
        (protected.add if protect else protected.discard)(owned["root"])
        config[PROTECTED_KEY] = sorted(protected)
        if protect and ALLOWED_KEY in config:
            # The old opt-in wins over protection, so protecting means leaving it.
            allowed = set(config.get(ALLOWED_KEY, []) or [])
            allowed.discard(owned["root"])
            config[ALLOWED_KEY] = sorted(allowed)
        app_settings._write_config_atomic(config_path, config)
    return ownership(path)  # type: ignore[return-value]
