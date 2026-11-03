"""File rules for the AI assistant (#179).

The agent is untrusted. Every path it names is checked here, on every call,
before anything is opened:

- The real path, after following symlinks, must be inside a designated folder.
  Below the folder the walk is done step by step through file descriptors
  with ``O_NOFOLLOW``, so a symlink anywhere in the path (a file or a parent)
  is refused outright, and the file that is read or written is the one that
  was checked, not one swapped in between the check and the use.
- ``..``, ``.``, hidden names, relative paths and names that differ from the
  directory entry (a case variant on the Mac's file system, a Unicode
  lookalike) are refused.
- Writes need a ``read_write`` folder, refuse a file with more than one hard
  link, check ``base_hash`` against what is on disk, keep the previous
  version, and land atomically by rename.
- Only model files: PsyNeuLink ``.py``, MDF ``.json``/``.yaml``/``.yml``
  (confirmed by ``classify_file``), and the app's ``.pnlview.json`` layouts.
  No hidden, shell or config files; limits on size and on list length.
- Nothing here deletes, and reading never runs anything.

The designated folders come from ``folders_provider``, a function the backend's
settings module installs with ``set_folders_provider``; by default they are
read from the app's preferences file under ``assistant.folders``.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import logging
import os
import stat
import sys
import time
import unicodedata
from pathlib import Path
from typing import Callable

from app.services.app_config import app_config_path
from app.services.assistant import review
from app.services.file_types import FileType, classify_file

logger = logging.getLogger(__name__)

MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_LIST = 500
MAX_DEPTH = 6
LAYOUT_SUFFIX = ".pnlview.json"
MODEL_SUFFIXES = (".py", ".json", ".yaml", ".yml")

#: Redirects where previous versions are kept (tests, or two app instances).
STATE_DIR_ENV = "PSYNEUVIEW_ASSISTANT_STATE_DIR"


class PathRefused(Exception):
    """The path isn't one the assistant may use. ``reason`` is short and
    stable for the log; the message says why in plain English."""

    def __init__(self, path: str, reason: str, message: str | None = None):
        self.path = str(path)
        self.reason = reason
        super().__init__(message or f"{reason}: {self.path}")


# --- Folders ---

def _folders_from_settings() -> list[dict]:
    try:
        raw = json.loads(app_config_path().read_text(encoding="utf-8"))
        folders = (raw.get("assistant") or {}).get("folders") or []
    except (OSError, ValueError, AttributeError):
        return []
    return [f for f in folders if isinstance(f, dict) and f.get("path")]


folders_provider: Callable[[], list[dict]] = _folders_from_settings


def set_folders_provider(fn: Callable[[], list[dict]]) -> None:
    """Install the settings module's view of ``folders`` (``[{path, access}]``)."""
    global folders_provider
    folders_provider = fn


def _system_roots() -> list[tuple[Path, bool]]:
    """``(folder, whole subtree)``. The containers of user folders (``/Users``,
    ``/tmp``...) are refused only as themselves, since folders under them are
    exactly what a user designates."""
    subtree = ["/System", "/Library", "/Applications", "/usr", "/bin", "/sbin", "/etc", "/opt",
               "/dev", "/var/log", "/var/db", "/var/root", "/var/run", "/private/etc"]
    itself = ["/", "/Users", "/home", "/root", "/Volumes", "/private", "/var", "/tmp",
              "/private/var", "/private/tmp"]
    if sys.platform == "win32":
        subtree += [os.environ.get("SystemRoot", r"C:\Windows"), r"C:\Program Files", r"C:\Program Files (x86)"]
    return [(Path(r), True) for r in subtree] + [(Path(r), False) for r in itself]


def _app_roots() -> list[Path]:
    """Folders of the app itself, its state, its installs and PsyNeuLink."""
    roots = [Path(__file__).resolve().parents[4], Path.home() / ".psyneuview", Path(sys.prefix)]
    try:
        spec = importlib.util.find_spec("psyneulink")
        if spec and spec.origin:
            roots.append(Path(spec.origin).resolve().parent)
    except (ImportError, ValueError):
        pass
    try:
        from app.services import locations
        active = locations._active_pnl_path()
        if active:
            roots.append(Path(active))
    except Exception:
        pass
    return roots


def _is_within(path: Path, root: Path) -> bool:
    try:
        return path == root or root in path.parents
    except (OSError, ValueError):
        return False


