"""Where things live: every folder and source PsyNeuView uses (#1295).

Backs ``GET /api/locations`` for Settings ▸ About ▸ Environment ("Where
things live") and Settings ▸ Developer (the managed PsyNeuLink copies and the
checkouts PsyNeuView knows). Read-only, except :func:`remove_managed_copy`,
which deletes one managed copy under ``~/.psyneuview/sources`` — a folder
PsyNeuView itself created — and nothing else.

Sizes on disk are bounded: a managed PsyNeuLink clone is hundreds of
megabytes in tens of thousands of files, so each folder's size is walked
with a time cap, never following symlinks out of the folder, and cached for
a while. A size that hit the cap is reported as a lower bound
(``size_complete: false``).
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

from app.services import managed_layouts, source_history, working_copies
from app.services.app_config import app_config_path
from app.services.catalogs import list_catalogs
from app.services.clone_manager import _STATE_DIRNAME, clone_root
from app.services.settings_info import (
    _GITHUB_URL_REPO,
    _repo_root,
    active_psyneulink_package_dir,
    get_psyneulink_info,
    get_psyneuview_info,
)

logger = logging.getLogger(__name__)

#: Seconds a folder-size walk may take before it stops and reports a lower bound.
SIZE_WALK_BUDGET_S = 1.5
#: How long a computed size is reused before it is walked again.
SIZE_CACHE_TTL_S = 300.0

_size_cache: dict[str, tuple[float, int, bool]] = {}


class LocationError(ValueError):
    """A request about a location that can't be honoured, with the reason."""


# ── Sizes ─────────────────────────────────────────────────────────────


def folder_size(path: Path, *, budget_s: float = SIZE_WALK_BUDGET_S) -> tuple[int, bool]:
    """Bytes under ``path`` and whether the walk finished within ``budget_s``.

    Symlinks are counted as the link itself and never followed, so a link out
    of the folder adds nothing from elsewhere. Cached per path for
    :data:`SIZE_CACHE_TTL_S`.
    """
    key = str(path)
    now = time.monotonic()
    cached = _size_cache.get(key)
    if cached and now - cached[0] < SIZE_CACHE_TTL_S:
        return cached[1], cached[2]
    total = 0
    complete = True
    deadline = now + budget_s
    stack = [path]
    while stack:
        if time.monotonic() > deadline:
            complete = False
            break
        current = stack.pop()
        try:
            with os.scandir(current) as it:
                for entry in it:
                    try:
                        st = entry.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    total += st.st_size
                    if entry.is_dir(follow_symlinks=False):
                        stack.append(Path(entry.path))
        except OSError:
            continue
    _size_cache[key] = (now, total, complete)
    return total, complete


def forget_size(path: Path) -> None:
    _size_cache.pop(str(path), None)


# ── Managed PsyNeuLink copies ─────────────────────────────────────────


def _origin_repo(path: Path) -> str | None:
    """``owner/repo`` from the clone's origin, or None when it can't be read."""
    try:
        origin = subprocess.check_output(
            ["git", "config", "--get", "remote.origin.url"],
            cwd=str(path), stderr=subprocess.DEVNULL, timeout=2,
        ).decode().strip()
    except (OSError, subprocess.SubprocessError):
        return None
    match = _GITHUB_URL_REPO.search(origin)
    return match.group(1) if match else None


def _mtime(path: Path) -> float | None:
    try:
        return path.stat().st_mtime
    except OSError:
        return None


def _last_used(path: Path, repo: str | None, sources: list[dict]) -> float | None:
    """When this copy was last switched to or fetched: the newest of the
    remembered selections of its repo and the clone's last fetch."""
    candidates: list[float] = []
    if repo:
        for entry in sources:
            if entry["kind"] == "github" and (entry.get("repo") or "").lower() == repo.lower():
                candidates.append(float(entry.get("selected_at") or 0))
    for marker in (path / ".git" / "FETCH_HEAD", path.parent / _STATE_DIRNAME / f"{path.name}.json"):
        if (t := _mtime(marker)) is not None:
            candidates.append(t)
    best = max(candidates, default=0.0)
    return best or None


def _active_pnl_path() -> Path | None:
    info = get_psyneulink_info()
    if info.get("path"):
        return Path(info["path"]).resolve()
    pkg = active_psyneulink_package_dir()
    return pkg.resolve() if pkg else None


