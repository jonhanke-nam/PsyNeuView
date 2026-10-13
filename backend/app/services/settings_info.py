"""Read-only inspection of the running install: version, source, branch.

Backs the ``/settings/info`` endpoint (#120). Pure read — no mutation, no
network. Detects the install source of ``psyneulink`` via PEP 610's
``direct_url.json`` so we can distinguish a PyPI wheel from
``pip install git+https://github.com/.../psyneulink@devel``.

When PsyNeuView-MacApp launches the backend it exports
``PSYNEUVIEW_PNL_SOURCE`` / ``PSYNEUVIEW_PNL_BRANCH`` (issue #137) and,
when a fork is configured, ``PSYNEUVIEW_PNL_REPO`` (issue #143). Those
are treated as authoritative for the source/branch/repo fields, since
the Mac app drove ``pip install`` from those values; introspection is
the fallback when they aren't set.
"""

import json
import logging
import os
import re
import subprocess
from urllib.parse import unquote
from importlib.metadata import PackageNotFoundError, distribution
from pathlib import Path
from typing import Literal, Optional, TypedDict

from app.services.clone_manager import clone_root

logger = logging.getLogger(__name__)


_GITHUB_URL_REPO = re.compile(r"github\.com[:/]+([\w.-]+/[\w.-]+?)(?:\.git)?(?:[/?#]|$)", re.IGNORECASE)


class PsyNeuLinkInfo(TypedDict):
    version: Optional[str]
    source: Literal["pypi", "github", "editable", "unknown"]
    branch: Optional[str]
    repo: Optional[str]
    commit: Optional[str]  # short SHA when we can probe a local clone
    path: Optional[str]    # filesystem path for editable installs


class PsyNeuViewInfo(TypedDict):
    version: str
    commit: str


class ModeciMdfInfo(TypedDict):
    version: str


class GithubAuthInfo(TypedDict):
    source: str
    user: Optional[str]
    scopes: list[str]
    has_repo_scope: bool


class PnlFeaturesInfo(TypedDict):
    # Whether the installed PsyNeuLink exposes the `_debugger` hook. Only the
    # jonhanke-nam fork ships it; stock PrincetonUniversity / PyPI builds don't.
    # When absent, the per-node value pill and debugger snapshots are
    # unavailable and trial nav falls back to an estimated split (#470).
    debugger_hook: bool
    level: Literal["full", "basic"]


class DeploymentCapabilitiesInfo(TypedDict):
    install: bool
    github_token: bool


class DeploymentInfo(TypedDict):
    # Declared by PSYNEUVIEW_DEPLOYMENT_MODE (#1062), not inferred from the
    # client address. The frontend uses this to hide controls that would fail
    # rather than offering them and reporting an error afterwards.
    mode: Literal["local", "mac_app", "container", "hosted"]
    capabilities: DeploymentCapabilitiesInfo


class SettingsInfo(TypedDict):
    psyneulink: PsyNeuLinkInfo
    psyneuview: PsyNeuViewInfo
    modeci_mdf: ModeciMdfInfo
    github_auth: GithubAuthInfo
    features: PnlFeaturesInfo
    deployment: DeploymentInfo
    updates: dict


def _safe_version(pkg_name: str) -> Optional[str]:
    try:
        return distribution(pkg_name).version
    except PackageNotFoundError:
        return None


def _override_from_env() -> Optional[PsyNeuLinkInfo]:
    """Mac app override (issues #137, #143).

    PsyNeuView-MacApp sets PSYNEUVIEW_PNL_SOURCE (and PSYNEUVIEW_PNL_BRANCH
    + optional PSYNEUVIEW_PNL_REPO when source is github) on the uvicorn
    process. The version is still introspected — env vars don't lie about
    it. ``repo`` is reported when present so the gear panel can show which
    fork is installed; absent → the Princeton default is implied.
    """
    source = os.environ.get("PSYNEUVIEW_PNL_SOURCE")
    if source not in ("pypi", "github"):
        return None
    try:
        version = distribution("psyneulink").version
    except PackageNotFoundError:
        version = None
    branch = os.environ.get("PSYNEUVIEW_PNL_BRANCH") if source == "github" else None
    repo = os.environ.get("PSYNEUVIEW_PNL_REPO") if source == "github" else None
    return {
        "version": version,
        "source": source,
        "branch": branch,
        "repo": repo or None,
        "commit": None,
        "path": None,
    }


