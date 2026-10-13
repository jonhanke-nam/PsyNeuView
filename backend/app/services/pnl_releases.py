"""The official PsyNeuLink releases on PyPI, and the ones kept locally (#1295 round 5).

Backs ``GET /api/settings/pnl-releases`` for General ▸ PsyNeuLink version:
every release, newest first, with its date, whether it can install on the
running Python, whether it is too old for run stepping, and whether a copy
is kept under ``~/.psyneuview/releases``.

PyPI's JSON is read with a short timeout and cached: an hour in memory, and
the last good copy on disk, so the list still shows offline. When PyPI can't
be reached and there is no copy, the kept releases alone are listed with
``offline: true``.

**Kept releases.** Installing an official release first downloads its wheel
or sdist into the releases folder, then installs it from there with its
dependencies resolved normally (``install_manager``); switching back to a
kept release reuses the download of PsyNeuLink itself, though a release
whose dependencies differ may still need the network. Removing a kept
release deletes that one file; never the release in use.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import threading
import time
from pathlib import Path
from typing import Optional

from packaging.specifiers import InvalidSpecifier, SpecifierSet
from packaging.version import InvalidVersion, Version

logger = logging.getLogger(__name__)

PYPI_URL = "https://pypi.org/pypi/psyneulink/json"

#: The first PsyNeuLink release with the ``_debugger`` hook (upstreamed in
#: 0.19.1.0). Anything older runs models but can't step runs, show value
#: pills or Run State (#470).
FIRST_DEBUGGER_HOOK_VERSION = "0.19.1.0"
LIMITED_REASON = "No run stepping, value pills or Run State: needs 0.19.1.0 or later"

CACHE_TTL_S = 3600.0
FETCH_TIMEOUT_S = 4.0

_lock = threading.Lock()
_memory: dict | None = None
_memory_at = 0.0


def releases_dir() -> Path:
    """Where kept releases and the PyPI copy live. ``PSYNEUVIEW_RELEASES_DIR``
    overrides it, so tests never touch the real one."""
    override = os.environ.get("PSYNEUVIEW_RELEASES_DIR")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".psyneuview" / "releases"


def _cache_file() -> Path:
    return releases_dir() / "pypi-psyneulink.json"


def running_python_version() -> str:
    v = sys.version_info
    return f"{v.major}.{v.minor}.{v.micro}"


# ── Reading PyPI ──────────────────────────────────────────────────────


def fetch_pypi(timeout: float = FETCH_TIMEOUT_S) -> dict:
    """PyPI's JSON for psyneulink. Raises on any failure; the caller falls back."""
    import httpx

    response = httpx.get(PYPI_URL, timeout=timeout, headers={"Accept": "application/json"})
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict) or not isinstance(payload.get("releases"), dict):
        raise ValueError("PyPI answered with something that isn't a release listing")
    return payload


def _release_date(files: list[dict]) -> Optional[str]:
    """The day the release's first file went up (``YYYY-MM-DD``)."""
    times = [f.get("upload_time_iso_8601") or f.get("upload_time") for f in files if isinstance(f, dict)]
    times = [t for t in times if isinstance(t, str) and t]
    return min(times)[:10] if times else None


def _requires_python(files: list[dict]) -> Optional[str]:
    for f in files:
        if isinstance(f, dict) and f.get("requires_python"):
            return str(f["requires_python"])
    return None


def _compatibility(requires_python: Optional[str], yanked: bool, python_version: str) -> tuple[bool, Optional[str]]:
    if yanked:
        return False, "Withdrawn by its authors"
    if not requires_python:
        return True, None
    try:
        spec = SpecifierSet(requires_python)
    except InvalidSpecifier:
        return True, None
    if Version(python_version) in spec:
        return True, None
    return False, f"Needs Python {requires_python}; this PsyNeuView runs Python {python_version}"


def parse_releases(payload: dict, python_version: Optional[str] = None,
                   kept: Optional[set[str]] = None) -> list[dict]:
    """Every release in the PyPI listing, newest first, with what the UI needs.
    Pure, so it is testable without the network."""
    python_version = python_version or running_python_version()
    kept = kept or set()
    hook = Version(FIRST_DEBUGGER_HOOK_VERSION)
    out: list[tuple[Version, dict]] = []
    for version, files in (payload.get("releases") or {}).items():
        try:
            parsed = Version(version)
        except InvalidVersion:
            continue
        files = [f for f in (files or []) if isinstance(f, dict)]
        if not files:
            continue
        yanked = all(bool(f.get("yanked")) for f in files)
        compatible, reason = _compatibility(_requires_python(files), yanked, python_version)
        limited = parsed < hook
        out.append((parsed, {
            "version": version,
            "released": _release_date(files),
            "requires_python": _requires_python(files),
            "yanked": yanked,
            "compatible": compatible,
            "reason": reason,
            "limited": limited,
            "limited_reason": LIMITED_REASON if limited else None,
            "kept": version in kept,
        }))
    out.sort(key=lambda pair: pair[0], reverse=True)
    return [entry for _, entry in out]


