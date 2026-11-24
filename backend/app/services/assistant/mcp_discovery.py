"""How the MCP command finds the running backend (#201).

The Mac app may start the backend on a different port each time, so the
setup pasted into Claude names no address. Instead the backend writes a small
**discovery file** when it starts, and the MCP command (``app/mcp_server.py``)
reads it on every request:

``{"pid": 12345, "port": 8353, "host": "127.0.0.1", "version": "0.6.16", "started": 1764000000.0}``

Where it lives, in order:

1. ``PSYNEUVIEW_MCP_DISCOVERY_FILE``, when set (both sides read it);
2. beside the preferences file when that is redirected
   (``PSYNEUVIEW_CONFIG_FILE``: the e2e harness, the Mac test app, a trial
   run), so a test backend never takes over the real one's file; the setup
   text then carries ``PSYNEUVIEW_MCP_DISCOVERY_FILE`` so the command looks
   there;
3. else ``~/.psyneuview/mcp-backend.json``, with the other app data.

The file holds no secret, but it is written readable and writable by the
user only (``0600``, made that way, never widened), and the command refuses
one that isn't: a file another account could write could point the token at
another program. The command also checks that the pid is alive and the
address is this machine, and says plainly when PsyNeuView isn't running.

**One holder at a time.** Several backends may run at once (a developer's
checkouts, the Mac app). The first live one keeps the file; a later one
takes it over only when the holder has stopped. A backend removes the file
when it stops, but only while the file still names it.

Standard library only, so the MCP command starts fast.
"""

from __future__ import annotations

import json
import os
import stat
import time
from pathlib import Path

DISCOVERY_ENV = "PSYNEUVIEW_MCP_DISCOVERY_FILE"
CONFIG_ENV = "PSYNEUVIEW_CONFIG_FILE"  # app_config.CONFIG_ENV, without importing it
FILE_NAME = "mcp-backend.json"
LOOPBACK = {"127.0.0.1", "::1", "localhost"}


class NotFound(Exception):
    """No running PsyNeuView could be found; the message is for the user."""


def default_path() -> Path:
    return Path.home() / ".psyneuview" / FILE_NAME


def path() -> Path:
    """Where this process writes (the backend) or reads (the MCP command)."""
    override = os.environ.get(DISCOVERY_ENV, "").strip()
    if override:
        return Path(override).expanduser()
    config = os.environ.get(CONFIG_ENV, "").strip()
    if config:
        return Path(config).expanduser().parent / FILE_NAME
    return default_path()


def is_default() -> bool:
    return path() == default_path()


def pid_alive(pid: int) -> bool:
    """Whether a process with this pid exists and belongs to this user."""
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return False  # someone else's process: not ours, so not PsyNeuView
    return True


# ── the backend's side ───────────────────────────────────────────────────


def _read_raw(p: Path) -> dict | None:
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


def write(port: int, version: str = "", *, pid: int | None = None, force: bool = False) -> bool:
    """Write the file for this backend unless another live backend holds it.
    True when the file now names this one. Never raises: a backend starts
    whether or not it could write it."""
    pid = os.getpid() if pid is None else pid
    p = path()
    try:
        held = _read_raw(p)
        if held and not force:
            other = held.get("pid")
            if isinstance(other, int) and other != pid and pid_alive(other):
                return False
            if other == pid and held.get("port") == port:
                return True
        p.parent.mkdir(parents=True, exist_ok=True)
        body = json.dumps({"pid": pid, "port": int(port), "host": "127.0.0.1", "version": version, "started": time.time()})
        tmp = p.with_name(f".{p.name}.{pid}.tmp")
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            os.fchmod(fd, 0o600)  # whatever the umask
            os.write(fd, body.encode("utf-8"))
        finally:
            os.close(fd)
        os.replace(tmp, p)
        return True
    except OSError:
        return False


def remove(*, pid: int | None = None) -> None:
    """Remove the file if it still names this backend."""
    pid = os.getpid() if pid is None else pid
    p = path()
    held = _read_raw(p)
    if held and held.get("pid") == pid:
        try:
            p.unlink()
        except OSError:
            pass


# ── the MCP command's side ───────────────────────────────────────────────


def find_url() -> str:
    """``http://127.0.0.1:<port>`` of the running backend, or ``NotFound``
    with a reason the user can act on."""
    p = path()
    try:
        st = os.stat(p, follow_symlinks=False)
    except FileNotFoundError:
        raise NotFound(f"PsyNeuView doesn't seem to be running: there's no {p}. Start PsyNeuView and try again.") from None
    except OSError as e:
        raise NotFound(f"couldn't read {p}: {e.strerror or e}") from None
    if not stat.S_ISREG(st.st_mode):
        raise NotFound(f"{p} isn't a plain file; delete it and restart PsyNeuView")
    if st.st_uid != os.getuid() or st.st_mode & 0o077:
        raise NotFound(f"{p} must belong to you and be readable by you only; delete it and restart PsyNeuView")
    data = _read_raw(p)
    if data is None:
        raise NotFound(f"{p} is unreadable; restart PsyNeuView")
    pid, port, host = data.get("pid"), data.get("port"), data.get("host", "127.0.0.1")
    if not isinstance(pid, int) or not isinstance(port, int) or not 0 < port < 65536:
        raise NotFound(f"{p} is malformed; restart PsyNeuView")
    if host not in LOOPBACK:
        raise NotFound(f"{p} names {host!r}, not this machine; delete it and restart PsyNeuView")
    if not pid_alive(pid):
        raise NotFound(f"PsyNeuView isn't running (the last one, process {pid}, has stopped). Start PsyNeuView and try again.")
    return f"http://127.0.0.1:{port}"
