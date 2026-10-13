"""Discover and browse model directories.

Model directories are resolved in this order:
1. PSYNEWVIEW_MODELS_DIR env var (colon-separated paths)
2. ~/.psynewview.json config file ({"model_dirs": [...]})
3. Default: see :func:`default_models_dir` (#1295) — on a Mac, a visible
   folder under ~/Documents; elsewhere ./models/ relative to the repo root.
"""

import json
import os
import re
import sys
from pathlib import Path

from app.services.app_config import app_config_path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
#: The checkout's own models/ folder: the default before #1295, and still the
#: default on Linux, in a container and on the hosted service.
REPO_MODELS_DIR = REPO_ROOT / "models"
DEFAULT_MODELS_DIR = REPO_MODELS_DIR

# The visible default for a new install on a Mac (#1295): the one place the
# folder's name is written. People name folders and files PsyNeuView makes for
# them with hyphens between words, PsyNeuView first (docs/where-things-live.md).
# The final name may still change with the naming decision recorded in
# docs/settings-etiquette.md; renaming it is a change to this line only.
VISIBLE_PROJECT_FOLDER = "Documents/PsyNeuView-My-Models"


def visible_default_models_dir() -> Path:
    """``~/Documents/PsyNeuView-My-Models``: where a new install on a Mac saves models."""
    return Path.home() / VISIBLE_PROJECT_FOLDER


def legacy_models_dirs() -> list[Path]:
    """Where earlier versions kept models: the Mac app's hidden folder
    (``~/.psyneuview/models``, PsyNeuView-MacApp, #1089) and the checkout's
    own ``models/``. Someone with models in one of these keeps it as their
    project folder, and is offered a move (#1295)."""
    return [Path.home() / ".psyneuview" / "models", REPO_MODELS_DIR]


def _platform() -> str:
    return sys.platform


def visible_default_applies() -> bool:
    """Whether this deployment gets the visible default: a Mac, running
    locally or inside the Mac app. A container, the hosted service and other
    operating systems keep the checkout's ``models/``."""
    from app.services import deployment_mode

    return _platform() == "darwin" and deployment_mode.current_mode() in (
        deployment_mode.LOCAL, deployment_mode.MAC_APP,
    )


def folder_has_models(folder: Path) -> bool:
    """True when at least one ``.py`` model is under ``folder`` (hidden and
    ``__pycache__`` folders aside). Stops at the first one found."""
    if not folder.is_dir():
        return False
    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if not d.startswith((".", "__"))]
        if any(f.endswith(".py") and not f.startswith(".") for f in files):
            return True
    return False


def default_models_dir() -> Path:
    """The project folder when neither the environment nor the preferences
    name one (#1295).

    A Mac gets the visible default, unless models already sit in one of the
    legacy folders: then that folder stays the project folder (nothing moves
    on its own; Settings offers the move once). Everywhere else, the
    checkout's ``models/``.
    """
    if not visible_default_applies():
        return REPO_MODELS_DIR
    for legacy in legacy_models_dirs():
        if folder_has_models(legacy):
            return legacy
    return visible_default_models_dir()

# Common abbreviations that should stay uppercase after title-casing
_ABBREVIATIONS = {
    "Ddm": "DDM", "Nn": "NN", "Rl": "RL", "Lca": "LCA", "Evc": "EVC", "Xor": "XOR",
    "Ego": "EGO", "Iscci": "ISC-CI", "Td": "TD",
}


# Joining words that stay lowercase inside a label: "Vectors and Matrices",
# not "Vectors And Matrices" (#45).
_SMALL_WORDS = {"And", "Of"}


def _format_label(stem: str) -> str:
    """Convert a filename stem to a display label with proper casing."""
    label = stem.replace("_", " ").title()
    for wrong, right in _ABBREVIATIONS.items():
        label = re.sub(rf'\b{wrong}\b', right, label)
    words = label.split(" ")
    return " ".join([words[0]] + [w.lower() if w in _SMALL_WORDS else w for w in words[1:]])


# The one variable read for the project folder. Settings shows this name when
# the folder is fixed by it (#1290); keep the two in step through this constant.
MODELS_DIR_ENV = "PSYNEWVIEW_MODELS_DIR"


def get_model_dirs() -> list[Path]:
    """Return the list of configured model directories."""
    dirs: list[Path] = []

    # 1. Environment variable
    env = os.environ.get(MODELS_DIR_ENV)
    if env:
        for p in env.split(":"):
            p = p.strip()
            if p:
                dirs.append(Path(p).expanduser().resolve())

    # 2. Config file
    config_file = app_config_path()
    if not dirs and config_file.exists():
        try:
            config = json.loads(config_file.read_text())
            for p in config.get("model_dirs", []):
                dirs.append(Path(p).expanduser().resolve())
        except (json.JSONDecodeError, TypeError):
            pass

    # 3. Default
    if not dirs:
        dirs.append(default_models_dir())

    return dirs


def list_models() -> list[dict]:
    """List all .py model files from configured directories."""
    models = []
    for dir_path in get_model_dirs():
        if not dir_path.exists():
            continue
        models.extend(scan_models(dir_path))
    return models


def scan_models(dir_path: Path) -> list[dict]:
    """The .py models under one folder, as the Open menu lists them."""
    models = []
    for py_file in sorted(dir_path.rglob("*.py")):
        rel = py_file.relative_to(dir_path)
        # Skip __pycache__, hidden files, etc. Checked inside the folder only,
        # so a folder that itself lives under a dot-folder still lists its models.
        if any(part.startswith((".", "__")) for part in rel.parts):
            continue
        models.append({
            "name": py_file.stem,
            "label": _format_label(py_file.stem),
            "path": str(py_file),
            "relative": str(rel),
            "directory": str(dir_path),
            "folder": str(rel.parent) if str(rel.parent) != "." else None,
        })
    return models


def browse_directory(path: str) -> dict:
    """Browse a directory, returning folders and .py files."""
    dir_path = Path(path).resolve()
    if not dir_path.exists() or not dir_path.is_dir():
        return {"path": str(dir_path), "folders": [], "files": []}

    folders = []
    files = []
    for item in sorted(dir_path.iterdir()):
        if item.name.startswith((".", "__")):
            continue
        if item.is_dir():
            folders.append({
                "name": item.name,
                "path": str(item),
            })
        elif item.suffix == ".py":
            files.append({
                "name": item.stem,
                "label": _format_label(item.stem),
                "path": str(item),
            })

    return {
        "path": str(dir_path),
        "parent": str(dir_path.parent) if dir_path != dir_path.parent else None,
        "folders": folders,
        "files": files,
    }


def get_default_save_dir() -> Path:
    """Return the first writable model directory (for Save As)."""
    dirs = get_model_dirs()
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)
        return d
    # Fallback
    fallback = default_models_dir()
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback
