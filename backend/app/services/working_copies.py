"""Where working copies of included models live, and the move there (#1319).

Opening a Reference Model, a Demo, or a PsyNeuLink Example from a managed
install copies the bundled file to a **working copy**, which is what gets
edited and saved; the bundled original is never written. Until #1319 that
copy went in ``PSYNEWVIEW_WORKING_DIR`` or, when unset, the running
PsyNeuView's ``backend/`` folder. The Mac app runs the backend from
``~/Library/Application Support/PsyNeuView/psyneuview-<version>/backend``, a
folder that is replaced when the app moves to a new included version — so an
edited Reference Model silently reopened as the pristine original after an
update.

Now there is one answer, :func:`working_copies_dir`:

- ``PSYNEWVIEW_WORKING_DIR`` when set (the e2e harness, developer setups);
- otherwise ``~/.psyneuview/working-copies``, a per-user folder outside every
  install, created on first use.

And one migration, :func:`migrate_legacy_working_copies`, run once at
startup before anything opens a working copy. It looks for working copies in
the old place — the running install's ``backend/``, and when PsyNeuView runs
from a Mac-app bundled install, the ``backend/`` of the other
``psyneuview-<version>`` installs beside it — and moves them to the new
folder. It follows the folder-move policy of :mod:`project_folder`:

- only files that match the known working-copy names (the stems of the
  bundled reference models, demos and the active PsyNeuLink's examples, with
  their layout, label and index sidecars, lateral or in ``.psyneuview/``);
  never anything else, never a symlink, never a file git tracks;
- copy, verify byte for byte, and only then remove the original; on any
  failure the original is left as it is and the failure is recorded;
- a file already in the new folder is never overwritten: identical, the old
  copy is simply removed; different, the new-folder one is kept, the old one
  left in place, and the conflict recorded;
- the outcome (``working_copies_last_migration``) goes in the preferences
  file so Report a Problem can include it;
- idempotent: a second run finds nothing and changes nothing.

Skipped entirely when ``PSYNEWVIEW_WORKING_DIR`` is set (the environment
decides, and there is no "old place" to look in) and in container or hosted
deployments (no per-user home to keep things in).
"""

from __future__ import annotations

import filecmp
import logging
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

from app.services import app_settings, deployment_mode
from app.services.app_config import app_config_path

logger = logging.getLogger(__name__)

WORKING_DIR_ENV = "PSYNEWVIEW_WORKING_DIR"
MIGRATION_KEY = "working_copies_last_migration"

#: The file the Mac app writes at the root of an unpacked included PsyNeuView
#: (``fetch-psyneuview.sh``). Its presence is what makes a folder "a bundled
#: install" here; a git checkout has none.
BUNDLED_VERSION_STAMP = "BUNDLED_VERSION"
_BUNDLED_DIR_PREFIX = "psyneuview-"

#: Hidden folder that may hold a model's sidecars (sidecar_placement).
_DOT_DIRNAME = ".psyneuview"

# services/working_copies.py → app/services → app → backend → install root
_BACKEND_DIR = Path(__file__).resolve().parents[2]
_INSTALL_ROOT = _BACKEND_DIR.parent


# ── Where ─────────────────────────────────────────────────────────────


def fixed_by_env() -> bool:
    """Whether ``PSYNEWVIEW_WORKING_DIR`` decides the folder."""
    return bool(os.environ.get(WORKING_DIR_ENV))


def default_working_copies_dir() -> Path:
    """The per-user folder: ``~/.psyneuview/working-copies``."""
    return Path.home() / ".psyneuview" / "working-copies"


def working_copies_dir(*, create: bool = True) -> Path:
    """Where working copies of included models are written and read back.

    ``PSYNEWVIEW_WORKING_DIR`` when set; otherwise the per-user default.
    Created unless ``create`` is False (a caller that only reports the path).
    """
    env = os.environ.get(WORKING_DIR_ENV)
    d = Path(env).expanduser() if env else default_working_copies_dir()
    d = d.resolve() if env else d
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return d