def validate_folder(path: str) -> Path:
    """The real path of a folder the user may designate, or ``PathRefused``.

    Refused: home itself, the system root and system folders, the app, its
    installs and state, the PsyNeuLink install, and any hidden folder (which
    is where credentials live). Settings calls this before storing a folder.
    """
    if not str(path).strip():
        raise PathRefused(path, "empty")
    p = Path(str(path)).expanduser()
    if not p.is_absolute():
        raise PathRefused(path, "relative", "Folders must be given as absolute paths.")
    try:
        real = Path(os.path.realpath(p))
    except OSError as e:
        raise PathRefused(path, "unresolvable", str(e))
    if not real.is_dir():
        raise PathRefused(path, "not_a_folder", f"Not a folder: {path}")
    home = Path(os.path.realpath(Path.home()))
    if real == home:
        raise PathRefused(path, "home_itself", "The home folder itself can't be designated; choose a folder inside it.")
    for root, whole in _system_roots():
        try:
            root_real = Path(os.path.realpath(root))
        except OSError:
            continue
        if real == root_real or (whole and _is_within(real, root_real)):
            raise PathRefused(path, "system_folder", f"System folders can't be designated: {path}")
    if _is_within(real, home / "Library"):
        raise PathRefused(path, "system_folder", f"~/Library can't be designated: {path}")
    for root in _app_roots():
        if _is_within(real, root) or _is_within(root, real):
            raise PathRefused(path, "app_folder", f"The app's own folders and installs can't be designated: {path}")
    if any(part.startswith(".") for part in real.parts[1:]):
        raise PathRefused(path, "hidden_folder", f"Hidden folders can't be designated: {path}")
    return real


def allowed_folders() -> list[tuple[Path, str]]:
    """``(real path, access)`` for each designated folder that still passes."""
    out = []
    for f in folders_provider() or []:
        try:
            out.append((validate_folder(f["path"]), "read_write" if f.get("access") == "read_write" else "read"))
        except PathRefused as e:
            logger.warning("assistant folder skipped: %s", e)
    return out


# --- Names and types ---

def _check_name(name: str) -> None:
    if name in ("", ".", ".."):
        raise PathRefused(name, "dot_segment")
    if name.startswith("."):
        raise PathRefused(name, "hidden")
    if "\x00" in name or "/" in name or "\\" in name:
        raise PathRefused(name, "bad_character")


def _is_layout(name: str) -> bool:
    return name.endswith(LAYOUT_SUFFIX)


def _check_file_name(name: str) -> None:
    _check_name(name)
    lower = name.lower()
    if not lower.endswith(MODEL_SUFFIXES):
        raise PathRefused(name, "wrong_type", f"Only model files (.py, .json, .yaml, .yml, {LAYOUT_SUFFIX}): {name}")
    if lower in ("setup.py", "conftest.py") or lower.startswith("test_"):
        raise PathRefused(name, "wrong_type", f"Not a model file: {name}")


def _file_kind(real: Path) -> str:
    """The kind of an existing file, by extension and content, or refuse."""
    if _is_layout(real.name):
        try:
            json.loads(real.read_text(encoding="utf-8"))
        except (OSError, ValueError, UnicodeDecodeError):
            raise PathRefused(str(real), "wrong_type", f"Not a layout file: {real.name}")
        return "layout"
    c = classify_file(real)
    if c.file_type is FileType.PNL_PYTHON:
        return "pnl_python"
    if c.file_type in (FileType.MDF_JSON, FileType.MDF_YAML):
        return c.file_type.value
    raise PathRefused(str(real), "wrong_type", c.error or f"Not a model file: {real.name}")


def _relative_parts(path: str) -> tuple[Path, str, list[str]]:
    """The designated folder the path is under, its access, and the parts below it."""
    if not str(path).strip():
        raise PathRefused(path, "empty")
    p = Path(str(path))
    if not p.is_absolute():
        raise PathRefused(path, "relative", "Paths must be absolute.")
    if "\x00" in str(p):
        raise PathRefused(path, "bad_character")
    # Lexically only: no following of links here. Every part is checked below.
    parts = [unicodedata.normalize("NFC", s) for s in p.parts[1:]]
    for folder, access in allowed_folders():
        fparts = [unicodedata.normalize("NFC", s) for s in folder.parts[1:]]
        if len(parts) > len(fparts) and parts[:len(fparts)] == fparts:
            rel = parts[len(fparts):]
            if len(rel) > MAX_DEPTH:
                raise PathRefused(path, "too_deep")
            return folder, access, rel
    # ``..`` in the prefix, a different case, a lookalike, or just elsewhere.
    raise PathRefused(path, "outside_allowed_folders", f"Not inside a folder the assistant may use: {path}")