# ── Kept releases ─────────────────────────────────────────────────────

_KEPT_FILE = re.compile(r"^psyneulink-(?P<version>[0-9][^-]*?)(?:-py\d.*\.whl|\.tar\.gz|\.zip)$", re.IGNORECASE)


def kept_releases() -> list[dict]:
    """The release files under the releases folder, newest version first."""
    folder = releases_dir()
    if not folder.is_dir():
        return []
    found: list[tuple[Version, dict]] = []
    for entry in folder.iterdir():
        if entry.is_symlink() or not entry.is_file():
            continue
        match = _KEPT_FILE.match(entry.name)
        if not match:
            continue
        try:
            parsed = Version(match.group("version"))
        except InvalidVersion:
            continue
        st = entry.stat()
        found.append((parsed, {
            "version": match.group("version"),
            "path": str(entry),
            "size_bytes": st.st_size,
            "last_used": st.st_atime or st.st_mtime,
        }))
    found.sort(key=lambda pair: pair[0], reverse=True)
    return [entry for _, entry in found]


def kept_file_for(version: str) -> Optional[Path]:
    for entry in kept_releases():
        if entry["version"] == version:
            return Path(entry["path"])
    return None


def version_in_use() -> Optional[str]:
    """The PyPI release installed now, or None when the install isn't from PyPI."""
    from app.services.settings_info import get_psyneulink_info

    info = get_psyneulink_info()
    return info.get("version") if info.get("source") == "pypi" else None


class ReleaseError(ValueError):
    """A request about a kept release that can't be honoured, with the reason."""


def remove_kept(version: str) -> str:
    """Delete the kept file for ``version``. Never the release in use."""
    path = kept_file_for(version)
    if path is None:
        raise ReleaseError(f"No kept copy of PsyNeuLink {version}.")
    if version_in_use() == version:
        raise ReleaseError(f"PsyNeuLink {version} is the release in use. Switch to another first.")
    path.unlink()
    return str(path)


# ── The listing ───────────────────────────────────────────────────────


def _read_disk_copy() -> Optional[dict]:
    try:
        data = json.loads(_cache_file().read_text())
        return data if isinstance(data, dict) and isinstance(data.get("releases"), dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _write_disk_copy(payload: dict) -> None:
    try:
        releases_dir().mkdir(parents=True, exist_ok=True)
        _cache_file().write_text(json.dumps({"releases": payload.get("releases", {}), "fetched_at": time.time()}))
    except OSError as e:
        logger.warning("pnl_releases: couldn't keep a copy of the PyPI listing: %s", e)


def forget_cache() -> None:
    global _memory, _memory_at
    with _lock:
        _memory = None
        _memory_at = 0.0


def list_releases(*, python_version: Optional[str] = None) -> dict:
    """Every release newest first, with ``offline`` when PyPI couldn't be
    reached (then the last good copy, or the kept releases alone)."""
    global _memory, _memory_at
    kept = {k["version"] for k in kept_releases()}
    with _lock:
        payload = _memory if _memory and time.monotonic() - _memory_at < CACHE_TTL_S else None
    offline = False
    if payload is None:
        try:
            payload = fetch_pypi()
            with _lock:
                _memory, _memory_at = payload, time.monotonic()
            _write_disk_copy(payload)
        except Exception as e:  # noqa: BLE001 — any failure means: use what we have
            logger.info("pnl_releases: PyPI unreachable (%s); using what is kept", e)
            offline = True
            payload = _read_disk_copy()
    if payload is not None:
        releases = parse_releases(payload, python_version, kept)
        listed = {r["version"] for r in releases}
    else:
        releases, listed = [], set()
    # A kept release that PyPI doesn't list (or that we have no listing for)
    # is still something that can be installed.
    for version in sorted(kept - listed, key=Version, reverse=True):
        releases.append({
            "version": version, "released": None, "requires_python": None, "yanked": False,
            "compatible": True, "reason": None,
            "limited": Version(version) < Version(FIRST_DEBUGGER_HOOK_VERSION),
            "limited_reason": LIMITED_REASON if Version(version) < Version(FIRST_DEBUGGER_HOOK_VERSION) else None,
            "kept": True,
        })
    releases.sort(key=lambda r: Version(r["version"]), reverse=True)
    return {
        "releases": releases,
        "offline": offline,
        "python_version": python_version or running_python_version(),
        "in_use": version_in_use(),
        "releases_dir": str(releases_dir()),
    }
