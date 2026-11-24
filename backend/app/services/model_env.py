"""The environment a model run gets (#179, review packet B2).

Every process that runs model code (the warm worker, the fork server and
its children, pool workers, the one-shot fallback, Learn jobs and the
sandboxed converter) is started with this environment, not the server's.
Only what Python, PsyNeuLink, Graphviz and the runner need is passed on;
everything else the user exported before starting PsyNeuView (a
``GITHUB_TOKEN``, cloud credentials, an ``ANTHROPIC_API_KEY`` of their own,
the page secret's variables) stays in the server.

Two rules, in this order:

1. A name that looks like a secret is dropped, whatever its prefix: any
   part (split on ``_``) is ``TOKEN``, ``KEY``, ``SECRET``, ``PASSWORD`` and
   the like, or it starts with ``AWS_``, ``GITHUB_`` and the other
   credential prefixes below. ``PSYNEUVIEW_GITHUB_TOKEN`` and
   ``PSYNEUVIEW_PAGE_SECRET`` are dropped by this rule.
2. Otherwise a name is kept only if it is listed in ``KEEP`` or starts
   with one of ``KEEP_PREFIXES``.
"""

from __future__ import annotations

import os
import re
from typing import Mapping

#: Kept by exact name.
KEEP = frozenset({
    # Where programs are, who and where the user is.
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "TZ",
    # Language and encoding (LC_* below).
    "LANG", "LANGUAGE", "__CF_USER_TEXT_ENCODING",
    # Temporary folders.
    "TMPDIR", "TMP", "TEMP",
    # Python and the environment it runs in.
    "PYTHONPATH", "PYTHONHOME", "PYTHONDONTWRITEBYTECODE", "PYTHONHASHSEED", "PYTHONIOENCODING",
    "PYTHONUNBUFFERED", "PYTHONWARNINGS", "PYTHONNOUSERSITE", "PYTHONPYCACHEPREFIX", "PYTHONUTF8",
    "PYTHONSAFEPATH", "PYTHONFAULTHANDLER", "PYTHONMALLOC",
    "VIRTUAL_ENV", "CONDA_PREFIX", "CONDA_DEFAULT_ENV",
    # Native libraries PsyNeuLink, numpy and torch load.
    "LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH",
    "OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS",
    "NUMEXPR_NUM_THREADS", "KMP_DUPLICATE_LIB_OK",
    # Matplotlib and numba caches (the sandbox points them at the task's scratch).
    "MPLBACKEND", "MPLCONFIGDIR", "NUMBA_CACHE_DIR",
    # Graphviz.
    "GV_FILE_PATH", "GVBINDIR", "GRAPHVIZ_DOT",
    # Per-user folders.
    "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR",
    # Windows: what Python itself needs to start.
    "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
    "PROGRAMDATA", "PROGRAMFILES", "HOMEDRIVE", "HOMEPATH", "NUMBER_OF_PROCESSORS",
})

#: Kept by prefix (still subject to the secret rule).
KEEP_PREFIXES = (
    "LC_",
    "PSYNEUVIEW_",  # the runner's own settings: isolation mode, sandbox, review file, folders
    "PNL_",         # PsyNeuLink's own (PNL_LLVM_DEBUG)
    "COVERAGE_", "COV_CORE_",  # coverage of the worker in the test suite
)

#: Any part of the name (split on ``_``) that marks a secret.
SECRET_PARTS = frozenset({
    "TOKEN", "TOKENS", "KEY", "KEYS", "APIKEY", "SECRET", "SECRETS", "PASSWORD", "PASSWD", "PASS",
    "PASSPHRASE", "CREDENTIAL", "CREDENTIALS", "CREDS", "AUTH", "COOKIE", "PRIVATE", "SESSION",
})

#: Name prefixes of credentials and cloud accounts, dropped whatever follows.
SECRET_PREFIXES = (
    "AWS_", "GITHUB_", "GH_", "GITLAB_", "AZURE_", "GOOGLE_", "GCLOUD_", "GCP_", "CLOUDSDK_",
    "ANTHROPIC_", "OPENAI_", "HF_", "HUGGING", "NPM_", "DOCKER_", "SSH_", "GPG_", "GNUPG",
    "KUBE", "VAULT_", "OP_", "SLACK_", "STRIPE_", "TWILIO_", "DATABASE_", "PGPASS",
    "PSYNEWVIEW_",  # the page secret's old spelling, never a runner setting
)

_PARTS = re.compile(r"[^A-Z0-9]+")


def is_secret_name(name: str) -> bool:
    """Whether ``name`` looks like it holds a credential."""
    upper = name.upper()
    if upper.startswith(SECRET_PREFIXES):
        return True
    return any(part in SECRET_PARTS for part in _PARTS.split(upper) if part)


def is_kept(name: str) -> bool:
    """Whether a model run is given the variable ``name``."""
    if is_secret_name(name):
        return False
    upper = name.upper() if os.name == "nt" else name
    return upper in KEEP or upper.startswith(KEEP_PREFIXES)


def model_env(source: Mapping[str, str] | None = None) -> dict[str, str]:
    """The allow-listed environment for a process that runs model code."""
    src = os.environ if source is None else source
    return {k: v for k, v in src.items() if is_kept(k)}
