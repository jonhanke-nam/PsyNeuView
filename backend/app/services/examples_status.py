"""Whether each of PsyNeuLink's own examples loads and runs, kept on disk (#175).

The Open menu's PsyNeuLink Examples section marks each example: loads and
runs, loads only, or fails. Finding that out means loading every model in
the active source's ``Scripts/Examples`` and running each once with zero
inputs, one at a time in the model runner, which took the better part of a
minute on a full checkout. The result used to be kept in memory only, so
every launch started over.

The result now lives in ``~/.psyneuview/cache/examples-status.json``, under
a key that changes whenever the answer could:

- the active PsyNeuLink's commit;
- the folder the examples are read from;
- the name, size and modification time of every ``.py`` file in it, since
  a local checkout can have uncommitted edits (the commit alone, reported
  as ``.dirty``, doesn't say which file changed).

The file holds only what the probe found: example names, node counts and
the first line of any error. Nothing is ever written into the PsyNeuLink
checkout itself.

The probe gives way to user-requested work between its steps
(``sandbox.giving_way``), so a model opened while it runs doesn't queue
behind the rest of the corpus. Only a probe whose key is still right when it
finishes is kept: if the files or the source changed meanwhile, the result
is answered but not remembered, and the next request probes again. The
same goes for a probe cut short by the model runner itself dying.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from collections.abc import Callable
from pathlib import Path

from app.services import sandbox
from app.services.executor import get_input_nodes, run_model
from app.services.introspector import load_and_introspect

logger = logging.getLogger(__name__)

CACHE_DIR_ENV = "PSYNEUVIEW_CACHE_DIR"
_FILENAME = "examples-status.json"
#: Results kept on disk: one per source the user has had the section open
#: with. Few people switch between more sources than this.
MAX_ENTRIES = 8

# Results already read or found this process, by key.
_memory: dict[str, dict] = {}
# One probe at a time: a second request for the same key waits for the
# first's answer instead of probing the corpus again alongside it.
_probe_lock = threading.Lock()


# ── Where ─────────────────────────────────────────────────────────────


def fixed_by_env() -> bool:
    """Whether ``PSYNEUVIEW_CACHE_DIR`` decides the folder."""
    return bool(os.environ.get(CACHE_DIR_ENV))


def default_cache_dir() -> Path:
    """The per-user folder: ``~/.psyneuview/cache``."""
    return Path.home() / ".psyneuview" / "cache"


def cache_dir(*, create: bool = False) -> Path:
    """Where results that are only a convenience to keep are stored.

    ``PSYNEUVIEW_CACHE_DIR`` when set; otherwise the per-user default.
    Created when ``create`` is True (a writer); a caller that only reports
    the path leaves it alone.
    """
    env = os.environ.get(CACHE_DIR_ENV)
    d = Path(env).expanduser() if env else default_cache_dir()
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return d


def _cache_file() -> Path:
    return cache_dir() / _FILENAME


# ── The key ───────────────────────────────────────────────────────────


def fingerprint(scripts_dir: Path, commit: str | None) -> str:
    """The key under which this folder's status is kept.

    Any change to a ``.py`` file in the folder (a helper module counts: an
    example may import one) changes the key, as does a different commit or
    a different folder.
    """
    try:
        files = sorted(
            (p.name, st.st_size, st.st_mtime_ns)
            for p in scripts_dir.glob("*.py")
            for st in [p.stat()]
        )
    except OSError:
        files = []
    payload = json.dumps([commit or "unknown", str(scripts_dir), files])
    return hashlib.sha256(payload.encode()).hexdigest()[:32]


# ── Remembering ───────────────────────────────────────────────────────


def _read_entries() -> dict[str, dict]:
    try:
        data = json.loads(_cache_file().read_text())
    except (OSError, ValueError):
        return {}
    entries = data.get("entries") if isinstance(data, dict) else None
    return entries if isinstance(entries, dict) else {}


def _write_entries(entries: dict[str, dict]) -> None:
    path = cache_dir(create=True) / _FILENAME
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({"version": 1, "entries": entries}, indent=1))
    os.replace(tmp, path)


def cached(key: str) -> dict | None:
    """The status kept for ``key``, from this process or from disk, or None."""
    if key in _memory:
        return _memory[key]
    entry = _read_entries().get(key)
    status = entry.get("status") if isinstance(entry, dict) else None
    if isinstance(status, dict):
        _memory[key] = status
        return status
    return None


def remember(key: str, status: dict, commit: str | None) -> None:
    """Keep ``status`` for ``key``, in memory and on disk (oldest dropped past the cap)."""
    _memory[key] = status
    entries = _read_entries()
    entries[key] = {"status": status, "commit": commit, "savedAt": time.time()}
    if len(entries) > MAX_ENTRIES:
        by_age = sorted(entries.items(), key=lambda kv: kv[1].get("savedAt") or 0)
        entries = dict(by_age[-MAX_ENTRIES:])
    try:
        _write_entries(entries)
    except OSError as e:
        # A read-only home: the result still serves this process.
        logger.warning("Could not keep the examples status on disk: %s", e)


def forget_all() -> None:
    """Drop what this process remembers (the file stays). For tests."""
    _memory.clear()


# ── Probing ───────────────────────────────────────────────────────────


def _runner_failed(entry: dict) -> bool:
    """Whether a result came from the runner dying, not from the model."""
    return any("Worker" in str(entry.get(k) or "") for k in ("error", "runError"))


def _probe_one(path: Path) -> dict:
    """Load one example and, if it loads, run it once with zero inputs.

    A *run* failure often just means the model needs real inputs: the reason
    is carried in ``runError`` for the tooltip, and the UI shows "loads", not
    "fails". Only a *load* failure is a hard "fails".
    """
    p = str(path)
    try:
        r = load_and_introspect(p, use_sandbox=True)
        err = r.get("error") if isinstance(r, dict) else None
        comps = (r.get("compositions") or []) if isinstance(r, dict) else []
        nodes = len(comps[0].get("nodes", [])) if comps else 0
        if err:
            return {"load": "fail", "error": str(err).splitlines()[0][:160]}
        if nodes == 0:
            return {"load": "fail", "error": "loaded but no nodes (construction failed)"}
        entry: dict = {"load": "ok", "nodes": nodes}
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
        return entry
    except Exception as e:  # noqa: BLE001 - report any probe failure as fail
        return {"load": "fail", "error": str(e).splitlines()[0][:160]}


def probe(
    scripts_dir: Path,
    key: str,
    commit: str | None,
    *,
    key_now: Callable[[], str] | None = None,
) -> tuple[dict, bool]:
    """Probe every example in ``scripts_dir``; the status and whether it was kept.

    ``key`` is what :func:`fingerprint` gave when the request arrived;
    ``key_now`` recomputes it once the probe is done (the default
    fingerprints the folder again under the same commit). A probe whose key
    changed, or that the runner cut short, is answered but not kept.
    """
    with _probe_lock:
        done = cached(key)
        if done is not None:
            return done, True
        status: dict[str, dict] = {}
        with sandbox.giving_way():
            for path in sorted(scripts_dir.glob("*.py")):
                if path.stem.startswith("__"):
                    continue
                status[path.stem] = _probe_one(path)
        still_same = (key_now() if key_now else fingerprint(scripts_dir, commit)) == key
        complete = still_same and not any(_runner_failed(s) for s in status.values())
        if complete:
            remember(key, status, commit)
        else:
            logger.info("Examples status not kept: the files or the runner changed during the probe")
        return status, complete
