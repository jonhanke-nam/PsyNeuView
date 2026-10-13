"""Managed git clones for PsyNeuLink source installs (#262).

Replaces the per-switch ``pip install git+https://...@ref`` cost with a
long-lived clone + editable install. After the one-time clone, switching
branches is ``git fetch`` + ``git checkout -B`` (a few seconds), and pip
is only re-invoked when ``pyproject.toml`` actually changes between refs.

Token handling: tokens are passed to git via ``-c http.extraheader=...``
on each invocation so they never persist to the clone's ``.git/config``.
The remote URL stored on disk is the bare https URL with no embedded
credentials. The header form is HTTP Basic with a base64-encoded
``x-access-token:TOKEN`` body — the same shape the GitHub Actions
checkout action uses. (A naive ``Authorization: Bearer TOKEN`` does
not authenticate ``git clone`` over HTTPS — git falls through to
credential prompting and fails with "could not read Username".)
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import subprocess
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, distribution
from pathlib import Path
from typing import Callable, Optional


logger = logging.getLogger(__name__)


# Match an Authorization header value coming from `-c http.extraheader=...`.
# git echoes the full command on errors and in trace output; redact the
# base64 credential body before any line reaches the status log.
_TOKEN_HEADER_PATTERN = re.compile(
    r"Authorization:\s*(?:basic|bearer)\s+\S+", re.IGNORECASE
)

# Sidecar files track what pyproject hash the venv was last editable-installed
# against — used to skip the pip re-run when nothing on the build surface
# changed across a checkout.
#
# Stored OUTSIDE the clone (under ``<clone_root>/.state/``), keyed by the
# clone's directory name. Keeping the sidecar inside the clone made the
# working tree dirty (the file is untracked and not in PsyNeuLink's
# ``.gitignore``), which then blocked the next ``is_dirty()`` check.
_STATE_DIRNAME = ".state"
_LEGACY_STATE_FILENAME = ".psyneuview-state.json"

# PsyNeuView writes GUI sidecars and pre-edit backups next to the model file.
# Inside a managed clone these untracked files dirty the git working tree and
# block branch switches (#316). They are redirected out of tree (see
# ``artifact_path``) and any that leaked in before #349 are purged on checkout.
_PNV_ARTIFACT_DIRNAME = "artifacts"
_PNV_ARTIFACT_SUFFIXES = (
    ".pnlview.json",
    ".labels.yaml",
    ".psyneuview.json",
    ".original.py",
    ".star_import_original.py",
)


class CloneError(Exception):
    """Surface-level error suitable for showing in the gear panel."""


def _redact(line: str) -> str:
    return _TOKEN_HEADER_PATTERN.sub("Authorization: basic ***", line)


def clone_root() -> Path:
    """Where managed clones live. Overridable via ``PSYNEUVIEW_CLONE_ROOT``
    so tests can pin a tmp directory without colliding with the user's
    real ``~/.psyneuview``."""
    override = os.environ.get("PSYNEUVIEW_CLONE_ROOT")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".psyneuview" / "sources"


def _slug_dirname(repo: str) -> str:
    """``owner/Name`` → ``Name-owner``. Keeps repo name leading (so casual
    ``ls`` is readable) and owner-suffixed (so forks don't collide)."""
    owner, name = repo.split("/", 1)
    return f"{name}-{owner}"


def clone_path_for(repo: str) -> Path:
    return clone_root() / _slug_dirname(repo)


def artifact_path(in_place: Path) -> Path:
    """Where a PsyNeuView sidecar/backup should actually be written (#349, #1321).

    For any path outside a read-only PsyNeuLink — the normal case, a user
    file anywhere on disk — the path is returned unchanged. For a path that
    would land *inside* a managed clone, it's redirected out of the tree so
    it can never dirty the clone's git working tree (which would block branch
    switches — #316); since #1321 the same rule covers a ``git+`` or PyPI
    install in site-packages, and the files go to
    ``~/.psyneuview/layouts/<source>/<path>`` (``managed_layouts``). The
    redirected parent directory is created so callers can write immediately.
    """
    from app.services.managed_layouts import redirect_path

    return redirect_path(Path(in_place))


def _https_url(repo: str) -> str:
    return f"https://github.com/{repo}.git"


def _auth_args(token: Optional[str]) -> list[str]:
    """``-c http.extraheader=...`` arguments — empty when unauthenticated.

    Mirrors the GitHub Actions checkout action: HTTP Basic with a
    base64-encoded ``x-access-token:TOKEN`` body. ``Bearer TOKEN`` looks
    superficially plausible but git's HTTP transport rejects it and
    falls through to credential prompting, which then fails with
    "could not read Username for 'https://github.com'".

    The token is supplied per-invocation and never written to
    ``.git/config``.
    """
    if not token:
        return []
    credential = base64.b64encode(f"x-access-token:{token}".encode()).decode()
    return ["-c", f"http.extraheader=Authorization: basic {credential}"]


def _git(
    args: list[str],
    cwd: Optional[Path],
    on_line: Callable[[str], None],
    token: Optional[str] = None,
) -> None:
    """Run a git command, streaming each output line through ``on_line``.

    Token redaction is applied to every emitted line, including the
    echoed command itself.
    """
    full_cmd = ["git"] + _auth_args(token) + args
    on_line(_redact("$ " + " ".join(full_cmd)))
    proc = subprocess.Popen(
        full_cmd,
        cwd=str(cwd) if cwd is not None else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        on_line(_redact(line.rstrip("\n")))
    code = proc.wait()
    if code != 0:
        raise CloneError(f"git {' '.join(args)} failed with exit code {code}")


def _git_capture(args: list[str], cwd: Path) -> str:
    """Run a git command for its output (e.g., ``rev-parse HEAD``). No
    token args — these reads don't hit the network."""
    return subprocess.check_output(
        ["git"] + args, cwd=str(cwd), text=True, stderr=subprocess.DEVNULL
    )


def ensure_clone(
    repo: str, token: Optional[str], on_line: Callable[[str], None]
) -> Path:
    """Make sure a clone of ``repo`` exists under :func:`clone_root`.

    - If the directory is missing: ``git clone`` (paying the one-time cost).
    - If it exists with the right origin: ``git fetch`` to pick up new
      commits and any deleted refs (``--prune``).
    - If it exists with a *different* origin: refuse — surfacing a clear
      message lets the user resolve manually rather than silently clobber.

    Returns the local clone path.
    """
    path = clone_path_for(repo)
    path.parent.mkdir(parents=True, exist_ok=True)
    url = _https_url(repo)

    if not path.exists():
        on_line(f"Cloning {url} → {path}")
        _git(["clone", "--quiet", url, str(path)], cwd=None, on_line=on_line, token=token)
        return path

    # Existing clone — confirm the remote matches before we touch it.
    try:
        actual = _git_capture(["config", "--get", "remote.origin.url"], cwd=path).strip()
    except subprocess.CalledProcessError as e:
        raise CloneError(
            f"Managed clone at {path} is not a valid git repository "
            f"(could not read remote.origin.url). Delete it and retry."
        ) from e
    if actual != url:
        raise CloneError(
            f"Managed clone at {path} has origin {actual!r}, expected {url!r}. "
            f"Delete the directory to re-clone, or fix the remote manually."
        )

    on_line(f"Fetching origin in {path}")
    _git(["fetch", "--prune", "origin"], cwd=path, on_line=on_line, token=token)
    return path


def clone_into(
    repo: str, target: Path, token: Optional[str], on_line: Callable[[str], None]
) -> None:
    """Clone ``repo`` into the exact folder ``target`` (#1342).

    For *Another local checkout…* with an empty or missing folder: the
    result is the user's own checkout, not a managed clone, so none of
    :func:`ensure_clone`'s origin checks or fetches apply and this module
    never looks at the folder again. The same git invocation and token
    handling as the managed clones. ``git clone`` itself refuses a folder
    that isn't empty, so nothing already there can be overwritten; the
    caller (``install_manager``) clones into a fresh hidden folder and
    moves the result into place. Branch selection is :func:`checkout`'s
    job afterwards, the way it is for a managed clone.
    """
    url = _https_url(repo)
    on_line(f"Downloading {url} → {target}")
    _git(["clone", "--quiet", url, str(target)], cwd=None, on_line=on_line, token=token)


def is_dirty(path: Path) -> bool:
    """Any uncommitted change (staged, unstaged, or untracked) → dirty.

    Untracked-but-gitignored files (like a Python ``.egg-info`` from a
    previous editable install) don't count — ``--porcelain`` excludes them
    by default.
    """
    try:
        out = _git_capture(["status", "--porcelain"], cwd=path)
    except subprocess.CalledProcessError:
        return False
    return bool(out.strip())


def _purge_pnv_artifacts(path: Path, on_line: Callable[[str], None]) -> None:
    """Delete stray PsyNeuView sidecar/backup files left inside the clone.

    Builds before #349 wrote ``.pnlview.json`` / ``.original.py`` /
    ``.star_import_original.py`` next to the model *inside* the clone. Those
    untracked files keep ``git status`` dirty and block branch switches
    (#316). Removing them here lets existing clones self-heal — newly written
    artifacts now land out of tree via ``artifact_path``.
    """
    try:
        out = _git_capture(["status", "--porcelain"], cwd=path)
    except subprocess.CalledProcessError:
        return
    for line in out.splitlines():
        if not line.startswith("??"):
            continue
        rel = line[3:].strip()
        if len(rel) >= 2 and rel[0] == '"' and rel[-1] == '"':
            rel = rel[1:-1]
        if not rel.endswith(_PNV_ARTIFACT_SUFFIXES):
            continue
        try:
            (path / rel).unlink()
            on_line(f"Removed stray PsyNeuView file {rel}")
        except OSError as e:
            logger.warning("clone_manager: failed to remove stray artifact %s: %s", rel, e)


def checkout(path: Path, ref: str, on_line: Callable[[str], None]) -> str:
    """Move the working tree to ``ref``. Returns the resolved commit SHA.

    Branches force-create a local branch of the same name pointing at
    ``origin/<ref>`` and switch HEAD to it. Tags / commit SHAs detach
    to that exact object.
    """
    _purge_pnv_artifacts(path, on_line)
    if is_dirty(path):
        raise CloneError(
            f"Working tree at {path} has uncommitted changes. "
            f"Resolve them (or delete the directory) before switching branches."
        )

    # Prefer the remote-tracking branch so we always end up on origin's
    # current tip even if the local branch lagged.
    remote_ref = f"origin/{ref}"
    if _ref_exists(path, remote_ref):
        # ``checkout -B <ref> <start>`` creates-or-updates a local branch
        # named after the ref and switches HEAD to it, with the same
        # working-tree effect as ``reset --hard <start>``. Using ``reset
        # --hard`` directly would silently leave HEAD on whatever branch
        # the clone was on (#452: ``master`` from the initial clone), so
        # ``git symbolic-ref HEAD`` later reported the wrong name to the
        # settings panel. ``-B`` accepts slashes in the local branch name
        # so namespaced refs like ``refactor/emcomposition/foo`` work.
        on_line(f"Checking out {ref} (tracking {remote_ref})")
        _git(["checkout", "-B", ref, remote_ref], cwd=path, on_line=on_line)
    else:
        # Tag or commit SHA — detach.
        on_line(f"Checking out {ref} (detached)")
        _git(["checkout", "--detach", ref], cwd=path, on_line=on_line)

    sha = _git_capture(["rev-parse", "HEAD"], cwd=path).strip()
    on_line(f"HEAD is now at {sha[:10]}")
    return sha


def _ref_exists(path: Path, ref: str) -> bool:
    """``rev-parse --verify`` is the canonical "does this name resolve?" probe."""
    try:
        subprocess.check_output(
            ["git", "rev-parse", "--verify", "--quiet", ref + "^{commit}"],
            cwd=str(path),
            stderr=subprocess.DEVNULL,
        )
        return True
    except subprocess.CalledProcessError:
        return False


def pyproject_hash(path: Path) -> str:
    """sha256 of ``pyproject.toml`` truncated to 16 hex chars.

    Used to detect dep/build-system changes between checkouts so we can
    skip ``pip install -e`` when nothing on the build surface changed.
    Returns ``""`` if ``pyproject.toml`` is missing.
    """
    pyproject = path / "pyproject.toml"
    if not pyproject.exists():
        return ""
    return hashlib.sha256(pyproject.read_bytes()).hexdigest()[:16]


@dataclass(frozen=True)
class EditableState:
    """The two facts we need to decide whether to re-run pip.

    - ``pointing_here``: pip's ``direct_url.json`` says psyneulink is an
      editable install pointing at this exact clone path.
    - ``pyproject_unchanged``: the sidecar state file says we last
      editable-installed against the same ``pyproject.toml`` content.

    Both must be true to skip the pip step.
    """

    pointing_here: bool
    pyproject_unchanged: bool

    @property
    def can_skip_pip(self) -> bool:
        return self.pointing_here and self.pyproject_unchanged


def editable_state(clone_path: Path) -> EditableState:
    pointing_here = _editable_install_targets(clone_path)
    pyproject_unchanged = _sidecar_hash(clone_path) == pyproject_hash(clone_path)
    return EditableState(pointing_here, pyproject_unchanged)


def _editable_install_targets(clone_path: Path) -> bool:
    """True iff pip's metadata for psyneulink describes an editable install
    rooted at ``clone_path``.

    pip writes PEP 610 ``direct_url.json`` whenever a package was installed
    from a URL/VCS/local path. For ``pip install -e <dir>`` the file has
    ``url: "file:///<dir>"`` and ``dir_info: {"editable": true}``.
    """
    try:
        dist = distribution("psyneulink")
    except PackageNotFoundError:
        return False
    raw = dist.read_text("direct_url.json")
    if raw is None:
        return False
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return False
    if not (data.get("dir_info") or {}).get("editable"):
        return False
    url = data.get("url", "") or ""
    if not url.startswith("file://"):
        return False
    installed_path = Path(url[len("file://"):]).resolve()
    try:
        return installed_path == clone_path.resolve()
    except OSError:
        return False


def _sidecar_path(clone_path: Path) -> Path:
    """Where the sidecar for ``clone_path`` lives.

    Outside the clone so it can't dirty the working tree. Keyed by the
    clone directory's name (which already encodes ``repo-owner``), so
    each managed clone gets a distinct file under a shared ``.state/``
    directory next to the clones.
    """
    return clone_path.parent / _STATE_DIRNAME / f"{clone_path.name}.json"


def _cleanup_legacy_sidecar(clone_path: Path) -> None:
    """Remove the old in-clone sidecar if it survived from before the move.

    Called on every read/write so existing clones self-heal without a
    manual ``git clean``. The legacy file, if left in place, would keep
    showing up in ``git status --porcelain`` and block branch switches.
    """
    legacy = clone_path / _LEGACY_STATE_FILENAME
    if legacy.exists():
        try:
            legacy.unlink()
        except OSError as e:
            logger.warning("clone_manager: failed to remove legacy sidecar %s: %s", legacy, e)


def _sidecar_hash(clone_path: Path) -> Optional[str]:
    _cleanup_legacy_sidecar(clone_path)
    sidecar = _sidecar_path(clone_path)
    if not sidecar.exists():
        return None
    try:
        return (json.loads(sidecar.read_text()) or {}).get("pyproject_hash")
    except (OSError, json.JSONDecodeError):
        return None


def mark_installed(clone_path: Path) -> None:
    """Record the current ``pyproject.toml`` hash. Call after a successful
    ``pip install -e <clone_path>`` so future switches can skip pip when
    the file is unchanged."""
    _cleanup_legacy_sidecar(clone_path)
    sidecar = _sidecar_path(clone_path)
    try:
        sidecar.parent.mkdir(parents=True, exist_ok=True)
        sidecar.write_text(json.dumps({"pyproject_hash": pyproject_hash(clone_path)}))
    except OSError as e:
        logger.warning("clone_manager: failed to write sidecar %s: %s", sidecar, e)
