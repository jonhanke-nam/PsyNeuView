"""The operating-system sandbox for model runs: policy and state (#311).

The import guard (#187) stops assistant-written code running by accident.
It runs inside Python, so model code that deliberately works against it can
get round it. This module decides the **hard boundary** behind it: what a
model runner may read, write, start and reach, which the runner then asks
the kernel to enforce on itself (``os_sandbox_apply.py``) before any model
code runs. The design, per platform, is ``docs/ai-assistant/os-sandbox.md``.

Three things live here:

- :func:`policy` — the policy for one task, built from the review state
  (the files the assistant wrote that nobody has approved), the assistant's
  folders, and where Python, PsyNeuLink and PsyNeuView are installed.
- :func:`wanted` / :func:`active` — whether a task is sandboxed now.
- :func:`status` — what the app says in Settings ▸ AI assistant and in
  About: available or not, by what mechanism, and what it does and doesn't
  enforce. Never silently unsandboxed: when it is wanted and can't be
  applied, the status says so, and the assistant refuses to turn on unless
  the user has allowed that.
"""

from __future__ import annotations

import glob
import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
from pathlib import Path

from app.services import os_sandbox_apply as _apply

logger = logging.getLogger(__name__)

#: ``on`` sandboxes every run, ``off`` none (measuring, debugging), anything
#: else follows the settings. Read once, when the server starts.
FORCE_ENV = "PSYNEUVIEW_OS_SANDBOX"
_FORCED = os.environ.get(FORCE_ENV, "").strip().lower()

#: Further folders a model may write in, besides the assistant's read-write
#: folders: ``os.pathsep``-separated. The "declared output folders".
WRITE_FOLDERS_ENV = "PSYNEUVIEW_OS_SANDBOX_WRITE_FOLDERS"

APPLY_PATH = str(Path(_apply.__file__).resolve())

#: Places nothing a model runs may read: keys, tokens, the Keychain,
#: browser profiles, mail. Relative to the home folder.
HOME_SECRETS = (
    ".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".netrc", ".git-credentials",
    ".pypirc", ".npmrc", ".password-store", ".config/gh", ".config/gcloud", ".config/hub",
    ".local/share/keyrings", ".mozilla", ".config/google-chrome", ".config/chromium",
    ".config/BraveSoftware", ".config/microsoft-edge", ".thunderbird",
    "Library/Keychains", "Library/Cookies", "Library/Safari", "Library/Mail", "Library/Messages",
    "Library/Application Support/Google/Chrome", "Library/Application Support/Firefox",
    "Library/Application Support/BraveSoftware", "Library/Application Support/Microsoft Edge",
    "Library/Application Support/Arc", "Library/Application Support/com.apple.TCC",
    "Library/Containers/com.apple.Safari",
)
SYSTEM_SECRETS = ("/Library/Keychains", "/private/var/db/dslocal", "/etc/shadow", "/etc/sudoers")

#: Graphviz's programs, which ``show_graph`` starts.
GRAPHVIZ = ("dot", "neato", "fdp", "sfdp", "circo", "twopi", "osage", "patchwork", "unflatten", "gvpr")

_probe_lock = threading.Lock()
_probe_result: dict | None = None
_scratch_root: str | None = None
_hash_cache: dict[str, tuple[tuple, str | None]] = {}


# ── Can it be applied here? ─────────────────────────────────────────────────


