"""Update options for a developer's own checkouts (#1304).

The PsyNeuLink checkouts Settings knows (:mod:`source_history`, kind
``local``) and the PsyNeuView checkout this backend runs from, when it is a
git checkout. For each, two switches, both off by default:

- **Check for upstream changes** — fetch its remote branch on the schedule
  and say how far behind it is, and when that was checked.
- **Pull on launch** — fast-forward it when the backend starts.

Safety, because these are the user's folders: a pull is **fast-forward
only**, is **refused with uncommitted changes** ("3 files changed locally;
not pulled") and on a **diverged branch** (local commits the remote lacks),
and **never switches branch**. Everything is plain ``git`` in the checkout;
the remote and branch used are the ones the checkout already tracks
(``origin/devel``), shown beside each switch.

Preferences and the last check/pull are kept per checkout in the
preferences file, keyed by the resolved path.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

from app.services.app_config import app_config_path

logger = logging.getLogger(__name__)

PREFS_KEY = "checkout_updates"
STATE_KEY = "checkout_update_state"

GIT_TIMEOUT_S = 10.0
FETCH_TIMEOUT_S = 60.0

_lock = threading.Lock()


# ── Preferences and state ─────────────────────────────────────────────


def _read_config(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _write_config_atomic(path: Path, config: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".psynewview.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(config, f, indent=2, sort_keys=True)
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def _key(path: str | Path) -> str:
    return str(Path(path).expanduser().resolve())


def prefs(path: str | Path, *, config_file: Optional[Path] = None) -> dict:
    """``{"check": bool, "pull_on_launch": bool}`` for one checkout; both off by default."""
    raw = _read_config(config_file or app_config_path()).get(PREFS_KEY)
    stored = (raw or {}).get(_key(path)) if isinstance(raw, dict) else None
    stored = stored if isinstance(stored, dict) else {}
    return {"check": bool(stored.get("check")), "pull_on_launch": bool(stored.get("pull_on_launch"))}


def set_prefs(
    path: str | Path,
    *,
    check: Optional[bool] = None,
    pull_on_launch: Optional[bool] = None,
    config_file: Optional[Path] = None,
) -> dict:
    config_path = config_file or app_config_path()
    key = _key(path)
    with _lock:
        config = _read_config(config_path)
        table = config.get(PREFS_KEY) if isinstance(config.get(PREFS_KEY), dict) else {}
        entry = dict(table.get(key) or {}) if isinstance(table.get(key), dict) else {}
        if check is not None:
            entry["check"] = bool(check)
        if pull_on_launch is not None:
            entry["pull_on_launch"] = bool(pull_on_launch)
        table[key] = entry
        config[PREFS_KEY] = table
        _write_config_atomic(config_path, config)
    return prefs(path, config_file=config_file)


def recorded(path: str | Path, *, config_file: Optional[Path] = None) -> dict:
    """The last check and the last pull recorded for one checkout."""
    raw = _read_config(config_file or app_config_path()).get(STATE_KEY)
    stored = (raw or {}).get(_key(path)) if isinstance(raw, dict) else None
    stored = stored if isinstance(stored, dict) else {}
    return {"last_check": stored.get("last_check"), "last_pull": stored.get("last_pull")}


def _record(path: str | Path, changes: dict, *, config_file: Optional[Path] = None) -> None:
    config_path = config_file or app_config_path()
    key = _key(path)
    with _lock:
        config = _read_config(config_path)
        table = config.get(STATE_KEY) if isinstance(config.get(STATE_KEY), dict) else {}
        entry = dict(table.get(key) or {}) if isinstance(table.get(key), dict) else {}
        entry.update(changes)
        table[key] = entry
        config[STATE_KEY] = table
        _write_config_atomic(config_path, config)


# ── git ───────────────────────────────────────────────────────────────


def _git(args: list[str], cwd: Path, timeout: float = GIT_TIMEOUT_S) -> tuple[int, str]:
    """Run git in ``cwd``; ``(exit code, output)``. Never raises for a git
    failure — the code says so; raises only when git itself can't run."""
    try:
        proc = subprocess.run(
            ["git", *args], cwd=str(cwd), capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return 124, f"git {' '.join(args)} took longer than {int(timeout)} seconds"
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def is_checkout(path: str | Path) -> bool:
    return (Path(path).expanduser() / ".git").exists()


def inspect(path: str | Path) -> dict:
    """What the checkout looks like right now, without the network: branch,
    the remote branch it tracks, how far ahead/behind it is of what was last
    fetched, and how many files are changed locally."""
    folder = Path(path).expanduser()
    out: dict = {
        "branch": None, "upstream": None, "commit": None,
        "ahead_by": None, "behind_by": None, "dirty_files": 0, "status": "unknown", "detail": "",
    }
    if not is_checkout(folder):
        out["status"] = "not_a_checkout"
        out["detail"] = "Not a git checkout."
        return out
    code, branch = _git(["symbolic-ref", "--short", "HEAD"], folder)
    out["branch"] = branch if code == 0 else None
    code, commit = _git(["rev-parse", "--short", "HEAD"], folder)
    out["commit"] = commit if code == 0 else None
    code, upstream = _git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], folder)
    out["upstream"] = upstream if code == 0 else None
    code, porcelain = _git(["status", "--porcelain"], folder)
    out["dirty_files"] = len([line for line in porcelain.splitlines() if line.strip()]) if code == 0 else 0
    if out["branch"] is None:
        out["status"] = "detached"
        out["detail"] = "Not on a branch (detached HEAD); nothing is pulled."
        return out
    if out["upstream"] is None:
        out["status"] = "no_upstream"
        out["detail"] = f"{out['branch']} tracks no remote branch; nothing is pulled."
        return out
    code, counts = _git(["rev-list", "--left-right", "--count", "HEAD...@{u}"], folder)
    if code != 0:
        out["detail"] = counts or "Couldn't compare with the remote branch."
        return out
    ahead, behind = (int(n) for n in counts.split())
    out["ahead_by"], out["behind_by"] = ahead, behind
    if ahead and behind:
        out["status"] = "diverged"
    elif ahead:
        out["status"] = "ahead"
    elif behind:
        out["status"] = "behind"
    else:
        out["status"] = "current"
    out["detail"] = describe(out["status"], behind, ahead, out["dirty_files"], out["upstream"])
    return out


