"""Parse the provenance ("lineage") header carried by vendored model files.

Reference models — and, going forward, any bundled example/script — are vendored
with a structured comment header that records exactly which upstream source they
came from, e.g.::

    # Vendored from PsyNeuLink — PrincetonUniversity/PsyNeuLink
    # Source: psyneulink/library/models/Botvinick_conflict_monitoring_model.py
    # Pinned commit: 83cc4165b7 (v0.19.1.0-10-g83cc4165b7, 2026-08-01)
    # Vendored: 2026-08-04 for PsyNeuView reference-model seamless load (Refs #806, #808)

:func:`parse_lineage` turns that header into a structured dict (and a GitHub
permalink to the exact file@commit) so the UI can show *what code is actually
being run* when a reference model is loaded (#835). It is deliberately generic:
the repo is read from the header, not hard-coded, so examples vendored from other
repositories work too. Files with no such header (user files, raw library
scripts) return ``None``.

Header contract (for anyone vendoring a new example/script):
  - ``# Vendored from <name> — <owner>/<repo>``   (required to be recognized)
  - ``# Source: <path within repo>``
  - ``# Pinned commit: <sha> [(<tag>, <date>)]``
  - ``# Vendored: <YYYY-MM-DD> ... [(Refs #N, #M)]``
"""

from __future__ import annotations

import re

# Only the leading comment block can hold the header — bound the scan so a stray
# "Refs #123" deeper in the file can't be mistaken for provenance.
_HEADER_LINES = 25

# owner/repo — GitHub-legal characters only.
_REPO = r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+"
# em dash / en dash / hyphen may separate the name from the slug.
_DASH = r"[—–-]"

_RE_VENDORED_FROM = re.compile(rf"#\s*Vendored from\b.*?{_DASH}\s*({_REPO})")
_RE_SOURCE = re.compile(r"#\s*Source:\s*(\S+)")
_RE_COMMIT = re.compile(r"#\s*Pinned commit:\s*(\S+?)(?:\s*\(([^)]*)\))?\s*$", re.MULTILINE)
_RE_VENDORED_DATE = re.compile(r"#\s*Vendored:\s*(\d{4}-\d{2}-\d{2})")
_RE_REFS = re.compile(r"Refs?\s+((?:#\d+)(?:\s*,\s*#\d+)*)", re.IGNORECASE)


def parse_lineage(source: str | None) -> dict | None:
    """Extract the vendored-provenance header from ``source``.

    Returns a dict with keys ``repo``, ``sourcePath``, ``commit``, ``commitTag``,
    ``vendoredDate``, ``refs`` (list of "#N"), and ``url`` (a GitHub permalink to
    the file at that commit, when repo/commit/path are all known) — or ``None``
    if the source carries no recognizable provenance header.
    """
    if not source:
        return None

    header = "\n".join(source.splitlines()[:_HEADER_LINES])

    m_from = _RE_VENDORED_FROM.search(header)
    if not m_from:
        return None
    repo = m_from.group(1)

    source_path = None
    m_src = _RE_SOURCE.search(header)
    if m_src:
        source_path = m_src.group(1)

    commit = None
    commit_tag = None
    m_commit = _RE_COMMIT.search(header)
    if m_commit:
        commit = m_commit.group(1)
        paren = (m_commit.group(2) or "").strip()
        if paren:
            # e.g. "v0.19.1.0-10-g83cc4165b7, 2026-08-01" → keep the tag part.
            commit_tag = paren.split(",")[0].strip() or None

    vendored_date = None
    m_date = _RE_VENDORED_DATE.search(header)
    if m_date:
        vendored_date = m_date.group(1)

    refs: list[str] = []
    m_refs = _RE_REFS.search(header)
    if m_refs:
        refs = [r.strip() for r in m_refs.group(1).split(",")]

    url = None
    if repo and commit and source_path:
        url = f"https://github.com/{repo}/blob/{commit}/{source_path}"

    return {
        "repo": repo,
        "sourcePath": source_path,
        "commit": commit,
        "commitTag": commit_tag,
        "vendoredDate": vendored_date,
        "refs": refs,
        "url": url,
    }
