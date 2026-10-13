#!/usr/bin/env python3
"""Measure the open backlog against commit history (see BACKLOG.md).

Answers one question per issue: has this already been built? The backlog had
drifted far enough that planning against it produced wrong answers — roughly
half the issues reached for in one session turned out to be already done,
including one marked ``[Bug][Urgent]`` whose fix had merged months earlier.

The discriminator is the *type* of the newest commit naming an issue, not how
many there are. Nearly every open issue has commits; an issue whose most recent
touch is ``docs(TODO): record the …`` is someone writing work down, not doing
it.

Subjects only, deliberately. ``git log --grep`` searches the whole message and
matches issues named in a body, which attaches one issue's evidence to another.

Usage:
    python3 scripts/backlog_survey.py            # summary
    python3 scripts/backlog_survey.py --tsv      # full rows, for grouping
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import subprocess
import sys

# A commit that *records* work, versus one that does it.
#
# Defined as an exception list rather than a whitelist, which matters: an
# earlier version only counted conventional-commit prefixes (feat/fix/…) as
# doing, and this repo's older history writes "area: description" instead —
# `modelStore:`, `Frontend:`, `backend:`, `toolbar:`. That mistake classified
# 132 shipped issues as merely mentioned, understating the shipped count by a
# factor of twenty. Anything that is not bookkeeping counts as doing.
BOOKKEEPING = re.compile(
    r"^(docs?|chore|tests?)[(:]|^Merge |^TODO|^Update TODO|record the|retire the", re.I
)


def _is_doing(subject: str) -> bool:
    return not BOOKKEEPING.match(subject)


def open_issues(repo: str) -> list[tuple[str, str]]:
    out = subprocess.run(
        ["gh", "issue", "list", "-R", repo, "--state", "open", "--limit", "1000",
         "--json", "number,title"],
        capture_output=True, text=True, check=True,
    ).stdout
    return [(str(i["number"]), i["title"]) for i in json.loads(out)]


def commits_by_issue(ref: str) -> dict[str, list[tuple[str, str]]]:
    out = subprocess.run(
        ["git", "log", ref, "--format=%cs%x09%s"], capture_output=True, text=True, check=True
    ).stdout
    index: dict[str, list[tuple[str, str]]] = collections.defaultdict(list)
    for line in out.splitlines():
        date, _, subject = line.partition("\t")
        for m in re.finditer(r"#(\d{2,4})", subject):
            index[m.group(1)].append((date, subject))
    return index


def classify(commits: list[tuple[str, str]]) -> tuple[str, str, str]:
    """(signal, newest date, newest subject) for one issue's commits."""
    if not commits:
        return "no-commits", "-", "-"
    newest_date, newest_subject = max(commits)
    did = any(_is_doing(s) for _, s in commits)
    if did and _is_doing(newest_subject):
        return "likely-shipped", newest_date, newest_subject
    if did:
        return "shipped-then-documented", newest_date, newest_subject
    return "mentioned-only", newest_date, newest_subject


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default="jonhanke-nam/PsyNeuView")
    ap.add_argument("--ref", default="origin/devel")
    ap.add_argument("--tsv", action="store_true", help="print every row instead of a summary")
    args = ap.parse_args()

    index = commits_by_issue(args.ref)
    counts: collections.Counter[str] = collections.Counter()
    rows = []
    for num, title in open_issues(args.repo):
        signal, date, subject = classify(index.get(num, []))
        counts[signal] += 1
        rows.append((num, str(len(index.get(num, []))), date, signal, subject[:70], title[:70]))

    if args.tsv:
        print("number\tcommits\tnewest_date\tsignal\tnewest_subject\ttitle")
        for r in rows:
            print("\t".join(r))
        return 0

    print(f"{sum(counts.values())} open issues, measured against {args.ref}\n")
    for signal in ("likely-shipped", "shipped-then-documented", "mentioned-only", "no-commits"):
        print(f"  {signal:<26} {counts[signal]:>4}")
    print("\nlikely-shipped are candidates to close — check each against the code,")
    print("and never close an umbrella because one of its children shipped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