def capability(refresh: bool = False) -> dict:
    """Whether a sandbox can be applied on this machine, and how. Found by
    applying a small policy in a process of its own and checking that it
    holds (``os_sandbox_apply.probe``); once per server, about 60 ms."""
    global _probe_result
    with _probe_lock:
        if _probe_result is not None and not refresh:
            return _probe_result
        result: dict
        if not (sys.platform == "darwin" or sys.platform.startswith("linux")):
            result = {"ok": False, "platform": sys.platform,
                      "reason": "PsyNeuView has no sandbox for native Windows; run it under WSL2 instead"}
        else:
            work = tempfile.mkdtemp(prefix="psyneuview-sandbox-probe-")
            try:
                proc = subprocess.run([sys.executable, "-I", APPLY_PATH, "--probe", work],
                                      capture_output=True, text=True, timeout=30)
                line = (proc.stdout or "").strip().splitlines()[-1:] or [""]
                result = json.loads(line[0]) if line[0] else {
                    "ok": False, "reason": f"the sandbox check printed nothing ({(proc.stderr or '').strip()[-200:]})"}
            except (OSError, ValueError, subprocess.SubprocessError) as e:
                result = {"ok": False, "reason": f"the sandbox check couldn't run: {e}"}
            finally:
                shutil.rmtree(work, ignore_errors=True)
        _probe_result = result
        if result.get("ok"):
            logger.info("Model runs can be sandboxed here (%s)", result.get("mechanism"))
        else:
            logger.warning("Model runs can't be sandboxed here: %s", result.get("reason"))
        return result


def available() -> bool:
    return bool(capability().get("ok"))


# ── Is it wanted now? ───────────────────────────────────────────────────────


def _assistant_settings() -> dict:
    try:
        from app.services.assistant import settings as assistant_settings
        return assistant_settings.get_settings()
    except Exception:  # noqa: BLE001 - a broken settings file must not stop a run
        return {}


def wanted() -> tuple[bool, str]:
    """Whether the next task should be sandboxed, and why, in plain words.

    Always while anything the assistant wrote is tracked (or the review
    record can't be read); with the assistant on and "every model run" set
    (the default), for every run, since opening any shared model runs its
    code. ``PSYNEUVIEW_OS_SANDBOX=on|off`` overrides both."""
    if _FORCED == "off":
        return False, "turned off by PSYNEUVIEW_OS_SANDBOX=off"
    if _FORCED == "on":
        return True, "turned on by PSYNEUVIEW_OS_SANDBOX=on"
    from app.services.assistant import review
    if review.worker_must_be_fresh():
        return True, "files the assistant wrote are tracked"
    s = _assistant_settings()
    if s.get("enabled") and (s.get("sandbox") or {}).get("all_runs", True):
        return True, "the assistant is on and every model run is sandboxed"
    return False, "the assistant is off and nothing it wrote is tracked"


def active() -> bool:
    """Wanted and possible: the next task runs sandboxed."""
    want, _ = wanted()
    return want and available()


# ── The policy ──────────────────────────────────────────────────────────────


def _real(p: str | os.PathLike) -> str:
    try:
        return os.path.realpath(os.fspath(p))
    except OSError:
        return os.fspath(p)


def _spellings(path: str) -> list[str]:
    """``path`` as given and as the file system spells it. Seatbelt matches
    the file system's spelling (case and accent form included), which on
    macOS ``F_GETPATH`` returns."""
    out = [_real(path)]
    if sys.platform == "darwin":
        try:
            import fcntl
            fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC)
            try:
                raw = fcntl.fcntl(fd, 50, b"\0" * 1024)  # F_GETPATH
                spelled = raw.split(b"\0", 1)[0].decode("utf-8", "surrogateescape")
                if spelled and spelled not in out:
                    out.append(spelled)
            finally:
                os.close(fd)
        except OSError:
            pass
    return out


def _approved_hash_of(path: str) -> str | None:
    """The content hash of ``path`` now (cached by size and mtime), or None
    if it can't be read as text."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    sig = (st.st_size, st.st_mtime_ns, st.st_ino)
    cached = _hash_cache.get(path)
    if cached and cached[0] == sig:
        return cached[1]
    try:
        with open(path, "rb") as f:
            text = f.read().decode("utf-8")
        h = hashlib.sha256(text.encode("utf-8")).hexdigest()
    except (OSError, UnicodeDecodeError):
        h = None
    _hash_cache[path] = (sig, h)
    return h


def unapproved_files() -> list[str]:
    """Every tracked file whose text on disk now isn't the approved text."""
    from app.services.assistant import review
    files = review._load()["files"]
    out = []
    for key, entry in (files or {}).items():
        if not os.path.exists(key):
            continue
        approved = (entry or {}).get("approved")
        if approved is None or _approved_hash_of(key) != approved:
            out.extend(_spellings(key))
    return sorted(set(out))