def legacy_working_copies_dir() -> Path:
    """Where working copies went before #1319: the running install's ``backend/``."""
    return _BACKEND_DIR


def install_root() -> Path:
    """The PsyNeuView this backend runs from (a checkout or an unpacked copy)."""
    return _INSTALL_ROOT


def _is_bundled_install(root: Path) -> bool:
    return root.name.startswith(_BUNDLED_DIR_PREFIX) and (root / BUNDLED_VERSION_STAMP).is_file()


def sibling_bundled_installs(root: Path | None = None) -> list[Path]:
    """The other ``psyneuview-<version>`` installs beside this one — only when
    this one is itself a bundled install, and only siblings that are too.
    Empty for a checkout, which has no such neighbours."""
    root = root or install_root()
    if not _is_bundled_install(root):
        return []
    out: list[Path] = []
    try:
        entries = sorted(root.parent.iterdir(), key=lambda p: p.name)
    except OSError:
        return []
    for entry in entries:
        if entry.resolve() == root.resolve() or entry.is_symlink() or not entry.is_dir():
            continue
        if _is_bundled_install(entry) and (entry / "backend").is_dir():
            out.append(entry)
    return out


# ── What counts as a working copy ─────────────────────────────────────


def _stems_in(folder: Path) -> set[str]:
    try:
        return {p.stem for p in folder.glob("*.py") if p.is_file()}
    except OSError:
        return set()


def bundled_stems(backend_dir: Path) -> set[str]:
    """The names of the models an install includes: its reference models
    and demos. A working copy of one is ``<stem>.py`` plus sidecars."""
    return _stems_in(backend_dir / "reference_models") | _stems_in(backend_dir / "demos")


def _example_stems() -> set[str]:
    """The active PsyNeuLink's ``Scripts/Examples`` (#843); a managed install
    opens those as working copies too. Empty when there is no such folder."""
    try:
        from app.services.settings_info import active_psyneulink_package_dir

        pkg = active_psyneulink_package_dir()
    except Exception:  # noqa: BLE001 — a migration must not fail on introspection
        return set()
    if pkg is None:
        return set()
    return _stems_in(pkg.parent / "Scripts" / "Examples")


def _name_pattern(stems: set[str]) -> re.Pattern[str] | None:
    """Matches the files a working copy of any of ``stems`` consists of:
    ``<stem>.py``, its layout / labels / index sidecars, and named variants
    of the layout and labels (``<stem>.<variant>.pnlview.json``)."""
    if not stems:
        return None
    alts = "|".join(re.escape(s) for s in sorted(stems))
    return re.compile(
        rf"^(?:{alts})(?:\.py|\.pnlview\.json|\.labels\.yaml|\.psyneuview\.json"
        rf"|\.[^/]+\.(?:pnlview\.json|labels\.yaml))$"
    )


def _candidates(folder: Path, pattern: re.Pattern[str]) -> list[Path]:
    """Files under ``folder`` (and its ``.psyneuview/``) whose names match.
    Plain files only — a symlink is never a working copy PsyNeuView wrote."""
    out: list[Path] = []
    for parent in (folder, folder / _DOT_DIRNAME):
        try:
            entries = sorted(parent.iterdir(), key=lambda p: p.name)
        except OSError:
            continue
        for entry in entries:
            if entry.is_symlink() or not entry.is_file():
                continue
            if pattern.match(entry.name):
                out.append(entry)
    return out