def _probe_local_clone(local_path: Path) -> dict:
    """Pull repo/branch/commit straight from the git working copy at
    ``local_path``. Returns ``{}`` if the path isn't a git checkout we
    can read. Used to enrich the editable-install case (#262) so the
    gear panel can say "jonhanke-nam/PsyNeuLink @ jonhanke-dev (cce6f67)"
    instead of just "unknown"."""
    if not (local_path / ".git").exists():
        return {}

    def _git(args: list[str]) -> Optional[str]:
        try:
            return subprocess.check_output(
                ["git"] + args,
                cwd=str(local_path),
                stderr=subprocess.DEVNULL,
                timeout=2,
            ).decode().strip()
        except (OSError, subprocess.SubprocessError):
            return None

    origin = _git(["config", "--get", "remote.origin.url"])
    repo = None
    if origin:
        match = _GITHUB_URL_REPO.search(origin)
        if match:
            repo = match.group(1)

    branch = _git(["symbolic-ref", "--short", "HEAD"]) or None  # None on detached HEAD
    commit = _git(["rev-parse", "--short", "HEAD"])
    return {"repo": repo, "branch": branch, "commit": commit}


def _is_managed_clone(path: Path) -> bool:
    """True when ``path`` is one of PsyNeuView's managed GitHub clones (#262)."""
    try:
        path.resolve().relative_to(clone_root().resolve())
        return True
    except (ValueError, OSError):
        return False


def _local_checkout_installed() -> bool:
    """True when the installed psyneulink is an editable install from a folder
    outside the managed clones: the user's own local checkout (#1276)."""
    try:
        text = distribution("psyneulink").read_text("direct_url.json")
        direct_url = json.loads(text) if text else {}
    except (PackageNotFoundError, json.JSONDecodeError):
        return False
    if not isinstance(direct_url, dict):
        return False
    url = direct_url.get("url", "") or ""
    if not ((direct_url.get("dir_info") or {}).get("editable") and url.startswith("file://")):
        return False
    return not _is_managed_clone(Path(unquote(url[len("file://"):])))


def active_psyneulink_package_dir() -> Optional[Path]:
    """The installed ``psyneulink`` package directory, read fresh from disk (#1225).

    Everything that lists files *from* PsyNeuLink (the library models, the
    examples, the tests) used ``psyneulink.__file__``. But the backend's main
    process imports psyneulink once and keeps it in ``sys.modules``, and
    switching the source restarts only the model runner. So after a switch,
    those lists kept pointing at the *previous* install until the whole app
    restarted, and a user editing their local checkout's library models saw
    nothing change. The installed distribution's metadata is re-read from disk
    on every call, so it follows the switch: for an editable install, the
    folder pip recorded in ``direct_url.json``; otherwise wherever the package
    was installed. None when psyneulink isn't installed.
    """
    try:
        dist = distribution("psyneulink")
    except PackageNotFoundError:
        return None
    text = dist.read_text("direct_url.json")
    if text:
        try:
            direct_url = json.loads(text)
        except json.JSONDecodeError:
            direct_url = {}
        url = direct_url.get("url", "") or ""
        if (direct_url.get("dir_info") or {}).get("editable") and url.startswith("file://"):
            pkg = Path(unquote(url[len("file://"):])) / "psyneulink"
            return pkg if pkg.is_dir() else None
    pkg = Path(str(dist.locate_file("psyneulink")))
    return pkg.resolve() if pkg.is_dir() else None


def get_psyneulink_info() -> PsyNeuLinkInfo:
    """Probe the installed psyneulink distribution.

    Pip writes ``direct_url.json`` (PEP 610) into the dist-info whenever a
    package was installed from a URL, VCS, or local path. A plain PyPI wheel
    install has no such file — that's how we identify "pypi" reliably.

    Three install shapes we care about:
      - PyPI wheel: no ``direct_url.json``.
      - ``pip install git+https://github.com/...@ref``: ``vcs_info.vcs=git``,
        ``url`` is the github URL, ``requested_revision`` is the ref.
      - ``pip install -e <local-clone>`` (the #262 managed-clone flow):
        ``dir_info.editable=true``, ``url`` is ``file://<path>``. The clone
        itself holds the real source-of-truth (origin remote, branch,
        commit), so we read git directly from it.
    """
    # The Mac app's launch-time env vars describe what it installed then. A
    # local checkout chosen later from Settings is unambiguous on disk, so it
    # wins over a stale "github"/"pypi" from the environment (#1276).
    if not _local_checkout_installed() and (override := _override_from_env()) is not None:
        return override
    try:
        dist = distribution("psyneulink")
    except PackageNotFoundError:
        return {
            "version": None, "source": "unknown",
            "branch": None, "repo": None, "commit": None, "path": None,
        }

    version = dist.version
    direct_url_text = dist.read_text("direct_url.json")
    if direct_url_text is None:
        return {
            "version": version, "source": "pypi",
            "branch": None, "repo": None, "commit": None, "path": None,
        }

    try:
        direct_url = json.loads(direct_url_text)
    except json.JSONDecodeError:
        return {
            "version": version, "source": "unknown",
            "branch": None, "repo": None, "commit": None, "path": None,
        }

    vcs_info = direct_url.get("vcs_info") or {}
    url = direct_url.get("url", "") or ""

    if vcs_info.get("vcs") == "git" and "github.com" in url.lower():
        match = _GITHUB_URL_REPO.search(url)
        return {
            "version": version,
            "source": "github",
            "branch": vcs_info.get("requested_revision"),
            "repo": match.group(1) if match else None,
            "commit": (vcs_info.get("commit_id") or "")[:7] or None,
            "path": None,
        }

    dir_info = direct_url.get("dir_info") or {}
    if dir_info.get("editable") and url.startswith("file://"):
        local_path = Path(unquote(url[len("file://"):]))
        probe = _probe_local_clone(local_path)
        # Only a managed clone (#262, under the clone root) reads as GitHub:
        # PsyNeuView keeps it identical to the branch, so "GitHub @ devel" is
        # the true answer. Any other editable install is the user's own local
        # checkout, even when that folder is itself a git clone of a GitHub
        # repo (#1276): it may hold edits, so naming only its origin hid the
        # most important fact. Its origin repo, branch and commit are still
        # reported, as secondary detail. Same rule as
        # pnl_source_guard._active_install, so the two never disagree.
        if probe.get("repo") and _is_managed_clone(local_path):
            return {
                "version": version,
                "source": "github",
                "branch": probe.get("branch"),
                "repo": probe.get("repo"),
                "commit": probe.get("commit"),
                "path": str(local_path),
            }
        return {
            "version": version,
            "source": "editable",
            "branch": probe.get("branch"),
            "repo": probe.get("repo"),
            "commit": probe.get("commit"),
            "path": str(local_path),
        }

    return {
        "version": version, "source": "unknown",
        "branch": None, "repo": None, "commit": None, "path": None,
    }


