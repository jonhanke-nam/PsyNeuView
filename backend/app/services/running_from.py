"""What PsyNeuView is running, and from where (#1356).

A colleague's Mac app ran an old PsyNeuView for weeks without anyone
noticing: the app can run the PsyNeuView it includes (unpacked into
``~/Library/Application Support/PsyNeuView/psyneuview-<version>``) or a git
checkout the user chose, and a checkout changes only when it is pulled, on
whatever branch it is on. Settings ▸ About now says which, and this module
is where it finds out.

Everything here is read from disk, without the network: whether the
backend's own source tree is a git checkout, its branch and commit, files
changed locally, and how it compares with the remote branches **as last
fetched**. ``fetch()`` is the one call that touches the network, and only
when someone presses Check now. Every git call has a timeout, and no git
(not installed, or an unreadable checkout) is an answer, not an error.

Facts only about PsyNeuView's own install, nothing else on the computer
(the diagnostics privacy scope, docs/settings-and-mac-app.md).
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

GIT_TIMEOUT_S = 3.0
FETCH_TIMEOUT_S = 30.0

#: The trunk a checkout is compared with, as well as the branch it tracks.
MAIN_BRANCH = "devel"

#: The commit the running server's code came from, noted when it started
#: (``note_start``): a checkout pulled since then has new code on disk that
#: this process isn't running.
_started_commit: Optional[str] = None
_start_noted = False


def repo_root() -> Path:
    # services/running_from.py → app/services → app → backend → repo root
    return Path(__file__).resolve().parents[3]


# ── git ───────────────────────────────────────────────────────────────


class GitUnavailable(Exception):
    """git itself couldn't run here (not installed, or no permission)."""


def _git(args: list[str], cwd: Path, timeout: float = GIT_TIMEOUT_S) -> tuple[int, str]:
    """``(exit code, stdout)`` of git in ``cwd``. A timeout is exit 124.
    Raises ``GitUnavailable`` only when git can't be started at all."""
    try:
        proc = subprocess.run(
            ["git", *args], cwd=str(cwd), capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return 124, ""
    except OSError as e:  # FileNotFoundError: no git on PATH
        raise GitUnavailable(str(e)) from e
    return proc.returncode, (proc.stdout or "").strip()


def _out(args: list[str], cwd: Path) -> Optional[str]:
    code, out = _git(args, cwd)
    return out if code == 0 and out else None


def is_checkout(root: Path) -> bool:
    # A file in a worktree, a folder in a clone.
    return (root / ".git").exists()


def _count(args: list[str], cwd: Path) -> Optional[int]:
    out = _out(args, cwd)
    try:
        return int(out) if out is not None else None
    except ValueError:
        return None


def _last_fetched(cwd: Path) -> Optional[str]:
    """When the checkout last fetched: the newest ``FETCH_HEAD``. A worktree
    has its own, and a fetch in any worktree updates the shared remote
    branches, so both places are looked at."""
    candidates = []
    own = _out(["rev-parse", "--git-path", "FETCH_HEAD"], cwd)
    if own:
        candidates.append(Path(own))
    common = _out(["rev-parse", "--git-common-dir"], cwd)
    if common:
        candidates.append(Path(common) / "FETCH_HEAD")
    times = []
    for path in candidates:
        try:
            times.append((path if path.is_absolute() else cwd / path).stat().st_mtime)
        except OSError:
            continue
    return _iso(max(times)) if times else None


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")


def git_state(root: Path) -> dict:
    """The checkout as it is on disk, against the remote branches as last
    fetched. Never touches the network."""
    branch = _out(["symbolic-ref", "--short", "-q", "HEAD"], root)
    commit = _out(["rev-parse", "--short", "HEAD"], root)
    commit_date = _out(["log", "-1", "--format=%cI", "HEAD"], root)
    code, porcelain = _git(["status", "--porcelain", "--untracked-files=no"], root)
    dirty = len([line for line in porcelain.splitlines() if line.strip()]) if code == 0 else None
    upstream = _out(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], root) if branch else None

    ahead = behind = None
    if upstream:
        counts = _out(["rev-list", "--left-right", "--count", f"HEAD...{upstream}"], root)
        if counts and len(counts.split()) == 2:
            ahead, behind = (int(n) for n in counts.split())

    # The trunk, as last fetched: how many of its commits this checkout lacks.
    main_ref = f"origin/{MAIN_BRANCH}"
    has_main = _git(["rev-parse", "--verify", "-q", f"refs/remotes/{main_ref}"], root)[0] == 0
    behind_main = _count(["rev-list", "--count", f"HEAD..{main_ref}"], root) if has_main else None

    return {
        "branch": branch,
        "commit": commit,
        "commit_date": commit_date,
        "dirty_files": dirty,
        "upstream": upstream,
        "ahead_by": ahead,
        "behind_by": behind,
        "main_branch": main_ref if has_main else None,
        "behind_main": behind_main,
        "on_main_branch": branch == MAIN_BRANCH,
        "last_fetched": _last_fetched(root),
    }


