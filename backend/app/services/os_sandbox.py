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
import time
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

#: Set to 1 when the server starts to let runs go ahead unsandboxed where
#: the sandbox is wanted but can't be applied (read once; a model can't
#: change it, since every model run is out of the server's process).
ALLOW_UNSANDBOXED_ENV = "PSYNEUVIEW_OS_SANDBOX_ALLOW_UNSANDBOXED"
_ALLOW_UNSANDBOXED = os.environ.get(ALLOW_UNSANDBOXED_ENV, "").strip() == "1"

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
        # A success holds for the server's life; a failure is checked again
        # after a minute (#311, S4): it may have been passing trouble.
        if _probe_result is not None and not refresh and (
                _probe_result.get("ok") or time.monotonic() - _probe_result.get("_at", 0) < 60):
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
        result["_at"] = time.monotonic()
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


class SandboxRefused(RuntimeError):
    """A run that must be sandboxed and can't be (#311, S4)."""


def refusal() -> str | None:
    """Why a run must not go ahead now, or None. While the sandbox is
    wanted (the assistant on, or anything it wrote tracked) and it can't be
    applied, runs are refused, unless "Require the sandbox" is off or the
    server was started with ``PSYNEUVIEW_OS_SANDBOX_ALLOW_UNSANDBOXED=1``."""
    want, why = wanted()
    if not want or available():
        return None
    if _ALLOW_UNSANDBOXED:
        return None
    if not (_assistant_settings().get("sandbox") or {}).get("require", True):
        return None
    reason = capability().get("reason") or "no sandbox can be applied here"
    return (f"Model runs must be sandboxed ({why}), and the sandbox can't be applied here: {reason}. "
            f"Nothing was run. Turn off \"Require the sandbox\" in Settings to run without it.")


def check_applied(result, policy: dict | None) -> dict:
    """The worker's proof that it ran under ``policy`` (#311, S4). A result
    from a run that should have been sandboxed and doesn't carry the
    policy's key is refused, whatever the cause."""
    if not policy or not isinstance(result, dict):
        return result
    if result.get("os_sandbox_refused") or result.get("os_sandbox_applied") == policy.get("key"):
        return result
    if "error" in result and "os_sandbox_applied" not in result:
        return result  # the process ended before answering; already an error
    logger.error("A task meant to be sandboxed answered without the sandbox's proof; its result is refused")
    return {"error": "This run should have been sandboxed and its process didn't prove it was, so its result "
                     "isn't used.", "os_sandbox_refused": True}


_sweep_lock = threading.Lock()
_sweep_again = False


def sweep_survivors(wait: bool = False) -> None:
    """End sandboxed processes finished tasks left behind (#311, S3 and T3).

    Runs in the background, so a task never waits on a survivor: after
    Learn jobs, pool and one-shot tasks and conversions, and before every
    task. ``wait`` (before the assistant writes a file) runs it now, so no
    survivor is there to read what is written; bounded to ten seconds. The
    fork server's parent sweeps its own after each of its tasks."""
    if not available():
        return
    if wait:
        _sweep_now()
        return
    global _sweep_again
    if not _sweep_lock.acquire(blocking=False):
        _sweep_again = True  # one is running; it goes round once more
        return

    def run():
        global _sweep_again
        try:
            while True:
                _sweep_again = False
                _sweep_now()
                if not _sweep_again:
                    break
        finally:
            _sweep_lock.release()

    threading.Thread(target=run, daemon=True, name="sandbox-sweep").start()


def _sweep_now() -> None:
    try:
        _apply.end_survivors(0.0, _programs(), own_children=False, time_limit=10.0)
    except Exception:  # noqa: BLE001 - never fail a task over it
        logger.exception("Couldn't sweep processes left by a sandboxed task")


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


def canonical(path: str) -> str:
    """``path`` as the file system spells it: the real path, and on macOS the
    spelling the volume stores (case and accent form), from ``F_GETPATH``
    on the opened file or folder. Every path a policy compares goes through
    this, so a case- or accent-changed spelling names the same rules (#311)."""
    real = _real(path)
    if sys.platform == "darwin":
        try:
            import fcntl
            fd = os.open(real, os.O_RDONLY | os.O_CLOEXEC)
            try:
                raw = fcntl.fcntl(fd, 50, b"\0" * 1024)  # F_GETPATH
                spelled = raw.split(b"\0", 1)[0].decode("utf-8", "surrogateescape")
                if spelled:
                    return spelled
            finally:
                os.close(fd)
        except OSError:
            pass
    return real


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


