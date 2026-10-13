"""Keep PsyNeuLink current, and say so (#1304).

People couldn't see whether the PsyNeuLink they run is current or when that
was last checked, and "Latest development" (the default) only stays latest
if it is updated. This module is the one place for that:

- **The check.** :func:`check_now` asks how current the installed PsyNeuLink
  is — a branch install through :mod:`pnl_freshness` (how many commits
  behind its branch), a PyPI install through :mod:`pnl_releases` (is there a
  newer release) — and records when it ran and what it found in the
  preferences file, so Settings and Report a Problem can show it without a
  network call.
- **The schedule.** A background thread runs the check at launch and every
  :data:`CHECK_INTERVAL_S` (one constant: the same rhythm as app updates).
- **Automatic updates for Latest development**, on by default. A managed
  GitHub install that is behind is marked *update ready*; the update is
  installed at the **next start**, not mid-session, because updating
  restarts the model runner. :func:`install_ready_update` does that through
  the one install mechanism, :mod:`install_manager`, before the runner is
  used; on failure the install in use stays and the failure is recorded.
  An official release is only reported, never switched.

Everything that decides is a pure function (:func:`is_due`,
:func:`should_install_at_start`, :func:`newer_release_available`) so the
rules are tested without a network, a clock or a venv.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Callable, Optional

from app.services import pnl_freshness
from app.services.app_config import app_config_path

logger = logging.getLogger(__name__)

#: How often the check runs while PsyNeuView is open — the same rhythm as the
#: Mac app's own update check. The one place the interval is written.
CHECK_INTERVAL_S = 4 * 60 * 60

#: How long a start may wait for a ready update to install before giving up on
#: it (the install job keeps running; the start goes on with what is there).
INSTALL_AT_START_TIMEOUT_S = 15 * 60

#: Settings ▸ General ▸ "Keep Latest development up to date automatically".
AUTO_UPDATE_KEY = "pnl_auto_update"
#: Last check, its result, whether an update is ready, the last automatic install.
STATE_KEY = "pnl_update_state"

#: Set to ``0`` to keep the scheduler and the start-time install off (the e2e
#: harness, a developer who wants a quiet backend).
ENABLE_ENV = "PSYNEUVIEW_PNL_UPDATE_CHECKS"

_lock = threading.Lock()


# ── Preferences ───────────────────────────────────────────────────────


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


def auto_update_enabled(*, config_file: Optional[Path] = None) -> bool:
    """Whether Latest development is kept up to date automatically. On by default."""
    value = _read_config(config_file or app_config_path()).get(AUTO_UPDATE_KEY)
    return True if value is None else bool(value)


def set_auto_update(enabled: bool, *, config_file: Optional[Path] = None) -> None:
    path = config_file or app_config_path()
    with _lock:
        config = _read_config(path)
        config[AUTO_UPDATE_KEY] = bool(enabled)
        if not enabled:
            # Nothing installs on its own any more: an update marked ready is
            # unmarked, so the "installs next time" note goes away with it.
            state = config.get(STATE_KEY) if isinstance(config.get(STATE_KEY), dict) else {}
            state = {**state, "update_ready": False, "ready_commit": None}
            config[STATE_KEY] = state
        _write_config_atomic(path, config)


def state(*, config_file: Optional[Path] = None) -> dict:
    """What is recorded: ``last_check_at``, ``last_result``, ``update_ready``,
    ``ready_commit``, ``last_install``. Empty keys when never checked."""
    raw = _read_config(config_file or app_config_path()).get(STATE_KEY)
    stored = raw if isinstance(raw, dict) else {}
    return {
        "last_check_at": stored.get("last_check_at"),
        "last_result": stored.get("last_result"),
        "update_ready": bool(stored.get("update_ready")),
        "ready_commit": stored.get("ready_commit"),
        "last_install": stored.get("last_install"),
    }


def _update_state(changes: dict, *, config_file: Optional[Path] = None) -> dict:
    path = config_file or app_config_path()
    with _lock:
        config = _read_config(path)
        current = config.get(STATE_KEY) if isinstance(config.get(STATE_KEY), dict) else {}
        merged = {**current, **changes}
        config[STATE_KEY] = merged
        _write_config_atomic(path, config)
    return merged


# ── The decisions ─────────────────────────────────────────────────────


def is_due(last_check_at: Optional[float], now: float, interval_s: float = CHECK_INTERVAL_S) -> bool:
    """Whether a check is due: never checked, or the interval has passed."""
    if last_check_at is None:
        return True
    return now - float(last_check_at) >= interval_s


def seconds_until_due(last_check_at: Optional[float], now: float, interval_s: float = CHECK_INTERVAL_S) -> float:
    """How long the scheduler should wait before the next check; 0 when due."""
    if last_check_at is None:
        return 0.0
    return max(0.0, interval_s - (now - float(last_check_at)))


def newer_release_available(installed: Optional[str], newest: Optional[str]) -> bool:
    """Whether ``newest`` (the newest release that can install here) is newer
    than the ``installed`` one. Unknown either way means no."""
    if not installed or not newest:
        return False
    try:
        from packaging.version import InvalidVersion, Version

        return Version(newest) > Version(installed)
    except InvalidVersion:
        return False


def _same_branch_install(result: Optional[dict], info: dict) -> bool:
    """Whether the installed PsyNeuLink is still the managed GitHub branch the
    ready update was found for."""
    if not result or info.get("source") != "github":
        return False
    return (
        (result.get("repo") or "").lower() == (info.get("repo") or "").lower()
        and (result.get("branch") or "") == (info.get("branch") or "")
    )


def should_install_at_start(current_state: dict, info: dict, auto_update: bool) -> bool:
    """Whether a start should install the ready update first: automatic
    updates on, an update marked ready for the very branch install that is
    still in use, and not already at that commit (someone may have applied
    it from Settings in the meantime)."""
    if not auto_update or not current_state.get("update_ready"):
        return False
    if not _same_branch_install(current_state.get("last_result"), info):
        return False
    ready = current_state.get("ready_commit") or ""
    installed = info.get("commit") or ""
    if ready and installed and (ready.startswith(installed) or installed.startswith(ready)):
        return False
    return True


# ── The check ─────────────────────────────────────────────────────────


def _not_applicable(branch: Optional[str], commit: Optional[str]) -> dict:
    return {
        "status": "not_applicable", "behind_by": None, "installed_commit": commit,
        "head_commit": None, "head_date": None,
        "detail": pnl_freshness.describe("not_applicable", None, branch),
    }


def check_now(
    *,
    info: Optional[dict] = None,
    now: Optional[float] = None,
    freshness: Optional[Callable[..., dict]] = None,
    newest_release: Optional[Callable[[], tuple[Optional[str], bool]]] = None,
    config_file: Optional[Path] = None,
) -> dict:
    """Check how current the installed PsyNeuLink is, record it, and return
    the recorded state.

    A branch install (managed GitHub, or a checkout) is compared with the
    head of its branch; a PyPI install with the newest release that can
    install here. A managed GitHub install that is behind is marked *update
    ready* when automatic updates are on; a checkout and a release never are
    (the checkout has its own pull in Developer; a release is only reported).
    """
    if info is None:
        from app.services.settings_info import get_psyneulink_info

        info = get_psyneulink_info()
    checked_at = time.time() if now is None else now
    source = info.get("source")
    result: dict = {
        "checked_at": checked_at,
        "source": source,
        "version": info.get("version"),
        "repo": info.get("repo"),
        "branch": info.get("branch"),
        "commit": info.get("commit"),
        "freshness": None,
        "newest_release": None,
        "release_available": False,
        "offline": False,
    }
    update_ready = False
    ready_commit = None
    if source in ("github", "editable") and info.get("repo") and info.get("branch"):
        fresh = (freshness or pnl_freshness.check)(
            repo=info.get("repo"), branch=info.get("branch"),
            version=info.get("version"), commit=info.get("commit"),
        )
        result["freshness"] = fresh
        if source == "github" and fresh.get("status") == "behind":
            update_ready = auto_update_enabled(config_file=config_file)
            ready_commit = fresh.get("head_commit")
    elif source == "pypi":
        newest, offline = (newest_release or _newest_installable_release)()
        result["newest_release"] = newest
        result["offline"] = offline
        result["release_available"] = newer_release_available(info.get("version"), newest)
        result["freshness"] = _not_applicable(None, None)
    else:
        result["freshness"] = _not_applicable(info.get("branch"), info.get("commit"))
    _update_state(
        {
            "last_check_at": checked_at,
            "last_result": result,
            "update_ready": update_ready,
            "ready_commit": ready_commit,
        },
        config_file=config_file,
    )
    logger.info(
        "pnl_updates: checked %s — %s%s",
        source, (result["freshness"] or {}).get("detail", ""),
        " (update ready for next start)" if update_ready else "",
    )
    return state(config_file=config_file)


def _newest_installable_release() -> tuple[Optional[str], bool]:
    """The newest release that installs on this Python, and whether PyPI was
    unreachable (then the answer comes from the last listing seen)."""
    from app.services import pnl_releases

    listing = pnl_releases.list_releases()
    newest = next((r["version"] for r in listing.get("releases", []) if r.get("compatible")), None)
    return newest, bool(listing.get("offline"))


# ── Installing the ready update at start ──────────────────────────────


def install_ready_update(
    manager,
    *,
    info: Optional[dict] = None,
    timeout_s: float = INSTALL_AT_START_TIMEOUT_S,
    after_info: Optional[Callable[[], dict]] = None,
    config_file: Optional[Path] = None,
) -> dict:
    """Install the update marked ready, through the one install mechanism,
    and wait for it. Records ``last_install`` either way: on failure the
    PsyNeuLink in use stays as it is and the failure is kept to show.

    ``manager`` is an :class:`install_manager.InstallManager`; ``after_info``
    reads the install afterwards (defaults to the real probe) so the record
    can say what it went to.
    """
    if info is None:
        from app.services.settings_info import get_psyneulink_info

        info = get_psyneulink_info()
    started = time.time()
    record = {
        "at": started,
        "outcome": "failed",
        "from_commit": info.get("commit"),
        "to_commit": None,
        "repo": info.get("repo"),
        "branch": info.get("branch"),
        "detail": "",
        "job_id": None,
    }
    try:
        job = manager.start("github", info.get("branch"), None, info.get("repo"), None)
        record["job_id"] = job.id
        deadline = started + timeout_s
        while job.status in ("pending", "running") and time.time() < deadline:
            time.sleep(0.25)
        if job.status == "succeeded":
            record["outcome"] = "succeeded"
            read = after_info
            if read is None:
                from app.services.settings_info import get_psyneulink_info

                read = get_psyneulink_info
            record["to_commit"] = (read() or {}).get("commit")
            record["detail"] = f"Updated {info.get('repo')} @ {info.get('branch')}."
        elif job.status in ("pending", "running"):
            record["outcome"] = "failed"
            record["detail"] = f"The update was still running after {int(timeout_s)} seconds; PsyNeuView started without it."
        else:
            record["outcome"] = "failed"
            tail = [line for line in job.log if line.strip()][-5:]
            record["detail"] = "The update failed; the PsyNeuLink in use stays. " + (" | ".join(tail) if tail else "")
    except Exception as exc:  # noqa: BLE001 — a failed update must never stop the start
        record["outcome"] = "failed"
        record["detail"] = f"The update couldn't start: {exc}"
        logger.warning("pnl_updates: automatic update failed to start: %s", exc)
    # Marked ready no longer, whatever happened: a failure is recorded and
    # shown, and the next check marks it ready again if it is still behind,
    # rather than retrying on every start.
    _update_state(
        {"last_install": record, "update_ready": False, "ready_commit": None},
        config_file=config_file,
    )
    if record["outcome"] == "succeeded":
        logger.info("pnl_updates: %s", record["detail"])
    else:
        logger.warning("pnl_updates: %s", record["detail"])
    return record


# ── What Settings and Report a Problem read ───────────────────────────


def status(*, info: Optional[dict] = None, config_file: Optional[Path] = None) -> dict:
    """Everything about keeping PsyNeuLink current, without a network call:
    the switch, the interval, the last check and its result, whether an
    update is ready, and the last automatic install's outcome."""
    if info is None:
        from app.services.settings_info import get_psyneulink_info

        info = get_psyneulink_info()
    current = state(config_file=config_file)
    auto = auto_update_enabled(config_file=config_file)
    return {
        "auto_update": auto,
        "interval_s": CHECK_INTERVAL_S,
        "installed": info,
        **current,
        # Ready only counts while automatic updates are on and the install is
        # still the branch the update was found for.
        "update_ready": bool(current["update_ready"] and auto and _same_branch_install(current.get("last_result"), info)),
        "checks_enabled": checks_enabled(),
    }


