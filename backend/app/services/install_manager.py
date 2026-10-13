"""Install/restart manager for switching the PsyNeuLink venv install (#130).

For source=pypi/local, runs ``pip install --force-reinstall --no-deps`` in a
background thread. A local checkout that is already the editable install,
with an unchanged ``pyproject.toml``, skips pip entirely (#1276). For source=github, orchestrates a managed clone
via :mod:`clone_manager` (#262) — clone if missing, fetch + reset to
the requested ref, and only re-run ``pip install -e`` when
``pyproject.toml`` has actually changed. This avoids the per-switch
wheel build that made the github source path painfully slow.

Subprocess output streams into ``job.log`` so the gear panel can show
progress live. Token-bearing strings are redacted before any line
reaches the log, regardless of which subprocess emitted them.

One job at a time — concurrent install requests are rejected.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import shlex
import subprocess
import sys
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Literal, Optional

from app.services import clone_manager, github_auth
from app.services.source_history import is_placeholder_repo

logger = logging.getLogger(__name__)

# Matches the credential segment of a token-injected git URL. Anything
# from ``x-access-token:`` to the next ``@`` is the bearer token. The
# new clone_manager path uses ``-c http.extraheader`` instead and
# avoids this form entirely, but keep the redaction so older entries
# and any unexpected leaks stay masked.
_TOKEN_URL_PATTERN = re.compile(r"x-access-token:[^@\s]*@")


def _redact_token(text: str) -> str:
    return _TOKEN_URL_PATTERN.sub("x-access-token:***@", text)


class _StepTimer:
    """Emits ``✓ <label> in X.Xs`` per step and a final ``Total: X.Xs``.

    Tracks elapsed wall time for a sequence of steps so the job log shows
    where time goes during a github/clone install. See #264.
    """

    def __init__(self, on_line: Callable[[str], None]):
        self._on_line = on_line
        self._started = time.monotonic()

    @contextmanager
    def step(self, label: str):
        start = time.monotonic()
        failed = False
        try:
            yield
        except BaseException:
            failed = True
            raise
        finally:
            elapsed = time.monotonic() - start
            marker = "✗" if failed else "✓"
            self._on_line(f"{marker} {label} in {elapsed:.1f}s")

    def finish(self) -> None:
        total = time.monotonic() - self._started
        self._on_line(f"Total: {total:.1f}s")


InstallSource = Literal["pypi", "github", "local"]
JobStatus = Literal["pending", "running", "succeeded", "failed", "cancelled"]

DEFAULT_GITHUB_REPO = "PrincetonUniversity/PsyNeuLink"
#: The branch downloaded into an empty folder when none is named (#1342):
#: Princeton ``devel``, the panel's "Latest development".
DEFAULT_DOWNLOAD_REF = "devel"
_REPO_PATTERN = re.compile(r"^[\w.-]+/[\w.-]+$")


def _normalize_repo(repo: Optional[str]) -> str:
    """Empty/whitespace → the Princeton default; otherwise validate owner/repo shape."""
    if repo is None or not repo.strip():
        return DEFAULT_GITHUB_REPO
    candidate = repo.strip()
    if not _REPO_PATTERN.match(candidate):
        raise ValueError(
            f"repo must be 'owner/repo' (got {candidate!r}); private/auth URLs are not supported"
        )
    if is_placeholder_repo(candidate):
        # #1292: the example slug passes the shape check; refuse it here so
        # nothing downstream (the job, the history) ever sees it.
        raise ValueError(
            f"{candidate!r} is the placeholder, not a GitHub repo: enter the real owner/name"
        )
    return candidate


def local_checkout_problem(path: str) -> Optional[str]:
    """Why ``path`` can't be installed as a PsyNeuLink checkout, in the user's
    words, or None when it looks like one (#1331): a folder holding a
    ``pyproject.toml`` or ``setup.py`` and a ``psyneulink`` package beside it.
    Not a full build check — enough to catch a typo, a parent folder, or a
    checkout of something else before pip is asked."""
    if not (path or "").strip():
        return "path is required for source=local"
    local = Path(path).expanduser().resolve()
    if not local.is_dir():
        return f"path is not a directory: {local}"
    if not ((local / "pyproject.toml").is_file() or (local / "setup.py").is_file()):
        return f"{local} doesn't look like a PsyNeuLink checkout: no pyproject.toml or setup.py in it"
    if not (local / "psyneulink").is_dir():
        return f"{local} doesn't look like a PsyNeuLink checkout: no psyneulink/ package in it"
    return None


#: What a PsyNeuLink checkout holds, in the words the panel uses (#1342).
_CHECKOUT_CONTENTS = "a PsyNeuLink checkout has a psyneulink folder and a pyproject.toml or setup.py"

#: Finder's own bookkeeping file: a folder holding only this still counts
#: as empty, and it is removed before a download so git can clone into the
#: folder (git refuses anything but an empty one). Nothing else is ignored.
_IGNORABLE_IN_EMPTY_FOLDER = frozenset({".DS_Store"})

LocalFolderStatus = Literal["usable", "downloadable", "refused"]


@dataclass(frozen=True)
class LocalFolderCheck:
    """What the folder typed under *Another local checkout…* is (#1342):

    - ``usable``: a PsyNeuLink checkout, to switch to as it is.
    - ``downloadable``: empty, or not there yet (its parent is): PsyNeuLink
      can be downloaded into it.
    - ``refused``: anything else, with ``reason`` saying why in plain words.

    ``exists`` says whether the folder is there now, so the panel can say
    "will be created" rather than "is empty".
    """

    status: LocalFolderStatus
    path: str
    exists: bool
    reason: Optional[str] = None


def _folder_entries(folder: Path) -> Optional[list[str]]:
    """The names in ``folder``, or None when it can't be read."""
    try:
        return [child.name for child in folder.iterdir()]
    except OSError:
        return None


def check_local_folder(path: str) -> LocalFolderCheck:
    """Check the folder as soon as it is typed or chosen, not after Apply
    (#1342). Reads the file system only; no network, nothing is changed."""
    raw = (path or "").strip()
    if not raw:
        return LocalFolderCheck("refused", "", False, "Enter the path to a PsyNeuLink checkout, or choose its folder.")
    if not (raw.startswith("/") or raw == "~" or raw.startswith("~/")):
        return LocalFolderCheck(
            "refused", raw, False, "Enter the full path to the folder, starting with / or ~/."
        )
    local = Path(raw).expanduser()
    try:
        local = local.resolve()
    except OSError:
        pass
    shown = str(local)
    if local.is_dir():
        if local_checkout_problem(shown) is None:
            return LocalFolderCheck("usable", shown, True)
        entries = _folder_entries(local)
        if entries is None:
            return LocalFolderCheck(
                "refused", shown, True,
                "PsyNeuView can't read this folder. Check its permissions, or choose another folder.",
            )
        if all(name in _IGNORABLE_IN_EMPTY_FOLDER for name in entries):
            return LocalFolderCheck("downloadable", shown, True)
        has_build_file = (local / "pyproject.toml").is_file() or (local / "setup.py").is_file()
        why = (
            "This folder has a pyproject.toml or setup.py but no psyneulink folder, "
            "so it isn't a PsyNeuLink checkout"
            if has_build_file
            else f"This folder already has other files in it and isn't a PsyNeuLink checkout: {_CHECKOUT_CONTENTS}"
        )
        return LocalFolderCheck(
            "refused", shown, True,
            f"{why}. Choose a PsyNeuLink checkout, or an empty folder to download PsyNeuLink into. "
            "Nothing in this folder is changed.",
        )
    if local.exists():
        return LocalFolderCheck("refused", shown, True, "That is a file, not a folder. Choose a folder.")
    if not local.parent.is_dir():
        return LocalFolderCheck(
            "refused", shown, False,
            f"The folder it would go in doesn't exist ({local.parent}). Check the path, or create that folder first.",
        )
    return LocalFolderCheck("downloadable", shown, False)


def _normalize_ref(ref: Optional[str]) -> str:
    """Strip whitespace and leading/trailing slashes from a branch/tag ref.

    Users often paste branch names with a trailing slash (e.g.
    ``refactor/emcomposition/em_mech/``). git checkout then fails with
    "did not match any file(s) known to git". Strip those off and
    reject empty-after-strip with a clearer error than the bare
    ``ref is required for source=github``.
    """
    if ref is None:
        raise ValueError("ref is required for source=github")
    cleaned = ref.strip().strip("/")
    if not cleaned:
        raise ValueError(
            f"ref is required for source=github (got {ref!r}, empty after stripping whitespace and slashes)"
        )
    return cleaned


@dataclass
class InstallJob:
    id: str
    source: InstallSource
    ref: Optional[str]
    path: Optional[str]
    repo: Optional[str] = None
    status: JobStatus = "pending"
    log: list[str] = field(default_factory=list)
    exit_code: Optional[int] = None
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    command: list[str] = field(default_factory=list)
    #: A PyPI release to install (#1295 round 5); None means the newest.
    version: Optional[str] = None
    #: For a local checkout: download PsyNeuLink from this GitHub repo and
    #: branch into ``path`` first (#1342). Both set, or neither.
    download_repo: Optional[str] = None
    download_ref: Optional[str] = None


def _build_pip_args(
    source: InstallSource,
    ref: Optional[str],
    path: Optional[str],
    repo: Optional[str] = None,
) -> list[str]:
    """Translate a (source, path) into pip arguments for pypi/local installs.

    ``source=github`` is handled by :func:`_resolve_github_target` +
    :meth:`InstallManager._run_github` rather than a single pip call.

    --no-deps preserves the rest of the venv (matches the Mac app's
    Installer/Updater behavior for non-default sources).
    """
    base = ["install", "--upgrade", "--force-reinstall", "--no-deps"]
    if source == "pypi":
        return base + ["psyneulink"]
    if source == "local":
        problem = local_checkout_problem(path or "")
        if problem:
            raise ValueError(problem)
        return base + ["-e", str(Path(path).expanduser().resolve())]
    if source == "github":
        raise ValueError(
            "source=github is handled via clone_manager, not _build_pip_args"
        )
    raise ValueError(f"unknown source: {source}")


def _local_state_path(local: Path) -> Path:
    """Where we note the ``pyproject.toml`` a local checkout was last installed
    against (#1276). Beside the managed clones' state, never inside the user's
    folder, which would dirty their working tree; keyed by the resolved path."""
    key = hashlib.sha256(str(local.resolve()).encode()).hexdigest()[:16]
    return clone_manager.clone_root() / ".state" / "local" / f"{key}.json"


def _local_recorded_hash(local: Path) -> Optional[str]:
    try:
        return (json.loads(_local_state_path(local).read_text()) or {}).get("pyproject_hash")
    except (OSError, json.JSONDecodeError, AttributeError):
        return None


def _mark_local_installed(local: Path) -> None:
    state = _local_state_path(local)
    try:
        state.parent.mkdir(parents=True, exist_ok=True)
        state.write_text(json.dumps({
            "path": str(local.resolve()),
            "pyproject_hash": clone_manager.pyproject_hash(local),
        }))
    except OSError as e:
        logger.warning("install_manager: failed to write %s: %s", state, e)


def local_install_can_skip_pip(path: str) -> bool:
    """Whether switching to the local checkout at ``path`` needs no pip at all
    (#1276): psyneulink is already installed editable from that very folder,
    and its ``pyproject.toml`` (dependencies, build settings, version) is the
    one we last installed it with. Code edits need no reinstall: an editable
    install runs straight from the folder. The same test the managed GitHub
    clones use (``clone_manager.editable_state``), so switching back to a
    checkout that is already active takes a moment, not a rebuild.

    Switching between two different checkouts still runs pip, already with
    ``--no-deps``: only psyneulink is reinstalled and the rest of the
    environment is left as it is, so there is no dependency resolve.
    """
    local = Path(path).expanduser().resolve()
    if not clone_manager._editable_install_targets(local):
        return False
    recorded = _local_recorded_hash(local)
    return recorded is not None and recorded == clone_manager.pyproject_hash(local)


def _resolve_github_target(ref: Optional[str], repo: Optional[str]) -> tuple[str, str]:
    """Validate + normalize ``(repo, ref)`` for source=github.

    Returns ``(owner_repo, clean_ref)``. Raises ``ValueError`` on bad
    inputs the same way ``_build_pip_args`` used to.
    """
    return _normalize_repo(repo), _normalize_ref(ref)


def _staging_folder_for(target: Path) -> Path:
    """Where a download into ``target`` is made first (#1342): a hidden
    sibling, on the same disk so moving it into place is a rename."""
    return target.parent / f".{target.name}.psyneuview-download-{uuid.uuid4().hex[:8]}"


def _move_download_into_place(staging: Path, target: Path, on_line: Callable[[str], None]) -> None:
    """Put a finished download where the user asked for it (#1342).

    A missing ``target`` is simply the staging folder renamed. An existing
    one must still be empty but for Finder's bookkeeping, which is removed;
    the download's entries are then moved in one by one. If a move fails,
    the entries already moved (all of them the download's) are taken back
    out, so the folder is left as it was found. Raises ``CloneError`` when
    the folder is no longer empty: nothing in it is touched.
    """
    import shutil

    if not target.exists():
        staging.rename(target)
        return
    entries = _folder_entries(target)
    if entries is None or any(name not in _IGNORABLE_IN_EMPTY_FOLDER for name in entries):
        raise clone_manager.CloneError(
            f"{target} is no longer empty, so PsyNeuLink was not put in it. Nothing in it was changed."
        )
    for name in entries:
        child = target / name
        if child.is_file():
            child.unlink()
            on_line(f"Removed {name} (Finder's bookkeeping) so the folder holds only PsyNeuLink")
    moved: list[Path] = []
    try:
        for child in list(staging.iterdir()):
            dest = target / child.name
            child.rename(dest)
            moved.append(dest)
        staging.rmdir()
    except BaseException:
        for dest in moved:
            if dest.is_dir() and not dest.is_symlink():
                shutil.rmtree(dest, ignore_errors=True)
            else:
                dest.unlink(missing_ok=True)
        raise


def _remove_staging_folder(staging: Path, on_line: Callable[[str], None]) -> None:
    """After a failed download, remove the partial download and nothing
    else (#1342): the staging folder is this job's own, made by ``git
    clone``. Never raises: the failure being reported matters more."""
    import shutil

    try:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
            on_line("Removed the partly downloaded copy")
    except Exception as e:  # noqa: BLE001
        logger.warning("install_manager: cleanup after a failed download failed: %s", e)


def _venv_pip() -> str:
    """Path to the venv's pip executable.

    sys.executable is the venv's python while serving requests, so its
    sibling ``pip`` is the one whose dist-info we want to mutate.
    """
    return str(Path(sys.executable).parent / "pip")


def psyneulink_import_problem(python: Optional[str] = None, env: Optional[dict] = None) -> Optional[str]:
    """None when a fresh Python in this environment imports PsyNeuLink whole;
    otherwise, in plain words, why not (#1396).

    A fresh process, like the model runner after a switch: the server's own
    ``psyneulink`` was imported at startup and would hide the problem.
    """
    code = "import psyneulink, sys; sys.exit(0 if hasattr(psyneulink, 'Composition') else 3)"
    try:
        out = subprocess.run(
            [python or sys.executable, "-c", code],
            capture_output=True, text=True, timeout=300, env=env,
        )
    except subprocess.TimeoutExpired:
        return "importing PsyNeuLink took more than 5 minutes"
    except OSError as e:
        return f"couldn't start Python to check PsyNeuLink: {e}"
    if out.returncode == 0:
        return None
    if out.returncode == 3:
        return (
            "import psyneulink finds a folder without PsyNeuLink in it: something else "
            "named psyneulink is in the way of the new install"
        )
    lines = out.stderr.strip().splitlines()
    return f"import psyneulink failed: {lines[-1] if lines else f'exit code {out.returncode}'}"


class InstallManager:
    """Thread-safe job tracker. One install runs at a time."""

    def __init__(self):
        self._lock = threading.Lock()
        self._jobs: dict[str, InstallJob] = {}
        self._running_id: Optional[str] = None
        self._on_success_callbacks: list = []

    def register_on_success(self, callback) -> None:
        """Run callback() after a successful install (e.g., kill warm worker)."""
        self._on_success_callbacks.append(callback)

    def get_job(self, job_id: str) -> Optional[InstallJob]:
        with self._lock:
            return self._jobs.get(job_id)

    def current_job(self) -> Optional[InstallJob]:
        with self._lock:
            return self._jobs.get(self._running_id) if self._running_id else None

    def start(
        self,
        source: InstallSource,
        ref: Optional[str],
        path: Optional[str],
        repo: Optional[str] = None,
        version: Optional[str] = None,
        download_repo: Optional[str] = None,
        download_ref: Optional[str] = None,
    ) -> InstallJob:
        """Kick off an install. Raises RuntimeError if one is already running.

        ``version`` names a PyPI release (#1295 round 5): it is downloaded
        into the releases folder once and installed from there, so switching
        back later needs no network for PsyNeuLink itself. Without it, pypi
        means the newest release, as before.

        ``download_repo`` and ``download_ref`` (#1342), with ``source=local``:
        ``path`` is an empty or missing folder, and PsyNeuLink is downloaded
        from that GitHub repo and branch into it before the editable install.
        Refused up front for any folder that isn't empty or missing, so
        nothing of the user's can be overwritten.
        """
        # Validate inputs up front so bad payloads raise before we claim
        # the job slot. github gets the clone-manager path; pypi/local
        # keep the single-pip-subprocess path.
        version = (version or "").strip() or None
        if version is not None and source != "pypi":
            raise ValueError("version is only for source=pypi")
        if version is not None:
            from packaging.version import InvalidVersion, Version

            try:
                Version(version)
            except InvalidVersion:
                raise ValueError(f"not a release version: {version!r}")
        download = (download_repo or "").strip() or (download_ref or "").strip()
        if download and source != "local":
            raise ValueError("a download is only for source=local")
        if source == "github":
            owner_repo, clean_ref = _resolve_github_target(ref, repo)
            # job.command is display-only for github — the actual git +
            # pip commands stream into job.log per-step inside _run_github.
            display_command = [f"# managed clone: {owner_repo}@{clean_ref}"]
        elif version is not None:
            display_command = [f"# kept release: psyneulink=={version}"]
        elif download:
            # A blank branch means the default source's: "Latest development".
            download_repo, download_ref = _resolve_github_target(
                (download_ref or "").strip() or DEFAULT_DOWNLOAD_REF, download_repo
            )
            folder = check_local_folder(path or "")
            if folder.status != "downloadable":
                raise ValueError(
                    folder.reason
                    or f"{folder.path} is already a PsyNeuLink checkout: switch to it without a download"
                )
            display_command = [f"# download {download_repo}@{download_ref} → {folder.path}, then pip install -e"]
        else:
            if source == "local":
                # The same plain words the panel shows under the Path field
                # (#1342), rather than pip's or a developer's.
                folder = check_local_folder(path or "")
                if folder.status == "refused":
                    raise ValueError(folder.reason)
                if folder.status == "downloadable":
                    state = "is empty" if folder.exists else "doesn't exist yet"
                    raise ValueError(
                        f"{folder.path} {state}: choose Download PsyNeuLink here "
                        "to put a copy of PsyNeuLink in it."
                    )
            pip_args = _build_pip_args(source, ref, path, repo)
            display_command = [_venv_pip()] + pip_args

        with self._lock:
            if self._running_id is not None:
                running = self._jobs.get(self._running_id)
                if running and running.status == "running":
                    raise RuntimeError(f"An install is already running (job {self._running_id})")
            job = InstallJob(
                id=uuid.uuid4().hex[:12],
                source=source,
                ref=ref,
                path=path,
                repo=repo,
                command=display_command,
                version=version,
                download_repo=download_repo if download else None,
                download_ref=download_ref if download else None,
            )
            self._jobs[job.id] = job
            self._running_id = job.id

        threading.Thread(target=self._run, args=(job,), daemon=True).start()
        return job

    def _append(self, job: InstallJob, line: str) -> None:
        """Append a redacted line to job.log under the lock."""
        with self._lock:
            job.log.append(_redact_token(line))

    def _stream_subprocess(self, cmd: list[str], job: InstallJob) -> int:
        """Popen ``cmd``, stream stdout/stderr into job.log, return exit code."""
        cmd_line = " ".join(shlex.quote(a) for a in cmd)
        self._append(job, f"$ {cmd_line}")
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # merge so order is preserved
            text=True,
            bufsize=1,
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            self._append(job, line.rstrip("\n"))
        return proc.wait()

    def _run(self, job: InstallJob) -> None:
        """Worker entry point — dispatches by source.

        github → managed-clone flow via clone_manager.
        pypi / local → single pip subprocess.
        """
        self._before_install(job)
        if job.source == "local" and job.download_repo and job.download_ref:
            self._run_local_download(job)
            return
        if job.source == "local" and job.path and local_install_can_skip_pip(job.path):
            self._skip_local_pip(job)
            return
        if job.source == "pypi" and job.version:
            self._run_pip_release(job)
            return
        if job.source == "github":
            try:
                repo, ref = _resolve_github_target(job.ref, job.repo)
            except ValueError as e:
                # start() already validated, so this would only fire if
                # someone bypassed the public API. Mark the job failed
                # rather than crashing the thread silently.
                self._append(job, f"[install_manager error] {e}")
                self._finalize(job, exit_code=-1, hard_fail=True)
                return
            self._run_github(job, repo, ref)
        else:
            self._run_pip(job)

    def _run_pip(self, job: InstallJob) -> None:
        """Single-pip-subprocess path: pypi / local-editable installs."""
        with self._lock:
            job.status = "running"
        on_line = lambda line: self._append(job, line)
        timer = _StepTimer(on_line)
        try:
            with timer.step("pip install"):
                exit_code = self._stream_subprocess(job.command, job)
            if exit_code == 0 and job.source == "local" and job.path:
                _mark_local_installed(Path(job.path).expanduser())
            timer.finish()
            self._finalize(job, exit_code)
        except Exception as e:
            timer.finish()
            self._finalize_error(job, e)

    def _run_pip_release(self, job: InstallJob) -> None:
        """A named PyPI release (#1295 round 5): keep its file under the
        releases folder, then install from the file.

        The download is skipped when the file is already kept, so switching
        back to a release needs no download of PsyNeuLink itself. The install
        step resolves dependencies normally (the index stays allowed), so a
        release that needs different versions of them gets them — which may
        still need the network.
        """
        from app.services import pnl_releases

        with self._lock:
            job.status = "running"
        on_line = lambda line: self._append(job, line)
        timer = _StepTimer(on_line)
        try:
            folder = pnl_releases.releases_dir()
            folder.mkdir(parents=True, exist_ok=True)
            spec = f"psyneulink=={job.version}"
            kept = pnl_releases.kept_file_for(job.version)
            if kept is None:
                with timer.step("pip download"):
                    exit_code = self._stream_subprocess(
                        [_venv_pip(), "download", "--no-deps", "--dest", str(folder), spec], job,
                    )
                if exit_code != 0:
                    timer.finish()
                    self._finalize(job, exit_code)
                    return
            else:
                self._append(job, f"Using the kept copy {kept.name} — no download needed")
            with timer.step("pip install"):
                exit_code = self._stream_subprocess(
                    [_venv_pip(), "install", "--upgrade", "--find-links", str(folder), spec],
                    job,
                )
            timer.finish()
            self._finalize(job, exit_code)
        except Exception as e:
            timer.finish()
            self._finalize_error(job, e)

    def _skip_local_pip(self, job: InstallJob) -> None:
        """The local checkout is already the editable install and nothing on
        its build surface moved (#1276): restart the runner, no pip."""
        with self._lock:
            job.status = "running"
        self._append(
            job,
            f"psyneulink already editable at {Path(job.path).expanduser().resolve()} "
            "and pyproject.toml unchanged — skipping pip install -e",
        )
        self._finalize(job, exit_code=0)

    def _run_local_download(self, job: InstallJob) -> None:
        """Download PsyNeuLink into the chosen folder, then install it
        editable and switch to it (#1342).

        The folder was empty or missing when the job was accepted, and is
        checked again here. The download is made in a hidden sibling folder
        and only moved into place once it has finished, so a failed or
        interrupted download never leaves anything in the user's folder: the
        only thing removed on failure is that sibling, which this job made.
        The steps stream into the log the way a managed clone's do, the
        download its own step.
        """
        with self._lock:
            job.status = "running"
        on_line = lambda line: self._append(job, line)
        timer = _StepTimer(on_line)
        repo, ref = job.download_repo or "", job.download_ref or ""
        folder = check_local_folder(job.path or "")
        if folder.status != "downloadable":
            on_line(f"[install_manager error] {folder.reason or 'the folder is no longer empty'}")
            timer.finish()
            self._finalize(job, exit_code=-1, hard_fail=True)
            return
        target = Path(folder.path)
        staging = _staging_folder_for(target)
        try:
            on_line(f"Downloading PsyNeuLink from {repo} @ {ref} into {target}")
            # The same git and token handling as the managed clones; the
            # result is the user's own checkout, never a managed clone.
            token = github_auth.get_auth().token
            try:
                with timer.step("download PsyNeuLink"):
                    clone_manager.clone_into(repo, staging, token, on_line)
                with timer.step(f"checkout {ref}"):
                    sha = clone_manager.checkout(staging, ref, on_line)
                _move_download_into_place(staging, target, on_line)
            except BaseException:
                _remove_staging_folder(staging, on_line)
                raise
            on_line(f"Downloaded {repo} @ {ref} → {sha[:10]} into {target}")
            pip_cmd = [_venv_pip()] + _build_pip_args("local", None, str(target))
            with timer.step("pip install -e"):
                exit_code = self._stream_subprocess(pip_cmd, job)
            if exit_code == 0:
                _mark_local_installed(target)
            # A known checkout from now on (#1276): the folder holds
            # PsyNeuLink now, even if pip failed. Not on intent like the
            # other sources (routes.start_install): a failed download leaves
            # no checkout to list.
            try:
                from app.services import source_history

                source_history.remember_source("local", path=str(target))
            except Exception:
                logger.warning("source_history.remember_source failed", exc_info=True)
            timer.finish()
            self._finalize(job, exit_code)
        except clone_manager.CloneError as e:
            on_line(f"[clone_manager error] {e}")
            timer.finish()
            self._finalize(job, exit_code=-1, hard_fail=True)
        except Exception as e:
            timer.finish()
            self._finalize_error(job, e)

    def _run_github(self, job: InstallJob, repo: str, ref: str) -> None:
        """Managed-clone path: clone/fetch + checkout + conditional ``pip install -e``.

        Per-step timings stream into the job log so the gear panel can show
        where the wall time went (see #264).
        """
        with self._lock:
            job.status = "running"

        on_line = lambda line: self._append(job, line)
        timer = _StepTimer(on_line)
        try:
            on_line(f"Switching to {repo}@{ref} via managed clone")
            token = github_auth.get_auth().token

            with timer.step("clone/fetch"):
                clone_path = clone_manager.ensure_clone(repo, token, on_line)
            with timer.step(f"checkout {ref}"):
                sha = clone_manager.checkout(clone_path, ref, on_line)
            on_line(f"Resolved {repo}@{ref} → {sha[:10]}")

            with timer.step("editable-state probe"):
                state = clone_manager.editable_state(clone_path)
            if state.can_skip_pip:
                on_line(
                    f"psyneulink already editable at {clone_path} "
                    "and pyproject.toml unchanged — skipping pip install -e"
                )
                timer.finish()
                self._finalize(job, exit_code=0)
                return

            on_line(f"Running pip install -e {clone_path}")
            pip_cmd = [
                _venv_pip(),
                "install",
                "--upgrade",
                "--force-reinstall",
                "--no-deps",
                "-e",
                str(clone_path),
            ]
            with timer.step("pip install -e"):
                exit_code = self._stream_subprocess(pip_cmd, job)
            if exit_code == 0:
                with timer.step("mark_installed"):
                    clone_manager.mark_installed(clone_path)
            timer.finish()
            self._finalize(job, exit_code)
        except clone_manager.CloneError as e:
            on_line(f"[clone_manager error] {e}")
            timer.finish()
            self._finalize(job, exit_code=-1, hard_fail=True)
        except Exception as e:
            timer.finish()
            self._finalize_error(job, e)

    def _before_install(self, job: InstallJob) -> None:
        """Move the layouts PsyNeuView saved inside the current read-only
        install out of it, while it is still the active one and can be told
        apart from PsyNeuLink's own files (#1321). The uninstall would leave
        them behind, keeping a ``psyneulink/`` folder alive (#1396)."""
        from app.services import managed_layouts

        record = managed_layouts.migrate_legacy_layouts()
        if record and record.get("moved"):
            self._append(job, f"Moved {record['moved']} layout file(s) out of the old PsyNeuLink to {record['to']}")

    def _environment_ok_after_install(self, job: InstallJob) -> bool:
        """After pip succeeded: clear a ``psyneulink/`` folder the uninstall
        left behind, then check that a fresh Python imports PsyNeuLink whole
        (#1396). Off while tests redirect the layouts folder, like the
        cleanup itself: a test's fake install must not reach the real one."""
        from app.services import managed_layouts

        if managed_layouts.fixed_by_env():
            return True
        record = managed_layouts.clear_leftover_packages_here()
        if record:
            if record.get("kept_in"):
                self._append(job, f"Cleared a psyneulink folder the old install left behind; kept its files in {record['kept_in']}")
            for failure in record.get("failures") or []:
                self._append(job, f"Couldn't move {failure['file']}: {failure['error']}")
        problem = psyneulink_import_problem()
        if problem is None:
            return True
        self._append(job, f"PsyNeuLink was installed, but {problem}.")
        return False

    def _finalize(self, job: InstallJob, exit_code: int, hard_fail: bool = False) -> None:
        """Common end-of-run bookkeeping + on-success callbacks."""
        installed = exit_code == 0 and not hard_fail
        succeeded = installed and self._environment_ok_after_install(job)
        with self._lock:
            job.exit_code = exit_code
            job.status = "succeeded" if succeeded else "failed"
            job.finished_at = time.time()
            self._running_id = None
        if installed:
            # The environment changed even when the check after it failed:
            # the warm worker must not keep the old PsyNeuLink either way.
            if succeeded:
                logger.info(f"Install job {job.id} succeeded")
            else:
                logger.warning(f"Install job {job.id} installed, but PsyNeuLink doesn't import")
            for cb in list(self._on_success_callbacks):
                try:
                    cb()
                except Exception:
                    logger.exception("on-success callback failed")
        else:
            logger.warning(f"Install job {job.id} failed with exit code {exit_code}")

    def _finalize_error(self, job: InstallJob, e: Exception) -> None:
        logger.exception("Install subprocess crashed")
        with self._lock:
            job.log.append(f"[install_manager error] {e}")
            job.status = "failed"
            job.exit_code = -1
            job.finished_at = time.time()
            self._running_id = None


_install_manager: Optional[InstallManager] = None
_install_manager_lock = threading.Lock()


def get_install_manager() -> InstallManager:
    global _install_manager
    with _install_manager_lock:
        if _install_manager is None:
            _install_manager = InstallManager()
            _install_manager.register_on_success(_restart_warm_worker_after_install)
        return _install_manager


def _restart_warm_worker_after_install() -> None:
    """Kill the warm sandbox worker so the next request reimports psyneulink fresh."""
    try:
        from app.services import sandbox

        if sandbox.restart_warm_worker():
            logger.info("Restarted warm worker after psyneulink reinstall")
    except Exception:
        logger.exception("Failed to restart warm worker after install")