def _entry_matches(dir_fd: int, name: str) -> bool:
    """The directory holds an entry spelt exactly like ``name``, so a
    case-insensitive or normalization-insensitive file system can't open a
    different file than the one named."""
    try:
        names = os.listdir(dir_fd)
    except OSError:
        return False
    nfc = unicodedata.normalize("NFC", name)
    return any(unicodedata.normalize("NFC", n) == nfc for n in names)


def _open_dir(dir_fd: int, name: str) -> int:
    _check_name(name)
    if not _entry_matches(dir_fd, name):
        raise PathRefused(name, "no_such_entry", f"No such folder: {name}")
    try:
        return os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=dir_fd)
    except OSError as e:
        raise PathRefused(name, "symlink_or_missing", f"Can't enter {name}: {e.strerror}")


def _open_allowed(path: str, *, write: bool, must_exist: bool = True):
    """Walk from the designated folder to the file through descriptors.

    Returns ``(file_fd or None, parent_fd, name, real_path, access)``. The
    caller closes both descriptors. ``file_fd`` is None only when the file
    doesn't exist and ``must_exist`` is False (a new file to write).
    """
    folder, access, rel = _relative_parts(path)
    if write and access != "read_write":
        raise PathRefused(path, "read_only_folder", f"The folder isn't read-write: {folder}")
    name = rel[-1]
    _check_file_name(name)
    try:
        parent_fd = os.open(str(folder), os.O_RDONLY | os.O_DIRECTORY)
    except OSError as e:
        raise PathRefused(path, "folder_unavailable", str(e))
    try:
        for part in rel[:-1]:
            next_fd = _open_dir(parent_fd, part)
            os.close(parent_fd)
            parent_fd = next_fd
        real = folder.joinpath(*rel)
        if not _entry_matches(parent_fd, name):
            if must_exist:
                raise PathRefused(path, "not_found", f"No such file: {path}")
            return None, parent_fd, name, real, access
        flags = os.O_RDONLY | os.O_NOFOLLOW
        if hasattr(os, "O_NONBLOCK"):
            flags |= os.O_NONBLOCK  # never hang on a fifo
        try:
            fd = os.open(name, flags, dir_fd=parent_fd)
        except OSError as e:
            raise PathRefused(path, "symlink_or_unreadable", f"Can't open {name}: {e.strerror}")
        try:
            st = os.fstat(fd)
            if not stat.S_ISREG(st.st_mode):
                raise PathRefused(path, "not_a_regular_file")
            if st.st_size > MAX_FILE_BYTES:
                raise PathRefused(path, "too_large", f"Larger than {MAX_FILE_BYTES // (1024 * 1024)} MiB: {name}")
            if write and st.st_nlink > 1:
                raise PathRefused(path, "hard_linked", f"{name} has more than one hard link; refusing to write it.")
        except BaseException:
            os.close(fd)
            raise
        return fd, parent_fd, name, real, access
    except BaseException:
        os.close(parent_fd)
        raise


# --- The contract's functions ---

def resolve_allowed(path: str, *, write: bool = False) -> Path:
    """The real path of a model file the assistant may read (or, with
    ``write=True``, write), after every check above. Raises ``PathRefused``."""
    fd, parent_fd, name, real, _access = _open_allowed(path, write=write, must_exist=not write)
    try:
        if fd is not None:
            _file_kind(real)
        return real
    finally:
        if fd is not None:
            os.close(fd)
        os.close(parent_fd)


def list_model_files() -> list[dict]:
    """Model files in the designated folders, without following any symlink
    and skipping hidden names, at most ``MAX_LIST`` of them."""
    out: list[dict] = []
    for folder, access in allowed_folders():
        stack = [(folder, 0)]
        while stack and len(out) < MAX_LIST:
            d, depth = stack.pop()
            try:
                entries = sorted(os.scandir(d), key=lambda e: e.name)
            except OSError:
                continue
            for e in entries:
                if len(out) >= MAX_LIST:
                    break
                if e.name.startswith(".") or e.is_symlink():
                    continue
                if e.is_dir(follow_symlinks=False):
                    if depth + 1 < MAX_DEPTH:
                        stack.append((Path(e.path), depth + 1))
                    continue
                if not e.is_file(follow_symlinks=False) or not e.name.lower().endswith(MODEL_SUFFIXES):
                    continue
                try:
                    _check_file_name(e.name)
                    kind = _file_kind(Path(e.path))
                    size = e.stat(follow_symlinks=False).st_size
                except (PathRefused, OSError):
                    continue
                if size > MAX_FILE_BYTES:
                    continue
                out.append({"path": e.path, "name": e.name, "type": kind, "size": size,
                            "folder": str(folder), "access": access})
    return out