def _canon_list(paths) -> list[str]:
    return sorted({canonical(p) if os.path.exists(p) else _real(p) for p in paths})


def output_folders() -> list[str]:
    """Where a sandboxed model may write besides its own task folder: the
    assistant's read-write folders and any declared in
    ``PSYNEUVIEW_OS_SANDBOX_WRITE_FOLDERS``. The protected places
    (:func:`_protected_from_writes`) stay unwritable even inside them."""
    out = [_real(f["path"]) for f in _designated_folders() if f.get("access") == "read_write"]
    out += [_real(p) for p in os.environ.get(WRITE_FOLDERS_ENV, "").split(os.pathsep) if p.strip()]
    return _canon_list(out)


def _protected_from_writes() -> list[str]:
    """Never written by a model: the review record and app settings, the
    app itself, PsyNeuLink, and the Python install with its packages."""
    from app.services.assistant import review
    out = [str(review.state_path().parent), str(review.state_path()), str(review.backup_path()),
           str(Path.home() / ".psyneuview.json"), str(Path(__file__).resolve().parents[3]),
           sys.prefix, sys.base_prefix, sys.exec_prefix]
    # The app's settings file, which names the PsyNeuLink the fork server's
    # parent imports, under its name now and its old one.
    try:
        from app.services import app_config
        out += [str(app_config.app_config_path()), str(app_config.DEFAULT_CONFIG_FILE),
                str(app_config.LEGACY_CONFIG_FILE)]
    except Exception:  # noqa: BLE001
        pass
    # The interpreter's own library folders: a sitecustomize.py or a module
    # there would run in every Python (an admin user can write a
    # python.org install's lib folder).
    import sysconfig
    for scheme_key in ("stdlib", "platstdlib", "purelib", "platlib", "include", "scripts", "data"):
        try:
            value = sysconfig.get_paths().get(scheme_key)
        except (KeyError, OSError):
            value = None
        if value:
            out.append(value)
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


def _own_home() -> str:
    """The user's home folder from the account, not ``$HOME`` (which a
    test, or a launcher, may point elsewhere)."""
    try:
        import pwd
        return pwd.getpwuid(os.getuid()).pw_dir
    except (ImportError, KeyError, OSError):
        return str(Path.home())


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


#: Files a model may not make or change in its own folder (macOS): code a
#: later Python could run without anyone reviewing it.
CODE_SUFFIXES = (".py", ".pyc", ".pyo", ".pyw", ".pth", ".so", ".dylib", ".pyd")
CODE_NAMES = ("sitecustomize", "usercustomize")


def assistant_stores() -> list[str]:
    """Everywhere the assistant keeps text it wrote, besides the files
    themselves: earlier versions of files it changed (which may be
    unapproved text), and its log. No model may read them (#311, S1)."""
    out = []
    try:
        from app.services.assistant import files as assistant_files
        out.append(str(assistant_files.previous_versions_dir()))
    except Exception:  # noqa: BLE001
        out.append(str(Path(_own_home()) / ".psyneuview" / "assistant" / "previous"))
    try:
        from app.services.assistant import log as assistant_log
        out.append(str(assistant_log.log_path()))
    except Exception:  # noqa: BLE001
        pass
    return [_real(p) for p in out]


def tracked_files() -> list[str]:
    """Every file the assistant wrote that is on disk, approved or not."""
    from app.services.assistant import review
    out = []
    for key in (review._load()["files"] or {}):
        if os.path.exists(key):
            out.extend(_spellings(key))
    return sorted(set(out))