def summary(*, config_file: Optional[Path] = None) -> dict:
    """The short form for ``/api/settings/info`` (Report a Problem reads it):
    no git probe, no network."""
    current = state(config_file=config_file)
    result = current.get("last_result") or {}
    fresh = result.get("freshness") or {}
    return {
        "auto_update": auto_update_enabled(config_file=config_file),
        "last_check_at": current.get("last_check_at"),
        "status": fresh.get("status"),
        "behind_by": fresh.get("behind_by"),
        "detail": fresh.get("detail"),
        "newest_release": result.get("newest_release"),
        "release_available": bool(result.get("release_available")),
        "update_ready": current.get("update_ready"),
        "last_install": current.get("last_install"),
    }


# ── The scheduler ─────────────────────────────────────────────────────


def checks_enabled() -> bool:
    """Whether the scheduler and the start-time install run in this process:
    not in the e2e harness, not when switched off, and only where installing
    is possible at all (a container's PsyNeuLink is fixed by its image)."""
    if os.environ.get(ENABLE_ENV, "").strip() == "0":
        return False
    if os.environ.get("PSYNEWVIEW_TEST_MODE") == "1":
        return False
    try:
        from app.services import deployment_mode

        return bool(deployment_mode.capabilities(deployment_mode.current_mode()).install)
    except Exception:  # noqa: BLE001
        return False


