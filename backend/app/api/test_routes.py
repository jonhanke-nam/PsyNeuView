"""Test-only endpoints for the Playwright E2E harness (#147).

Mounted by app.main only when PSYNEWVIEW_TEST_MODE=1. Never include in
production builds — the reset endpoint is destructive (it wipes the
working dir and restarts the warm worker).
"""

import json
import logging
import os
import shutil
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)

router = APIRouter()


class ModelsDirRequest(BaseModel):
    path: str | None = None


@router.post("/test/models-dir")
async def set_models_dir_for_test(request: ModelsDirRequest) -> dict:
    """Set or clear ``PSYNEWVIEW_MODELS_DIR`` in the running backend (#1295).

    The harness fixes the project folder through that variable, and while it
    is set the folder can't be moved — by design. A spec about moving it
    clears the variable here, works through the preferences file (which the
    harness already redirects to its temp dir), and puts it back in its
    ``finally``. Test mode only, like everything in this file.
    """
    from app.services.model_dirs import MODELS_DIR_ENV

    previous = os.environ.get(MODELS_DIR_ENV)
    if request.path:
        os.environ[MODELS_DIR_ENV] = request.path
    else:
        os.environ.pop(MODELS_DIR_ENV, None)
    return {"previous": previous, "current": os.environ.get(MODELS_DIR_ENV)}


class PnlInstallRequest(BaseModel):
    kind: Optional[Literal["local", "github", "pypi"]] = None
    root: Optional[str] = None


class _FakePnlDistribution:
    """The installed psyneulink's metadata, with its origin replaced (#1305).

    Only ``direct_url.json`` and where the package directory is are faked;
    everything else (the version, other metadata files) is the real
    distribution's, so the model runner keeps importing the real PsyNeuLink.
    The shapes match what pip writes: a local checkout is an editable install
    from ``file://<root>``; a GitHub install is ``git+https://github.com/…``
    with the package under ``<root>/psyneulink``; a PyPI install has no
    ``direct_url.json`` at all.
    """

    def __init__(self, kind: str, root: Path, real):
        self._root = root
        self._real = real
        self.version = getattr(real, "version", "0.0.0")
        if kind == "local":
            self._direct_url = {"url": "file://" + str(root), "dir_info": {"editable": True}}
        elif kind == "github":
            self._direct_url = {
                "url": "https://github.com/PrincetonUniversity/PsyNeuLink.git",
                "vcs_info": {"vcs": "git", "requested_revision": "devel", "commit_id": "0000000"},
            }
        else:
            self._direct_url = None

    def read_text(self, name):
        if name == "direct_url.json":
            return json.dumps(self._direct_url) if self._direct_url is not None else None
        return self._real.read_text(name)

    def locate_file(self, rel):
        return self._root / rel

    def __getattr__(self, attr):
        return getattr(self._real, attr)


_real_distribution = None


def _restore_pnl_install() -> None:
    from app.services import settings_info

    global _real_distribution
    if _real_distribution is not None:
        settings_info.distribution = _real_distribution
        _real_distribution = None


@router.post("/test/pnl-install")
async def set_pnl_install_for_test(request: PnlInstallRequest) -> dict:
    """Make the backend treat ``root`` as the active PsyNeuLink of ``kind`` (#1305).

    "Which PsyNeuLink is active" is read from the installed distribution's
    metadata, which the harness can't point elsewhere. A spec about editing
    PsyNeuLink's own files builds a temporary checkout tree
    (``<root>/psyneulink/library/models/…``) and declares it here as a local
    checkout, a managed GitHub install, or a PyPI release; ``kind`` null puts
    the real metadata back (a spec does that in its ``finally``, and
    ``/test/reset`` does it too). Test mode only, like everything in this file.
    """
    from app.services import settings_info

    global _real_distribution
    if request.kind is None:
        _restore_pnl_install()
        return {"kind": None, "root": None}
    if not request.root:
        raise HTTPException(status_code=400, detail="root is required with a kind")
    root = Path(request.root).expanduser().resolve()
    if not root.is_dir():
        raise HTTPException(status_code=400, detail=f"root is not a folder: {root}")
    if _real_distribution is None:
        _real_distribution = settings_info.distribution
    real = _real_distribution
    fake = _FakePnlDistribution(request.kind, root, real("psyneulink"))
    settings_info.distribution = lambda name: fake if name == "psyneulink" else real(name)
    return {"kind": request.kind, "root": str(root)}


@router.post("/test/reset")
async def reset_for_test() -> dict:
    """Reset backend state between mutating E2E tests.

    Restarts the warm worker (clears any PsyNeuLink state accumulated by
    previous task runs) and empties the configured working dir so demo
    working copies and their sidecars don't leak across tests.

    Read-only tests can skip this for speed — see the readOnlyTest
    fixture in frontend/e2e/test-base.ts.
    """
    from app.services import sandbox

    cleared: list[str] = []
    working_env = os.environ.get("PSYNEWVIEW_WORKING_DIR")
    if working_env:
        working = Path(working_env).expanduser().resolve()
        if working.exists():
            for entry in working.iterdir():
                try:
                    if entry.is_file() or entry.is_symlink():
                        entry.unlink()
                    elif entry.is_dir():
                        shutil.rmtree(entry)
                    cleared.append(entry.name)
                except OSError as e:
                    logger.warning("test/reset: failed to remove %s: %s", entry, e)
        working.mkdir(parents=True, exist_ok=True)

    # Layouts written for read-only PsyNeuLink files (#1321) are keyed by
    # source and path, not by install, so one spec's lock on a stand-in
    # library model would be the next spec's. The harness points the folder
    # at a temp dir; empty it the same way as the working copies.
    layouts_env = os.environ.get("PSYNEUVIEW_LAYOUTS_DIR")
    if layouts_env:
        layouts = Path(layouts_env).expanduser().resolve()
        if layouts.exists():
            for entry in layouts.iterdir():
                try:
                    if entry.is_file() or entry.is_symlink():
                        entry.unlink()
                    elif entry.is_dir():
                        shutil.rmtree(entry)
                    cleared.append(f"layouts/{entry.name}")
                except OSError as e:
                    logger.warning("test/reset: failed to remove %s: %s", entry, e)

    # A faked PsyNeuLink install (#1305) must not outlive the spec that set it.
    _restore_pnl_install()

    # Off the event loop: the restart waits for any in-flight task to finish
    # and then for the new worker's handshake, and this is an async route.
    await run_in_threadpool(sandbox.restart_warm_worker)

    return {"cleared": cleared, "worker_restarted": True}
