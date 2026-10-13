"""Where layout and label files for a read-only PsyNeuLink file live (#1321).

A PsyNeuLink library model opens in place: the file on screen is a file of
the PsyNeuLink in use. When that PsyNeuLink is one PsyNeuView manages — a
GitHub copy under ``~/.psyneuview/sources``, a ``git+`` install or an
official release from PyPI in the Python environment's ``site-packages``, a
kept release — the file itself is read only (``pnl_source_guard``), but the
layout and label files PsyNeuView writes for it are PsyNeuView's, not
PsyNeuLink's: moving a node is still recorded.

Until #1321 only the managed GitHub copies had those companions redirected
out of the tree (``clone_manager.artifact_path``, #349, under
``sources/.state/artifacts``). For a ``git+`` or PyPI install they went into
a hidden ``.psyneuview/`` folder *inside site-packages* — untidy, inside a
folder PsyNeuView treats as read only, and lost whenever PsyNeuLink was
reinstalled, which an automatic update does (#1304).

Now there is one rule, :func:`redirect_path`, for every managed kind::

    ~/.psyneuview/layouts/<source key>/<path relative to the source>

- the **source key** names where the PsyNeuLink came from, not its version,
  so a layout survives a reinstall or a switch of release: a GitHub repo is
  keyed as its managed-copy folder name (``PsyNeuLink-PrincetonUniversity``),
  whether installed as a copy or straight from ``git+``; every official
  release shares ``PsyNeuLink-PyPI``;
- the **relative path** mirrors the package's own layout
  (``psyneulink/library/models/Cohen_Huston1994.pnlview.json``), the same for
  a copy and a site-packages install, so files for different models never
  collide;
- inside that tree the files are *lateral* (next to where the ``.py`` would
  be): the hidden dot-folder buys nothing in a folder that is hidden anyway.

A path outside every managed PsyNeuLink — a file of the user's, or of their
own editable checkout — comes back unchanged: those sidecars stay beside the
file, as before (``sidecar_placement`` decides lateral or dot-folder).

And one migration, :func:`migrate_legacy_layouts`, run once at startup. It
looks in the two old places — the ``sources/.state/artifacts`` tree, and
inside the active read-only install (files PsyNeuView added, never files the
install's own ``RECORD`` lists) — and moves what it finds, under the
folder-move policy of :mod:`project_folder` / :mod:`working_copies`:

- copy, verify byte for byte, and only then remove the original; on any
  failure the original stays and the failure is recorded;
- a file already in the new folder is never overwritten: identical, the old
  one is simply removed; different, the new one is kept, the old one is left
  in place, and the conflict recorded;
- the outcome (``layouts_last_migration``) goes in the preferences file so
  Report a Problem can include it;
- idempotent: a second run finds nothing and changes nothing.

Skipped when ``PSYNEUVIEW_LAYOUTS_DIR`` is set (the test suites redirect the
folder and must never move a developer's real files into a temp dir) and in
container or hosted deployments.
"""

from __future__ import annotations

import filecmp
import json
import logging
import os
import re
import shutil
import time
from pathlib import Path
from typing import Optional

from app.services import app_settings, deployment_mode
from app.services.app_config import app_config_path
from app.services.clone_manager import (
    _PNV_ARTIFACT_DIRNAME,
    _PNV_ARTIFACT_SUFFIXES,
    _STATE_DIRNAME,
    _slug_dirname,
    clone_root,
)

logger = logging.getLogger(__name__)

LAYOUTS_DIR_ENV = "PSYNEUVIEW_LAYOUTS_DIR"
MIGRATION_KEY = "layouts_last_migration"

#: The source key every official release shares (``Name-owner`` style, like
#: the managed-copy folders, so ``ls ~/.psyneuview/layouts`` reads the same).
PYPI_KEY = "PsyNeuLink-PyPI"

#: Hidden folder that may hold a model's sidecars (sidecar_placement).
_DOT_DIRNAME = ".psyneuview"

#: The companions PsyNeuView writes beside a model: the sidecars and the
#: pre-edit backups. Same list the managed-copy purge uses.
ARTIFACT_SUFFIXES = _PNV_ARTIFACT_SUFFIXES

_GITHUB_REPO = re.compile(r"github\.com[/:]([^/]+/[^/\s#?]+?)(?:\.git)?/?$")


# ── Where ─────────────────────────────────────────────────────────────