def describe(status: str, behind_by: Optional[int], ahead_by: Optional[int], dirty_files: int, upstream: Optional[str]) -> str:
    """The sentence Settings shows for a checkout."""
    def commits(n: int) -> str:
        return f"{n} commit{'' if n == 1 else 's'}"

    if status == "current":
        text = f"Up to date with {upstream}."
    elif status == "behind":
        text = f"{commits(behind_by or 0)} behind {upstream}."
    elif status == "ahead":
        text = f"{commits(ahead_by or 0)} ahead of {upstream}; nothing to pull."
    elif status == "diverged":
        text = f"{commits(behind_by or 0)} behind and {commits(ahead_by or 0)} ahead of {upstream}; not pulled."
    elif status == "unknown":
        text = "Couldn't check — the remote was unreachable."
    else:
        text = ""
    if dirty_files:
        text = f"{text} {_dirty_sentence(dirty_files)}".strip()
    return text


def _dirty_sentence(n: int) -> str:
    return f"{n} file{'' if n == 1 else 's'} changed locally; not pulled."


def check(path: str | Path, *, fetch: bool = True, config_file: Optional[Path] = None, now: Optional[float] = None) -> dict:
    """Fetch the tracked remote branch and record how the checkout stands."""
    folder = Path(path).expanduser()
    checked_at = time.time() if now is None else now
    fetched = True
    fetch_error = None
    if fetch and is_checkout(folder):
        code, remote = _git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], folder)
        remote_name = remote.split("/", 1)[0] if code == 0 and "/" in remote else None
        if remote_name:
            code, out = _git(["fetch", "--quiet", remote_name], folder, timeout=FETCH_TIMEOUT_S)
            if code != 0:
                fetched = False
                fetch_error = out
    result = inspect(folder)
    if not fetched:
        result["status"] = "unknown"
        result["detail"] = describe("unknown", None, None, result["dirty_files"], result["upstream"])
        logger.info("checkout_updates: fetch failed for %s: %s", folder, fetch_error)
    record = {**result, "checked_at": checked_at, "fetched": fetched}
    _record(folder, {"last_check": record}, config_file=config_file)
    return record


