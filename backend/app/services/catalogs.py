"""The user's own Open-menu catalogs, and their project folder (#1229).

The Open menu's folders used to be fixed. Now:

- **My Project Folder** is the first model directory, where new models are
  saved. It can be moved to another folder, but not removed: new models have
  to land somewhere.
- **Catalogs** are any other folders the user adds. Each is its own Open-menu
  section listing that folder's models. Removing one takes it off the menu and
  never touches the files.

Stored in the preferences file, beside ``model_dirs``: the folders are on the
machine running the backend, so that's where the list belongs. Not offered on
the hosted deployment, where adding a folder would expose the server's disk to
everyone using it.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import TypedDict

from app.services import app_settings, deployment_mode
from app.services.app_config import app_config_path
from app.services.model_dirs import MODELS_DIR_ENV, get_model_dirs, scan_models

CATALOGS_KEY = "catalogs"


class Catalog(TypedDict):
    id: str
    name: str
    path: str


class CatalogError(ValueError):
    """A catalog change that can't be made, with a reason to show the user."""


def _catalog_id(path: Path) -> str:
    return hashlib.sha1(str(path).encode()).hexdigest()[:10]


def _read() -> dict:
    return app_settings._read_config(app_config_path())


def _stored(config: dict) -> list[Catalog]:
    items = config.get(CATALOGS_KEY) or []
    return [c for c in items if isinstance(c, dict) and c.get("id") and c.get("path")]


def _check_allowed() -> None:
    if deployment_mode.current_mode() == deployment_mode.HOSTED:
        raise CatalogError("Catalogs can't be changed on the shared hosted PsyNeuView.")


def _existing_dir(path: str) -> Path:
    resolved = Path(path).expanduser().resolve()
    if not resolved.is_dir():
        raise CatalogError(f"No folder at {resolved}.")
    return resolved


def list_catalogs() -> dict:
    """The project folder and the user's catalogs, each with its models."""
    with app_settings._lock:
        stored = _stored(_read())
    project = get_model_dirs()[0]
    catalogs = []
    for c in stored:
        p = Path(c["path"])
        catalogs.append({
            **c,
            "exists": p.is_dir(),
            "models": scan_models(p) if p.is_dir() else [],
        })
    return {
        "projectFolder": {
            "path": str(project),
            "exists": project.is_dir(),
            # Set by the environment, so Settings can't change it. Settings
            # names the variable that set it rather than guessing (#1290).
            "fixed": bool(os.environ.get(MODELS_DIR_ENV)),
            "fixedBy": MODELS_DIR_ENV if os.environ.get(MODELS_DIR_ENV) else None,
        },
        "catalogs": catalogs,
        "canEdit": deployment_mode.current_mode() != deployment_mode.HOSTED,
    }


def add_catalog(path: str, name: str | None = None) -> Catalog:
    _check_allowed()
    folder = _existing_dir(path)
    if folder in get_model_dirs():
        raise CatalogError("That folder is already your project folder.")
    catalog: Catalog = {
        "id": _catalog_id(folder),
        "name": (name or "").strip() or folder.name,
        "path": str(folder),
    }
    with app_settings._lock:
        config = _read()
        stored = _stored(config)
        if any(c["id"] == catalog["id"] for c in stored):
            raise CatalogError("That folder is already a catalog.")
        config[CATALOGS_KEY] = [*stored, catalog]
        app_settings._write_config_atomic(app_config_path(), config)
    return catalog


def rename_catalog(catalog_id: str, name: str) -> Catalog:
    _check_allowed()
    name = name.strip()
    if not name:
        raise CatalogError("A catalog needs a name.")
    with app_settings._lock:
        config = _read()
        stored = _stored(config)
        for c in stored:
            if c["id"] == catalog_id:
                c["name"] = name
                config[CATALOGS_KEY] = stored
                app_settings._write_config_atomic(app_config_path(), config)
                return c
    raise CatalogError("No such catalog.")


def remove_catalog(catalog_id: str) -> None:
    """Take a catalog off the menu. The folder and its files are left alone."""
    _check_allowed()
    with app_settings._lock:
        config = _read()
        stored = _stored(config)
        kept = [c for c in stored if c["id"] != catalog_id]
        if len(kept) == len(stored):
            raise CatalogError("No such catalog.")
        config[CATALOGS_KEY] = kept
        app_settings._write_config_atomic(app_config_path(), config)


def set_project_folder(path: str) -> str:
    """Move the project folder. Other configured model folders stay as they are."""
    _check_allowed()
    if os.environ.get(MODELS_DIR_ENV):
        raise CatalogError(f"The project folder is set by {MODELS_DIR_ENV}, so it can't be changed here.")
    folder = _existing_dir(path)
    with app_settings._lock:
        config = _read()
        rest = [p for p in (config.get("model_dirs") or [])[1:]
                if Path(p).expanduser().resolve() != folder]
        config["model_dirs"] = [str(folder), *rest]
        # A folder can't be both the project folder and a catalog.
        config[CATALOGS_KEY] = [c for c in _stored(config) if c["id"] != _catalog_id(folder)]
        app_settings._write_config_atomic(app_config_path(), config)
    return str(folder)