_SHA = re.compile(r"^[0-9a-f]{4,40}$")


def is_commit_id(value: Optional[str]) -> bool:
    """A (short) commit id, and nothing git could read as an option."""
    return bool(value) and bool(_SHA.match(value))


def relation(page_commit: str, server_commit: str, root: Path) -> str:
    """How a page's build commit stands to the server's: ``same``,
    ``page_older`` (the server has commits the page doesn't), ``page_newer``,
    or ``different`` (neither contains the other, or git can't say)."""
    if _same_commit(page_commit, server_commit):
        return "same"
    if not (is_commit_id(page_commit) and is_commit_id(server_commit)):
        return "different"
    try:
        if _git(["merge-base", "--is-ancestor", page_commit, server_commit], root)[0] == 0:
            return "page_older"
        if _git(["merge-base", "--is-ancestor", server_commit, page_commit], root)[0] == 0:
            return "page_newer"
    except GitUnavailable:
        pass
    return "different"


def _same_commit(a: Optional[str], b: Optional[str]) -> bool:
    """Short SHAs of different lengths name the same commit when one starts the other."""
    if not a or not b:
        return False
    return a.startswith(b) or b.startswith(a)


# ── What's running ────────────────────────────────────────────────────


def _deployment() -> str:
    from app.services import deployment_mode

    return deployment_mode.current_mode()


def _version() -> str:
    from app.services.settings_info import get_psyneuview_info

    return get_psyneuview_info()["version"]


def _kind(root: Path, deployment: str) -> str:
    """``checkout`` (a git checkout: yours, changes only when pulled),
    ``included`` (the copy the Mac app includes and replaces on update) or
    ``copy`` (any other install without git history)."""
    if is_checkout(root):
        return "checkout"
    if deployment == "mac_app" or "Application Support/PsyNeuView" in str(root):
        return "included"
    return "copy"


def _dist_build(root: Path) -> Optional[dict]:
    """``frontend/dist/build-info.json``: what the page files on disk were built
    from (written by the build, frontend/vite.config.ts). None without one."""
    import json

    path = root / "frontend" / "dist" / "build-info.json"
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def note_start() -> Optional[str]:
    """Remember the commit the server started from (called once, at start).
    Returns it; None for an install that isn't a checkout or can't be read."""
    global _started_commit, _start_noted
    root = repo_root()
    commit = None
    if is_checkout(root):
        try:
            commit = _out(["rev-parse", "--short", "HEAD"], root)
        except GitUnavailable:
            commit = None
    _started_commit, _start_noted = commit, True
    return commit