def fixed_by_env() -> bool:
    """Whether ``PSYNEUVIEW_LAYOUTS_DIR`` decides the folder."""
    return bool(os.environ.get(LAYOUTS_DIR_ENV))


def default_layouts_dir() -> Path:
    """The per-user folder: ``~/.psyneuview/layouts``."""
    return Path.home() / ".psyneuview" / "layouts"


def layouts_dir(*, create: bool = False) -> Path:
    """Where layouts and labels for read-only PsyNeuLink files are kept.

    ``PSYNEUVIEW_LAYOUTS_DIR`` when set; otherwise the per-user default.
    Created when ``create`` is True (a writer); a caller that only reports
    the path leaves it alone.
    """
    env = os.environ.get(LAYOUTS_DIR_ENV)
    d = Path(env).expanduser() if env else default_layouts_dir()
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return d


def legacy_clone_artifacts_dir() -> Path:
    """Where a managed copy's companions went before #1321 (#349)."""
    return clone_root() / _STATE_DIRNAME / _PNV_ARTIFACT_DIRNAME


def source_key_for_url(url: str) -> str:
    """The source key for a ``git+`` install, from the URL pip recorded.

    A GitHub repo gets the managed-copy folder name for that repo
    (``PsyNeuLink-PrincetonUniversity``), so a copy and a ``git+`` install of
    the same repo share their layouts. Any other git host gets a readable
    slug of the URL.
    """
    url = (url or "").strip()
    if url.startswith("git+"):
        url = url[len("git+"):]
    match = _GITHUB_REPO.search(url)
    if match:
        return _slug_dirname(match.group(1))
    bare = re.sub(r"^[a-z+]+://", "", url)
    bare = re.sub(r"\.git$", "", bare)
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", bare).strip("-") or "unknown"
    return f"PsyNeuLink-git-{slug}"


def _active_read_only_install() -> Optional[tuple[str, Path]]:
    """``(source key, package dir)`` of the active PsyNeuLink when it is a
    read-only install in site-packages (a ``git+`` install or a release);
    None for an editable install (a managed copy is handled by its own
    rule; a local checkout keeps its sidecars beside the file) or when no
    PsyNeuLink is installed."""
    from app.services import settings_info

    try:
        pkg = settings_info.active_psyneulink_package_dir()
    except Exception:  # noqa: BLE001 — a path lookup must not fail on introspection
        return None
    if pkg is None:
        return None
    try:
        dist = settings_info.distribution("psyneulink")
        text = dist.read_text("direct_url.json")
        direct_url = json.loads(text) if text else {}
    except Exception:  # noqa: BLE001
        direct_url = {}
    if not isinstance(direct_url, dict):
        direct_url = {}
    url = direct_url.get("url", "") or ""
    if (direct_url.get("dir_info") or {}).get("editable") and url.startswith("file://"):
        return None
    if direct_url.get("vcs_info") or url.startswith("git+") or "github.com" in url:
        return source_key_for_url(url), pkg.resolve()
    return PYPI_KEY, pkg.resolve()


def managed_source(path: str | Path) -> Optional[tuple[str, Path]]:
    """``(source key, base)`` when ``path`` is inside a read-only PsyNeuLink,
    where ``base`` is the folder the stored relative path is taken from;
    None for anything else.

    - inside a managed copy ``<clone root>/<name>/…``: key ``<name>``, base
      the copy itself (so the relative path starts at the repo root, where
      the ``psyneulink`` package sits);
    - inside the active read-only install ``<site-packages>/psyneulink/…``:
      key from the install's origin, base ``<site-packages>`` (so the
      relative path starts with ``psyneulink/``, matching a copy's).
    """
    try:
        p = Path(path).resolve()
    except OSError:
        return None
    try:
        root = clone_root().resolve()
        rel = p.relative_to(root)
    except (ValueError, OSError):
        rel = None
    if rel is not None:
        if not rel.parts or rel.parts[0] == _STATE_DIRNAME:
            return None  # the clone root itself, or its state folder
        return rel.parts[0], root / rel.parts[0]
    install = _active_read_only_install()
    if install is None:
        return None
    key, pkg = install
    try:
        p.relative_to(pkg)
    except ValueError:
        return None
    return key, pkg.parent


def is_managed(path: str | Path) -> bool:
    """Whether ``path`` is inside a read-only PsyNeuLink (its companions are
    redirected to the layouts folder)."""
    return managed_source(path) is not None


def redirect_path(in_place: Path) -> Path:
    """Where a PsyNeuView companion of a model should actually be written.

    For a path outside every managed PsyNeuLink — the normal case, a file of
    the user's anywhere on disk — the path comes back unchanged. For a path
    that would land inside a read-only PsyNeuLink, it is remapped to
    ``<layouts dir>/<source key>/<path relative to the source>``. The parent
    directory is created so callers can write immediately; if that fails the
    in-place path is returned, as before #1321.
    """
    in_place = Path(in_place)
    managed = managed_source(in_place)
    if managed is None:
        return in_place
    key, base = managed
    try:
        rel = in_place.resolve().relative_to(base)
    except (ValueError, OSError):
        return in_place
    redirected = layouts_dir() / key / rel
    try:
        redirected.parent.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        logger.warning("managed_layouts: couldn't create %s: %s", redirected.parent, e)
        return in_place
    return redirected


# ── The move ──────────────────────────────────────────────────────────


def _copy_file(src: Path, dst: Path) -> None:
    """One file, metadata included. A module-level function so a test can
    make the copy fail partway."""
    shutil.copy2(src, dst)


def _same_content(a: Path, b: Path) -> bool:
    return filecmp.cmp(a, b, shallow=False)


def _record(record: dict, key: str = MIGRATION_KEY) -> None:
    with app_settings._lock:
        config = app_settings._read_config(app_config_path())
        config[key] = record
        app_settings._write_config_atomic(app_config_path(), config)


def last_migration() -> dict | None:
    """The outcome of the last move, for Report a Problem; None if nothing
    was ever found to move."""
    with app_settings._lock:
        record = app_settings._read_config(app_config_path()).get(MIGRATION_KEY)
    return record if isinstance(record, dict) else None


def _is_artifact(name: str) -> bool:
    return name.endswith(ARTIFACT_SUFFIXES)


def _plain_files_under(folder: Path) -> list[Path]:
    """Every plain file below ``folder`` (symlinks skipped, never followed)."""
    out: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(folder, followlinks=False):
        dirnames[:] = sorted(d for d in dirnames if not (Path(dirpath) / d).is_symlink())
        for name in sorted(filenames):
            p = Path(dirpath) / name
            if not p.is_symlink() and p.is_file():
                out.append(p)
    return out


def recorded_files(dist, site_packages: Path) -> Optional[set[Path]]:
    """The files the installed distribution owns, from its ``RECORD``, as
    absolute paths; None when it can't be read (the caller then leaves the
    install alone rather than guess what is PsyNeuLink's)."""
    try:
        text = dist.read_text("RECORD")
    except Exception:  # noqa: BLE001
        return None
    if not text:
        return None
    out: set[Path] = set()
    for line in text.splitlines():
        rel = line.split(",", 1)[0].strip()
        if rel:
            out.add((site_packages / rel).resolve())
    return out


def install_candidates(pkg: Path, recorded: set[Path]) -> list[tuple[Path, Path]]:
    """Companions PsyNeuView added inside a read-only install: every file
    under the package dir whose name is a sidecar or backup and which the
    install's RECORD doesn't list. Returns ``(file, path relative to
    site-packages with any .psyneuview/ segment dropped)``: inside the
    layouts tree the files are lateral."""
    out: list[tuple[Path, Path]] = []
    site = pkg.parent
    for f in _plain_files_under(pkg):
        if not _is_artifact(f.name) or f.resolve() in recorded:
            continue
        rel = f.relative_to(site)
        rel = Path(*[part for part in rel.parts if part != _DOT_DIRNAME])
        out.append((f, rel))
    return out


def _remove_empty_dirs(folder: Path, stop_at: Path) -> None:
    """Remove ``folder`` and its now-empty parents up to (not including)
    ``stop_at``. Best effort: a folder that isn't empty is left."""
    current = folder
    while current != stop_at and stop_at in current.parents:
        try:
            current.rmdir()
        except OSError:
            return
        current = current.parent


def migrate_from(
    *,
    clone_artifacts: Optional[Path],
    install: Optional[tuple[str, Path, set[Path]]],
    destination: Path,
) -> dict | None:
    """Move companions from the old places to ``destination``:

    - ``clone_artifacts``: the ``sources/.state/artifacts`` tree, whose
      layout (``<copy name>/<path in the copy>``) is already the new one;
    - ``install``: ``(source key, package dir, files RECORD lists)`` of a
      read-only install, scanned for files PsyNeuView added.

    Returns the record of what happened, or None when there was nothing to
    move. Pure file work — the policy of when to run is
    :func:`migrate_legacy_layouts`'s.
    """
    started = time.time()
    candidates: list[tuple[Path, Path]] = []  # (file, destination)
    scanned: list[str] = []
    if clone_artifacts is not None and clone_artifacts.is_dir():
        files = _plain_files_under(clone_artifacts)
        if files:
            scanned.append(str(clone_artifacts))
            candidates.extend((f, destination / f.relative_to(clone_artifacts)) for f in files)
    if install is not None:
        key, pkg, recorded = install
        if pkg.is_dir():
            found = install_candidates(pkg, recorded)
            if found:
                scanned.append(str(pkg))
                candidates.extend((f, destination / key / rel) for f, rel in found)
    if not candidates:
        return None

    moved = 0
    duplicates = 0
    conflicts: list[str] = []
    failures: list[dict] = []
    emptied: set[Path] = set()
    for src, dst in candidates:
        try:
            if dst.exists() or dst.is_symlink():
                if not dst.is_symlink() and dst.is_file() and _same_content(src, dst):
                    src.unlink()
                    duplicates += 1
                    emptied.add(src.parent)
                else:
                    conflicts.append(str(src))
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            try:
                _copy_file(src, dst)
                if not _same_content(src, dst):
                    raise OSError("didn't copy correctly")
            except Exception:
                # Only what this copy created; the original is untouched.
                try:
                    dst.unlink()
                except OSError:
                    pass
                raise
            src.unlink()
            moved += 1
            emptied.add(src.parent)
        except Exception as e:  # noqa: BLE001 — one failure must not stop the rest
            failures.append({"file": str(src), "error": f"{e}"})
            logger.warning("layouts: couldn't move %s: %s", src, e)

    # Tidy the folders the move emptied: a `.psyneuview/` left in
    # site-packages, the old artifacts tree. Only empty ones go.
    stops = [p for p in (clone_artifacts.parent if clone_artifacts else None,
                         install[1].parent if install else None) if p is not None]
    for folder in sorted(emptied, key=lambda p: -len(p.parts)):
        for stop in stops:
            if stop in folder.parents:
                _remove_empty_dirs(folder, stop)
                break

    record = {
        "at": started,
        "from": scanned,
        "to": str(destination),
        "moved": moved,
        "duplicates_removed": duplicates,
        "conflicts": conflicts,
        "failures": failures,
        "ok": not failures,
    }
    _record(record)
    logger.info(
        "layouts: moved %d to %s (%d already there, %d conflicts, %d failures)",
        moved, destination, duplicates, len(conflicts), len(failures),
    )
    return record


def migrate_legacy_layouts() -> dict | None:
    """Run at startup: move companions from the old place(s) to
    :func:`layouts_dir`. Returns the record, or None when there was nothing
    to do or the move doesn't apply (folder fixed by the environment, or a
    container / hosted deployment). Never raises: a failure is recorded and
    the originals are left where they were.
    """
    if fixed_by_env() or deployment_mode.is_remote():
        return None
    try:
        from app.services import settings_info

        destination = layouts_dir()
        install = None
        active = _active_read_only_install()
        if active is not None:
            key, pkg = active
            recorded = recorded_files(settings_info.distribution("psyneulink"), pkg.parent)
            if recorded is None:
                logger.info("layouts: %s has no readable RECORD; its folder is left alone", pkg)
            else:
                install = (key, pkg, recorded)
        return migrate_from(
            clone_artifacts=legacy_clone_artifacts_dir(),
            install=install,
            destination=destination,
        )
    except Exception as e:  # noqa: BLE001 — startup must go on
        logger.warning("layouts: migration didn't run: %s", e)
        try:
            _record({"at": time.time(), "from": [], "to": None, "moved": 0, "duplicates_removed": 0,
                     "conflicts": [], "failures": [{"file": "", "error": f"{e}"}], "ok": False})
        except Exception:  # noqa: BLE001
            pass
        return None


# ── A package folder left behind (#1396) ─────────────────────────────

#: Preferences key for the outcome of the last leftover-folder cleanup.
LEFTOVER_KEY = "leftover_package_cleanup"

#: Where files from a left-behind ``psyneulink/`` folder are kept, under the
#: layouts folder. Their origin is gone with the install, so they can't be
#: filed under a source key; each cleanup gets its own dated folder, so
#: nothing is ever overwritten.
LEFTOVER_DIRNAME = "PsyNeuLink-left-behind"


