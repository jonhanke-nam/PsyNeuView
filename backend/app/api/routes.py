"""REST API routes."""

import io
import json as json_mod
import logging
import os
import shutil
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from app.services.introspector import load_and_introspect
from app.services.preview import clear_preview, write_preview
from app.services.dangling_check import find_dangling_projections
from app.services.file_writer import (
    apply_function_change,
    apply_node_rename,
    apply_parameter_change,
    apply_port_add,
    apply_port_remove,
    apply_port_rename,
    apply_structural_change,
    guard_edit,
    save_source,
)


def _attach_dangling(model: dict, source: str) -> dict:
    """Run static-analysis dangling-projection detection over ``source`` and
    attach the result to the model dict as ``danglingProjections``.

    Runs unconditionally so the field is always present (possibly empty),
    which keeps the frontend's validation surface logic simple.
    """
    model["danglingProjections"] = find_dangling_projections(source)
    return model
from app.services.executor import run_model, get_input_nodes, learn_model
from app.services.jobs import job_manager, build_provenance
from app.services.layout import load_layout, save_layout, stamp_demo_origin, sidecar_path
from app.services.labels import load_labels, save_labels, labels_path
from app.services.sidecar_index import (
    INDEX_SUFFIX,
    LAYOUT_SUFFIX,
    SETTINGS_SUFFIX,
    VariantError,
    create_variant,
    delete_variant,
    duplicate_variant,
    list_sidecars,
    rename_variant,
    reorder,
    set_active,
    set_placement,
)
from app.services import app_settings
from app.services import deployment_mode
from app.services.sidecar_placement import CONCRETE as PLACEMENT_CONCRETE, migrate as migrate_placement
from app.services import sidecar_copy
from app.services.converter import is_standardized_format, detect_format_issues, convert_to_standard_format, convert_star_imports
from app.services.file_types import FileType, classify_file, classify_upload
from app.services.model_dirs import list_models, browse_directory, get_default_save_dir, _format_label
from app.services.model_warnings import (
    classify as classify_model_warnings,
    split as split_model_warnings,
)
from app.services import edit_lock, pnl_source_guard, protection_line
from app.services.settings_info import active_psyneulink_package_dir, get_psyneulink_info, get_settings_info
from app.services.pnl_freshness import check as check_pnl_freshness
from app.services.execution_modes import get_execution_modes, DEFAULT_LEARN_MODE, DEFAULT_RUN_MODE
from app.services.install_manager import get_install_manager, InstallJob
from app.services import branch_lookup, bundle, file_history, github_files, source_history, working_copies
from app.services.clone_manager import artifact_path
from typing import Literal, Optional

router = APIRouter()


@router.get("/pnl-version")
async def pnl_version():
    """Return the installed PsyNeuLink version."""
    try:
        import psyneulink as pnl
        return {"version": pnl.__version__}
    except ImportError:
        return {"version": "unknown"}


class PsyNeuLinkInfoResponse(BaseModel):
    version: Optional[str]
    source: Literal["pypi", "github", "editable", "unknown"]
    branch: Optional[str]
    repo: Optional[str] = None
    commit: Optional[str] = None
    path: Optional[str] = None


class PsyNeuViewInfoResponse(BaseModel):
    version: str
    commit: str


class ModeciMdfInfoResponse(BaseModel):
    version: str


class GithubAuthInfoResponse(BaseModel):
    source: str
    user: Optional[str] = None
    scopes: list[str]
    has_repo_scope: bool


class PnlFeaturesResponse(BaseModel):
    debugger_hook: bool
    level: Literal["full", "basic"]


class DeploymentCapabilitiesResponse(BaseModel):
    install: bool
    github_token: bool


class DeploymentInfoResponse(BaseModel):
    mode: str
    capabilities: DeploymentCapabilitiesResponse


class SettingsInfoResponse(BaseModel):
    psyneulink: PsyNeuLinkInfoResponse
    psyneuview: PsyNeuViewInfoResponse
    modeci_mdf: ModeciMdfInfoResponse
    github_auth: GithubAuthInfoResponse
    features: PnlFeaturesResponse
    #: {"status": ok|not_installed|source_missing|import_failed, detail, path}
    health: dict
    deployment: DeploymentInfoResponse
    #: Whether PsyNeuLink is current, when that was checked, and the last
    #: automatic update (#1304); for Report a Problem. See /settings/pnl-updates.
    updates: Optional[dict] = None


class EditModeResponse(BaseModel):
    mode: Literal["editable", "viewOnly"]
    #: Which of the model's own rules makes it read only (#1346): the
    #: protection line in the file ("protectedPermanently", "protected") or
    #: the layout file's lock ("lock"); None when editable.
    rule: Optional[Literal["protectedPermanently", "protected", "lock"]] = None
    #: Whether PsyNeuView offers an unlock (never for "protectedPermanently").
    canUnlock: bool = False
    #: The file says "# PsyNeuView: protected" and was unlocked on this computer.
    unlockedHere: bool = False
    #: Why it is read only and how (or whether) to undo it.
    message: Optional[str] = None


def _edit_mode_response(file_path: str) -> EditModeResponse:
    st = edit_lock.status(file_path)
    return EditModeResponse(
        mode=st["mode"], rule=st["rule"], canUnlock=st["can_unlock"],
        unlockedHere=st["unlocked_here"], message=st["message"],
    )


class SetEditModeRequest(BaseModel):
    file_path: str
    mode: Literal["editable", "viewOnly"]


@router.get("/model/edit-mode", response_model=EditModeResponse)
async def get_edit_mode(file_path: str):
    """Whether this model may be edited from the canvas (#1116), and which of
    its own rules says not: the protection line in the file, or the lock
    (#1346). Where the file lives is answered by /model/pnl-source."""
    return _edit_mode_response(file_path)


@router.post("/model/edit-mode", response_model=EditModeResponse)
async def set_edit_mode(request: SetEditModeRequest):
    """Mark a model view-only, or editable again (#1116).

    Stored in the model's sidecar rather than in a user preference, so a
    curated model can ship locked and stay locked for whoever opens it.

    #1346: unlocking a file marked "# PsyNeuView: protected" is remembered on
    this computer instead (the line stays in the file); a file marked
    "protected permanently" can't be unlocked here — 409
    ``model_protected_permanently``, through the app's handler.
    """
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    try:
        edit_lock.set_edit_mode(request.file_path, request.mode)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _edit_mode_response(request.file_path)


@router.get("/settings/info", response_model=SettingsInfoResponse)
async def settings_info():
    """Read-only view of installed-package versions and install source (#120)."""
    return get_settings_info()


@router.get("/settings/running")
def settings_running(page_commit: Optional[str] = None):
    """What PsyNeuView is running and from where (#1356): the version, the
    Mac app's included copy or a checkout (branch, commit, files changed,
    behind its remote branch and devel as last fetched), and, given the
    asking page's build commit, which of page and server is older. No
    network; a sync handler, since it runs git."""
    from app.services import running_from

    if page_commit is not None and not running_from.is_commit_id(page_commit):
        raise HTTPException(status_code=400, detail="page_commit must be a commit id")
    return running_from.describe(page_commit)


@router.post("/settings/running/check")
def settings_running_check(page_commit: Optional[str] = None):
    """Check now (#1356): fetch the checkout's remotes, with a timeout, and
    describe it again. Nothing is pulled or switched."""
    from app.services import running_from

    if page_commit is not None and not running_from.is_commit_id(page_commit):
        raise HTTPException(status_code=400, detail="page_commit must be a commit id")
    fetched = running_from.fetch()
    return {**running_from.describe(page_commit), **fetched}


class PnlFreshnessResponse(BaseModel):
    status: Literal["current", "behind", "unknown", "not_applicable"]
    behind_by: Optional[int] = None
    installed_commit: Optional[str] = None
    head_commit: Optional[str] = None
    head_date: Optional[str] = None
    detail: str


@router.get("/settings/pnl-freshness", response_model=PnlFreshnessResponse)
async def pnl_freshness():
    """How far behind its branch a branch-pinned PsyNeuLink install is (#116).

    Separate from /settings/info deliberately. This one talks to GitHub, and
    Settings must open whether or not the network cooperates — so the panel
    loads first and fills this in when it arrives. `check` never raises; an
    unreachable GitHub comes back as "unknown", which reads as "couldn't
    check" rather than as reassurance.
    """
    info = (get_settings_info() or {}).get("psyneulink", {})
    return check_pnl_freshness(
        repo=info.get("repo"),
        branch=info.get("branch"),
        version=info.get("version"),
        commit=info.get("commit"),
    )


@router.get("/execution-modes")
async def execution_modes():
    """Available PsyNeuLink execution backends + which can train (#537, L4)."""
    return {
        "modes": get_execution_modes(),
        "defaultLearn": DEFAULT_LEARN_MODE,
        "defaultRun": DEFAULT_RUN_MODE,
    }


# ── PsyNeuLink install endpoint (#130) ─────────────────────────────────

_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}


def _is_loopback(request: Request) -> bool:
    client = request.client
    return client is not None and client.host in _LOOPBACK_HOSTS


class InstallCapabilities(BaseModel):
    enabled: bool
    # "unavailable_in_deployment" | "non_local". "running_in_mac_app" was
    # retired in #132 — the Mac app now drives this endpoint like any other
    # client rather than being told to use its own Preferences.
    reason: Optional[str] = None
    in_mac_app: bool
    mode: str


def _install_block(request: Request) -> Optional[tuple[int, str, str]]:
    """Why install is unavailable, as ``(status, reason, message)`` — or
    ``None`` when it's allowed.

    One resolution shared by the dependency and the capabilities endpoint, so
    what the UI is told and what the POST enforces cannot drift apart.

    Order matters. The deployment's own declaration is consulted *before*
    loopback, because the case this exists for (#1062) is a container reached
    over an SSH tunnel: the client genuinely is loopback while the user is
    remote and the venv is a read-only squashfs. Loopback still gets the last
    word in ``local`` mode, so a backend bound to 0.0.0.0 doesn't hand pip to
    the network — it just can no longer *grant* anything by itself.
    """
    mode = deployment_mode.current_mode()
    # The mac_app special case is gone (#132). It existed because the app kept
    # its own record of which PsyNeuLink was wanted and reinstalled from it on
    # every update, so anything chosen here was silently reverted later. The app
    # now reads what is installed rather than remembering it, and both windows
    # drive this same endpoint.
    if not deployment_mode.capabilities(mode).install:
        return (
            409,
            "unavailable_in_deployment",
            f"Changing the PsyNeuLink source isn't available in {mode} deployments.",
        )
    if not _is_loopback(request):
        return (403, "non_local", "Install endpoint is loopback-only.")
    return None


def _check_install_enabled(request: Request) -> None:
    """Dependency: refuse install unless the deployment mode allows it."""
    blocked = _install_block(request)
    if blocked is not None:
        status, reason, message = blocked
        raise HTTPException(status_code=status, detail={"reason": reason, "message": message})


@router.get("/settings/install/capabilities", response_model=InstallCapabilities)
async def install_capabilities(request: Request):
    """Whether the web Settings panel should expose install controls."""
    mode = deployment_mode.current_mode()
    blocked = _install_block(request)
    return InstallCapabilities(
        enabled=blocked is None,
        reason=None if blocked is None else blocked[1],
        in_mac_app=mode == deployment_mode.MAC_APP,
        mode=mode,
    )


class InstallRequest(BaseModel):
    source: Literal["pypi", "github", "local"]
    ref: Optional[str] = None  # required for github
    path: Optional[str] = None  # required for local
    repo: Optional[str] = None  # owner/repo for github; defaults to PrincetonUniversity/PsyNeuLink
    version: Optional[str] = None  # a PyPI release (#1295); None means the newest
    # source=local into an empty or missing folder (#1342): download
    # PsyNeuLink from this GitHub repo and branch into ``path`` first.
    download_repo: Optional[str] = None
    download_ref: Optional[str] = None


class InstallJobResponse(BaseModel):
    id: str
    source: str
    ref: Optional[str]
    path: Optional[str]
    repo: Optional[str]
    status: str
    log: list[str]
    exit_code: Optional[int]
    started_at: float
    finished_at: Optional[float]
    version: Optional[str] = None
    download_repo: Optional[str] = None
    download_ref: Optional[str] = None