def pull(path: str | Path, *, config_file: Optional[Path] = None, now: Optional[float] = None) -> dict:
    """Fast-forward the checkout to its tracked remote branch, after a fetch.
    Refused — recorded and reported, nothing touched — with uncommitted
    changes, on a diverged or ahead branch, off a branch, or without a remote
    branch. Never switches branch."""
    folder = Path(path).expanduser()
    at = time.time() if now is None else now
    before = check(folder, config_file=config_file, now=now)
    record = {
        "at": at, "outcome": "refused", "from_commit": before.get("commit"), "to_commit": None,
        "upstream": before.get("upstream"), "detail": "",
    }
    if before["status"] == "not_a_checkout":
        record["detail"] = "Not a git checkout."
    elif before["dirty_files"]:
        record["detail"] = _dirty_sentence(before["dirty_files"])
    elif before["status"] in ("diverged", "ahead"):
        record["detail"] = (
            f"Your branch has {before['ahead_by']} commit{'' if before['ahead_by'] == 1 else 's'} "
            f"{before['upstream']} doesn't; not pulled."
        )
    elif before["status"] in ("detached", "no_upstream"):
        record["detail"] = before["detail"]
    elif before["status"] == "unknown":
        record["detail"] = "Couldn't reach the remote; not pulled."
    elif before["status"] == "current":
        record["outcome"] = "up_to_date"
        record["to_commit"] = before.get("commit")
        record["detail"] = f"Already up to date with {before['upstream']}."
    else:
        code, out = _git(["merge", "--ff-only", "@{u}"], folder, timeout=FETCH_TIMEOUT_S)
        if code == 0:
            _, commit = _git(["rev-parse", "--short", "HEAD"], folder)
            record["outcome"] = "pulled"
            record["to_commit"] = commit
            record["detail"] = f"Pulled {before['behind_by']} commit{'' if before['behind_by'] == 1 else 's'} from {before['upstream']}."
        else:
            record["outcome"] = "failed"
            record["detail"] = f"The pull failed; nothing was changed. {out}".strip()
    _record(folder, {"last_pull": record}, config_file=config_file)
    if record["outcome"] == "pulled":
        logger.info("checkout_updates: %s — %s", folder, record["detail"])
        # The checkout's last check predates the pull: say where it stands now.
        _record(folder, {"last_check": {**inspect(folder), "checked_at": at, "fetched": True}}, config_file=config_file)
    else:
        logger.info("checkout_updates: %s — %s", folder, record["detail"])
    return record


# ── The checkouts Settings lists ──────────────────────────────────────


def list_checkouts(*, config_file: Optional[Path] = None) -> list[dict]:
    """The PsyNeuView checkout the backend runs from (when it is one) and
    every PsyNeuLink checkout Settings knows, each with its remote branch,
    its two switches and what was last found."""
    from app.services import locations, source_history
    from app.services.settings_info import get_psyneulink_info

    out: list[dict] = []
    pv = locations.psyneuview_location()
    if pv["kind"] == "checkout":
        out.append(_entry("psyneuview", "PsyNeuView", pv["path"], True, True, config_file=config_file))
    active = source_history.active_source_from_info(get_psyneulink_info())
    for e in source_history.list_sources(active=active, config_file=config_file):
        if e["kind"] != "local" or e["missing"]:
            continue
        name = e.get("label") or "PsyNeuLink checkout"
        out.append(_entry("psyneulink", name, e["path"], True, e["active"], config_file=config_file))
    return out


def _entry(kind: str, name: str, path: str, exists: bool, in_use: bool, *, config_file: Optional[Path] = None) -> dict:
    now = inspect(path) if exists else {"branch": None, "upstream": None, "commit": None}
    return {
        "id": _key(path),
        "kind": kind,
        "name": name,
        "path": path,
        "exists": exists,
        "in_use": in_use,
        "is_checkout": is_checkout(path) if exists else False,
        "branch": now.get("branch"),
        "upstream": now.get("upstream"),
        "commit": now.get("commit"),
        "dirty_files": now.get("dirty_files", 0),
        **prefs(path, config_file=config_file),
        **recorded(path, config_file=config_file),
    }


def check_enabled(*, config_file: Optional[Path] = None) -> list[dict]:
    """The scheduled check: every checkout whose "Check for upstream changes" is on."""
    results = []
    for entry in list_checkouts(config_file=config_file):
        if entry["check"] and entry["is_checkout"]:
            try:
                results.append(check(entry["path"], config_file=config_file))
            except Exception:  # noqa: BLE001
                logger.exception("checkout_updates: checking %s failed", entry["path"])
    return results


def pull_on_launch(*, config_file: Optional[Path] = None) -> list[dict]:
    """At start: pull every checkout whose "Pull on launch" is on. A PsyNeuLink
    checkout in use that moved restarts the model runner, so it runs the new code."""
    results = []
    for entry in list_checkouts(config_file=config_file):
        if not (entry["pull_on_launch"] and entry["is_checkout"]):
            continue
        try:
            result = pull(entry["path"], config_file=config_file)
        except Exception:  # noqa: BLE001
            logger.exception("checkout_updates: pulling %s failed", entry["path"])
            continue
        results.append(result)
        if result["outcome"] == "pulled" and entry["kind"] == "psyneulink" and entry["in_use"]:
            try:
                from app.services import sandbox

                sandbox.restart_warm_worker()
            except Exception:  # noqa: BLE001
                logger.exception("checkout_updates: restarting the model runner failed")
    return results