def model_folder(model_path: str | None) -> tuple[str | None, str | None]:
    """The model's own folder, if writes may be allowed there, and why not
    otherwise. Refused when the folder is, holds or sits inside a protected
    place (the app, PsyNeuLink, the Python install, the review record), or
    is the home folder or a root: the task then writes only in its own
    scratch folder and the declared output folders."""
    if not model_path:
        return None, None
    folder = canonical(os.path.dirname(os.path.abspath(model_path)))
    home = _real(_own_home())
    if folder in ("/", home) or folder.count(os.sep) < 2:
        return None, f"the model's folder ({folder}) is too broad to open for writing"
    for root in _protected_from_writes():
        if folder == root or folder.startswith(root.rstrip(os.sep) + os.sep) or root.startswith(folder.rstrip(os.sep) + os.sep):
            return None, (f"the model's folder ({folder}) is or holds part of the app, PsyNeuLink, the Python "
                          f"install or the review record ({root}), so it isn't opened for writing")
    return folder, None


def policy(scratch: str | None = None, model_path: str | None = None) -> dict:
    """The policy for one task. ``key`` names everything but the scratch
    folder, so two tasks with the same key are sandboxed alike.
    ``model_path`` is the model the task runs: its folder is writable,
    except the protected places in it (see :func:`model_folder`)."""
    from app.services.assistant import review
    home = _real(_own_home())
    read_deny = _secrets(home) + unapproved_files()
    if _real(Path.home()) != home:
        read_deny += [os.path.join(_real(Path.home()), rel) for rel in HOME_SECRETS]
    read_deny += assistant_stores()
    if review.state_broken():
        # The record can't be read, so nobody knows what is approved: none of
        # the assistant's folders may be read (the import guard refuses
        # everything outside the standard library then too).
        read_deny += [_real(f["path"]) for f in _designated_folders()]
    write_allow = output_folders()
    folder, note = model_folder(model_path)
    if folder:
        write_allow.append(folder)
    p = {
        "version": _apply.POLICY_VERSION,
        "home": home,
        "other_users_root": "/Users" if sys.platform == "darwin" else None,
        "read_deny": sorted(set(read_deny)),
        "write_allow": sorted(set(write_allow)),
        "write_deny": _protected_from_writes(),
        # Every file the assistant wrote, approved ones too, can't be changed
        # by a model (macOS; on Linux an approved file a model changes is
        # unapproved by its hash at the next task).
        "write_deny_files": tracked_files(),
        # No new code beside the model (macOS): a .py, .pth or
        # sitecustomize there would run in a later Python unreviewed.
        "no_code_in": sorted(set(write_allow)),
        # No hidden files or folders, nor files other tools run on their own
        # (a Makefile, .git/hooks, a .pth), in any writable folder (macOS).
        "no_autorun_in": sorted(set(write_allow)),
        "model_dir": folder,
        "model_dir_note": note,
        # Python, PsyNeuLink and the app stay readable wherever they are,
        # another account's folder included.
        "read_allow": _protected_from_writes(),
        "exec_allow": _programs(),
        "network": False,
    }
    # The folders that hold a protected file can't be renamed or removed
    # either (macOS matches paths, so moving the folder would move the file
    # out from under its rule): every folder from the file up to the
    # writable folder that holds it (#311, S2).
    p["no_move"] = _folders_above([canonical(x) if os.path.exists(x) else x for x in
                                   p["read_deny"] + p["write_deny"] + p["write_deny_files"]],
                                  [canonical(r) if os.path.exists(r) else r for r in p["write_allow"]])
    p["key"] = hashlib.sha256(json.dumps(p, sort_keys=True).encode()).hexdigest()[:16]
    scratch = scratch or new_scratch()
    p["scratch"] = scratch
    p["write_allow"] = sorted(set(p["write_allow"]) | {scratch})
    return p


def _folders_above(paths: list[str], roots: list[str]) -> list[str]:
    out = set()
    for root in roots:
        r = root.rstrip(os.sep)
        for p in paths:
            if not p.startswith(r + os.sep):
                continue
            d = os.path.dirname(p)
            while d.startswith(r + os.sep) or d == r:
                out.add(d)
                if d == r:
                    break
                d = os.path.dirname(d)
    return sorted(out)


def policy_key(model_path: str | None = None) -> str:
    """The key the next task's policy would have (its scratch folder aside)."""
    return policy(scratch="-", model_path=model_path)["key"]


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
