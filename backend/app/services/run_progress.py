"""Live progress of runs in flight (#357).

The Run panel names each run with a ``progress_id`` and polls
``GET /api/model/run/progress/{id}`` while it waits; the run updates its entry
from the worker's per-trial lines. Entries live only while their run does.
"""

import threading
import time

_lock = threading.Lock()
_runs: dict[str, dict] = {}

# A run that never finished (the client went away mid-request) must not stay
# forever; each new run sweeps entries older than this.
_MAX_AGE_S = 3600


def start(run_id: str, total: int) -> None:
    now = time.time()
    with _lock:
        for key in [k for k, v in _runs.items() if now - v["startedAt"] > _MAX_AGE_S]:
            del _runs[key]
        _runs[run_id] = {"trial": 0, "total": total, "seconds": None, "startedAt": now}


def update(run_id: str, event: dict) -> None:
    with _lock:
        entry = _runs.get(run_id)
        if entry is None:
            return
        if isinstance(event.get("trial"), int):
            entry["trial"] = event["trial"]
        if isinstance(event.get("seconds"), (int, float)):
            entry["seconds"] = event["seconds"]


def get(run_id: str) -> dict | None:
    with _lock:
        entry = _runs.get(run_id)
        return dict(entry) if entry is not None else None


def finish(run_id: str) -> None:
    with _lock:
        _runs.pop(run_id, None)