def site_packages_dirs() -> list[Path]:
    """This environment's site-packages folders (pure and platform)."""
    import sysconfig

    out: list[Path] = []
    for key in ("purelib", "platlib"):
        p = sysconfig.get_paths().get(key)
        if p and Path(p) not in out:
            out.append(Path(p))
    return out


def leftover_package_dirs(site_dirs: list[Path]) -> list[Path]:
    """``psyneulink/`` folders in ``site_dirs`` that aren't a package.

    When PsyNeuLink is uninstalled, pip removes only the files it installed.
    A file PsyNeuView added inside the package — a layout saved before #1321
    moved them out — keeps its folders alive. With no ``__init__.py`` that
    ``psyneulink/`` imports as an empty namespace package, and it is found
    before an editable install's finder: ``import psyneulink`` gets a shell
    with no ``Composition``, and every model fails to load.
    """
    out: list[Path] = []
    for site in site_dirs:
        pkg = site / "psyneulink"
        if pkg.is_dir() and not pkg.is_symlink() and not (pkg / "__init__.py").exists():
            out.append(pkg)
    return out


def _is_bytecode(path: Path) -> bool:
    return path.suffix == ".pyc" or "__pycache__" in path.parts


def clear_leftover_packages(*, site_dirs: list[Path], destination: Path) -> dict | None:
    """Clear left-behind ``psyneulink/`` folders out of ``site_dirs``.

    Bytecode is deleted (it is rebuilt from source, and is no one's work).
    Every other file — the layouts and labels PsyNeuView wrote there — is
    copied to ``<destination>/PsyNeuLink-left-behind/<when>/<path in
    site-packages>``, checked byte for byte, and only then removed. The
    emptied folders go. A file that can't be moved stays, with its folder,
    and the failure is recorded: the folder still shadows PsyNeuLink then,
    and the import check after a switch says so.

    Returns the record, or None when there was nothing to clear.
    """
    leftovers = leftover_package_dirs(site_dirs)
    if not leftovers:
        return None
    started = time.time()
    keep_root = destination / LEFTOVER_DIRNAME / time.strftime("%Y-%m-%d_%H-%M-%S", time.localtime(started))
    moved: list[dict] = []
    failures: list[dict] = []
    cleared: list[str] = []
    for pkg in leftovers:
        site = pkg.parent
        for dirpath, dirnames, filenames in os.walk(pkg, followlinks=False):
            for name in filenames:
                src = Path(dirpath) / name
                try:
                    if _is_bytecode(src.relative_to(pkg)):
                        src.unlink()
                        continue
                    dst = keep_root / src.relative_to(site)
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    _copy_file(src, dst)
                    if not _same_content(src, dst):
                        dst.unlink()
                        raise OSError("didn't copy correctly")
                    src.unlink()
                    moved.append({"from": str(src), "to": str(dst)})
                except Exception as e:  # noqa: BLE001 — one failure must not stop the rest
                    failures.append({"file": str(src), "error": f"{e}"})
                    logger.warning("leftover psyneulink: couldn't move %s: %s", src, e)
        # Bottom-up: a folder goes once everything in it has.
        for dirpath, dirnames, filenames in os.walk(pkg, topdown=False, followlinks=False):
            try:
                Path(dirpath).rmdir()
            except OSError:
                pass
        if not pkg.exists():
            cleared.append(str(pkg))
    record = {
        "at": started,
        "found": [str(p) for p in leftovers],
        "cleared": cleared,
        "moved": moved,
        "kept_in": str(keep_root) if moved else None,
        "failures": failures,
        "ok": not failures and len(cleared) == len(leftovers),
    }
    _record(record, key=LEFTOVER_KEY)
    logger.info(
        "leftover psyneulink: cleared %d of %d folder(s), kept %d file(s) in %s, %d failure(s)",
        len(cleared), len(leftovers), len(moved), keep_root, len(failures),
    )
    return record


def clear_leftover_packages_here() -> dict | None:
    """:func:`clear_leftover_packages` for this environment, at startup and
    after a PsyNeuLink switch. Off under the same rule as the migration:
    when ``PSYNEUVIEW_LAYOUTS_DIR`` is set (tests must never touch the real
    site-packages) and in container or hosted deployments. Never raises."""
    if fixed_by_env() or deployment_mode.is_remote():
        return None
    try:
        return clear_leftover_packages(site_dirs=site_packages_dirs(), destination=layouts_dir())
    except Exception as e:  # noqa: BLE001 — startup and installs must go on
        logger.warning("leftover psyneulink: cleanup didn't run: %s", e)
        return None
