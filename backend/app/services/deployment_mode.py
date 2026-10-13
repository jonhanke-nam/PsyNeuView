"""What kind of deployment this process is — declared, not inferred (#1062).

Privileged endpoints used to decide whether they were allowed by asking
whether the client address was loopback::

    _LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}

That is a sound proxy for "trusted local" on a laptop. It stops being one the
moment the app runs in a container:

  * **Apptainer reached over an SSH tunnel** — the normal HPC access pattern —
    presents a *loopback* client for a *remote* user, against a read-only
    squashfs venv. The install endpoints would be offered and would then fail
    partway through a pip run.
  * **A reverse proxy on the same host** presents loopback for every visitor.

So the deployment declares itself instead, via ``PSYNEUVIEW_DEPLOYMENT_MODE``:

  * ``local`` — a developer's machine, ``make start``. The default when the
    variable is unset, so existing installs are unaffected.
  * ``mac_app`` — launched by PsyNeuView-MacApp. Source switching belongs to
    the app's ``Cmd+,`` Preferences, not the web panel.
  * ``container`` — one user, one process, in a container on a shared host
    (Docker or Apptainer). Read-only image; no pip, no host filesystem, no
    inherited GitHub credentials.
  * ``hosted`` — the multi-tenant service (#1058). Not implemented yet; the
    mode exists so capabilities can be declared against it rather than
    discovered later.

Capabilities derive from the mode here rather than being re-decided ad hoc at
each call site. Loopback is still consulted *in addition* for install, so a
``local`` backend bound to ``0.0.0.0`` doesn't hand pip to the network — but it
can no longer *grant* anything on its own.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Literal

logger = logging.getLogger(__name__)

_MODE_ENV = "PSYNEUVIEW_DEPLOYMENT_MODE"

# Deprecated predecessor. PsyNeuView-MacApp does not actually set this today —
# the shipped app leaves it unset, so the Mac-app branch it guarded has never
# fired in production. Honored anyway so anything that *does* set it keeps
# working; the app should move to PSYNEUVIEW_DEPLOYMENT_MODE=mac_app.
_LEGACY_MAC_APP_ENV = "PSYNEUVIEW_MAC_APP"

Mode = Literal["local", "mac_app", "container", "hosted"]

LOCAL: Mode = "local"
MAC_APP: Mode = "mac_app"
CONTAINER: Mode = "container"
HOSTED: Mode = "hosted"

VALID_MODES: tuple[Mode, ...] = (LOCAL, MAC_APP, CONTAINER, HOSTED)

#: Modes that are not a single trusted user on their own machine. Used by
#: callers that need the coarse distinction rather than the full table.
REMOTE_MODES: tuple[Mode, ...] = (CONTAINER, HOSTED)


@dataclass(frozen=True)
class Capabilities:
    """What a deployment mode is allowed to do.

    Declarative on purpose: adding a mode means adding a row below, not
    hunting for the checks that need a new branch.
    """

    #: Switch the installed PsyNeuLink (pip install into the backend venv).
    #: Requires a writable venv, which a container image does not have.
    install: bool

    #: Use the *host's* GitHub credentials — ``gh auth token`` shellout or an
    #: ambient ``GITHUB_TOKEN``. Lending those to a remote visitor would hand
    #: them the operator's account, so off outside local use.
    github_token: bool

    # Deliberately absent: confining host filesystem access. Every model route
    # still takes an absolute ``file_path``, so a capability claiming otherwise
    # would be a false statement in an API response. Tracked in #1058, which is
    # where workspaces replace paths.


_CAPABILITIES: dict[Mode, Capabilities] = {
    LOCAL: Capabilities(install=True, github_token=True),
    # install=True since #132: the Mac app is a conduit for this setting, not a
    # separate implementation of it. It no longer keeps its own copy of which
    # PsyNeuLink is wanted, so an install started from the gear icon is no
    # longer undone by the app's next update. Loopback still gates the actual
    # endpoint, and the Mac app is loopback.
    MAC_APP: Capabilities(install=True, github_token=True),
    CONTAINER: Capabilities(install=False, github_token=False),
    HOSTED: Capabilities(install=False, github_token=False),
}


def current_mode() -> Mode:
    """The declared deployment mode; ``local`` when unset or unrecognized.

    Precedence: ``PSYNEUVIEW_DEPLOYMENT_MODE`` → legacy ``PSYNEUVIEW_MAC_APP=1``
    → ``local``. An unrecognized value falls back to ``local`` with a warning
    rather than raising: a typo in a deploy script should not take the backend
    down, and ``local`` is the most restrictive choice that still boots (it
    grants nothing a remote client can reach, since install also requires
    loopback).
    """
    raw = os.environ.get(_MODE_ENV, "").strip().lower()
    if raw:
        if raw in VALID_MODES:
            return raw  # type: ignore[return-value]
        logger.warning(
            "%s=%r is not one of %s — falling back to %r",
            _MODE_ENV,
            raw,
            ", ".join(VALID_MODES),
            LOCAL,
        )
        return LOCAL
    if os.environ.get(_LEGACY_MAC_APP_ENV) == "1":
        return MAC_APP
    return LOCAL


def capabilities(mode: Mode | None = None) -> Capabilities:
    """Capabilities for ``mode``, defaulting to the current one."""
    return _CAPABILITIES[mode or current_mode()]


def is_remote(mode: Mode | None = None) -> bool:
    """True when the user is not sitting at the machine running this process."""
    return (mode or current_mode()) in REMOTE_MODES