def _repo_root() -> Path:
    # services/settings_info.py → app/services → app → backend → repo root
    return Path(__file__).resolve().parents[3]


def get_psyneuview_info() -> PsyNeuViewInfo:
    # Prefer dist metadata so the wheel/editable-install version is authoritative;
    # fall back to the package __version__ when the backend is run straight from
    # source (no `pip install -e backend/`).
    version = _safe_version("psynewview")
    if version is None:
        from app import __version__ as version
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(_repo_root()),
            stderr=subprocess.DEVNULL,
            timeout=2,
        ).decode().strip()
    except (OSError, subprocess.SubprocessError):
        commit = "unknown"
    return {"version": version, "commit": commit or "unknown"}


def get_modeci_mdf_info() -> ModeciMdfInfo:
    return {"version": _safe_version("modeci_mdf") or "unknown"}


def debugger_hook_available() -> bool:
    """True when the installed PsyNeuLink exposes the `_debugger` hook.

    Mirrors the import guard the run worker uses (sandbox_worker
    `_run_capturing_debugger_snapshots`). Read-only — imports the submodule
    to confirm it's present, swallowing the ImportError on stock builds.
    """
    try:
        import psyneulink._debugger  # noqa: F401
    except Exception:
        return False
    return True


def get_pnl_features() -> PnlFeaturesInfo:
    hook = debugger_hook_available()
    return {"debugger_hook": hook, "level": "full" if hook else "basic"}


def get_github_auth_info() -> GithubAuthInfo:
    """Resolved auth — source label only, never the token characters."""
    from app.services import github_auth

    auth = github_auth.get_auth()
    return {
        "source": auth.source,
        "user": auth.user,
        "scopes": list(auth.scopes),
        "has_repo_scope": auth.has_repo_scope,
    }


def get_deployment_info() -> DeploymentInfo:
    """What kind of deployment this is, and what it's allowed to do (#1062)."""
    from app.services import deployment_mode

    mode = deployment_mode.current_mode()
    caps = deployment_mode.capabilities(mode)
    return {
        "mode": mode,
        "capabilities": {
            "install": caps.install,
            "github_token": caps.github_token,
        },
    }


from app.services.pnl_health import check as check_pnl_health


def get_settings_info() -> SettingsInfo:
    return {
        "psyneulink": get_psyneulink_info(),
        "psyneuview": get_psyneuview_info(),
        "modeci_mdf": get_modeci_mdf_info(),
        "github_auth": get_github_auth_info(),
        "features": get_pnl_features(),
        # Whether PsyNeuLink actually works, not only that it is recorded as
        # installed (#1143). Reported alongside the version because that is
        # where someone looks to find out what they are running — and a version
        # on its own can be reported by an install that no longer imports.
        "health": check_pnl_health(),
        "deployment": get_deployment_info(),
        # Whether PsyNeuLink is current and when that was last checked, and the
        # last automatic update's outcome (#1304), from the last check's record:
        # no network, so Report a Problem can read it any time.
        "updates": _updates_summary(),
    }


def _updates_summary() -> dict:
    from app.services import pnl_updates

    try:
        return pnl_updates.summary()
    except Exception:  # noqa: BLE001 — the versions must still be reported
        logger.exception("settings_info: couldn't read the update state")
        return {}