def _git_tracked(folder: Path, files: list[Path]) -> set[Path] | None:
    """Which of ``files`` git tracks, when ``folder`` is inside a git work
    tree; an empty set outside one. ``None`` when git can't answer — the
    caller then leaves that folder alone rather than guess."""
    if not files:
        return set()
    try:
        inside = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=str(folder), capture_output=True, text=True, timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if inside.returncode != 0 or inside.stdout.strip() != "true":
        return set()
    try:
        listed = subprocess.run(
            ["git", "ls-files", "-z", "--", *[str(f.relative_to(folder)) for f in files]],
            cwd=str(folder), capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if listed.returncode != 0:
        return None
    return {folder / rel for rel in listed.stdout.split("\0") if rel}


# ── The move ──────────────────────────────────────────────────────────


def _copy_file(src: Path, dst: Path) -> None:
    """One file, metadata included. A module-level function so a test can
    make the copy fail partway."""
    shutil.copy2(src, dst)


def _same_content(a: Path, b: Path) -> bool:
    return filecmp.cmp(a, b, shallow=False)


def _record(record: dict) -> None:
    with app_settings._lock:
        config = app_settings._read_config(app_config_path())
        config[MIGRATION_KEY] = record
        app_settings._write_config_atomic(app_config_path(), config)


def last_migration() -> dict | None:
    """The outcome of the last move, for Report a Problem; None if nothing
    was ever found to move."""
    with app_settings._lock:
        record = app_settings._read_config(app_config_path()).get(MIGRATION_KEY)
    return record if isinstance(record, dict) else None


def _mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def migrate_from(sources: list[Path], destination: Path, *, extra_stems: set[str] = frozenset()) -> dict | None:
    """Move the working copies found in ``sources`` (each a ``backend/``
    folder of some install) to ``destination``. Returns the record of what
    happened, or None when there was nothing to move. Pure file work — the
    policy of when to run is :func:`migrate_legacy_working_copies`'s.
    """
    started = time.time()
    stems = set(extra_stems) | bundled_stems(legacy_working_copies_dir())
    for src_dir in sources:
        stems |= bundled_stems(src_dir)
    pattern = _name_pattern(stems)
    if pattern is None:
        return None

    # Every candidate, newest first per name: when the same working copy is
    # in more than one old place, the most recently written one goes to the
    # new folder and the rest are duplicates or conflicts against it.
    moved = 0
    duplicates = 0
    skipped_tracked = 0
    conflicts: list[str] = []
    failures: list[dict] = []
    scanned: list[str] = []
    candidates: list[tuple[Path, Path]] = []  # (file, its backend/ folder)
    for src_dir in sources:
        if not src_dir.is_dir():
            continue
        found = _candidates(src_dir, pattern)
        if not found:
            continue
        tracked = _git_tracked(src_dir, found)
        if tracked is None:
            failures.append({"file": str(src_dir), "error": "couldn't ask git which files it tracks; folder left alone"})
            continue
        scanned.append(str(src_dir))
        skipped_tracked += sum(1 for f in found if f in tracked)
        candidates.extend((f, src_dir) for f in found if f not in tracked)
    if not candidates and not failures:
        return None
    candidates.sort(key=lambda c: -_mtime(c[0]))

    for src, src_dir in candidates:
        rel = src.relative_to(src_dir)
        dst = destination / rel
        try:
            if dst.exists() or dst.is_symlink():
                if not dst.is_symlink() and dst.is_file() and _same_content(src, dst):
                    src.unlink()
                    duplicates += 1
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
        except Exception as e:  # noqa: BLE001 — one failure must not stop the rest
            failures.append({"file": str(src), "error": f"{e}"})
            logger.warning("working copies: couldn't move %s: %s", src, e)

    record = {
        "at": started,
        "from": scanned,
        "to": str(destination),
        "moved": moved,
        "duplicates_removed": duplicates,
        "skipped_tracked": skipped_tracked,
        "conflicts": conflicts,
        "failures": failures,
        "ok": not failures,
    }
    _record(record)
    logger.info(
        "working copies: moved %d to %s (%d already there, %d conflicts, %d failures, %d tracked by git left alone)",
        moved, destination, duplicates, len(conflicts), len(failures), skipped_tracked,
    )
    return record


def migrate_legacy_working_copies() -> dict | None:
    """Run at startup: move working copies from the old place(s) to
    :func:`working_copies_dir`. Returns the record, or None when there was
    nothing to do or the move doesn't apply (environment variable set, or a
    container / hosted deployment). Never raises: a failure is recorded and
    the originals are left where they were.
    """
    if fixed_by_env() or deployment_mode.is_remote():
        return None
    try:
        destination = working_copies_dir()
        sources = [legacy_working_copies_dir()]
        sources += [s / "backend" for s in sibling_bundled_installs()]
        sources = [s for s in sources if s.resolve() != destination.resolve()]
        return migrate_from(sources, destination, extra_stems=_example_stems())
    except Exception as e:  # noqa: BLE001 — startup must go on
        logger.warning("working copies: migration didn't run: %s", e)
        try:
            _record({"at": time.time(), "from": [], "to": None, "moved": 0, "duplicates_removed": 0,
                     "skipped_tracked": 0, "conflicts": [], "failures": [{"file": "", "error": f"{e}"}], "ok": False})
        except Exception:  # noqa: BLE001
            pass
        return None


# Two reference models were renamed for the public release (#1416): their old
# stems carried contributors' names. A working copy made under an old name is
# adopted under the new one the first time the model is opened, so edits,
# arranged layouts and labels carry over. The old stems are matched by shape,
# so the names themselves don't have to appear here.
RENAMED_REFERENCE_STEMS: dict[str, re.Pattern[str]] = {
    "stroop_reference_basic": re.compile(r"^stroop_basic_[a-z]{3}_[a-z]{6}$"),
    "stroop_reference_with_lc": re.compile(r"^stroop_with_lc_[a-z]{3}_[a-z]{4}$"),
}

_SIDECAR_TAIL = re.compile(
    r"^(?P<stem>[A-Za-z0-9_]+?)(?P<tail>\.py|\.pnlview\.json|\.labels\.yaml|\.psyneuview\.json"
    r"|\.[^/]+\.(?:pnlview\.json|labels\.yaml))$"
)


def adopt_renamed_working_copy(new_stem: str, folder: Path | None = None) -> list[Path]:
    """Rename an old-named working copy of a renamed reference model to
    ``new_stem``, with its sidecars (lateral or in ``.psyneuview/``), and point
    a layout index at the renamed files. Does nothing when ``new_stem`` isn't a
    renamed model, when a working copy under the new name already exists, or
    when there is no old one. Never overwrites. Returns the files it wrote."""
    pattern = RENAMED_REFERENCE_STEMS.get(new_stem)
    if pattern is None:
        return []
    folder = folder or working_copies_dir()
    if (folder / f"{new_stem}.py").exists():
        return []
    moved: list[Path] = []
    for parent in (folder, folder / _DOT_DIRNAME):
        try:
            entries = sorted(parent.iterdir(), key=lambda p: p.name)
        except OSError:
            continue
        for entry in entries:
            if entry.is_symlink() or not entry.is_file():
                continue
            m = _SIDECAR_TAIL.match(entry.name)
            if not m or not pattern.match(m.group("stem")):
                continue
            old_stem = m.group("stem")
            dest = entry.with_name(new_stem + m.group("tail"))
            if dest.exists():
                continue
            try:
                entry.rename(dest)
            except OSError as e:
                logger.warning("working copies: couldn't rename %s: %s", entry, e)
                continue
            if dest.name.endswith(".psyneuview.json"):
                try:
                    dest.write_text(dest.read_text().replace(f'"{old_stem}.', f'"{new_stem}.'))
                except OSError as e:
                    logger.warning("working copies: couldn't update index %s: %s", dest, e)
            moved.append(dest)
    if moved:
        logger.info("working copies: adopted %d renamed file(s) as %s", len(moved), new_stem)
    return moved