def _designated_folders() -> list[dict]:
    try:
        from app.services.assistant import files as assistant_files
        return [f for f in assistant_files.folders_provider() if isinstance(f, dict) and f.get("path")]
    except Exception:  # noqa: BLE001
        return []


def output_folders() -> list[str]:
    """Where a sandboxed model may write besides its own task folder: the
    assistant's read-write folders and any declared in
    ``PSYNEUVIEW_OS_SANDBOX_WRITE_FOLDERS``. The protected places
    (:func:`_protected_from_writes`) stay unwritable even inside them."""
    out = [_real(f["path"]) for f in _designated_folders() if f.get("access") == "read_write"]
    out += [_real(p) for p in os.environ.get(WRITE_FOLDERS_ENV, "").split(os.pathsep) if p.strip()]
    return sorted(set(out))


def _protected_from_writes() -> list[str]:
    """Never written by a model: the review record and app settings, the
    app itself, PsyNeuLink, and the Python install with its packages."""
    from app.services.assistant import review
    out = [str(review.state_path().parent), str(review.state_path()), str(review.backup_path()),
           str(Path.home() / ".psyneuview.json"), str(Path(__file__).resolve().parents[3]),
           sys.prefix, sys.base_prefix, sys.exec_prefix]
    for var in ("PSYNEUVIEW_ASSISTANT_STATE_DIR", "PSYNEUVIEW_ASSISTANT_LOG", "PSYNEUVIEW_CONFIG_FILE"):
        if os.environ.get(var, "").strip():
            out.append(os.environ[var].strip())
    try:
        import site
        out += site.getsitepackages() + [site.getusersitepackages()]
    except Exception:  # noqa: BLE001
        pass
    try:
        for root in review.exempt_roots():
            out.append(root)
    except Exception:  # noqa: BLE001
        pass
    return sorted({_real(p) for p in out if p})


def _programs() -> list[str]:
    """Python (the runner starts it again for some libraries) and Graphviz."""
    out = {_real(sys.executable)}
    if sys.platform == "darwin" and "Python.framework" in sys.base_prefix:
        # The framework's python re-executes Python.app inside it.
        out.add(_real(sys.base_prefix))
    if sys.platform.startswith("linux"):
        for pattern in ("/lib*/ld-linux*.so*", "/lib/*/ld-linux*.so*", "/usr/lib*/ld-linux*.so*",
                        "/lib/ld-musl-*.so*"):
            out.update(_real(p) for p in glob.glob(pattern))
    for name in GRAPHVIZ:
        found = shutil.which(name)
        if found:
            out.add(_real(found))
    return sorted(out)


def _secrets(home: str) -> list[str]:
    out = [os.path.join(home, rel) for rel in HOME_SECRETS]
    out += list(SYSTEM_SECRETS)
    if sys.platform.startswith("linux"):
        for root in ("/home", "/var/home"):
            try:
                for name in os.listdir(root):
                    p = _real(os.path.join(root, name))
                    if p != home and not home.startswith(p + "/"):
                        out.append(p)
            except OSError:
                pass
        if home != "/root":
            out.append("/root")
    return [_real(p) for p in out]


