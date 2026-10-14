"""Remember show_graph's answers so an unchanged model isn't reloaded (#22).

Every show_graph request reloads the model in the model runner, about 3 s
(EGO 15–20 s). The "Like show_graph" layout asks often: on open, on each
switch back to it, and again with ``show_learning`` when the first answer
misses nodes. When nothing has changed the answer is the same, so it is kept.

What counts as "nothing has changed" is the key:

- the model file's contents (unsaved edits arrive as a separate preview file,
  so they get their own entry);
- the other ``.py`` files in the model's folder (name, size, modified time),
  since a model may import a helper module that sits next to it;
- the composition, the show_graph options and the format asked for.

The PsyNeuLink in use is not in the key. Instead the cache is emptied whenever
the model runner restarts (``sandbox.restart_warm_worker``), which is how every
change of PsyNeuLink takes effect: an install, a checkout update, or an edit to
a local checkout's code.

Errors are never kept, so a failure is retried next time.
"""

from __future__ import annotations

import hashlib
import json
import threading
from collections import OrderedDict
from pathlib import Path

# Descriptions are tens of KB; SVGs a few hundred. Enough for every model a
# session opens, without growing unbounded.
MAX_ENTRIES = 64

_entries: OrderedDict[str, dict] = OrderedDict()
_lock = threading.Lock()


def _folder_fingerprint(folder: Path) -> list:
    try:
        return sorted(
            (p.name, st.st_size, st.st_mtime_ns)
            for p in folder.glob("*.py")
            for st in [p.stat()]
        )
    except OSError:
        return []


def cache_key(file_path: str, composition_name: str, options: dict, fmt: str) -> str | None:
    """The key for this request, or None when the file can't be read."""
    path = Path(file_path)
    try:
        content = path.read_bytes()
    except OSError:
        return None
    h = hashlib.sha256(content)
    h.update(json.dumps(
        {
            "folder": _folder_fingerprint(path.parent),
            "composition": composition_name,
            "options": options,
            "format": fmt,
        },
        sort_keys=True,
        default=str,
    ).encode())
    return h.hexdigest()


def get(key: str) -> dict | None:
    with _lock:
        result = _entries.get(key)
        if result is None:
            return None
        _entries.move_to_end(key)
        return dict(result)


def put(key: str, result: dict) -> None:
    if "error" in result:
        return
    with _lock:
        _entries[key] = dict(result)
        _entries.move_to_end(key)
        while len(_entries) > MAX_ENTRIES:
            _entries.popitem(last=False)


def clear() -> None:
    with _lock:
        _entries.clear()