class Scheduler:
    """Runs the check at launch and every :data:`CHECK_INTERVAL_S` in a
    daemon thread; :meth:`stop` ends it. ``on_tick`` is what runs each time
    (the check, and the checkouts' checks); it must not raise."""

    def __init__(self, on_tick: Callable[[], None], interval_s: float = CHECK_INTERVAL_S):
        self._on_tick = on_tick
        self._interval = interval_s
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name="pnl-update-checks", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self._on_tick()
            except Exception:  # noqa: BLE001
                logger.exception("pnl_updates: a scheduled check failed")
            if self._stop.wait(self._interval):
                break


_scheduler: Optional[Scheduler] = None


def _tick() -> None:
    check_now()
    from app.services import checkout_updates

    checkout_updates.check_enabled()


def run_at_start() -> dict:
    """What the backend does when it starts (#1304), before the model runner
    is used: install a ready update, pull the checkouts that asked for it,
    then begin the scheduled checks. Never raises.

    Returns what happened, for the start-up phase report
    (PsyNeuView-MacApp#232): ``install`` is ``"installed"``, ``"skipped"`` or
    ``"failed"``, ``detail`` says why in a few words, and ``pulled`` counts
    the checkouts pulled on launch.
    """
    global _scheduler
    outcome = {"install": "skipped", "detail": "", "pulled": 0}
    if not checks_enabled():
        logger.info("pnl_updates: checks are off in this process")
        outcome["detail"] = "update checks are off in this process"
        return outcome
    try:
        from app.services.install_manager import get_install_manager
        from app.services.settings_info import get_psyneulink_info

        info = get_psyneulink_info()
        current = state()
        auto = auto_update_enabled()
        if should_install_at_start(current, info, auto):
            logger.info("pnl_updates: installing the ready update before starting")
            record = install_ready_update(get_install_manager(), info=info)
            if record.get("outcome") == "succeeded":
                outcome["install"] = "installed"
                outcome["detail"] = str(record.get("detail") or "installed the ready update")
            else:
                outcome["install"] = "failed"
                outcome["detail"] = str(record.get("detail") or "the install did not finish")
        elif not auto:
            outcome["detail"] = "automatic updates are off"
        elif not current.get("update_ready"):
            outcome["detail"] = "no update ready"
        else:
            outcome["detail"] = "already installed"
    except Exception as e:  # noqa: BLE001
        logger.exception("pnl_updates: the start-time update failed")
        outcome["install"] = "failed"
        outcome["detail"] = f"{type(e).__name__}: {e}"
    try:
        from app.services import checkout_updates

        outcome["pulled"] = len(checkout_updates.pull_on_launch())
    except Exception:  # noqa: BLE001
        logger.exception("pnl_updates: pulling checkouts at launch failed")
    if _scheduler is None:
        _scheduler = Scheduler(_tick)
        _scheduler.start()
    return outcome


def stop() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.stop()
        _scheduler = None
