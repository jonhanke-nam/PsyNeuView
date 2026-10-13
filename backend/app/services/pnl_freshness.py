"""How stale a branch-pinned PsyNeuLink install is. (#116)

The Mac app defaults to installing PsyNeuLink from the Princeton ``devel``
branch, which reads as "track the latest developer version". It isn't: the
branch is resolved once, at install time, and only re-pulled when the updater
runs. Settings shows ``Branch / ref: devel``, which looks current whether the
commit is a day old or four months old.

This module answers "how far behind is it", so the UI can say so. It is
deliberately split into pure parsing plus one network call, so the parsing is
testable without touching GitHub and the network failure is never fatal — a
Settings panel that cannot reach GitHub should still open.
"""

from __future__ import annotations

import logging
import re
from typing import Literal, Optional, TypedDict

logger = logging.getLogger(__name__)

# setuptools-scm renders a git build as `<tag>+<N>.g<sha>`, e.g.
# `0.19.1.0+30.g875890855`. The sha is what GitHub can compare against.
_LOCAL_SHA = re.compile(r"\+.*?\.g([0-9a-f]{7,40})", re.IGNORECASE)


class Freshness(TypedDict):
    status: Literal["current", "behind", "unknown", "not_applicable"]
    behind_by: Optional[int]
    installed_commit: Optional[str]
    head_commit: Optional[str]
    head_date: Optional[str]
    detail: str


def commit_from_version(version: Optional[str]) -> Optional[str]:
    """Pull the git sha out of a setuptools-scm local version.

    ``0.19.1.0+30.g875890855`` -> ``875890855``. A plain release version such
    as ``0.20.2.0`` has no sha and returns None, which is correct: a PyPI
    install has no branch to be behind.
    """
    if not version:
        return None
    match = _LOCAL_SHA.search(version)
    return match.group(1) if match else None


def describe(
    status: str,
    behind_by: Optional[int],
    branch: Optional[str],
    head_date: Optional[str] = None,
) -> str:
    """The sentence shown in Settings.

    Kept separate from the fetch so the wording is testable, and so the
    "unknown" case reads as an honest "we could not check" rather than
    implying the install is current.
    """
    if status == "not_applicable":
        return "Pinned to a release, so there is no branch to track."
    if status == "unknown":
        return "Couldn't check how current this is — GitHub was unreachable."
    if status == "current" or not behind_by:
        return f"Up to date with {branch}."
    commits = "commit" if behind_by == 1 else "commits"
    suffix = f", newest from {head_date[:10]}" if head_date else ""
    return f"{behind_by} {commits} behind {branch}{suffix}."


def _unknown(branch: Optional[str], installed: Optional[str]) -> Freshness:
    return {
        "status": "unknown", "behind_by": None,
        "installed_commit": installed, "head_commit": None, "head_date": None,
        "detail": describe("unknown", None, branch),
    }


def check(repo: Optional[str], branch: Optional[str], version: Optional[str],
          commit: Optional[str] = None, timeout: float = 4.0) -> Freshness:
    """Compare the installed commit against the head of its branch.

    ``commit`` (from a local clone, when the install is editable) wins over the
    sha embedded in the version string, since it is read from git rather than
    inferred from a version rendering.
    """
    installed = commit or commit_from_version(version)
    if not repo or not branch or not installed:
        return {
            "status": "not_applicable", "behind_by": None,
            "installed_commit": installed, "head_commit": None, "head_date": None,
            "detail": describe("not_applicable", None, branch),
        }

    try:
        import httpx

        # `compare/base...head` reports how far `head` has moved past `base`,
        # which is exactly "commits the branch has that we don't".
        url = f"https://api.github.com/repos/{repo}/compare/{installed}...{branch}"
        response = httpx.get(
            url, timeout=timeout,
            headers={"Accept": "application/vnd.github+json"},
        )
        if response.status_code != 200:
            logger.info("freshness check for %s@%s returned %s", repo, branch, response.status_code)
            return _unknown(branch, installed)
        payload = response.json()
    except Exception as exc:  # network, DNS, JSON — none of it is fatal
        logger.info("freshness check for %s@%s failed: %s", repo, branch, exc)
        return _unknown(branch, installed)

    behind_by = payload.get("ahead_by")
    head = payload.get("commits", [])
    head_commit = head[-1].get("sha") if head else None
    head_date = None
    if head:
        head_date = (head[-1].get("commit", {}).get("committer", {}) or {}).get("date")

    status = "current" if not behind_by else "behind"
    return {
        "status": status, "behind_by": behind_by,
        "installed_commit": installed, "head_commit": head_commit,
        "head_date": head_date,
        "detail": describe(status, behind_by, branch, head_date),
    }