def _job_to_response(job: InstallJob) -> InstallJobResponse:
    return InstallJobResponse(
        id=job.id,
        source=job.source,
        ref=job.ref,
        path=job.path,
        repo=job.repo,
        version=job.version,
        download_repo=getattr(job, "download_repo", None),
        download_ref=getattr(job, "download_ref", None),
        status=job.status,
        log=job.log,
        exit_code=job.exit_code,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


@router.post(
    "/settings/install",
    response_model=InstallJobResponse,
    dependencies=[Depends(_check_install_enabled)],
)
async def start_install(payload: InstallRequest):
    """Kick off a PsyNeuLink reinstall (#130). Returns the job id for polling."""
    manager = get_install_manager()
    try:
        # The download fields only when a download is asked for (#1342).
        download = (
            {"download_repo": payload.download_repo, "download_ref": payload.download_ref}
            if (payload.download_repo or payload.download_ref)
            else {}
        )
        job = manager.start(payload.source, payload.ref, payload.path, payload.repo, payload.version, **download)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Record the (repo, ref) into history for the typeahead (#251). We
    # record on intent, not success — failed installs are still signal
    # about what the user is trying to reach.
    if payload.source == "github" and payload.ref:
        repo_slug = payload.repo or "PrincetonUniversity/PsyNeuLink"
        try:
            source_history.record_selection(repo_slug, payload.ref)
        except Exception:
            logger.warning("source_history.record_selection failed", exc_info=True)

    # Remember every source switched to, for Settings' list of known sources
    # (#1276). Also on intent: start() has already refused a bad path or repo.
    # The one being left is kept too (#1331): a checkout installed outside
    # Settings was listed only while in use, and vanished on the first switch.
    try:
        source_history.remember_active(_active_pnl_source())
    except Exception:
        logger.warning("source_history.remember_active failed", exc_info=True)
    # A download is remembered by the job once the folder holds PsyNeuLink
    # (#1342): a failed one leaves no checkout to list.
    try:
        if getattr(job, "download_repo", None) is None:
            source_history.remember_source(
                payload.source,
                repo=(payload.repo or "PrincetonUniversity/PsyNeuLink") if payload.source == "github" else None,
                ref=payload.ref,
                path=payload.path,
            )
    except Exception:
        logger.warning("source_history.remember_source failed", exc_info=True)

    return _job_to_response(job)


class LocalFolderCheckResponse(BaseModel):
    # usable: a PsyNeuLink checkout; downloadable: empty or not there yet;
    # refused: anything else, ``reason`` saying why in plain words.
    status: Literal["usable", "downloadable", "refused"]
    path: str  # the folder, ~ expanded
    exists: bool
    reason: Optional[str] = None


@router.get(
    "/settings/install/check-folder",
    response_model=LocalFolderCheckResponse,
    dependencies=[Depends(_check_install_enabled)],
)
def check_install_folder(path: str = ""):
    """What the folder typed under *Another local checkout…* is, as soon as
    it is typed (#1342), so the panel can say so under the Path field rather
    than after Apply. Reads the file system only; nothing is changed."""
    from app.services.install_manager import check_local_folder

    check = check_local_folder(path)
    return LocalFolderCheckResponse(
        status=check.status, path=check.path, exists=check.exists, reason=check.reason,
    )


# ── Typeahead lookup endpoints (#251) ─────────────────────────────────
# Note: these literal-path routes must be declared BEFORE the parameterized
# `/settings/install/{job_id}` below, otherwise `branches` / `repos` would
# match as a job_id and 404.


class BranchListingResponse(BaseModel):
    branches: list[str]   # all branches, alphabetical
    default: str          # repo's default branch
    recent_refs: list[str]  # refs the user has previously selected for this repo


class ReposListingResponse(BaseModel):
    recent_repos: list[str]  # repos in selection order, newest first


@router.get(
    "/settings/install/branches",
    response_model=BranchListingResponse,
    dependencies=[Depends(_check_install_enabled)],
)
async def list_install_branches(repo: str):
    """Return GitHub branches for ``repo`` plus the user's recent refs for
    that repo. 4xx for invalid slugs, not-found repos, and rate-limit hits."""
    try:
        listing = branch_lookup.list_branches(repo)
    except branch_lookup.BranchLookupError as e:
        status = {
            "invalid_slug": 400,
            "not_found": 404,
            "rate_limited": 429,
            "network": 502,
        }.get(e.reason, 502)
        raise HTTPException(status_code=status, detail={"reason": e.reason, "message": str(e)})

    return BranchListingResponse(
        branches=listing.branches,
        default=listing.default,
        recent_refs=source_history.list_refs_for_repo(repo.strip()),
    )


@router.get(
    "/settings/install/repos",
    response_model=ReposListingResponse,
    dependencies=[Depends(_check_install_enabled)],
)
async def list_install_repos():
    """Recent repos in selection order. No live "all repos" list — GitHub
    doesn't expose that, and we don't want it."""
    return ReposListingResponse(recent_repos=source_history.list_repos())


# ── The official releases on PyPI, and the kept ones (#1295) ─────────


@router.get("/settings/pnl-releases")
def list_pnl_releases():
    """Every PsyNeuLink release on PyPI, newest first, with its date, whether
    it installs on this Python, whether it is too old for run stepping, and
    whether a copy is kept locally. Sync: it may read PyPI (short timeout,
    cached) and reads the releases folder."""
    from app.services import pnl_releases
    return pnl_releases.list_releases()


@router.delete(
    "/settings/pnl-releases/{version}",
    dependencies=[Depends(_check_install_enabled)],
)
def remove_kept_release(version: str):
    """Delete the kept file of one release; never the release in use."""
    from app.services import pnl_releases
    try:
        return {"removed": pnl_releases.remove_kept(version)}
    except pnl_releases.ReleaseError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Remembered PsyNeuLink sources (#1276) ─────────────────────────────


class PnlSourceEntry(BaseModel):
    id: str
    kind: Literal["github", "pypi", "local"]
    repo: Optional[str] = None
    ref: Optional[str] = None
    path: Optional[str] = None
    label: Optional[str] = None
    selected_at: float
    editable: bool     # a local checkout; GitHub and PyPI are managed, read-only
    active: bool       # the PsyNeuLink installed right now
    remembered: bool   # False only for an active source not yet on the list
    missing: bool      # a local checkout whose folder is gone


class PnlSourcesResponse(BaseModel):
    sources: list[PnlSourceEntry]


class RenamePnlSourceRequest(BaseModel):
    id: str
    label: Optional[str] = None


class RemovePnlSourceRequest(BaseModel):
    id: str


def _active_pnl_source() -> Optional[dict]:
    return source_history.active_source_from_info(get_psyneulink_info())


@router.get(
    "/settings/pnl-sources",
    response_model=PnlSourcesResponse,
    dependencies=[Depends(_check_install_enabled)],
)
def list_pnl_sources():
    """The PsyNeuLink sources Settings can switch between, active one marked.

    Sync (threadpool) because reading the active install may probe git.

    The source in use is put on the list the first time Settings sees it
    (#1331), so a checkout installed by the Mac app's setup or a terminal is
    a known source from then on, not only while it is in use.
    """
    active = _active_pnl_source()
    try:
        source_history.remember_active(active)
    except Exception:
        logger.warning("source_history.remember_active failed", exc_info=True)
    return PnlSourcesResponse(sources=source_history.list_sources(active=active))


@router.post(
    "/settings/pnl-sources/rename",
    response_model=PnlSourcesResponse,
    dependencies=[Depends(_check_install_enabled)],
)
def rename_pnl_source(payload: RenamePnlSourceRequest):
    """Name a remembered source; a blank name restores the default label."""
    active = _active_pnl_source()
    try:
        source_history.rename_source(payload.id, payload.label, active=active)
    except KeyError:
        raise HTTPException(status_code=404, detail="source not found")
    return PnlSourcesResponse(sources=source_history.list_sources(active=active))


@router.post(
    "/settings/pnl-sources/remove",
    response_model=PnlSourcesResponse,
    dependencies=[Depends(_check_install_enabled)],
)
def remove_pnl_source(payload: RemovePnlSourceRequest):
    """Take a source off the list. The folder of a local checkout is never
    deleted, and removing the active source doesn't uninstall it."""
    if not source_history.remove_source(payload.id):
        raise HTTPException(status_code=404, detail="source not found")
    return PnlSourcesResponse(sources=source_history.list_sources(active=_active_pnl_source()))


@router.get(
    "/settings/install/{job_id}",
    response_model=InstallJobResponse,
    dependencies=[Depends(_check_install_enabled)],
)
async def get_install_job(job_id: str):
    """Poll an install job's status and accumulated log."""
    job = get_install_manager().get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return _job_to_response(job)


# ── Keeping PsyNeuLink current (#1304) ────────────────────────────────


class AutoUpdateRequest(BaseModel):
    enabled: bool


class CheckoutPrefsRequest(BaseModel):
    path: str
    check: Optional[bool] = None
    pull_on_launch: Optional[bool] = None


class CheckoutPathRequest(BaseModel):
    path: str


@router.get("/settings/pnl-updates")
def pnl_updates_status():
    """Whether PsyNeuLink is current and when that was last checked, whether
    automatic updates are on and one is ready for the next start, the last
    automatic update's outcome, and the same for each checkout (#1304). No
    network: what the last check recorded. Report a Problem reads this too."""
    from app.services import checkout_updates, pnl_updates
    return {**pnl_updates.status(), "checkouts": checkout_updates.list_checkouts()}


@router.post("/settings/pnl-updates/check")
def pnl_updates_check_now():
    """Check now: asks GitHub (a branch install) or PyPI (a release) and
    records the result. Sync: a short network call."""
    from app.services import checkout_updates, pnl_updates
    pnl_updates.check_now()
    return {**pnl_updates.status(), "checkouts": checkout_updates.list_checkouts()}


@router.post(
    "/settings/pnl-updates/auto-update",
    dependencies=[Depends(_check_install_enabled)],
)
def set_pnl_auto_update(payload: AutoUpdateRequest):
    """Keep Latest development up to date automatically: on or off. Off
    also unmarks an update that was ready, so nothing installs on its own."""
    from app.services import checkout_updates, pnl_updates
    pnl_updates.set_auto_update(payload.enabled)
    return {**pnl_updates.status(), "checkouts": checkout_updates.list_checkouts()}


def _known_checkout(path: str) -> dict:
    from app.services import checkout_updates
    wanted = checkout_updates._key(path)
    for entry in checkout_updates.list_checkouts():
        if entry["id"] == wanted:
            return entry
    raise HTTPException(status_code=404, detail="That folder isn't one of the checkouts Settings knows.")


@router.post(
    "/settings/checkout-updates/prefs",
    dependencies=[Depends(_check_install_enabled)],
)
def set_checkout_update_prefs(payload: CheckoutPrefsRequest):
    """A checkout's two switches: check for upstream changes, pull on launch."""
    from app.services import checkout_updates
    _known_checkout(payload.path)
    checkout_updates.set_prefs(payload.path, check=payload.check, pull_on_launch=payload.pull_on_launch)
    return {"checkouts": checkout_updates.list_checkouts()}


@router.post("/settings/checkout-updates/check")
def check_checkout_now(payload: CheckoutPathRequest):
    """Fetch one checkout's remote branch and say how far behind it is."""
    from app.services import checkout_updates
    entry = _known_checkout(payload.path)
    if not entry["is_checkout"]:
        raise HTTPException(status_code=400, detail="That folder isn't a git checkout.")
    return {"result": checkout_updates.check(payload.path), "checkouts": checkout_updates.list_checkouts()}


@router.post(
    "/settings/checkout-updates/pull",
    dependencies=[Depends(_check_install_enabled)],
)
def pull_checkout_now(payload: CheckoutPathRequest):
    """Fast-forward one checkout now, with the same refusals as at launch."""
    from app.services import checkout_updates
    entry = _known_checkout(payload.path)
    if not entry["is_checkout"]:
        raise HTTPException(status_code=400, detail="That folder isn't a git checkout.")
    return {"result": checkout_updates.pull(payload.path), "checkouts": checkout_updates.list_checkouts()}


class LoadModelRequest(BaseModel):
    file_path: str
    # Developer mode (#273 / #249): when True, don't patch
    # Composition.run/execute/learn — let the script's calls actually
    # execute. Used for extracted pytest tests so the loaded file produces
    # real results, not just a graph snapshot. Default False matches the
    # normal "open a model file, see the graph" behavior.
    developer_mode: bool = False
    # Flat view (#658): inline every nested composition into one graph instead
    # of the per-composition (drill-down) view. Threaded to serialize_composition.
    flat: bool = False
    # PyTorch view (#230): the autodiff-flattened graph (AutodiffComposition
    # only). Takes precedence over `flat` when applicable.
    pytorch: bool = False
    # "Like show_graph" layout (#27): ask show_graph while the model is loaded
    # and keep the answers for the layout's own request. Carries the options
    # the page will ask with ({show_controller, show_learning}) and,
    # optionally, the composition it has open ({composition}).
    show_graph: dict | None = None


class LoadModelResponse(BaseModel):
    model: dict
    source: str
    layout: dict | None = None
    # Optional sidecar `<model>.labels.yaml` for semantic element-name
    # overlays (#361 Layer 3). None when no sidecar exists.
    labels: dict | None = None
    # #408: list of sidecar files that exist next to the .py. Each entry
    # {kind, name}: kind is the frontend's well-known identifier for
    # /api/model/sidecar lookups; name is the bare filename for display.
    bundle: list[dict] = []
    # #479/#482: the merged named-layout / settings-profile view — ordered
    # lists with one active each. Supersedes `bundle` for variant-aware
    # clients; `bundle` stays for existing #408 consumers.
    sidecars: dict | None = None
    # #1010: state of a reference model's working copy. `diverged` means the
    # file on disk differs from the bundled pristine, i.e. it carries edits.
    # `restored` means this load overwrote it from the bundle on request.
    # Absent for non-reference loads.
    workingCopy: dict | None = None
    isStandardized: bool = True
    formatIssues: list[str] = []
    starImportConverted: bool = False
    # Absolute path of the working copy the model was loaded into. Set by the
    # reference/demo loaders so the client doesn't have to guess it from the
    # pristine path — the working dir may be isolated (e.g. PSYNEWVIEW_WORKING_DIR
    # under the E2E harness), where the guess "backend/<name>.py" is wrong.
    file_path: str | None = None
    # #864: server-side load timing (milliseconds) so the client can log one
    # consistent end-to-end breakdown instead of guessing where the seconds go.
    # {introspect_ms, total_ms, misc_ms?}. None on paths that don't measure.
    timings: dict | None = None


class GetSidecarRequest(BaseModel):
    """Request shape for /api/model/sidecar (#408)."""
    file_path: str  # path to the model .py file
    kind: str       # "labels" | "layout"
    # Optional named variant (#482); None addresses the default sidecar.
    variant: str | None = None


class SaveSidecarRequest(BaseModel):
    """Request shape for /api/model/save-sidecar (#410).

    Mixing a Pydantic model + an extra Body field on the same endpoint
    confuses FastAPI's validation — keep all fields in one model.
    """
    file_path: str
    kind: str
    content: str
    # Optional named variant (#482); None addresses the default sidecar.
    variant: str | None = None


class SidecarListRequest(BaseModel):
    """Request shape for /api/model/sidecars/list (#482)."""
    file_path: str


class SidecarVariantRequest(BaseModel):
    """A variant op keyed by (kind, name): set-active / create / delete."""
    file_path: str
    kind: str   # "layout" | "settings"
    name: str


class SidecarRenameRequest(BaseModel):
    """A two-name variant op: rename / duplicate (#482)."""
    file_path: str
    kind: str
    name: str
    new_name: str


class SidecarReorderRequest(BaseModel):
    """Set the variant order for a kind (#482)."""
    file_path: str
    kind: str
    names: list[str]


class SidecarPlacementRequest(BaseModel):
    """Set a model's per-model sidecar placement (#933).

    ``placement`` is ``"lateral"`` / ``"dotfolder"`` for an explicit override, or
    ``"inherit"`` / ``null`` to clear it and follow the global default."""
    file_path: str
    placement: Optional[str] = None


class PlacementDefaultRequest(BaseModel):
    """Set the global sidecar-placement default (#933). ``null`` clears it."""
    placement: Optional[str] = None


class AutosaveRequest(BaseModel):
    """Change the autosave setting (#1347); either part may be left out."""
    enabled: Optional[bool] = None
    seconds: Optional[int] = None


class UpdateParamRequest(BaseModel):
    file_path: str
    var_name: str
    param_name: str
    new_value: str
    context: str = "mechanism"  # "mechanism" or "function"
    is_default: bool = False  # if true, remove param from code (default values are suppressed)
    skip_introspect: bool = False  # if true, skip re-introspection (for fast param edits)
    # Class of the owner's function, e.g. "DriftDiffusionAnalytical". Used only
    # when the declaration has no `function=` at all: the mechanism is on its
    # class default, and this says which default to write in (#1200).
    function_class: Optional[str] = None


class SaveLabelsRequest(BaseModel):
    """Write the sidecar `<model>.labels.yaml` for a model (#404).

    The labels dict is taken at face value — the caller owns the full
    structure (no merging here). Pass an empty dict to delete the sidecar.
    """
    file_path: str
    labels: dict
    # Optional named variant (#479/#483); None addresses the default sidecar.
    variant: str | None = None


class UpdateFunctionTypeRequest(BaseModel):
    file_path: str
    var_name: str
    new_function_class: str
    skip_introspect: bool = False


class RenamePortRequest(BaseModel):
    file_path: str
    var_name: str
    port_kind: Literal["input", "output"]
    current_names: list[str]
    old_name: str
    new_name: str


class RenameNodeRequest(BaseModel):
    file_path: str
    var_name: str
    new_name: str
    # All current node display names, for collision detection (#612).
    existing_names: list[str]
    current_name: str | None = None


class AddPortRequest(BaseModel):
    file_path: str
    var_name: str
    port_kind: Literal["input", "output"]
    current_names: list[str]
    new_name: str


class RemovePortRequest(BaseModel):
    file_path: str
    var_name: str
    port_kind: Literal["input", "output"]
    current_names: list[str]
    port_name: str


class SaveSourceRequest(BaseModel):
    file_path: str
    source: str
    #: What the client believes is currently on disk — the text it last loaded
    #: or saved. When it no longer matches the file, someone else wrote to it
    #: since, and saving would discard their work (#926). Optional so callers
    #: that genuinely mean "overwrite" (and older clients) keep working.
    base_source: Optional[str] = None


class FileExistsRequest(BaseModel):
    file_path: str


class GithubFileRecent(BaseModel):
    path: str
    selected_at: float


class GithubTreeResponse(BaseModel):
    paths: list[str]
    truncated: bool
    recent: list[GithubFileRecent]  # recents scoped to this (repo, ref)


class GithubFileResponse(BaseModel):
    repo: str
    ref: str
    path: str
    content: str  # decoded UTF-8 source


def _github_files_http_status(reason: str) -> int:
    """Map GithubFilesError reasons to HTTP status codes.

    auth_required → 403 (UI routes user to Settings); rate_limited → 429
    (UI suggests waiting); too_large → 413; everything client-side wrong
    (invalid slug/ref/path, directory passed as file) → 400.
    """
    return {
        "invalid_slug":   400,
        "invalid_ref":    400,
        "invalid_path":   400,
        "not_a_file":     400,
        "not_found":      404,
        "auth_required":  403,
        "rate_limited":   429,
        "too_large":      413,
        "network":        502,
    }.get(reason, 502)


@router.get("/model/github/tree", response_model=GithubTreeResponse)
async def github_tree(repo: str, ref: str):
    """List ``.py`` paths in ``repo`` at ``ref``, plus the user's recently
    opened files for that (repo, ref). Tree is cached 5 min; recents are
    read from ``~/.psynewview.json`` on every call (cheap)."""
    try:
        listing = github_files.list_tree(repo, ref)
    except github_files.GithubFilesError as e:
        raise HTTPException(
            status_code=_github_files_http_status(e.reason),
            detail={"reason": e.reason, "message": str(e)},
        )

    recents = file_history.list_for_repo_ref(repo.strip(), ref.strip())
    return GithubTreeResponse(
        paths=listing.paths,
        truncated=listing.truncated,
        recent=[
            GithubFileRecent(path=e["path"], selected_at=e["selected_at"])
            for e in recents
        ],
    )


@router.get("/model/github/file", response_model=GithubFileResponse)
async def github_file(repo: str, ref: str, path: str):
    """Fetch a single file from GitHub. Records the (repo, ref, path) into
    file_history on success so it can be surfaced as a recent next time."""
    try:
        raw = github_files.get_file_content(repo, ref, path)
    except github_files.GithubFilesError as e:
        raise HTTPException(
            status_code=_github_files_http_status(e.reason),
            detail={"reason": e.reason, "message": str(e)},
        )

    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError:
        # Python source is text, but a binary file at a .py path would
        # explode here. Surface as 400 with a clear reason rather than
        # corrupting bytes into latin-1.
        raise HTTPException(
            status_code=400,
            detail={
                "reason": "not_utf8",
                "message": f"File at {path!r} is not valid UTF-8.",
            },
        )

    try:
        file_history.record_selection(repo.strip(), ref.strip(), path.strip())
    except Exception:
        logger.warning("file_history.record_selection failed", exc_info=True)

    return GithubFileResponse(
        repo=repo.strip(),
        ref=ref.strip(),
        path=path.strip(),
        content=content,
    )


@router.post("/model/file-exists")
async def file_exists(request: FileExistsRequest):
    """Check whether a file exists on disk."""
    return {"exists": Path(request.file_path).exists()}


class DiskSourceRequest(BaseModel):
    file_path: str


@router.post("/model/disk-source")
def disk_source(request: DiskSourceRequest):
    """The model's text as it is on disk right now, for "Changes since save"
    (#1348).

    The client already holds what it last loaded or saved (``savedSource``);
    this is the other half, read fresh, so the comparison is against the file
    as it stands even when it changed outside PsyNeuView. Read only. A model
    file is a ``.py``, so nothing else is read; a missing file is an answer
    (``exists: false``), not an error, because "it is gone" is what the
    dialog then has to say.
    """
    path = Path(request.file_path)
    if path.suffix != ".py":
        raise HTTPException(status_code=400, detail="Only a model's .py file can be read here.")
    if not path.is_file():
        return {"exists": False, "source": None}
    return {"exists": True, "source": path.read_text(errors="replace")}


def _load_timings(introspect_ms: float, total_start: float, **extra) -> dict:
    """Server-side load timing (#864) returned to the client so it can emit a
    single consistent end-to-end breakdown. All values are milliseconds."""
    return {
        "introspect_ms": round(introspect_ms),
        "total_ms": round((time.time() - total_start) * 1000),
        **{k: round(v) for k, v in extra.items()},
    }


def _sidecar_payload(path: Path) -> tuple[dict | None, dict | None, list[dict], dict]:
    """What a client needs to open ``path`` looking as it was last left:
    ``(layout, labels, bundle, sidecars)``, as ``/model/load`` returns them.
    Shared with Save a copy as… (#1244), which opens the copy the same way.

    The model opens in its *active* layout/settings variant, not just the
    unsuffixed default (#483). For a model with no index, the active names
    resolve to "Default", so this stays the plain default-sidecar load.

    #408 / #631: ``bundle`` enumerates the model's files. Beyond the source
    .py, every label/layout *variant* present on disk (not just the default
    sidecar), so the file-switcher dropdown matches the right-side variant
    pickers. Each entry carries the variant name so the client can fetch that
    exact file via /api/model/sidecar. Index entries whose file is gone
    (`missing`) are skipped — they'd 404 in the picker.
    """
    sidecars = list_sidecars(str(path))
    layout = load_layout(str(path), sidecars["activeLayout"])
    labels = load_labels(str(path), sidecars["activeSetting"])
    bundle: list[dict] = [{"kind": "source", "name": path.name}]
    for _entry in sidecars["settings"]:
        if not _entry.get("missing"):
            bundle.append({"kind": "labels", "variant": _entry["name"], "name": _entry["file"]})
    for _entry in sidecars["layouts"]:
        if not _entry.get("missing"):
            bundle.append({"kind": "layout", "variant": _entry["name"], "name": _entry["file"]})
    return layout, labels, bundle, sidecars


def _keep_show_graph_answers(file_path: str, answers: list | None) -> None:
    """Keep show_graph's answers from a load for the layout's request (#27)."""
    from app.services import show_graph_cache

    for a in answers or []:
        key = show_graph_cache.cache_key(file_path, a["composition"], a["options"], "dot")
        if key is not None:
            show_graph_cache.put(key, a["answer"])


@router.post("/model/load", response_model=LoadModelResponse)
def load_model(request: LoadModelRequest):
    """Load a .py model file: execute it, introspect the PsyNeuLink objects,
    return the model graph as JSON along with the source code."""
    t0 = time.time()
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    classification = classify_file(path)
    if classification.file_type is not FileType.PNL_PYTHON:
        # /model/load is the .py entry point; MDF and project bundles have
        # their own endpoints. Surface the classifier's error if it had one,
        # otherwise explain why this file was rejected here.
        detail = classification.error or (
            f"This endpoint accepts PsyNeuLink .py files. Detected type: "
            f"{classification.file_type.value}."
        )
        raise HTTPException(status_code=400, detail=detail)

    source = path.read_text()

    # Auto-convert star imports before introspection so the file_writer
    # can safely emit `pnl.`-prefixed code for any future edits.
    converted_source, star_converted = convert_star_imports(source)
    # Opening a file must never rewrite a protected PsyNeuLink file (#1225).
    # It opens as it is; since it can't be edited, the conversion isn't needed.
    if star_converted and pnl_source_guard.ownership(path) is not None \
            and not pnl_source_guard.ownership(path)["editable"]:
        star_converted = False
    # Nor a model whose own rules make it read only (#1346): a protection
    # line in the file, or the lock. The file opens as it is.
    if star_converted and edit_lock.status(str(path))["rule"] is not None:
        star_converted = False
    if star_converted:
        # Back up original before overwriting (redirected out of tree for
        # managed clones — #349)
        backup_path = artifact_path(path.with_suffix(".star_import_original.py"))
        if not backup_path.exists():
            shutil.copy2(path, backup_path)
        path.write_text(converted_source)
        source = converted_source
        logger.info(f"[star-import] Converted 'from psyneulink import *' in {path.name} (backup: {backup_path.name})")

    t1 = time.time()
    model = load_and_introspect(
        str(path), developer_mode=request.developer_mode, flat=request.flat,
        pytorch=request.pytorch, show_graph=request.show_graph,
    )
    _keep_show_graph_answers(str(path), model.pop("showGraph", None))
    t2 = time.time()
    layout, labels, bundle, sidecars = _sidecar_payload(path)
    standardized = is_standardized_format(source)
    issues = detect_format_issues(source) if not standardized else []
    t3 = time.time()
    logger.info(f"[perf] /model/load: introspect={t2-t1:.2f}s misc={t3-t2:.2f}s total={t3-t0:.2f}s")
    return LoadModelResponse(
        model=_attach_dangling(model, source),
        source=source,
        layout=layout,
        labels=labels,
        bundle=bundle,
        sidecars=sidecars,
        isStandardized=standardized,
        formatIssues=issues,
        starImportConverted=star_converted,
        timings=_load_timings((t2 - t1) * 1000, t0, misc_ms=(t3 - t2) * 1000),
    )


@router.post("/model/sidecar")
async def get_sidecar(request: GetSidecarRequest):
    """Return the raw contents + suggested language for a sidecar (#408).

    Server-side path resolution from a `kind` identifier — never accepts an
    arbitrary path. Keeps the endpoint locked to well-known sidecars
    alongside the requested model file.
    """
    if request.kind == "labels":
        sidecar = labels_path(request.file_path, request.variant)
        language = "yaml"
    elif request.kind == "layout":
        sidecar = sidecar_path(request.file_path, request.variant)
        language = "json"
    else:
        raise HTTPException(status_code=400, detail=f"Unknown sidecar kind: {request.kind!r}")
    if not sidecar.exists():
        return {"name": sidecar.name, "language": language, "content": "", "exists": False}
    try:
        content = sidecar.read_text()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to read sidecar: {e}")
    return {"name": sidecar.name, "language": language, "content": content, "exists": True}


@router.post("/model/save-sidecar")
async def save_sidecar(request: SaveSidecarRequest):
    """Write raw text to a sidecar file (#410).

    Mirrors /model/sidecar's path-resolution semantics so the endpoint
    can't be coaxed into writing arbitrary paths. For ``kind="labels"``
    the content is parse-checked as YAML before writing — a malformed
    save returns 400 with the parse error and the file is left untouched.
    """
    content = request.content
    if request.kind == "labels":
        sidecar = labels_path(request.file_path, request.variant)
        try:
            import yaml as _yaml
            _yaml.safe_load(content)
        except _yaml.YAMLError as e:
            raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")
    elif request.kind == "layout":
        sidecar = sidecar_path(request.file_path, request.variant)
        try:
            import json as _json
            _json.loads(content)
        except _json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")
    else:
        raise HTTPException(status_code=400, detail=f"Unknown sidecar kind: {request.kind!r}")
    try:
        if content.strip():
            sidecar.write_text(content)
        elif sidecar.exists():
            sidecar.unlink()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to write sidecar: {e}")
    # Return the post-save state so the client can refresh the store.
    if request.kind == "labels":
        return {"labels": load_labels(request.file_path, request.variant)}
    return {}


def _variant_op(fn, *args):
    """Run a sidecar_index mutation, mapping VariantError → 400 (always a
    client mistake: unknown variant, name collision, malformed name)."""
    try:
        return fn(*args)
    except VariantError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/model/sidecars/list")
async def sidecars_list(request: SidecarListRequest):
    """The model's merged named-layout / settings-profile view (#482)."""
    return list_sidecars(request.file_path)


@router.post("/model/sidecars/set-active")
async def sidecars_set_active(request: SidecarVariantRequest):
    return _variant_op(set_active, request.file_path, request.kind, request.name)


@router.post("/model/sidecars/create")
async def sidecars_create(request: SidecarVariantRequest):
    return _variant_op(create_variant, request.file_path, request.kind, request.name)


@router.post("/model/sidecars/delete")
async def sidecars_delete(request: SidecarVariantRequest):
    return _variant_op(delete_variant, request.file_path, request.kind, request.name)


@router.post("/model/sidecars/rename")
async def sidecars_rename(request: SidecarRenameRequest):
    return _variant_op(rename_variant, request.file_path, request.kind, request.name, request.new_name)


@router.post("/model/sidecars/duplicate")
async def sidecars_duplicate(request: SidecarRenameRequest):
    return _variant_op(duplicate_variant, request.file_path, request.kind, request.name, request.new_name)


@router.post("/model/sidecars/reorder")
async def sidecars_reorder(request: SidecarReorderRequest):
    return _variant_op(reorder, request.file_path, request.kind, request.names)


@router.post("/model/sidecars/placement")
async def sidecars_set_placement(request: SidecarPlacementRequest):
    """Set a model's per-model sidecar placement (#933).

    An explicit ``lateral`` / ``dotfolder`` also **migrates** the model's
    existing sidecars into that layout — lateral-first discovery means the choice
    is inert until the files actually move. ``inherit`` / ``null`` just clears the
    override (no move). Returns the refreshed sidecar view plus any migration
    result (moved files + unresolved both-locations conflicts)."""
    value = request.placement
    if value == "inherit":
        value = None
    if value is not None and value not in PLACEMENT_CONCRETE:
        raise HTTPException(
            status_code=400,
            detail=f"placement must be one of {sorted(PLACEMENT_CONCRETE)}, 'inherit', or null",
        )
    set_placement(request.file_path, value)
    migration = migrate_placement(request.file_path, value) if value is not None else None
    result = list_sidecars(request.file_path)
    if migration is not None:
        result["migration"] = migration
    return result


@router.get("/settings/sidecar-placement")
async def get_placement_default():
    """The global sidecar-placement default (``auto`` when unset) (#933)."""
    return {"placement": app_settings.get_default_placement() or "auto"}


@router.post("/settings/sidecar-placement")
async def set_placement_default(request: PlacementDefaultRequest):
    """Set (or, with ``null``, clear) the global sidecar-placement default."""
    value = request.placement
    if value == "inherit":  # UI may send 'inherit' to mean "clear"
        value = None
    try:
        app_settings.set_default_placement(value)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"placement": app_settings.get_default_placement() or "auto"}


@router.get("/settings/autosave")
async def get_autosave_setting():
    """Autosave (#1347): ``{"enabled", "seconds"}``, off and 10 s by default."""
    return app_settings.get_autosave()


@router.post("/settings/autosave")
async def set_autosave_setting(request: AutosaveRequest):
    """Turn autosave on or off, or change its delay. The page does the saving,
    through the same request a manual Save sends; this only remembers it."""
    try:
        return app_settings.set_autosave(enabled=request.enabled, seconds=request.seconds)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/model/sidecars/resolve")
async def sidecars_resolve(request: SidecarListRequest):
    """Parsed layout + labels for the model's *active* variants (#483).

    The frontend calls this after switching the active layout or settings
    profile to re-apply it without re-introspecting the whole model — it
    gets back the same shapes /model/load delivers for ``layout``/``labels``.
    """
    sidecars = list_sidecars(request.file_path)
    return {
        "layout": load_layout(request.file_path, sidecars["activeLayout"]),
        "labels": load_labels(request.file_path, sidecars["activeSetting"]),
    }


@router.post("/model/save-labels")
async def save_labels_endpoint(request: SaveLabelsRequest):
    """Persist the labels sidecar for a model (#404).

    Writes the supplied dict verbatim to ``<model>.labels.yaml``. Empty
    dict deletes the file. Returns the labels that are now on disk so the
    client can update its store without a second round-trip.
    """
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    try:
        save_labels(str(path), request.labels, request.variant)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to write labels: {e}")
    # Re-read so the response reflects exactly what hit disk (and what an
    # immediate /model/load would now return).
    return {"labels": load_labels(str(path), request.variant)}


@router.post("/model/update-param")
def update_param(request: UpdateParamRequest):
    """Update a single parameter in the .py file.

    With skip_introspect=true, only writes the file and returns the updated
    source (fast path for live editing). Full re-introspection happens on Save.
    """
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    try:
        updated_source = apply_parameter_change(
            request.file_path,
            request.var_name,
            request.param_name,
            request.new_value,
            request.context,
            request.is_default,
            request.function_class,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if request.skip_introspect:
        return {"source": updated_source}

    model = load_and_introspect(request.file_path)
    layout = load_layout(request.file_path)
    return LoadModelResponse(model=_attach_dangling(model, updated_source), source=updated_source, layout=layout)


@router.post("/model/update-function-type")
def update_function_type(request: UpdateFunctionTypeRequest):
    """Swap a mechanism's function= class to a new one (defaults).

    Old function-specific params are dropped since they may not apply to
    the new class. Re-introspection is the default so the frontend sees
    the new function's full param set.
    """
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    try:
        updated_source = apply_function_change(
            request.file_path,
            request.var_name,
            request.new_function_class,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if request.skip_introspect:
        return {"source": updated_source}

    model = load_and_introspect(request.file_path)
    layout = load_layout(request.file_path)
    return LoadModelResponse(model=_attach_dangling(model, updated_source), source=updated_source, layout=layout)


@router.post("/model/rename-port")
def rename_port(request: RenamePortRequest):
    """Rename an input or output port on a mechanism (#198)."""
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    try:
        updated_source = apply_port_rename(
            request.file_path,
            request.var_name,
            request.port_kind,
            request.current_names,
            request.old_name,
            request.new_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    model = load_and_introspect(request.file_path)
    layout = load_layout(request.file_path)
    return LoadModelResponse(model=_attach_dangling(model, updated_source), source=updated_source, layout=layout)


@router.post("/model/rename-node")
def rename_node(request: RenameNodeRequest):
    """Rename a node's PsyNeuLink display name (`name=` arg) (#612).

    Renames what the graph/inspector show; the Python variable is left as-is
    (node names can contain spaces that aren't valid identifiers). Collisions
    against existing node names are rejected with a 400.
    """
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    try:
        updated_source = apply_node_rename(
            request.file_path,
            request.var_name,
            request.new_name,
            request.existing_names,
            request.current_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    model = load_and_introspect(request.file_path)
    layout = load_layout(request.file_path)
    return LoadModelResponse(model=_attach_dangling(model, updated_source), source=updated_source, layout=layout)


@router.post("/model/add-port")
def add_port(request: AddPortRequest):
    """Append a new input or output port to a mechanism (#198)."""
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    try:
        updated_source = apply_port_add(
            request.file_path,
            request.var_name,
            request.port_kind,
            request.current_names,
            request.new_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    model = load_and_introspect(request.file_path)
    layout = load_layout(request.file_path)
    return LoadModelResponse(model=_attach_dangling(model, updated_source), source=updated_source, layout=layout)


@router.post("/model/remove-port")
def remove_port(request: RemovePortRequest):
    """Remove an input or output port from a mechanism (#198).

    Refuses to remove the last port of a given kind. The frontend is
    expected to warn the user about attached projections before calling
    this endpoint; once the port is gone, the projections will appear as
    dangling per #186's rendering.
    """
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    try:
        updated_source = apply_port_remove(
            request.file_path,
            request.var_name,
            request.port_kind,
            request.current_names,
            request.port_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    model = load_and_introspect(request.file_path)
    layout = load_layout(request.file_path)
    return LoadModelResponse(model=_attach_dangling(model, updated_source), source=updated_source, layout=layout)


class PreviewSourceRequest(BaseModel):
    file_path: str
    source: str


class PreviewSourceResponse(BaseModel):
    model: dict
    source: str
    # Where the buffer was actually executed from. The client passes this back
    # as the target for run/learn/show-graph while its edits are unsaved, so
    # what you run is what you are looking at.
    preview_path: str


@router.post("/model/preview", response_model=PreviewSourceResponse)
def preview_source_endpoint(request: PreviewSourceRequest):
    """Introspect unsaved editor content without touching the user's file (#1029).

    The canvas is built by executing a model file, so previewing edits means
    writing them somewhere first — just not over ``file_path``. The source goes
    to a private preview file and that is what gets executed.

    Deliberately does not return layout or labels: sidecars belong to the real
    model and are already loaded: a preview changes the code, never where the
    nodes sit.
    """
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    preview = write_preview(request.file_path, request.source)

    try:
        model = load_and_introspect(str(preview))
    except Exception as e:
        # Invalid code is the normal state of a file being typed into, not an
        # error worth failing the request over. Report it the way save-source
        # does so the editor can surface it without losing the buffer.
        return PreviewSourceResponse(
            model=_attach_dangling(
                {"compositions": [], "lineMap": {}, "error": str(e)}, request.source
            ),
            source=request.source,
            preview_path=str(preview),
        )

    return PreviewSourceResponse(
        model=_attach_dangling(model, request.source),
        source=request.source,
        preview_path=str(preview),
    )


@router.post("/model/save-source", response_model=LoadModelResponse)
def save_source_endpoint(request: SaveSourceRequest):
    """Save edited source from the code editor, then re-introspect."""
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    # Refuse to overwrite work that arrived after we loaded (#926).
    #
    # Live sync (#1026) catches most of this by telling the editor as soon as
    # the file changes, but it is a notification, not a guarantee: the watcher
    # may not be running, the socket may have dropped, the backend may have
    # restarted, or the machine may have slept through the change. This is the
    # check that does not depend on having been told.
    #
    # Compared as text rather than by hash because writes here are verbatim —
    # `write_model_source` does not normalise — so equality is exact and there
    # is no digest to agree on across two languages.
    if request.base_source is not None:
        on_disk = path.read_text()
        if on_disk != request.base_source:
            try:
                disk_model = load_and_introspect(str(path))
            except Exception as e:
                disk_model = {"compositions": [], "lineMap": {}, "error": str(e)}
            raise HTTPException(
                status_code=409,
                detail={
                    "reason": "stale_buffer",
                    "message": (
                        "This file changed on disk since it was opened here. "
                        "Saving now would discard that change."
                    ),
                    "file_path": str(path),
                    "disk_source": on_disk,
                    "disk_model": _attach_dangling(disk_model, on_disk),
                },
            )

    save_source(request.file_path, request.source)
    # The buffer and the file now agree, so any preview of it is stale.
    clear_preview(request.file_path)

    try:
        model = load_and_introspect(request.file_path)
    except Exception as e:
        # If the code is invalid, still save but return error in model.
        # Still surface dangling-projection info so the validation surface
        # can light up even when the file doesn't exec.
        return LoadModelResponse(
            model=_attach_dangling(
                {"compositions": [], "lineMap": {}, "error": str(e)},
                request.source,
            ),
            source=request.source,
        )

    layout = load_layout(request.file_path)
    return LoadModelResponse(model=_attach_dangling(model, request.source), source=request.source, layout=layout)


class RunModelRequest(BaseModel):
    file_path: str
    composition_name: str
    inputs: dict  # {var_name: [[trial1_values], [trial2_values], ...]}
    execution_mode: str | None = None  # Python | PyTorch | LLVM (#764); None → default
    log_nodes: list[str] | None = None  # #768: value-log only these nodes; None → all


class InputNodesRequest(BaseModel):
    file_path: str
    composition_name: str


@router.post("/model/input-nodes")
async def input_nodes(request: InputNodesRequest):
    """Get the input nodes and their expected shapes for a composition."""
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    result = get_input_nodes(request.file_path, request.composition_name)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/model/run")
async def run_model_endpoint(request: RunModelRequest):
    """Run a composition with provided inputs and return results."""
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    t0 = time.time()
    result = run_model(
        request.file_path,
        request.composition_name,
        request.inputs,
        execution_mode=request.execution_mode,
        log_nodes=request.log_nodes,
    )
    if "error" in result:
        # #1101: when the worker also emitted warnings, carry them next to the
        # error instead of folding them into the message. detail stays a plain
        # string when there are none, so every existing caller is unaffected;
        # only the run panel knows how to read the richer shape.
        if result.get("warnings"):
            raise HTTPException(status_code=400, detail={
                "message": result["error"],
                "warnings": result["warnings"],
                "warnings_suppressed": result.get("warnings_suppressed", 0),
            })
        raise HTTPException(status_code=400, detail=result["error"])
    # #894: server-side run time, so the client can show "ran in X.Xs" from the
    # real execution duration (not just the network round-trip).
    result["timings"] = {"run_ms": round((time.time() - t0) * 1000)}
    # #1101: a successful run can still have something to say. Split into what
    # PsyNeuLink addressed to the modeller and what libraries said about
    # themselves, so the Run panel can show the former and merely count the
    # latter.
    captured = result.pop("captured_warnings", None)
    if captured:
        shown, others = split_model_warnings(classify_model_warnings(captured))
        if shown or others:
            result["model_warnings"] = {"shown": shown, "others": others}
    return result


class LearnModelRequest(BaseModel):
    file_path: str
    composition_name: str
    inputs: dict  # {var_name: [[trial1_values], [trial2_values], ...]}
    # {output_var_name: [[trial1_values], ...]} — same trial count. Empty for a
    # composition that learns without targets (Hebbian, #997).
    targets: dict = {}
    epochs: int = 10
    learning_rate: float | None = None
    execution_mode: str | None = None  # Python | PyTorch | LLVM (#537); None → default


@router.post("/model/learn")
async def learn_model_endpoint(request: LearnModelRequest):
    """Train a learning-capable composition with supervised targets (#534, L1)."""
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    result = learn_model(
        request.file_path,
        request.composition_name,
        request.inputs,
        request.targets,
        epochs=request.epochs,
        learning_rate=request.learning_rate,
        execution_mode=request.execution_mode,
    )
    if "error" in result:
        # 422 distinguishes "this model can't learn" from bad request data,
        # so the frontend can surface a capability explanation (#475 pattern).
        status = 422 if result.get("notLearnable") else 400
        raise HTTPException(status_code=status, detail=result["error"])
    return result


class CreateJobRequest(BaseModel):
    kind: str  # "learn" today; "fit" arrives with F2 (#539)
    file_path: str
    composition_name: str
    inputs: dict
    targets: dict = {}  # empty for a model that learns without targets (#997)
    epochs: int = 10
    learning_rate: float | None = None
    execution_mode: str | None = None  # Python | PyTorch | LLVM (#537); None → default


@router.post("/jobs")
async def create_job(request: CreateJobRequest):
    """Submit an async model-execution job (#535, L2). One at a time."""
    if request.kind != "learn":
        raise HTTPException(status_code=400, detail=f"Unknown job kind: {request.kind}")
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    execution_mode = request.execution_mode or DEFAULT_LEARN_MODE
    config = {
        "kind": request.kind,
        "compositionName": request.composition_name,
        "epochs": request.epochs,
        "learningRate": request.learning_rate,
        # User-selected backend (#537). The worker falls back to the
        # composition's own learnable backend if the requested mode can't
        # train, and reports the effective mode in result (and, once done,
        # in provenance.effectiveExecutionMode, #997).
        "executionMode": execution_mode,
    }
    provenance = build_provenance(request.file_path, config)
    task_params = {
        "file_path": request.file_path,
        "composition_name": request.composition_name,
        "inputs": request.inputs,
        "targets": request.targets,
        "epochs": request.epochs,
        "learning_rate": request.learning_rate,
        # The raw request, not the defaulted one: an omitted mode resolves per
        # composition in the worker (PyTorch for autodiff, Python for a
        # learning-pathway Composition, #997), and defaulting it to PyTorch
        # here would make every plain Composition report a spurious fallback.
        "execution_mode": request.execution_mode,
        "stream_progress": True,
    }
    job, active = job_manager.submit(request.kind, "learn", task_params, config, provenance)
    if job is None:
        raise HTTPException(
            status_code=409,
            detail=f"Job {active.id} is already {active.status}; one job at a time.",
        )
    return job.snapshot()


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    """Polling fallback: full job snapshot including progress so far."""
    job = job_manager.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job: {job_id}")
    return job.snapshot()


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str):
    """SSE stream of job progress; replays history, ends on the terminal event."""
    job = job_manager.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job: {job_id}")

    live_queue, replay = job.subscribe()

    def gen():
        import queue as queue_mod
        try:
            for ev in replay:
                yield f"data: {json_mod.dumps(ev)}\n\n"
                if ev["type"] != "progress":
                    return
            while live_queue is not None:
                try:
                    ev = live_queue.get(timeout=15)
                except queue_mod.Empty:
                    yield ": keep-alive\n\n"
                    continue
                yield f"data: {json_mod.dumps(ev)}\n\n"
                if ev["type"] != "progress":
                    return
        finally:
            if live_queue is not None:
                job.unsubscribe(live_queue)

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.delete("/jobs/{job_id}")
async def cancel_job(job_id: str):
    """Cancel a queued/running job (kills its worker process)."""
    job = job_manager.cancel(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job: {job_id}")
    return job.snapshot()


class ShowGraphRequest(BaseModel):
    file_path: str
    composition_name: str
    options: dict = {}
    # "svg" renders the picture (needs the Graphviz programs on the machine);
    # "dot" returns show_graph's Graphviz description unrendered, which the
    # page lays out itself for the "Like show_graph" layout (#19).
    format: str = "svg"


@router.post("/model/show-graph")
def show_graph(request: ShowGraphRequest):
    """Render a composition using PsyNeuLink's built-in show_graph().

    Returns the graph as an SVG string. This is a dev/debug endpoint for
    comparing PsyNeuLink's native visualization with the React Flow graph.
    """
    from app.services import show_graph_cache
    from app.services.sandbox import run_in_sandbox

    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    # An unchanged model gives the same answer; skip reloading it (#22).
    key = show_graph_cache.cache_key(
        request.file_path, request.composition_name, request.options, request.format,
    )
    result = show_graph_cache.get(key) if key is not None else None
    if result is None:
        result = run_in_sandbox("show_graph", {
            "file_path": request.file_path,
            "composition_name": request.composition_name,
            "options": request.options,
            "format": request.format,
        })
        if key is not None:
            show_graph_cache.put(key, result)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/model/undo-star-convert")
def undo_star_convert(request: LoadModelRequest):
    """Restore the original file from before star import conversion."""
    path = Path(request.file_path)
    backup = artifact_path(path.with_suffix(".star_import_original.py"))
    if not backup.exists():
        raise HTTPException(status_code=404, detail="No star import backup found")
    shutil.copy2(backup, path)
    backup.unlink()
    source = path.read_text()
    model = load_and_introspect(str(path))
    layout = load_layout(str(path))
    return LoadModelResponse(model=_attach_dangling(model, source), source=source, layout=layout)


class SaveLayoutRequest(BaseModel):
    file_path: str
    # Nested (per-composition) view positions. Omitted on a flat-view save.
    positions: dict | None = None
    viewport: dict | None = None
    # Optional named variant (#479/#483); None addresses the default sidecar.
    variant: str | None = None
    # Flat / PyTorch (clustered) view positions, kept in a separate namespace
    # so frame-relative coords don't collide with nested positions (#719).
    flatPositions: dict | None = None
    # #282: dragged-port angular overrides, keyed by node varName → {port: angle}.
    portPositions: dict | None = None
    # #1162: hand-shaped edge routing, keyed by endpoint rather than projection
    # name. Same nested/flat split as positions.
    edgeRoutes: dict | None = None
    flatEdgeRoutes: dict | None = None
    # #1387: per-node value display, keyed by node name → {as, width}.
    valueViews: dict | None = None


@router.post("/model/save-layout")
async def save_layout_endpoint(request: SaveLayoutRequest):
    """Save node positions and viewport to the sidecar .pnlview.json file."""
    save_layout(
        request.file_path,
        request.positions,
        request.viewport,
        request.variant,
        flat_positions=request.flatPositions,
        port_positions=request.portPositions,
        edge_routes=request.edgeRoutes,
        flat_edge_routes=request.flatEdgeRoutes,
        value_views=request.valueViews,
    )
    return {"status": "ok"}


def _pnl_version() -> str:
    try:
        import psyneulink as pnl
        return pnl.__version__
    except ImportError:
        return "unknown"


@router.post("/model/export-project")
async def export_project(request: LoadModelRequest):
    """Export a model as a .pnlproject bundle (download).

    Builds a v2 bundle: manifest + model.py + layout.json (if saved) + an MDF
    (YAML) mirror when the model serializes cleanly. See ``bundle.py`` and
    ``docs/file-handling.md`` for the spec.
    """
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    model_name = path.stem
    mdf_text, _ = _try_mdf_mirror(str(path))
    data, _ = bundle.build_bundle_bytes(
        str(path),
        model_name=model_name,
        pnl_version=_pnl_version(),
        mdf_text=mdf_text,
    )

    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{model_name}.pnlproject"',
        },
    )


class ExportMdfRequest(BaseModel):
    file_path: str
    composition_name: str | None = None
    fmt: str = "yaml"  # "yaml" or "json"; YAML preferred for human readability


def _generate_mdf_text(
    file_path: str, fmt: str = "yaml", composition_name: str | None = None
) -> str:
    """Render a model's Composition to MDF text (YAML or JSON), with any saved
    layout bridged into PsyNeuView metadata so positions round-trip (#86).

    Shared by the MDF download endpoint and the ``.pnlproject`` MDF mirror.
    Raises ``ValueError`` (with a user-facing message) on any failure.
    """
    from app.services.sandbox import run_in_sandbox

    comp_name = composition_name
    if not comp_name:
        introspected = load_and_introspect(file_path)
        comps = introspected.get("compositions", [])
        if not comps:
            raise ValueError("No Composition found in this model — nothing to export.")
        comp_name = comps[0].get("varName") or comps[0].get("name")
        if not comp_name:
            raise ValueError("Could not determine the Composition name to export.")

    result = run_in_sandbox("export_mdf", {
        "file_path": file_path,
        "composition_name": comp_name,
        "fmt": fmt,
    })
    if "error" in result:
        raise ValueError(result["error"])

    text = result["text"]

    # Bridge any saved layout sidecar (.pnlview.json) into MDF metadata so
    # PsyNeuView-origin exports round-trip back with positions intact (#86).
    # Done in-process (not in the sandbox) since metadata injection is pure
    # text manipulation and the sandbox doesn't have ``app`` on its path.
    from app.services.mdf_metadata import (
        build_psyneuview_metadata,
        inject_psyneuview_metadata,
    )
    pv_block = build_psyneuview_metadata(load_layout(file_path))
    if pv_block:
        text = inject_psyneuview_metadata(text, fmt, pv_block)
    return text


def _try_mdf_mirror(file_path: str) -> tuple[str | None, str | None]:
    """Best-effort MDF (YAML) mirror for a bundle. Returns ``(text, warning)``;
    on any failure (e.g. GraphStructureConditions, PsyNeuLink#7) returns
    ``(None, message)`` so the bundle is still written without the mirror."""
    try:
        return _generate_mdf_text(file_path, fmt="yaml"), None
    except Exception as e:  # noqa: BLE001 — surface as a soft warning, never fail the save
        return None, str(e)


@router.post("/model/export-mdf")
async def export_mdf(request: ExportMdfRequest):
    """Export a Composition as MDF (JSON or YAML).

    Delegates to the sandbox worker, which calls
    ``psyneulink.core.globals.mdf.get_mdf_serialized``. If
    ``composition_name`` is omitted, picks the first top-level Composition
    in the introspected model.
    """
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    fmt = request.fmt.lower()
    if fmt == "yml":
        fmt = "yaml"
    if fmt not in ("yaml", "json"):
        raise HTTPException(status_code=400, detail=f"Unsupported MDF format: {request.fmt!r}. Use 'yaml' or 'json'.")

    try:
        text = _generate_mdf_text(str(path), fmt=fmt, composition_name=request.composition_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    extension = ".mdf.yaml" if fmt == "yaml" else ".mdf.json"
    media_type = "application/x-yaml" if fmt == "yaml" else "application/json"
    filename = f"{path.stem}{extension}"

    return StreamingResponse(
        io.BytesIO(text.encode("utf-8")),
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


class MdfGapsRequest(BaseModel):
    file_path: str
    composition_name: str | None = None


@router.post("/model/mdf-gaps")
def mdf_gaps(request: MdfGapsRequest):
    """The known MDF round-trip gaps in a model, for the export dialog to warn
    about before an MDF copy is written (#83, #84, #85, #87).

    Each gap: ``issue``, ``upstream`` (link or null), ``severity``
    ("warning" or "info"), ``title``, ``detail`` and the ``items`` it found.
    Checked on the live Composition in the sandbox, like the export itself.
    """
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    from app.services.sandbox import run_in_sandbox

    comp_name = request.composition_name
    if not comp_name:
        comps = load_and_introspect(str(path)).get("compositions", [])
        if not comps:
            return {"gaps": []}
        comp_name = comps[0].get("varName") or comps[0].get("name")
    result = run_in_sandbox("mdf_gaps", {"file_path": str(path), "composition_name": comp_name})
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"gaps": result.get("gaps", [])}


class SaveCopyRequest(BaseModel):
    """Write a copy of the model *on the server*, in any supported format.

    The download endpoints (``export-project`` / ``export-mdf``) stream bytes to
    the browser; this writes the same bytes to the server's models directory.
    Before #1067 only ``.py`` could be written server-side and only the other
    formats could be downloaded, so "where does this go" was decided by which
    format you picked and never stated. Both axes are now independent.
    """

    file_path: str
    fmt: Literal["py", "pnlproject", "mdf-yaml", "mdf-json"]
    file_name: str
    directory: Optional[str] = None
    # Editor buffer for ``py``. Matches /models/save-as: a copy saves what you
    # are looking at, not what was last written to disk.
    source: Optional[str] = None
    overwrite: bool = False


class SaveCopyResponse(BaseModel):
    file_path: str


_SAVE_COPY_SUFFIX = {
    "py": ".py",
    "pnlproject": ".pnlproject",
    "mdf-yaml": ".mdf.yaml",
    "mdf-json": ".mdf.json",
}


@router.post("/model/save-copy", response_model=SaveCopyResponse)
def save_copy(request: SaveCopyRequest):
    """Write a copy of the model on the server in the requested format."""
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    target_dir = Path(request.directory) if request.directory else get_default_save_dir()
    target_dir.mkdir(parents=True, exist_ok=True)

    suffix = _SAVE_COPY_SUFFIX[request.fmt]
    name = request.file_name.strip()
    if not name.endswith(suffix):
        name += suffix
    target = target_dir / name
    # A .py copy brings the model's sidecars with it (#1244); a bundle carries
    # them inside, and MDF has none.
    copies = _plan_sidecar_copy(str(path), target) if request.fmt == "py" else []
    _refuse_unless_overwrite(target, copies, request.overwrite)
    pnl_source_guard.guard_write(target)

    if request.fmt == "py":
        if request.source is None:
            raise HTTPException(status_code=400, detail="Saving .py requires `source`.")
        # A copy starts unprotected (#1346): a "# PsyNeuView: protected" line
        # is about the original, not a copy made to work on.
        target.write_text(protection_line.strip_from_source(request.source))
        sidecar_copy.apply(copies, path, target)
    elif request.fmt == "pnlproject":
        mdf_text, _ = _try_mdf_mirror(str(path))
        data, _ = bundle.build_bundle_bytes(
            str(path),
            model_name=path.stem,
            pnl_version=_pnl_version(),
            mdf_text=mdf_text,
        )
        target.write_bytes(data)
    else:
        fmt = "yaml" if request.fmt == "mdf-yaml" else "json"
        try:
            text = _generate_mdf_text(str(path), fmt=fmt)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        target.write_text(text)

    return SaveCopyResponse(file_path=str(target))


@router.post("/model/import-project")
async def import_project(file: UploadFile = File(...)):
    """Import a .pnlproject bundle.

    Extracts the model source and layout, saves to the models directory,
    and returns the loaded model.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    content = await file.read()

    classification = classify_upload(file.filename, content)
    if classification.file_type is not FileType.PNLPROJECT:
        detail = classification.error or (
            f"This endpoint accepts .pnlproject bundles. Detected type: "
            f"{classification.file_type.value}."
        )
        raise HTTPException(status_code=400, detail=detail)

    try:
        with zipfile.ZipFile(io.BytesIO(content), "r") as zf:
            # Read manifest
            if "manifest.json" not in zf.namelist():
                raise HTTPException(status_code=400, detail="Invalid .pnlproject: missing manifest.json")
            manifest = json_mod.loads(zf.read("manifest.json"))

            # Read source
            source_name = manifest.get("files", {}).get("source", "model.py")
            if source_name not in zf.namelist():
                raise HTTPException(status_code=400, detail=f"Invalid .pnlproject: missing {source_name}")
            source = zf.read(source_name).decode("utf-8")

            # Read layout (optional)
            layout_name = manifest.get("files", {}).get("layout")
            layout_data = None
            if layout_name and layout_name in zf.namelist():
                layout_data = json_mod.loads(zf.read(layout_name))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid .pnlproject: not a valid zip file")

    # Save to models directory
    model_name = manifest.get("model", {}).get("name", "imported_model")
    save_dir = get_default_save_dir()
    save_dir.mkdir(parents=True, exist_ok=True)

    target = save_dir / f"{model_name}.py"
    # If file exists, append a number
    counter = 1
    while target.exists():
        target = save_dir / f"{model_name}_{counter}.py"
        counter += 1

    target.write_text(source)

    # Save layout if present
    if layout_data:
        save_layout(str(target), layout_data.get("positions", {}), layout_data.get("viewport"))

    # Introspect the saved file
    model = load_and_introspect(str(target))
    layout = load_layout(str(target))

    return {
        "model": model,
        "source": source,
        "file_path": str(target),
        "layout": layout,
        "projectName": model_name,
        "formatVersion": manifest.get("formatVersion"),
    }


class OpenProjectRequest(BaseModel):
    bundle_path: str


@router.post("/model/open-project")
def open_project(request: OpenProjectRequest):
    """Open a local ``.pnlproject`` *in place* for editing (#348).

    Unlike ``/model/import-project`` (which ingests an upload into the models
    dir), this extracts a bundle that already lives on disk into a stable
    working directory and returns its origin path, so a later Save re-zips
    back into the same bundle.
    """
    bundle_path = Path(request.bundle_path)
    if not bundle_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {bundle_path}")

    classification = classify_file(str(bundle_path))
    if classification.file_type is not FileType.PNLPROJECT:
        raise HTTPException(
            status_code=400,
            detail=classification.error
            or f"Not a .pnlproject bundle: {bundle_path.name}",
        )

    try:
        extracted = bundle.extract_bundle(str(bundle_path))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid .pnlproject: {e}")

    working_py = extracted["working_py_path"]
    manifest = extracted["manifest"]
    model = load_and_introspect(working_py)
    layout = load_layout(working_py)

    return {
        "model": _attach_dangling(model, extracted["source"]),
        "source": extracted["source"],
        "file_path": working_py,
        "layout": layout,
        "projectName": manifest.get("model", {}).get("name") or bundle_path.stem,
        "formatVersion": manifest.get("formatVersion"),
        "bundleOrigin": str(bundle_path),
    }


class SaveProjectRequest(BaseModel):
    file_path: str  # the working .py extracted from the bundle
    source: str
    bundle_path: str  # the origin .pnlproject to re-zip into


@router.post("/model/save-project")
def save_project(request: SaveProjectRequest):
    """Save an edited bundle: write the working ``.py`` and re-zip it (plus
    its layout sidecar and a refreshed MDF mirror) back into the origin
    ``.pnlproject`` (#348). The MDF mirror is best-effort — a model that
    can't serialize (e.g. GraphStructureConditions) still saves, sans mirror.
    """
    working = Path(request.file_path)
    if not working.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {working}")

    save_source(request.file_path, request.source)

    # Preserve created/description/name from the bundle's prior manifest.
    prior = bundle.working_manifest(request.file_path) or {}
    model_name = (prior.get("model", {}) or {}).get("name") or working.stem
    description = (prior.get("model", {}) or {}).get("description", "")
    created = prior.get("created")

    mdf_text, mdf_warning = _try_mdf_mirror(request.file_path)
    new_manifest = bundle.write_bundle(
        request.bundle_path,
        request.file_path,
        model_name=model_name,
        pnl_version=_pnl_version(),
        mdf_text=mdf_text,
        description=description,
        created=created,
    )
    # Refresh the cached working manifest so subsequent saves stay consistent.
    (working.parent / "manifest.json").write_text(json_mod.dumps(new_manifest, indent=2))

    try:
        model = load_and_introspect(request.file_path)
    except Exception as e:
        return {
            "model": _attach_dangling(
                {"compositions": [], "lineMap": {}, "error": str(e)},
                request.source,
            ),
            "source": request.source,
            "bundleOrigin": request.bundle_path,
            "mdfWarning": mdf_warning,
        }

    layout = load_layout(request.file_path)
    return {
        "model": _attach_dangling(model, request.source),
        "source": request.source,
        "layout": layout,
        "bundleOrigin": request.bundle_path,
        "mdfWarning": mdf_warning,
    }


@router.post("/model/import-mdf")
async def import_mdf(file: UploadFile = File(...)):
    """Import an MDF (ModECI Model Description Format) file.

    Accepts ``.mdf.json`` / ``.mdf.yaml`` / ``.mdf.yml`` (canonical) or bare
    ``.json`` / ``.yaml`` / ``.yml`` whose content is valid MDF. The file is
    classified, parsed via ``modeci_mdf``, converted to a PsyNeuLink Python
    script via ``generate_script_from_mdf``, saved to the default models
    directory, then introspected like ``/model/load``.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    content = await file.read()

    # Pre-flight nested-Composition detection (#82): PsyNeuLink's MDF
    # round-trip doesn't support nested Compositions — export serializes the
    # inner Composition as a graph node with a non-standard nested ``nodes``
    # dict, which ``modeci_mdf`` can't even parse (so classification rejects
    # the file before ``generate_script_from_mdf`` would crash on it).
    # Detect the signature with a raw parse, before classification, so the
    # failure gets an actionable message instead of a generic parse error.
    from app.services.mdf_metadata import detect_nested_compositions, detect_shared_nodes

    _lower_name = file.filename.lower()
    nested_comp_nodes = detect_nested_compositions(
        content.decode("utf-8", errors="replace"),
        "json" if _lower_name.endswith(".json") else "yaml",
    )

    def _nested_unsupported(reason: str) -> HTTPException:
        return HTTPException(
            status_code=400,
            detail=(
                f"This MDF file contains nested Composition(s) "
                f"({', '.join(nested_comp_nodes)}), which PsyNeuLink's MDF "
                f"round-trip does not yet support — {reason}. See "
                f"https://github.com/jonhanke-nam/PsyNeuLink/issues/3 for "
                f"status."
            ),
        )

    classification = classify_upload(file.filename, content)
    if classification.file_type not in (FileType.MDF_JSON, FileType.MDF_YAML):
        if nested_comp_nodes:
            raise _nested_unsupported(
                "the nested structure is not valid MDF, so the file cannot "
                "be parsed"
            )
        detail = classification.error or (
            f"This endpoint accepts MDF files. Detected type: "
            f"{classification.file_type.value}."
        )
        raise HTTPException(status_code=400, detail=detail)

    # Persist the uploaded MDF to a temp file so modeci_mdf can read by path
    # (it auto-detects format from extension).
    import tempfile
    suffix = ".json" if classification.file_type is FileType.MDF_JSON else ".yaml"
    with tempfile.NamedTemporaryFile(prefix="psyneuview_mdf_", suffix=suffix, delete=False) as tf:
        tmp_path = Path(tf.name)
        tf.write(content)

    try:
        from psyneulink.core.globals.mdf import generate_script_from_mdf

        # generate_script_from_mdf accepts a path, JSON string, or YAML string
        # (see PsyNeuLink source: it tries load_mdf(path) first, then JSON, then
        # writes to temp and loads as YAML). The Model-object signature in its
        # docstring is misleading. Pass the path we just wrote.
        try:
            script_source = generate_script_from_mdf(str(tmp_path))
        except Exception as e:
            if nested_comp_nodes:
                raise _nested_unsupported(
                    f"the importer crashed while reading them "
                    f"(underlying error: {e})"
                )
            raise HTTPException(status_code=400, detail=f"Failed to generate PsyNeuLink script from MDF: {e}")
        if not script_source or not script_source.strip():
            raise HTTPException(
                status_code=400,
                detail=(
                    "MDF parsed but produced no PsyNeuLink script. The file may "
                    "contain a bare Graph rather than a Model, or no recognized "
                    "compositions."
                ),
            )
    finally:
        try:
            tmp_path.unlink()
        except OSError:
            pass

    if nested_comp_nodes:
        classification.warnings.append(
            f"MDF import: file contains nested Composition(s) "
            f"({', '.join(nested_comp_nodes)}). PsyNeuLink's MDF round-trip "
            f"does not yet support nesting — inner nodes and boundary "
            f"projections may be missing from the imported model. See "
            f"https://github.com/jonhanke-nam/PsyNeuLink/issues/3."
        )

    shared_nodes = detect_shared_nodes(
        content.decode("utf-8", errors="replace"),
        "json" if _lower_name.endswith(".json") else "yaml",
    )
    if shared_nodes:
        classification.warnings.append(
            f"MDF import: {', '.join(shared_nodes)} "
            f"{'appears' if len(shared_nodes) == 1 else 'appear'} in more than one "
            f"Composition. The imported model creates a separate copy in each, "
            f"so they no longer share it (state, learned weights). See "
            f"https://github.com/jonhanke-nam/PsyNeuLink/issues/4."
        )

    # Save as a .py file alongside other imported models.
    model_name = Path(file.filename).name
    # Strip recognized MDF suffixes to derive a clean stem.
    for ext in (".mdf.json", ".mdf.yaml", ".mdf.yml", ".json", ".yaml", ".yml"):
        if model_name.lower().endswith(ext):
            model_name = model_name[: -len(ext)]
            break
    if not model_name:
        model_name = "imported_mdf_model"

    save_dir = get_default_save_dir()
    save_dir.mkdir(parents=True, exist_ok=True)
    target = save_dir / f"{model_name}.py"
    counter = 1
    while target.exists():
        target = save_dir / f"{model_name}_{counter}.py"
        counter += 1
    target.write_text(script_source)

    # Auto-apply Standard format on MDF import (#94 task 1). The Python that
    # ``generate_script_from_mdf`` produces is functionally correct but
    # noisy (every kwarg spelled out at default, generated Function names,
    # etc.). Running it through ``convert_to_standard_format`` rewrites the
    # file from the live introspected objects, producing a much cleaner
    # source. Falls back to FREE-FORM with a warning on failure.
    auto_standardized = False
    try:
        script_source = convert_to_standard_format(str(target), backup=False)
        auto_standardized = True
    except Exception as e:
        classification.warnings.append(
            f"MDF import: auto-conversion to Standard format failed "
            f"({e!s}); loaded as FREE-FORM. Use Convert to Standard "
            f"Format manually if needed."
        )

    # If the uploaded MDF carries a PsyNeuView-origin metadata block (#86),
    # extract it now; we'll persist a sidecar after introspection so we can
    # remap the original keys onto whatever live names PsyNeuLink assigned.
    # Foreign MDF (no namespace, or unknown version) → no sidecar → Dagre.
    from app.services.mdf_metadata import (
        extract_psyneuview_metadata,
        remap_layout_to_live_names,
    )
    pv_meta = extract_psyneuview_metadata(
        content.decode("utf-8"),
        "yaml" if classification.file_type is FileType.MDF_YAML else "json",
    )

    try:
        model = load_and_introspect(str(target))
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"MDF imported and saved to {target.name}, but introspection failed: {e}",
        )

    # Now that we know the live node names, remap sidecar keys. PsyNeuLink
    # appends a session suffix (``color_input`` → ``color_input_1``) on
    # MDF re-instantiation, so sidecar keys from the source model don't
    # match the imported model's live names without remapping. (#86, #94)
    if pv_meta and pv_meta.get("layout"):
        live_names = []
        for comp in (model.get("compositions") or []):
            for n in comp.get("nodes", []):
                name = n.get("varName") or n.get("name")
                if name:
                    live_names.append(name)
        remapped = remap_layout_to_live_names(pv_meta["layout"], live_names)
        if remapped:
            save_layout(
                str(target),
                positions=remapped,
                viewport=pv_meta.get("viewport"),
            )
    layout = load_layout(str(target))

    return {
        "model": model,
        "source": script_source,
        "file_path": str(target),
        "layout": layout,
        "projectName": model_name,
        "warnings": classification.warnings,
        "sourceFormat": classification.file_type.value,
        "isStandardized": auto_standardized,
    }


class StructuralChangeRequest(BaseModel):
    file_path: str
    changes: dict  # {action, var_name, type?, params?, sender?, receiver?, composition?}


@router.post("/model/structural-change", response_model=LoadModelResponse)
def structural_change(request: StructuralChangeRequest):
    """Apply a structural change (add/remove node/projection), then re-introspect."""
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    # #1116: enforced here, not in the UI. Hiding buttons is a hint; this is
    # the lock. A locked model refuses every structural change whatever asked
    # for it — the canvas, a shortcut, or a direct call to the API.
    # #1346: where the file lives outranks the lock, so a model in a protected
    # checkout is refused for the checkout (the app answers 409
    # ``psyneulink_source_protected``) before the lock is asked.
    pnl_source_guard.guard_write(request.file_path)
    # #1346 part 2: the model's own rules come next, strictest first — a
    # "# PsyNeuView: protected permanently" line, then "protected" (unless
    # unlocked on this computer), then the lock. The refusal goes through the
    # app's ModelIsViewOnly handler: 409 with the rule's own reason.
    edit_lock.guard(request.file_path)

    try:
        updated_source = apply_structural_change(request.file_path, request.changes)
    except (ValueError, NotImplementedError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        model = load_and_introspect(request.file_path)
    except Exception as e:
        return LoadModelResponse(
            model=_attach_dangling(
                {"compositions": [], "lineMap": {}, "error": str(e)},
                updated_source,
            ),
            source=updated_source,
        )

    layout = load_layout(request.file_path)
    return LoadModelResponse(model=_attach_dangling(model, updated_source), source=updated_source, layout=layout)


class ConvertRequest(BaseModel):
    file_path: str
    backup: bool = True


@router.post("/model/convert", response_model=LoadModelResponse)
def convert_model(request: ConvertRequest):
    """Convert a free-form .py file to standardized format."""
    path = Path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    # Converting rewrites the whole file, so the same rules as any edit apply
    # (#1346): where it lives, then the protection line, then the lock.
    guard_edit(path)

    try:
        new_source = convert_to_standard_format(request.file_path, request.backup)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Conversion failed: {e}")

    model = load_and_introspect(request.file_path)
    layout = load_layout(request.file_path)
    return LoadModelResponse(
        model=_attach_dangling(model, new_source),
        source=new_source,
        layout=layout,
        isStandardized=True,
        formatIssues=[],
    )


# --- Demo models ---

DEMOS_DIR = Path(__file__).resolve().parent.parent.parent / "demos"


def _demo_working_dir() -> Path:
    """Where the working copy of an included model goes: a Demo (reset on
    every open), a Reference Model, or a PsyNeuLink Example from a managed
    install. One answer for all three (#1319): ``PSYNEWVIEW_WORKING_DIR``
    when set (the e2e harness), otherwise ``~/.psyneuview/working-copies``
    — a per-user folder outside every install, so edits survive an app
    update. It used to be ``backend/`` itself; working copies left there are
    moved on startup (``working_copies.migrate_legacy_working_copies``).
    """
    return working_copies.working_copies_dir()


@router.get("/demos")
async def list_demos():
    """List available demo models."""
    if not DEMOS_DIR.exists():
        return {"demos": []}
    demos = []
    for f in sorted(DEMOS_DIR.glob("*.py")):
        demos.append({
            "name": f.stem,
            "label": _format_label(f.stem),
            "pristine_path": str(f),
        })
    return {"demos": demos}


class ResetDemoRequest(BaseModel):
    demo_name: str


@router.post("/demos/reset", response_model=LoadModelResponse)
def reset_demo(request: ResetDemoRequest):
    """Reset a demo model to its pristine state."""
    pristine = DEMOS_DIR / f"{request.demo_name}.py"
    if not pristine.exists():
        raise HTTPException(status_code=404, detail=f"Demo not found: {request.demo_name}")

    # Working copy lives in the configured working dir (default: backend/).
    working = _demo_working_dir() / f"{request.demo_name}.py"
    shutil.copy2(pristine, working)

    # Stamp the sidecar with demo_origin so the "Reset to Demo" affordance
    # survives close-and-reopen of the working file (issue #40). This also
    # resets any prior layout — only the origin pointer carries forward.
    stamp_demo_origin(str(working), request.demo_name)

    source = working.read_text()
    t0 = time.time()
    model = load_and_introspect(str(working))
    introspect_ms = (time.time() - t0) * 1000
    layout = load_layout(str(working))
    return LoadModelResponse(
        model=_attach_dangling(model, source),
        source=source,
        layout=layout,
        file_path=str(working),
        timings=_load_timings(introspect_ms, t0),
    )


class DemoPristineResponse(BaseModel):
    source: str


@router.get("/demos/pristine", response_model=DemoPristineResponse)
async def demo_pristine_source(name: str):
    """Return the pristine source for a demo without touching the working copy.

    Used by the frontend on file load: when a sidecar carries demo_origin,
    the dialog needs the pristine source to drive the modified-vs-original
    check that gates the "Reset to Demo" button.
    """
    pristine = DEMOS_DIR / f"{name}.py"
    if not pristine.exists():
        raise HTTPException(status_code=404, detail=f"Demo not found: {name}")
    return DemoPristineResponse(source=pristine.read_text())


# --- Reference models (#321 ego, #322 stroop) ---
#
# A small, distinguished set of known reference models kept easily
# accessible at the top of the Load Model dropdown for testing and
# debugging. Bundled as pristine copies so they stay stable regardless of
# which PsyNeuLink source/branch is pinned. Loading copies the pristine
# file into the working dir (like /demos/reset) so debugging edits never
# mutate the bundled originals.

REFERENCE_DIR = Path(__file__).resolve().parent.parent.parent / "reference_models"

# Curated, ordered. `name` is the bundled filename stem; `label` is shown.
REFERENCE_MODELS = [
    {"name": "Giallanza2024_ego_study2", "label": "EGO — Giallanza et al. 2024 (Study 2)"},
    {"name": "stroop_reference_basic", "label": "Stroop — Basic"},
    {"name": "stroop_reference_with_lc", "label": "Stroop — with Locus Coeruleus (LC)"},
    {"name": "Cohen_Huston1994", "label": "Stroop — Bidirectional (Cohen & Huston 1994)"},
    {"name": "Cohen_Huston1994_horse_race", "label": "Stroop — Horse Race (Cohen & Huston 1994)"},
    {"name": "Kalanthroff_PCTC_2018", "label": "Stroop — PCTC (Kalanthroff, Davelaar & Usher 2018)"},
    {"name": "GilzenratModel", "label": "Locus Coeruleus — gain model (Gilzenrat et al.)"},
    {"name": "Nieuwenhuis2005Model", "label": "Locus Coeruleus / P300 (Nieuwenhuis et al. 2005)"},
    {"name": "MontagueDayanSejnowski96", "label": "TD Learning / dopamine (Montague, Dayan & Sejnowski 1996)"},
    {"name": "Botvinick_conflict_monitoring_model", "label": "Conflict Monitoring — Stroop (Botvinick et al. 2001)"},
]


@router.get("/reference-models")
async def list_reference_models():
    """List bundled reference models that are present on disk."""
    models = []
    for entry in REFERENCE_MODELS:
        path = REFERENCE_DIR / f"{entry['name']}.py"
        if path.exists():
            models.append({
                "name": entry["name"],
                "label": entry["label"],
                "pristine_path": str(path),
            })
    return {"models": models}


class LoadReferenceRequest(BaseModel):
    name: str
    # #1010: opt in to discarding working-copy edits and reloading the bundled
    # source. Reopening never does this on its own — losing work has to be
    # asked for, not inferred.
    restore_pristine: bool = False


@router.post("/reference-models/load", response_model=LoadModelResponse)
def load_reference_model(request: LoadReferenceRequest):
    """Load a bundled reference model into a fresh working copy."""
    if not any(e["name"] == request.name for e in REFERENCE_MODELS):
        raise HTTPException(status_code=404, detail=f"Unknown reference model: {request.name}")
    pristine = REFERENCE_DIR / f"{request.name}.py"
    if not pristine.exists():
        raise HTTPException(status_code=404, detail=f"Reference model not found: {request.name}")

    # #1010: reopening is a re-read. Overwriting the working copy silently
    # destroyed any edits made to a reference model — the one place a user
    # could lose work without being asked. The bundled model itself is never
    # written (REFERENCE_DIR is read-only), so the only thing at risk is the
    # user's own copy.
    #
    # Copy when there is nothing to lose: no working copy, or one identical to
    # the bundle. Otherwise keep the edits and report the divergence so the UI
    # can offer the choice — restoring is opt-in via `restore_pristine`.
    # #1416: a working copy made under a model's old name is adopted first.
    working_copies.adopt_renamed_working_copy(request.name, _demo_working_dir())
    working = _demo_working_dir() / f"{request.name}.py"
    pristine_text = pristine.read_text()
    had_edits = working.exists() and working.read_text() != pristine_text
    restored = bool(had_edits and request.restore_pristine)
    if not had_edits or restored:
        shutil.copy2(pristine, working)

    # Seed the sidecar bundle — labels/layout plus any named variants and the
    # layout index (.psyneuview.json) — so the working copy reproduces the
    # curated GUI state (named layouts + active selection), not just the single
    # default layout (#399, #408, #483). The reference stem matches between
    # pristine and working, so basenames carry over unchanged.
    #
    # #1008: seed only what is ABSENT. This used to copy unconditionally, which
    # made the curated layout an override re-applied on every open rather than a
    # default — reopening a model threw away whatever the user had arranged.
    # Reopening is a re-read, not a re-seed.
    #
    # Copying only the missing files is also the whole layout waterfall:
    #
    #   user layout present   -> left alone            (tier 1)
    #   absent, curated ships -> seeded from reference (tier 2)
    #   neither               -> no sidecar, auto      (tier 3)
    #
    # It fixes the quieter half too: a working copy created before a curated
    # layout existed never received it, because the copy was tied to the load
    # rather than to the file being missing.
    _bundle_suffixes = (LAYOUT_SUFFIX, SETTINGS_SUFFIX, INDEX_SUFFIX)
    for sidecar in REFERENCE_DIR.glob(f"{request.name}.*"):
        if not sidecar.name.endswith(_bundle_suffixes):
            continue
        dest = working.with_name(sidecar.name)
        if dest.exists():
            continue
        shutil.copy2(sidecar, dest)

    source = working.read_text()
    t0 = time.time()
    model = load_and_introspect(str(working))
    introspect_ms = (time.time() - t0) * 1000
    # Open in the active layout/settings variant the index designates (mirrors
    # /model/load); with no index the active names resolve to "Default".
    sidecars = list_sidecars(str(working))
    layout = load_layout(str(working), sidecars["activeLayout"])
    labels = load_labels(str(working), sidecars["activeSetting"])
    bundle = [{"kind": "source", "name": working.name}]
    _labels_sidecar = labels_path(str(working))
    if _labels_sidecar.exists():
        bundle.append({"kind": "labels", "name": _labels_sidecar.name})
    _layout_sidecar = sidecar_path(str(working))
    if _layout_sidecar.exists():
        bundle.append({"kind": "layout", "name": _layout_sidecar.name})
    return LoadModelResponse(
        model=_attach_dangling(model, source),
        source=source,
        layout=layout,
        labels=labels,
        bundle=bundle,
        sidecars=sidecars,
        workingCopy={
            # True when the file still carries edits after this load — i.e. the
            # user's version was kept. False after a restore, or when it never
            # diverged.
            "diverged": bool(had_edits and not restored),
            "restored": restored,
        },
        file_path=str(working),
        timings=_load_timings(introspect_ms, t0),
    )


# --- PsyNeuLink examples (live, from the active source's Scripts/) — #843 ---

def _pnl_scripts_dir() -> Path | None:
    """The active PsyNeuLink source's ``Scripts/Examples`` dir, or None.

    Read live from whichever PsyNeuLink is selected, via the installed
    distribution rather than the cached import (#1225).
    Returns None when the active PsyNeuLink is a pip-installed package (which
    ships no ``Scripts/``) rather than a full repo checkout.
    """
    pkg = active_psyneulink_package_dir()
    if pkg is None:
        return None
    d = pkg.parent / "Scripts" / "Examples"
    return d if d.is_dir() else None


def _inject_live_lineage(model, src: Path, scripts_dir: Path) -> None:
    """Attach synthesized lineage for a live PsyNeuLink example (#835/#843).

    A raw upstream file has no vendored-provenance header, but a live example's
    lineage is exact: the active source's file at the active commit. Fills
    ``diagnostics.lineage`` (same shape as ``lineage.parse_lineage``) so the
    Inspector shows precisely which code is running.
    """
    if not isinstance(model, dict) or not isinstance(model.get("diagnostics"), dict):
        return
    try:
        info = (get_settings_info() or {}).get("psyneulink", {})
    except Exception:
        info = {}
    repo = info.get("repo")
    commit = info.get("commit")
    root = scripts_dir.parent.parent  # scripts_dir = <source root>/Scripts/Examples
    try:
        source_path = str(src.resolve().relative_to(root.resolve()))
    except Exception:
        source_path = f"Scripts/Examples/{src.name}"
    url = None
    if repo and commit:
        from urllib.parse import quote
        url = f"https://github.com/{repo}/blob/{commit}/{quote(source_path)}"
    model["diagnostics"]["lineage"] = {
        "repo": repo,
        "sourcePath": source_path,
        "commit": commit,
        "commitTag": info.get("version"),
        "vendoredDate": None,
        "refs": [],
        "url": url,
    }


@router.get("/psyneulink-examples")
async def list_psyneulink_examples():
    """List PsyNeuLink's own example models, live from the active source (#843).

    Read verbatim from the selected PsyNeuLink's ``Scripts/Examples`` — not
    copied — so they stay in sync with whichever source is active. Returns
    ``available: False`` when the active PsyNeuLink has no ``Scripts/`` (e.g. a
    pip install), so the UI can hide or annotate the section.
    """
    d = _pnl_scripts_dir()
    if d is None:
        return {"models": [], "available": False}
    models = [
        {"name": path.stem, "label": _format_label(path.stem), "path": str(path)}
        for path in sorted(d.glob("*.py"))
        if not path.stem.startswith("__")
    ]
    return {"models": models, "available": True, "sourceDir": str(d)}


# Per-source-commit cache of the (expensive) load probe. The corpus is the live
# source's Scripts/Examples, which only changes when the source does.
_examples_status_cache: dict[str, dict] = {}


@router.get("/psyneulink-examples/status")
def psyneulink_examples_status():
    """Per-example load + run status for the live section (#843/#839).

    Probes each ``Scripts/Examples`` model with the app's introspector (load) and,
    for those that load, runs it once with zero inputs (run). Cached by the active
    source commit — the first call probes every model (this now includes a run
    pass, so it takes longer), later calls are instant until the source changes.
    Sync def so FastAPI threadpools it rather than blocking the event loop.

    A *run* failure often just means the model needs real inputs — the reason is
    carried in ``runError`` for the tooltip — so the UI downgrades it to "loads",
    not "fails". Only a *load* failure is a hard "fails".
    """
    d = _pnl_scripts_dir()
    if d is None:
        return {"status": {}, "available": False}
    commit = ((get_settings_info() or {}).get("psyneulink", {}) or {}).get("commit") or "unknown"
    if commit in _examples_status_cache:
        return {"status": _examples_status_cache[commit], "available": True, "cached": True}

    status: dict[str, dict] = {}
    for path in sorted(d.glob("*.py")):
        if path.stem.startswith("__"):
            continue
        p = str(path)
        try:
            r = load_and_introspect(p, use_sandbox=True)
            err = r.get("error") if isinstance(r, dict) else None
            comps = (r.get("compositions") or []) if isinstance(r, dict) else []
            nodes = len(comps[0].get("nodes", [])) if comps else 0
            if err:
                status[path.stem] = {"load": "fail", "error": str(err).splitlines()[0][:160]}
                continue
            if nodes == 0:
                status[path.stem] = {"load": "fail", "error": "loaded but no nodes (construction failed)"}
                continue
            entry: dict = {"load": "ok", "nodes": nodes}
            # Run pass: run once with zero inputs via the app's run path.
            try:
                comp_var = comps[0].get("varName")
                info = get_input_nodes(p, comp_var, use_sandbox=True)
                inputs = {
                    n["varName"]: [[0.0] * ((n.get("shape") or [1])[-1] or 1)]
                    for n in (info.get("inputNodes") or [])
                }
                rr = run_model(p, comp_var, inputs, use_sandbox=True)
                if isinstance(rr, dict) and not rr.get("error"):
                    entry["run"] = "ok"
                else:
                    entry["run"] = "fail"
                    entry["runError"] = str((rr or {}).get("error", "run failed")).splitlines()[0][:160]
            except Exception as e:  # noqa: BLE001 - run failure downgrades to "loads"
                entry["run"] = "fail"
                entry["runError"] = str(e).splitlines()[0][:160]
            status[path.stem] = entry
        except Exception as e:  # noqa: BLE001 - report any probe failure as fail
            status[path.stem] = {"load": "fail", "error": str(e).splitlines()[0][:160]}

    _examples_status_cache[commit] = status
    return {"status": status, "available": True, "cached": False}


class LoadPnlExampleRequest(BaseModel):
    name: str


@router.post("/psyneulink-examples/load", response_model=LoadModelResponse)
def load_psyneulink_example(request: LoadPnlExampleRequest):
    """Load a live PsyNeuLink example (#843).

    From GitHub or PyPI it's copied into a fresh working copy, so edits never
    mutate a source PsyNeuView promises matches upstream. From the user's own
    local checkout it opens in place (#1225): the checkout's edit policy then
    applies — editable unless they protected it (#1305) — and changes land in
    their repo.
    """
    d = _pnl_scripts_dir()
    if d is None:
        raise HTTPException(status_code=404, detail="No PsyNeuLink Scripts/ in the active source")
    src = d / f"{request.name}.py"
    # Guard against path traversal via a crafted name.
    if not src.resolve().is_relative_to(d.resolve()) or not src.exists():
        raise HTTPException(status_code=404, detail=f"Unknown PsyNeuLink example: {request.name}")

    if pnl_source_guard.active_kind() == "local":
        working = src
    else:
        working = _demo_working_dir() / src.name
        shutil.copy2(src, working)
    source = working.read_text()
    t0 = time.time()
    model = load_and_introspect(str(working))
    introspect_ms = (time.time() - t0) * 1000

    # Synthesize lineage (#835/#843): a raw upstream file carries no vendored-
    # provenance header, but a live example's lineage is exactly knowable — it IS
    # the active source's file at the active commit. Inject it so the Inspector
    # shows precisely which code is running.
    _inject_live_lineage(model, src, d)

    sidecars = list_sidecars(str(working))
    layout = load_layout(str(working), sidecars["activeLayout"])
    labels = load_labels(str(working), sidecars["activeSetting"])
    return LoadModelResponse(
        model=_attach_dangling(model, source),
        source=source,
        layout=layout,
        labels=labels,
        bundle=[{"kind": "source", "name": working.name}],
        sidecars=sidecars,
        file_path=str(working),
        timings=_load_timings(introspect_ms, t0),
    )


# --- PsyNeuLink library models (#20) ---

# The full psyneulink/library/models/ package. All introspect cleanly from the
# live source: 7 assign a Composition at module scope; EGO (Giallanza2024) uses
# the newer construct_model() factory convention, which the loader now
# materializes (#855) so it loads directly like the rest — no maintained copy.
LIBRARY_MODEL_NAMES = [
    "Botvinick_conflict_monitoring_model",
    "Cohen_Huston1994",
    "Cohen_Huston1994_horse_race",
    "Giallanza2024_EGO_Study2",
    "GilzenratModel",
    "Kalanthroff_PCTC_2018",
    "MontagueDayanSejnowski96",
    "Nieuwenhuis2005Model",
]


def _library_models_dir() -> Path | None:
    pkg = active_psyneulink_package_dir()
    if pkg is None:
        return None
    d = pkg / "library" / "models"
    return d if d.is_dir() else None


@router.get("/library-models")
async def list_library_models():
    """List PsyNeuLink library models that load cleanly (issue #20)."""
    models_dir = _library_models_dir()
    if models_dir is None:
        return {"models": []}
    models = []
    for name, path in library_model_files(models_dir):
        models.append({
            "name": name,
            "label": _format_label(name),
            "path": str(path),
        })
    return {"models": models}


def library_model_files(models_dir: Path) -> list[tuple[str, Path]]:
    """Each known library model with the path of its file as it really is (#1254).

    Matched by name regardless of case, and returned with the name on disk.
    A Mac checkout made before PsyNeuLink renamed a file can still hold the old
    case (``Giallanza2024_ego_study2.py``): git doesn't apply a case-only rename
    on a case-insensitive filesystem. ``(models_dir / "Giallanza2024_EGO_Study2.py")
    .exists()`` is still true there, so the old code offered a path in the wrong
    case. The file opened, but the watchers compare names exactly, so an outside
    edit missed the open-file watcher and went the slow way, through a runner
    restart.
    """
    on_disk = {p.name.lower(): p for p in models_dir.glob("*.py")}
    found = []
    for name in LIBRARY_MODEL_NAMES:
        path = on_disk.get(f"{name}.py".lower())
        if path is not None:
            found.append((name, path))
    return found


def _pnl_clone_git() -> dict | None:
    """Git provenance of the active PsyNeuLink source clone — repo, branch, short
    commit, and how many commits behind its origin ref — for the library/examples
    catalog tooltips (#853).

    Cheap and network-free: ``behind`` is measured against the *last-fetched*
    ``origin/<branch>`` ref (clone_manager fetches on source re-select), NOT a live
    remote check — so it flags staleness as of the last sync, not this instant.
    Returns ``None`` when PsyNeuLink isn't an editable git clone (e.g. a pip wheel).
    """
    import subprocess
    from app.services.settings_info import _probe_local_clone

    pkg = active_psyneulink_package_dir()
    if pkg is None:
        return None
    root = pkg.parent
    info = _probe_local_clone(root)
    if not info:
        return None
    branch = info.get("branch")
    behind = None
    if branch:
        try:
            out = (
                subprocess.check_output(
                    ["git", "rev-list", "--count", f"HEAD..origin/{branch}"],
                    cwd=str(root),
                    stdin=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=2,
                )
                .decode()
                .strip()
            )
            behind = int(out) if out.isdigit() else None
        except (OSError, subprocess.SubprocessError, ValueError):
            behind = None
    return {
        "repo": info.get("repo"),
        "branch": branch,
        "commit": info.get("commit"),
        "behind": behind,
    }


@router.get("/catalog-sources")
def catalog_sources():
    """Resolved on-disk source directory for each Open-menu catalog.

    NOTE: sync ``def`` (not ``async``) on purpose — it shells out to ``git`` via
    ``_pnl_clone_git`` / ``_probe_local_clone``, so FastAPI must run it in a
    threadpool rather than block the event loop (which froze the whole backend and
    hung every catalog fetch — the same reason ``/settings/info`` is sync).

    Powers the catalog header tooltips so each section's provenance is exact.
    Values are absolute paths, or ``None`` when unavailable (e.g. a pip-installed
    PsyNeuLink ships no ``Scripts/`` for the live examples). ``pnlGit`` carries the
    active PsyNeuLink clone's branch/commit/behind for the two PsyNeuLink-sourced
    catalogs (library, examples), so the tooltip shows both *where* and *how fresh*.
    """
    lib = _library_models_dir()
    examples = _pnl_scripts_dir()
    return {
        "references": str(REFERENCE_DIR),
        "demos": str(DEMOS_DIR),
        "library": str(lib) if lib else None,
        "examples": str(examples) if examples else None,
        "myModels": str(get_default_save_dir()),
        "pnlGit": _pnl_clone_git(),
        # Which PsyNeuLink the Library, Examples and Tests come from, so each
        # Open-menu section can say so on its heading (#1295). The same answer
        # as /settings/info, fetched here because the menu refetches this after
        # a source switch.
        "pnl": get_psyneulink_info(),
    }


# --- User models ---

@router.get("/models")
async def list_user_models():
    """List all .py models from configured model directories."""
    return {"models": list_models()}


@router.get("/models/browse")
async def browse_models(path: str):
    """Browse a directory for folders and .py files."""
    return browse_directory(path)


@router.get("/models/dirs")
async def model_directories():
    """Return configured model directories."""
    from app.services.model_dirs import get_model_dirs
    dirs = [{"path": str(d), "exists": d.exists()} for d in get_model_dirs()]
    return {"directories": dirs, "default_save_dir": str(get_default_save_dir())}


# --- Open-menu catalogs and the project folder (#1229) ---

class AddCatalogRequest(BaseModel):
    path: str
    name: str | None = None


class RenameCatalogRequest(BaseModel):
    name: str


class ProjectFolderRequest(BaseModel):
    path: str


def _catalog_call(fn, *args):
    from app.services.catalogs import CatalogError
    try:
        return fn(*args)
    except CatalogError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/catalogs")
def get_catalogs():
    """The project folder and the user's own catalogs, with their models.

    The project folder also carries the one-time offer to move it out of a
    hidden legacy folder, and the record of the last move (#1295).
    """
    from app.services import catalogs, project_folder
    listing = catalogs.list_catalogs()
    listing["projectFolder"]["moveOffer"] = project_folder.move_offer()
    listing["projectFolder"]["lastMove"] = project_folder.last_move()
    return listing


@router.post("/catalogs/project-folder/move")
def move_project_folder(request: ProjectFolderRequest):
    """Move My Project Folder — models, sidecars and all — to another folder
    (#1295). Nothing is deleted until the copy is verified; a failure leaves
    the old folder and the setting as they were. 400 with the reason when it
    can't be done, including the colliding names of a non-empty destination.
    """
    from app.services import project_folder
    try:
        return project_folder.move_project_folder(request.path)
    except project_folder.MoveError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/catalogs/project-folder/move-offer/dismiss")
def dismiss_project_folder_move_offer():
    """"Not now" on the one-time offer; it isn't made again."""
    from app.services import project_folder
    project_folder.dismiss_move_offer()
    return {"dismissed": True}


# --- Where things live (#1295) ---

@router.get("/locations")
def get_locations():
    """Every folder and source PsyNeuView uses, for Settings' "Where things
    live": the PsyNeuView and PsyNeuLink in use, the project folder, the
    catalogs, the app-data folders, the managed PsyNeuLink copies (with a
    bounded size on disk and when each was last used) and the checkouts
    PsyNeuView knows. Sync: it probes git and walks folders."""
    from app.services import locations
    return locations.list_locations()


@router.delete(
    "/locations/managed-copies/{name}",
    dependencies=[Depends(_check_install_enabled)],
)
def remove_managed_copy(name: str):
    """Delete one managed PsyNeuLink copy under the sources folder — a folder
    PsyNeuView created. Refused for the copy in use and for anything outside
    that folder. Gated like install: it changes what PsyNeuLink can be
    switched to without a network fetch."""
    from app.services import locations
    try:
        return {"removed": locations.remove_managed_copy(name)}
    except locations.LocationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/catalogs")
def add_catalog(request: AddCatalogRequest):
    from app.services import catalogs
    return _catalog_call(catalogs.add_catalog, request.path, request.name)


@router.patch("/catalogs/{catalog_id}")
def rename_catalog(catalog_id: str, request: RenameCatalogRequest):
    from app.services import catalogs
    return _catalog_call(catalogs.rename_catalog, catalog_id, request.name)


@router.delete("/catalogs/{catalog_id}")
def remove_catalog(catalog_id: str):
    """Off the menu only; the folder and its files are left alone."""
    from app.services import catalogs
    _catalog_call(catalogs.remove_catalog, catalog_id)
    return {"removed": catalog_id}


@router.post("/catalogs/project-folder")
def set_project_folder(request: ProjectFolderRequest):
    from app.services import catalogs
    return {"path": _catalog_call(catalogs.set_project_folder, request.path)}


class SaveAsRequest(BaseModel):
    source: str
    file_name: str
    directory: str | None = None  # defaults to first model dir
    overwrite: bool = False  # allow replacing an existing target (#301)
    # See LoadModelRequest.developer_mode (#273 / #249). The dev-tests
    # loader posts save-as with developer_mode=True so the post-save
    # introspection actually executes the test's .run/.learn calls.
    developer_mode: bool = False
    # The model being copied (#1244). Its layout, labels and index come along
    # to the copy; omitted (a brand-new file, the dev-tests loader, an
    # import) there is nothing to carry.
    source_path: str | None = None


class SaveAsResponse(BaseModel):
    model: dict
    source: str
    file_path: str
    # The copy's sidecars, as /model/load returns them, so the client opens
    # the copy looking like the original (#1244).
    layout: dict | None = None
    labels: dict | None = None
    bundle: list[dict] = []
    sidecars: dict | None = None


def _existing_targets_detail(existing: list[Path]) -> str:
    """The 409 wording for a copy that would replace what is there: names
    the files, so the confirmation says what an overwrite touches."""
    names = ", ".join(p.name for p in existing)
    if len(existing) == 1:
        return f"File already exists: {names}"
    return f"Files already exist: {names}"


def _plan_sidecar_copy(source_path: str | None, target: Path) -> list[sidecar_copy.SidecarCopy]:
    """The sidecars that come with a copy of ``source_path`` written at
    ``target`` (#1244), or none when there is no original to copy from."""
    if not source_path:
        return []
    src = Path(source_path)
    if not src.is_file():
        return []
    return sidecar_copy.plan(src, target)


def _refuse_unless_overwrite(target: Path, copies: list[sidecar_copy.SidecarCopy], overwrite: bool) -> None:
    """409 before anything is written when the ``.py`` or any of the copy's
    sidecars already exists at the destination, unless the caller confirmed
    the overwrite — one confirmation covers the model and its files alike."""
    existing = ([target] if target.exists() else []) + sidecar_copy.existing_targets(copies)
    if existing and not overwrite:
        raise HTTPException(status_code=409, detail=_existing_targets_detail(existing))


@router.post("/models/save-as", response_model=SaveAsResponse)
def save_as(request: SaveAsRequest):
    """Save source code as a new model file — with the original's layout,
    labels and index when ``source_path`` names it (#1244)."""
    # Determine target directory
    if request.directory:
        target_dir = Path(request.directory)
    else:
        target_dir = get_default_save_dir()

    target_dir.mkdir(parents=True, exist_ok=True)

    # Sanitize filename
    name = request.file_name.strip()
    if not name.endswith(".py"):
        name += ".py"

    target = target_dir / name
    copies = _plan_sidecar_copy(request.source_path, target)
    _refuse_unless_overwrite(target, copies, request.overwrite)
    pnl_source_guard.guard_write(target)

    # A copy of a model starts unprotected (#1346), as it starts unlocked: a
    # "# PsyNeuView: protected" line is about the original. A brand-new file
    # (no source_path) is written exactly as given.
    source = protection_line.strip_from_source(request.source) if request.source_path else request.source
    target.write_text(source)
    sidecar_copy.apply(copies, request.source_path or target, target)
    layout, labels, bundle, sidecars = _sidecar_payload(target)

    try:
        model = load_and_introspect(str(target), developer_mode=request.developer_mode)
    except Exception as e:
        model = {"compositions": [], "lineMap": {}, "error": str(e)}

    return SaveAsResponse(
        model=model,
        source=source,
        file_path=str(target),
        layout=layout,
        labels=labels,
        bundle=bundle,
        sidecars=sidecars,
    )


# --- Developer-mode pytest test loading (#249 / #274) ---


class DevTestRef(BaseModel):
    file: str           # absolute path to the source test_*.py
    class_name: str | None
    method_name: str
    qualified_name: str  # "Class.method" or "method"


class DiscoverTestsResponse(BaseModel):
    tests: list[DevTestRef]
    source_tree: str | None  # path used for discovery, or None if unavailable


class ExtractTestRequest(BaseModel):
    file: str            # absolute path returned from /dev/tests
    qualified_name: str  # "Class.method" or "method"


class ExtractTestResponse(BaseModel):
    content: str
    suggested_filename: str  # e.g. "test_emcomposition__test_simple_execution_without_learning.py"


def _pnl_source_tree() -> Path | None:
    """Locate a PsyNeuLink source tree (one with ``tests/composition/``) for
    test discovery. Resolution order:

    1. ``PSYNEUVIEW_PNL_TESTS_ROOT`` env var (explicit override — used by devs
       who want to point at a specific checkout).
    2. ``~/.psyneuview/sources/PsyNeuLink-{owner}/`` where ``{owner}`` comes
       from ``PSYNEUVIEW_PNL_REPO`` (set by the Mac app for GitHub installs);
       defaults to ``PrincetonUniversity`` when the env var is absent.
    3. The active install's source root, for editable installs that
       have tests next to the package.

    Returns ``None`` when none of the above yields a directory with
    ``tests/composition/`` — typical for wheel installs without the Mac app.
    Phase 5 of #249 will fetch tests from GitHub in that case.
    """
    def has_tests(root: Path) -> bool:
        return (root / "tests" / "composition").is_dir()

    env_override = os.environ.get("PSYNEUVIEW_PNL_TESTS_ROOT")
    if env_override:
        root = Path(env_override).expanduser()
        if has_tests(root):
            return root

    repo_slug = os.environ.get("PSYNEUVIEW_PNL_REPO", "PrincetonUniversity/PsyNeuLink")
    owner = repo_slug.split("/")[0] if "/" in repo_slug else "PrincetonUniversity"
    cached = Path.home() / ".psyneuview" / "sources" / f"PsyNeuLink-{owner}"
    if has_tests(cached):
        return cached

    pkg = active_psyneulink_package_dir()
    if pkg is None:
        return None
    return pkg.parent if has_tests(pkg.parent) else None


@router.get("/dev/tests", response_model=DiscoverTestsResponse)
async def discover_dev_tests():
    """List every pytest ``test_*`` method/function discovered under the
    installed PsyNeuLink's ``tests/composition/`` directory.

    Returns ``tests: []`` (and ``source_tree: null``) if the installed PNL
    is a wheel install with no tests on disk. Phase 5 (#249) will fetch
    tests from GitHub in that case.
    """
    from app.services.test_extractor import discover_tests

    source_tree = _pnl_source_tree()
    if source_tree is None:
        return DiscoverTestsResponse(tests=[], source_tree=None)

    try:
        refs = discover_tests(source_tree)
    except FileNotFoundError:
        return DiscoverTestsResponse(tests=[], source_tree=str(source_tree))

    return DiscoverTestsResponse(
        tests=[
            DevTestRef(
                file=str(r.file),
                class_name=r.class_name,
                method_name=r.method_name,
                qualified_name=r.qualified_name,
            )
            for r in refs
        ],
        source_tree=str(source_tree),
    )


@router.post("/dev/extract-test", response_model=ExtractTestResponse)
async def extract_dev_test(request: ExtractTestRequest):
    """Run the AST extractor against ``(file, qualified_name)`` and return
    the standalone .py contents. Frontend opens this as an in-memory model —
    no disk write happens here (Phase 3 v1 keeps extracted files session-only,
    matching the GitHub-loader pattern from #258)."""
    from app.services.test_extractor import ExtractionError, extract_test

    source_path = Path(request.file)
    if not source_path.is_file():
        raise HTTPException(
            status_code=404,
            detail={"reason": "not_found", "message": f"source file not found: {source_path}"},
        )

    try:
        content = extract_test(source_path, request.qualified_name)
    except ExtractionError as e:
        raise HTTPException(
            status_code=422,
            detail={"reason": "unextractable", "message": str(e)},
        )

    safe_method = request.qualified_name.replace(".", "__")
    suggested = f"{source_path.stem}__{safe_method}.py"
    return ExtractTestResponse(content=content, suggested_filename=suggested)


class PnlSourceStatusRequest(BaseModel):
    file_path: str


class PnlSourceProtectRequest(BaseModel):
    file_path: str
    protect: bool = True


@router.post("/model/pnl-source")
def pnl_source_status(request: PnlSourceStatusRequest):
    """Whether ``file_path`` is a file of the active PsyNeuLink, and if it is,
    whether PsyNeuView may edit it (#1225). ``owned`` false: an ordinary file."""
    owned = pnl_source_guard.ownership(request.file_path)
    return {"owned": owned is not None, **(owned or {})}


@router.post("/model/pnl-source/protect")
def pnl_source_protect(request: PnlSourceProtectRequest):
    """Protect from edits (``protect`` true) or allow edits in (false) the local
    PsyNeuLink checkout owning ``file_path`` (#1305). A checkout is editable by
    default; GitHub and PyPI installs are always protected and can't be changed."""
    try:
        owned = pnl_source_guard.set_checkout_protected(request.file_path, request.protect)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"owned": True, **owned}