def _read_fd(fd: int, path: str) -> str:
    data = b""
    while True:
        chunk = os.read(fd, 1 << 16)
        if not chunk:
            break
        data += chunk
        if len(data) > MAX_FILE_BYTES:
            raise PathRefused(path, "too_large")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        raise PathRefused(path, "not_text", f"Not a text file: {path}")


def read_model_file(path: str) -> str:
    """The file's text. It is read through the checked descriptor and never
    imported, parsed or run."""
    fd, parent_fd, _name, real, _access = _open_allowed(path, write=False)
    try:
        _file_kind(real)
        return _read_fd(fd, path)
    finally:
        os.close(fd)
        os.close(parent_fd)


def previous_versions_dir() -> Path:
    override = os.environ.get(STATE_DIR_ENV, "").strip()
    base = Path(override).expanduser() if override else Path.home() / ".psyneuview" / "assistant"
    return base / "previous"


def previous_versions(path: str) -> list[dict]:
    """Earlier versions kept by ``write_model_file``, newest first."""
    real = resolve_allowed(path)
    d = previous_versions_dir() / hashlib.sha256(str(real).encode()).hexdigest()[:16]
    if not d.is_dir():
        return []
    items = sorted(d.iterdir(), key=lambda p: p.name, reverse=True)
    return [{"path": str(p), "name": p.name, "size": p.stat().st_size}
            for p in items if p.is_file() and p.name.endswith(".bak")]


def _keep_previous(real: Path, fd: int) -> Path:
    d = previous_versions_dir() / hashlib.sha256(str(real).encode()).hexdigest()[:16]
    d.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%S") + f".{time.time_ns() % 1_000_000_000:09d}"
    kept = d / f"{real.name}.{stamp}.bak"
    os.lseek(fd, 0, os.SEEK_SET)
    with open(kept, "xb") as out:
        while True:
            chunk = os.read(fd, 1 << 16)
            if not chunk:
                break
            out.write(chunk)
    (d / "origin.txt").write_text(str(real) + "\n", encoding="utf-8")
    return kept


def write_model_file(path: str, text: str, *, base_hash: str | None) -> Path:
    """Write ``text`` to a model file in a read-write folder.

    ``base_hash`` is the sha256 of the content the agent last read. If the
    file now hashes differently, nothing is written and ``PathRefused`` with
    reason ``stale`` is raised, so someone else's change is never overwritten.
    A new file needs ``base_hash`` None. The previous version is kept under
    ``previous_versions_dir()``; the write lands by atomic rename; and the
    result is marked unreviewed, so it doesn't run until approved.
    """
    if not isinstance(text, str):
        raise PathRefused(path, "not_text")
    data = text.encode("utf-8")
    if len(data) > MAX_FILE_BYTES:
        raise PathRefused(path, "too_large")
    fd, parent_fd, name, real, _access = _open_allowed(path, write=True, must_exist=False)
    try:
        if fd is None:
            if base_hash is not None:
                raise PathRefused(path, "stale", f"{name} no longer exists; look again before writing.")
            if _is_layout(name):
                try:
                    json.loads(text)
                except ValueError:
                    raise PathRefused(path, "wrong_type", "A layout file must be JSON.")
        else:
            _file_kind(real)
            current = _read_fd(fd, path)
            if base_hash is None or base_hash != review.content_hash(current):
                raise PathRefused(path, "stale", f"{name} changed since the assistant last read it; look again before writing.")
            _keep_previous(real, fd)
        tmp = f".{name}.assistant-{os.getpid()}-{time.time_ns()}.tmp"
        try:
            tmp_fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=parent_fd)
        except OSError as e:
            raise PathRefused(path, "cannot_write", str(e))
        try:
            with os.fdopen(tmp_fd, "wb") as out:
                out.write(data)
                out.flush()
                os.fsync(out.fileno())
            if fd is not None:
                # The entry must still be the inode that was checked and hashed.
                now = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
                was = os.fstat(fd)
                if (now.st_ino, now.st_dev) != (was.st_ino, was.st_dev) or now.st_nlink > 1:
                    raise PathRefused(path, "swapped", f"{name} was replaced while being written; look again.")
            os.rename(tmp, name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
        except BaseException:
            try:
                os.unlink(tmp, dir_fd=parent_fd)
            except OSError:
                pass
            raise
        review.mark_unreviewed(str(real), text)
        return real
    finally:
        if fd is not None:
            os.close(fd)
        os.close(parent_fd)
