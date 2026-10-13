"""Persisted history of which PsyNeuLink (repo, ref) pairs the user has
selected from Settings → Change install.

This backs the typeahead in #251 ("show me the branches I actually use") and
will be the same storage that #253's bookmarked-sources / named-sections UI
manages. The remembered-sources list Settings switches between (#1276) lives
beside it, under its own key; see ``remember_source`` below. Auto-populated on each install submit — the user doesn't have to
"save" anything; we just remember.

Storage: a ``source_history`` key inside ``~/.psynewview.json``, the same
config file that already holds ``model_dirs``. Schema:

    {
      "model_dirs": [...],
      "source_history": [
        {"repo": "owner/repo", "ref": "branch_name", "selected_at": 1748275200.0},
        ...
      ]
    }

Ordering: newest first. Dedupe is on the (repo, ref) pair — selecting
the same pair again bumps it to the top with a fresh ``selected_at``.
Capped at ``MAX_ENTRIES`` to keep the file from growing unbounded; the
oldest entries fall off.

Writes are atomic (tempfile + rename) and serialized with a process-local
lock — enough for the threadpool FastAPI uses. The file can also be
missing or malformed; reads degrade to an empty list rather than crash.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

from app.services.app_config import app_config_path


MAX_ENTRIES = 50

_lock = threading.Lock()


# ── Placeholders are never a source (#1292) ──────────────────────────
#
# ``owner/repo`` is the example the docs, the code and the Repo field's
# placeholder text all use. It passes the ``owner/repo`` shape check, and one
# was found recorded in a developer's real preferences file (written by a
# test, before #1025 isolated the file). A placeholder is refused when it
# is recorded and dropped when the file is read, so one already on disk goes
# away by itself. The frontend's ``isPlaceholderRepo`` keeps the same list.

#: Whole slugs that are examples, not repos (compared lowercased).
PLACEHOLDER_REPOS = frozenset({
    "owner/repo", "owner/name", "org/repo", "user/repo", "username/repo",
    "your-org/your-repo", "example/repo", "<owner>/<repo>", "owner/repository",
})
#: An owner that is a stand-in word, whatever the name after it.
_PLACEHOLDER_OWNERS = frozenset({
    "owner", "org", "user", "username", "example", "your-org", "yourorg", "your_org",
    "your-name", "yourname", "<owner>", "{owner}",
})
#: A name that is a stand-in word, whoever the owner is.
_PLACEHOLDER_NAMES = frozenset({
    "repo", "name", "repository", "your-repo", "yourrepo", "your_repo", "repo-name",
    "reponame", "<repo>", "{repo}",
})


def is_placeholder_repo(repo: Optional[str]) -> bool:
    """Whether ``repo`` is an example slug (``owner/repo``) rather than a real
    GitHub repository: a listed placeholder, template brackets, or a stand-in
    word on either side of the slash."""
    slug = (repo or "").strip().lower()
    if not slug:
        return False
    if slug in PLACEHOLDER_REPOS:
        return True
    if any(ch in slug for ch in "<>{}[]…") or "..." in slug:
        return True
    owner, _, name = slug.partition("/")
    return owner in _PLACEHOLDER_OWNERS or name in _PLACEHOLDER_NAMES


def record_selection(repo: str, ref: str, *, config_file: Optional[Path] = None) -> None:
    """Record that the user just selected ``repo`` + ``ref`` for install.

    De-duplicated by the (repo, ref) pair: re-selecting an existing entry
    refreshes its ``selected_at`` and moves it to the top. A placeholder
    repo (``owner/repo``) is never recorded (#1292).
    """
    repo = (repo or "").strip()
    ref = (ref or "").strip()
    if not repo or not ref or is_placeholder_repo(repo):
        return

    path = config_file or app_config_path()
    with _lock:
        config = _read_config(path)
        history = _coerce_history(config.get("source_history"))

        history = [e for e in history if not (e["repo"] == repo and e["ref"] == ref)]
        history.insert(0, {"repo": repo, "ref": ref, "selected_at": time.time()})
        if len(history) > MAX_ENTRIES:
            history = history[:MAX_ENTRIES]

        config["source_history"] = history
        _write_config_atomic(path, config)


def list_selections(*, config_file: Optional[Path] = None) -> list[dict]:
    """Return the full history (newest first). Empty list if the file is
    missing, unreadable, or has no history key."""
    path = config_file or app_config_path()
    with _lock:
        config = _read_config(path)
        return _coerce_history(config.get("source_history"))


def list_repos(*, config_file: Optional[Path] = None) -> list[str]:
    """Unique repos in selection order — newest first. Powers the Repo
    field's typeahead."""
    seen: set[str] = set()
    repos: list[str] = []
    for entry in list_selections(config_file=config_file):
        repo = entry["repo"]
        if repo not in seen:
            seen.add(repo)
            repos.append(repo)
    return repos


def list_refs_for_repo(repo: str, *, config_file: Optional[Path] = None) -> list[str]:
    """Unique refs for ``repo`` in selection order — newest first. Powers
    the Branch / ref field's 'Recent' section."""
    refs: list[str] = []
    seen: set[str] = set()
    for entry in list_selections(config_file=config_file):
        if entry["repo"] != repo:
            continue
        if entry["ref"] not in seen:
            seen.add(entry["ref"])
            refs.append(entry["ref"])
    return refs


# ── Remembered PsyNeuLink sources (#1276) ────────────────────────────
#
# "Many remembered, one active." Settings lists every source the user has
# switched to, so moving between GitHub devel, PyPI and several local
# checkouts is one pick and Apply & restart, with no retyping of paths.
#
# Stored under its own ``pnl_sources`` key, beside ``source_history``, because
# the history above is the branch typeahead's (GitHub only, and capped at 50
# refs), while this is a short list the user curates: entries can be renamed
# and removed. Removing an entry only takes it off the list: no folder is ever
# deleted. Until the user first changes the list, it is seeded from the most
# recent GitHub selections, so people upgrading see what they already used.
#
# Entry: {"kind": "github"|"pypi"|"local", "repo", "ref", "path", "label",
# "selected_at"}. Its id is derived, never stored: "pypi", "local:<resolved
# path>", or "github:<owner/repo, lowercased>@<ref>". GitHub treats repo names
# case-insensitively, so two spellings of one repo are one entry.

SOURCES_KEY = "pnl_sources"
MAX_SOURCES = 30
_SEED_FROM_HISTORY = 10
_KINDS = ("github", "pypi", "local")


def _normalize_local_path(path: str) -> str:
    return str(Path(path).expanduser().resolve())


def source_id(kind: str, repo: Optional[str] = None, ref: Optional[str] = None,
              path: Optional[str] = None) -> str:
    """The stable identity of a source, used to dedupe and to address it."""
    if kind == "pypi":
        return "pypi"
    if kind == "local":
        return f"local:{_normalize_local_path(path or '')}"
    return f"github:{(repo or '').strip().lower()}@{(ref or '').strip()}"


def _make_entry(kind: str, repo: Optional[str], ref: Optional[str], path: Optional[str],
                label: Optional[str] = None, selected_at: float = 0.0) -> Optional[dict]:
    """A normalized stored entry, or None when the fields don't describe a source."""
    if kind not in _KINDS:
        return None
    repo = (repo or "").strip() or None
    ref = (ref or "").strip() or None
    path = (path or "").strip() or None
    if kind == "github" and not (repo and ref):
        return None
    if kind == "github" and is_placeholder_repo(repo):
        return None  # #1292: an example slug is not a source
    if kind == "local":
        if not path:
            return None
        path = _normalize_local_path(path)
    if kind != "github":
        repo = ref = None
    if kind != "local":
        path = None
    label = label.strip() or None if isinstance(label, str) else None
    return {"kind": kind, "repo": repo, "ref": ref, "path": path,
            "label": label, "selected_at": float(selected_at)}


def _stored_sources(config: dict) -> list[dict]:
    """The remembered list, or its seed when the user hasn't changed it yet."""
    raw = config.get(SOURCES_KEY)
    if not isinstance(raw, list):
        return [
            e for e in (
                _make_entry("github", h["repo"], h["ref"], None, selected_at=h["selected_at"])
                for h in _coerce_history(config.get("source_history"))[:_SEED_FROM_HISTORY]
            ) if e is not None
        ]
    out: list[dict] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        at = item.get("selected_at", 0)
        entry = _make_entry(
            item.get("kind"), item.get("repo"), item.get("ref"), item.get("path"),
            item.get("label"), at if isinstance(at, (int, float)) else 0,
        )
        if entry is None:
            continue
        sid = source_id(**_id_fields(entry))
        if sid not in seen:
            seen.add(sid)
            out.append(entry)
    return out


def _id_fields(entry: dict) -> dict:
    return {"kind": entry["kind"], "repo": entry["repo"], "ref": entry["ref"], "path": entry["path"]}


def _save_sources(path: Path, config: dict, sources: list[dict]) -> None:
    config[SOURCES_KEY] = sources[:MAX_SOURCES]
    _write_config_atomic(path, config)


def remember_source(kind: str, *, repo: Optional[str] = None, ref: Optional[str] = None,
                    path: Optional[str] = None, config_file: Optional[Path] = None) -> Optional[dict]:
    """Remember that the user just switched to this source. Re-selecting one
    already on the list moves it to the top and keeps its name."""
    entry = _make_entry(kind, repo, ref, path, selected_at=time.time())
    if entry is None:
        return None
    sid = source_id(**_id_fields(entry))
    config_path = config_file or app_config_path()
    with _lock:
        config = _read_config(config_path)
        sources = _stored_sources(config)
        for existing in sources:
            if source_id(**_id_fields(existing)) == sid:
                entry["label"] = existing["label"]
        sources = [e for e in sources if source_id(**_id_fields(e)) != sid]
        sources.insert(0, entry)
        _save_sources(config_path, config, sources)
    return entry


def remember_active(active: Optional[dict], *, config_file: Optional[Path] = None) -> bool:
    """Put the source in use on the list if it isn't there yet (#1331).

    A PsyNeuLink installed outside Settings — the Mac app's setup wizard, a
    terminal's ``pip install -e`` — used to be listed only while it was in
    use, so switching away lost it: a developer's own checkout was never
    among the known sources. True when it was added; False when it was
    already listed, or nothing is in use.
    """
    if active is None:
        return False
    sid = source_id(**_id_fields(active))
    config_path = config_file or app_config_path()
    with _lock:
        if any(source_id(**_id_fields(e)) == sid for e in _stored_sources(_read_config(config_path))):
            return False
    return remember_source(**_id_fields(active), config_file=config_path) is not None


def active_source_from_info(info: dict) -> Optional[dict]:
    """Which source the installed PsyNeuLink is, from ``settings_info``'s
    report: a local checkout by its path, GitHub by repo and branch, or PyPI."""
    source = info.get("source")
    if source == "editable" and info.get("path"):
        return _make_entry("local", None, None, info["path"])
    if source == "github" and info.get("repo") and info.get("branch"):
        return _make_entry("github", info["repo"], info["branch"], None)
    if source == "pypi":
        return _make_entry("pypi", None, None, None)
    return None


def _public(entry: dict, *, active_id: Optional[str], remembered: bool) -> dict:
    sid = source_id(**_id_fields(entry))
    return {
        **entry,
        "id": sid,
        # Local checkouts are the user's own, editable folders; GitHub and
        # PyPI installs are managed by PsyNeuView and kept read-only (#1225).
        "editable": entry["kind"] == "local",
        "active": sid == active_id,
        "remembered": remembered,
        "missing": entry["kind"] == "local" and not Path(entry["path"]).is_dir(),
    }


def list_sources(*, active: Optional[dict] = None,
                 config_file: Optional[Path] = None) -> list[dict]:
    """Remembered sources, most recently selected first, with the active one
    marked. The active source is always listed, even when it was installed
    outside Settings (the Mac app's setup, a terminal): that entry carries
    ``remembered: False`` until the user switches to it or names it."""
    config_path = config_file or app_config_path()
    with _lock:
        sources = _stored_sources(_read_config(config_path))
    active_id = source_id(**_id_fields(active)) if active else None
    out = [_public(e, active_id=active_id, remembered=True) for e in sources]
    if active is not None and not any(e["active"] for e in out):
        out.insert(0, _public(active, active_id=active_id, remembered=False))
    return out


def rename_source(sid: str, label: Optional[str], *, active: Optional[dict] = None,
                  config_file: Optional[Path] = None) -> dict:
    """Give a source a name of the user's choosing; blank restores the default.
    Naming the active source remembers it. KeyError if ``sid`` isn't listed."""
    config_path = config_file or app_config_path()
    with _lock:
        config = _read_config(config_path)
        sources = _stored_sources(config)
        target = next((e for e in sources if source_id(**_id_fields(e)) == sid), None)
        if target is None:
            if active is None or source_id(**_id_fields(active)) != sid:
                raise KeyError(sid)
            target = {**active, "selected_at": time.time()}
            sources.insert(0, target)
        target["label"] = (label or "").strip() or None
        _save_sources(config_path, config, sources)
        return dict(target)


def remove_source(sid: str, *, config_file: Optional[Path] = None) -> bool:
    """Take a source off the list. Never deletes a folder. False if absent."""
    config_path = config_file or app_config_path()
    with _lock:
        config = _read_config(config_path)
        sources = _stored_sources(config)
        kept = [e for e in sources if source_id(**_id_fields(e)) != sid]
        if len(kept) == len(sources):
            return False
        _save_sources(config_path, config, kept)
        return True


def _read_config(path: Path) -> dict:
    """Best-effort read of the JSON config file. Returns {} on any failure."""
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _coerce_history(raw: object) -> list[dict]:
    """Defensively normalize a ``source_history`` value read from disk.

    Drops any entry that isn't a dict with the required ``repo`` and
    ``ref`` string fields. Tolerates missing ``selected_at`` (defaults to 0).
    """
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        repo = entry.get("repo")
        ref = entry.get("ref")
        if not isinstance(repo, str) or not isinstance(ref, str):
            continue
        if not repo.strip() or not ref.strip():
            continue
        if is_placeholder_repo(repo):
            continue  # #1292: dropped on read, so one already on disk goes away
        selected_at = entry.get("selected_at", 0)
        if not isinstance(selected_at, (int, float)):
            selected_at = 0
        out.append({"repo": repo, "ref": ref, "selected_at": float(selected_at)})
    return out


def _write_config_atomic(path: Path, config: dict) -> None:
    """Write ``config`` to ``path`` atomically via tempfile + os.replace.

    A crash mid-write leaves either the old file intact or the new file
    fully written — never a half-written JSON that breaks the next read.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=".psynewview.", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(config, f, indent=2, sort_keys=True)
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