def scratch_root() -> str:
    """This server's folder for task folders, made once, private to the user."""
    global _scratch_root
    if _scratch_root is None:
        base = Path(tempfile.gettempdir()) / f"psyneuview-sandbox-{os.getuid() if hasattr(os, 'getuid') else 'u'}"
        base.mkdir(mode=0o700, exist_ok=True)
        root = base / str(os.getpid())
        root.mkdir(mode=0o700, exist_ok=True)
        _scratch_root = _real(root)
    return _scratch_root


def new_scratch() -> str:
    """A path for one task's own folder (made by the runner, removed by
    :func:`discard_scratch` once the task has answered)."""
    return os.path.join(scratch_root(), "task-" + uuid.uuid4().hex[:12])


def discard_scratch(path: str | None) -> None:
    if path and _real(path).startswith(scratch_root() + os.sep):
        shutil.rmtree(path, ignore_errors=True)


def policy(scratch: str | None = None) -> dict:
    """The policy for one task. ``key`` names everything but the scratch
    folder, so two tasks with the same key are sandboxed alike."""
    from app.services.assistant import review
    home = _real(Path.home())
    read_deny = _secrets(home) + unapproved_files()
    if review.state_broken():
        # The record can't be read, so nobody knows what is approved: none of
        # the assistant's folders may be read (the import guard refuses
        # everything outside the standard library then too).
        read_deny += [_real(f["path"]) for f in _designated_folders()]
    write_allow = output_folders()
    p = {
        "version": _apply.POLICY_VERSION,
        "home": home,
        "other_users_root": "/Users" if sys.platform == "darwin" else None,
        "read_deny": sorted(set(read_deny)),
        "write_allow": sorted(set(write_allow)),
        "write_deny": _protected_from_writes(),
        "exec_allow": _programs(),
        "network": False,
    }
    p["key"] = hashlib.sha256(json.dumps(p, sort_keys=True).encode()).hexdigest()[:16]
    scratch = scratch or new_scratch()
    p["scratch"] = scratch
    p["write_allow"] = sorted(set(p["write_allow"]) | {scratch})
    return p


def launch_env(p: dict) -> dict:
    """The environment for a worker started for one task with policy ``p``:
    it applies the policy first thing (``apply_from_env``)."""
    env = dict(os.environ)
    env[_apply.POLICY_ENV] = json.dumps(p)
    return env


# ── What the app says ───────────────────────────────────────────────────────


def status() -> dict:
    """For Settings ▸ AI assistant and About: whether model runs are
    sandboxed, by what, and what isn't covered. ``state`` is one of
    ``on`` (wanted and applied), ``unavailable`` (wanted, can't be applied:
    runs are NOT sandboxed), ``available`` (could be, not wanted now) and
    ``off_unavailable`` (not wanted, and couldn't be anyway)."""
    cap = capability()
    want, why = wanted()
    ok = bool(cap.get("ok"))
    if want and ok:
        state = "on"
    elif want:
        state = "unavailable"
    elif ok:
        state = "available"
    else:
        state = "off_unavailable"
    s = _assistant_settings().get("sandbox") or {}
    return {
        "state": state,
        "available": ok,
        "wanted": want,
        "why": why,
        "mechanism": cap.get("mechanism"),
        "platform": cap.get("platform", sys.platform),
        "landlock_abi": cap.get("landlock_abi"),
        "enforced": cap.get("enforced", []),
        "not_enforced": cap.get("not_enforced", []),
        "reason": cap.get("reason"),
        "forced": _FORCED if _FORCED in ("on", "off") else None,
        "all_runs": bool(s.get("all_runs", True)),
        "require": bool(s.get("require", True)),
    }


def summary_line() -> str:
    """One line for problem reports and the log."""
    st = status()
    if st["state"] == "on":
        return f"Model runs are sandboxed ({st['mechanism']})"
    if st["state"] == "unavailable":
        return f"Model runs are NOT sandboxed: {st['reason']}"
    if st["available"]:
        return f"Sandbox available ({st['mechanism']}), not in use: {st['why']}"
    return f"No sandbox on this system: {st['reason']}"