def _is_under(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except (ValueError, OSError):
        return False


def managed_copies() -> list[dict]:
    """The managed clones under the clone root, the one in use marked."""
    root = clone_root()
    if not root.is_dir():
        return []
    active = _active_pnl_path()
    sources = source_history.list_sources()
    out: list[dict] = []
    for entry in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        if entry.name.startswith(".") or not entry.is_dir() or entry.is_symlink():
            continue
        repo = _origin_repo(entry)
        size, complete = folder_size(entry)
        out.append({
            "name": entry.name,
            "path": str(entry),
            "repo": repo,
            "size_bytes": size,
            "size_complete": complete,
            "last_used": _last_used(entry, repo, sources),
            "in_use": active is not None and _is_under(active, entry),
        })
    return out


_SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def remove_managed_copy(name: str) -> str:
    """Delete the managed copy ``name`` — a folder PsyNeuView created under
    the clone root — and its state sidecar. Never the one in use, never
    anything outside the clone root, never through a symlink."""
    if not _SAFE_NAME.match(name or "") or name.startswith(".") or name == _STATE_DIRNAME:
        raise LocationError("That isn't the name of a managed copy.")
    root = clone_root()
    path = root / name
    if path.is_symlink() or not path.is_dir():
        raise LocationError(f"There's no managed copy named {name}.")
    if not _is_under(path, root) or path.resolve().parent != root.resolve():
        raise LocationError("Only a managed copy under the sources folder can be removed.")
    active = _active_pnl_path()
    if active is not None and _is_under(active, path):
        raise LocationError("That copy is the PsyNeuLink in use. Switch to another source first.")
    shutil.rmtree(path)
    sidecar = root / _STATE_DIRNAME / f"{name}.json"
    try:
        sidecar.unlink()
    except OSError:
        pass
    forget_size(path)
    return str(path)


# ── The whole picture ─────────────────────────────────────────────────


def psyneuview_location() -> dict:
    """The PsyNeuView this backend runs from: a git checkout, or a copy
    (the Mac app's included PsyNeuView is unpacked without its history)."""
    root = _repo_root()
    checkout = (root / ".git").exists()
    info = get_psyneuview_info()
    return {
        "path": str(root),
        "kind": "checkout" if checkout else "included",
        "editable": checkout,
        "version": info["version"],
        "commit": info["commit"],
    }


def psyneulink_location() -> dict:
    info = get_psyneulink_info()
    path = info.get("path")
    if not path:
        pkg = active_psyneulink_package_dir()
        path = str(pkg) if pkg else None
    editable = info["source"] == "editable"
    return {
        **info,
        "path": path,
        "editable": editable,
        "managed": info["source"] in ("github", "pypi"),
    }


def known_checkouts() -> list[dict]:
    """The user's own PsyNeuLink checkouts Settings has switched to (#1276)."""
    active = source_history.active_source_from_info(get_psyneulink_info())
    return [
        {
            "path": e["path"],
            "label": e.get("label"),
            "exists": not e["missing"],
            "in_use": e["active"],
        }
        for e in source_history.list_sources(active=active)
        if e["kind"] == "local"
    ]


def kept_releases() -> list[dict]:
    """The official releases kept under the releases folder, the one in use marked."""
    from app.services import pnl_releases

    in_use = pnl_releases.version_in_use()
    return [{**k, "in_use": k["version"] == in_use} for k in pnl_releases.kept_releases()]


def list_locations() -> dict:
    catalogs = list_catalogs()
    return {
        "psyneuview": psyneuview_location(),
        "psyneulink": psyneulink_location(),
        "projectFolder": catalogs["projectFolder"],
        "catalogs": [
            {"id": c["id"], "name": c["name"], "path": c["path"], "exists": c["exists"]}
            for c in catalogs["catalogs"]
        ],
        "appData": {
            "root": str(Path.home() / ".psyneuview"),
            "sources": str(clone_root()),
            "configFile": str(app_config_path()),
            # Where edits to included models are kept (#1319), and how the
            # last move there from an install's backend/ went, for Report a
            # Problem.
            "workingCopies": str(working_copies.working_copies_dir(create=False)),
            "workingCopiesFixedBy": working_copies.WORKING_DIR_ENV if working_copies.fixed_by_env() else None,
            "workingCopiesLastMigration": working_copies.last_migration(),
            # Where layouts and labels for read-only PsyNeuLink files are
            # kept (#1321), keyed by source so a reinstall can't lose them,
            # and how the last move there went.
            "layouts": str(managed_layouts.layouts_dir()),
            "layoutsFixedBy": managed_layouts.LAYOUTS_DIR_ENV if managed_layouts.fixed_by_env() else None,
            "layoutsLastMigration": managed_layouts.last_migration(),
        },
        "managedCopies": managed_copies(),
        "releasesDir": str(__import__("app.services.pnl_releases", fromlist=["releases_dir"]).releases_dir()),
        "keptReleases": kept_releases(),
        "checkouts": known_checkouts(),
    }