def describe(page_commit: Optional[str] = None, *, root: Optional[Path] = None) -> dict:
    """Everything About shows about what's running. ``page_commit`` is the
    commit the asking page was built from, to say which of the two is older."""
    root = root or repo_root()
    deployment = _deployment()
    kind = _kind(root, deployment)
    out: dict = {
        "version": _version(),
        "kind": kind,
        "deployment": deployment,
        "app_flavor": os.environ.get("PSYNEUVIEW_APP_FLAVOR") or None,
        "path": str(root),
        "git": None,
        "git_error": None,
        "started_commit": _started_commit,
        "dist": _dist_build(root),
        "page": None,
        "dist_relation": None,
    }
    if kind == "checkout":
        try:
            out["git"] = git_state(root)
        except GitUnavailable as e:
            out["git_error"] = f"git couldn't run here ({e})"
        if out["git"] is not None and not out["git"]["commit"]:
            out["git_error"] = "git couldn't read this checkout"
        if not _start_noted and out["git"]:
            # Never noted (a test client, or an import without the lifespan):
            # the code on disk now is the best answer there is.
            out["started_commit"] = out["git"]["commit"]
    server_commit = out["started_commit"] or (out["git"] or {}).get("commit")
    can_compare = kind == "checkout" and out["git"] is not None and bool(server_commit)
    dist_commit = (out["dist"] or {}).get("commit")
    # The page files on disk against the server's code: a checkout pulled
    # without rebuilding them serves an older page, and a reload won't help.
    out["dist_relation"] = relation(dist_commit, server_commit, root) if (can_compare and dist_commit) else None
    if page_commit:
        if can_compare:
            rel = relation(page_commit, server_commit, root)
        elif dist_commit:
            # No git to order them: the page either is or isn't what's served now.
            rel = "same" if _same_commit(page_commit, dist_commit) else "different"
        else:
            rel = "unknown"
        out["page"] = {"commit": page_commit, "relation": rel}
    out["summary"] = summary_line(out)
    return out


def fetch(*, root: Optional[Path] = None) -> dict:
    """Check now: fetch the remote the checkout tracks (and ``origin``, for
    the trunk), with a timeout, then describe again. Nothing is pulled.
    ``fetched`` says whether it worked, ``fetch_error`` why not."""
    root = root or repo_root()
    result = {"fetched": False, "fetch_error": None}
    if not is_checkout(root):
        result["fetch_error"] = "Not a git checkout; there is nothing to fetch."
        return result
    try:
        upstream = _out(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], root)
        remotes = {"origin"}
        if upstream and "/" in upstream:
            remotes.add(upstream.split("/", 1)[0])
        errors = []
        for remote in sorted(remotes):
            if _git(["remote", "get-url", remote], root)[0] != 0:
                continue
            code, _ = _git(["fetch", "--quiet", remote], root, timeout=FETCH_TIMEOUT_S)
            if code == 124:
                errors.append(f"fetching {remote} took longer than {int(FETCH_TIMEOUT_S)} seconds")
            elif code != 0:
                errors.append(f"couldn't fetch {remote}")
        result["fetched"] = not errors
        result["fetch_error"] = "; ".join(errors) or None
    except GitUnavailable as e:
        result["fetch_error"] = f"git couldn't run here ({e})"
    return result


# ── The one line for the log ──────────────────────────────────────────


def _home(path: str) -> str:
    home = str(Path.home())
    return "~" + path[len(home):] if path == home or path.startswith(home + os.sep) else path


def summary_line(info: dict) -> str:
    """``PsyNeuView 0.5.15 running from your checkout at ~/… (devel, abc1234)``:
    one plain line for the start-up log, and the same words in diagnostics."""
    head = f"PsyNeuView {info['version']} running from"
    if info["kind"] == "included":
        return f"{head} the version included with the Mac app ({_home(info['path'])})"
    if info["kind"] == "copy":
        return f"{head} {_home(info['path'])} (not a git checkout)"
    git = info.get("git") or {}
    detail = []
    detail.append(git.get("branch") or "no branch")
    if git.get("commit"):
        detail.append(git["commit"])
    if git.get("dirty_files"):
        n = git["dirty_files"]
        detail.append(f"{n} file{'' if n == 1 else 's'} changed")
    if info.get("git_error"):
        detail = [info["git_error"]]
    return f"{head} your checkout at {_home(info['path'])} ({', '.join(detail)})"
