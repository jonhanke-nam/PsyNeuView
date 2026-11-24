"""The page secret (#381): a per-launch secret only the app's own page holds.

The assistant's page routes (settings and consent, the key, the MCP setup and
token, proposals, review approvals) used to accept any request that named no
site. Any program on this machine, Claude Code's own shell among them, could
then read the MCP token, turn the assistant on, or approve assistant-written
code. Those routes now need this secret in the ``X-PsyNeuView-Session``
header, and **no HTTP route ever serves it**. It reaches the page by a channel
outside HTTP:

- **The Mac app** makes it at launch, writes it to a file only this user can
  read, and names the file in ``PSYNEUVIEW_PAGE_SECRET_FILE``. The backend
  reads the file once and deletes it; the app puts the secret into its web
  view with a user script.
- **A browser** gets it from a one-time link the backend prints at start
  (``http://127.0.0.1:<port>/#pnv-session=<secret>``). It is in the
  fragment, which the browser never sends to a server; the page moves it to
  ``sessionStorage`` and takes it out of the address bar.
- ``PSYNEUVIEW_PAGE_SECRET`` sets it directly, for a launcher that starts
  both the backend and the dev server (``make dev``) or for tests. An
  environment can be read by other programs running as the user, so the
  Mac app uses the file.

The variables are removed from this process's environment as soon as they are
read, so model runs (which inherit the environment) never see them. With
neither set, the backend makes its own and prints the link.

See ``docs/ai-assistant/threat-model.md`` §4.4 for what this does and doesn't
keep out.
"""

from __future__ import annotations

import hmac
import logging
import os
import secrets
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

HEADER = "X-PsyNeuView-Session"
#: The fragment key in the one-time link; the page reads it (utils/pageSecret.ts).
FRAGMENT_KEY = "pnv-session"
FILE_ENV = "PAGE_SECRET_FILE"
VALUE_ENV = "PAGE_SECRET"
#: A secret shorter than this is refused and a fresh one made instead.
MIN_LENGTH = 32

_lock = threading.Lock()
_secret: str | None = None
#: Where it came from: "file", "environment", "generated" or "test".
_source: str | None = None


def _pop_env(name: str) -> str | None:
    """Read ``PSYNEUVIEW_<name>`` (or the old spelling) and remove both."""
    value = None
    for prefix in ("PSYNEUVIEW_", "PSYNEWVIEW_"):
        found = os.environ.pop(prefix + name, None)
        if value is None and found is not None:
            value = found
    return value


def _read_and_delete(path: str) -> str | None:
    p = Path(path).expanduser()
    try:
        text = p.read_text(encoding="utf-8").strip()
    except OSError as e:
        logger.warning("page secret file %s couldn't be read (%s); making a new secret", p, e.strerror or e)
        return None
    try:
        p.unlink()
    except OSError:
        logger.warning("page secret file %s couldn't be deleted after reading", p)
    return text


def load() -> str:
    """The secret, loaded once: from the file, else the variable, else made here.

    Called as the app module is imported, before any worker starts, so the
    variables are gone from the environment the workers inherit."""
    global _secret, _source
    with _lock:
        if _secret is not None:
            return _secret
        candidates = []
        file_path = _pop_env(FILE_ENV)
        value = _pop_env(VALUE_ENV)
        if file_path:
            candidates.append((_read_and_delete(file_path), "file"))
        if value:
            candidates.append((value.strip(), "environment"))
        for candidate, source in candidates:
            if candidate and len(candidate) >= MIN_LENGTH:
                _secret, _source = candidate, source
                return _secret
            if candidate:
                logger.warning("page secret from the %s is shorter than %d characters; making a new one", source, MIN_LENGTH)
        _secret, _source = secrets.token_urlsafe(32), "generated"
        return _secret


def source() -> str:
    load()
    return _source or "generated"


def matches(presented: str | None) -> bool:
    """Whether ``presented`` is this launch's secret (constant-time)."""
    if not presented:
        return False
    return hmac.compare_digest(presented.strip().encode("utf-8"), load().encode("utf-8"))


def one_time_link(base_url: str) -> str:
    """``base_url`` with the secret in the fragment."""
    return f"{base_url.rstrip('/')}/#{FRAGMENT_KEY}={load()}"


def announce(port: int, environ: dict | None = None) -> str | None:
    """The line printed at start, or None when the Mac app passed the secret
    (it injects it itself, and the secret shouldn't sit in a log)."""
    if source() == "file":
        return None
    environ = os.environ if environ is None else environ
    base = (environ.get("PSYNEUVIEW_PAGE_URL") or "").strip() or f"http://127.0.0.1:{port}/"
    return (
        "PsyNeuView: open this link to use the AI assistant from a browser (it is good until the server stops): "
        f"{one_time_link(base)}"
    )


def use_for_tests(value: str | None) -> None:
    """Fix the secret (tests and the e2e harness only); None forgets it."""
    global _secret, _source
    with _lock:
        _secret, _source = (value, "test") if value else (None, None)
