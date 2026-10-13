#!/usr/bin/env python3
"""Report local files that a fast-forward to a ref would collide with.

The anchor checkout uses backend/ as its working directory, so scratch models
and their sidecars accrete there. When one of those names later becomes tracked
upstream, `git merge --ff-only` refuses and the checkout silently stops updating
(PsyNeuView#1134).

Two populations matter, and they fail in opposite ways:

  untracked  git refuses the merge and names the files. Loud, nothing is lost,
             but someone must diff each one by hand to see which hold real work.
             This script does that diff.

  ignored    git overwrites these during checkout without a word. An ignored
             sidecar holding dragged node positions is destroyed silently. These
             are the dangerous ones, and nothing surfaces them today.

Exit status: 0 when a fast-forward is clear, 1 when anything would collide.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def git(*args: str, repo: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True, capture_output=True, text=True,
    ).stdout


def _zsplit(blob: str) -> list[str]:
    return [p for p in blob.split("\0") if p]


def tracked_blobs(ref: str, repo: Path) -> dict[str, str]:
    """path -> blob sha for every file tracked at `ref`."""
    out = git("ls-tree", "-r", "-z", "--format=%(objectname) %(path)", ref, repo=repo)
    entries = {}
    for line in _zsplit(out):
        sha, _, path = line.partition(" ")
        entries[path] = sha
    return entries


def local_files(repo: Path, *, ignored: bool) -> list[str]:
    """Untracked paths, either the visible ones or the ignored ones."""
    flags = ["--others", "-z"]
    flags += ["--ignored", "--exclude-standard"] if ignored else ["--exclude-standard"]
    return _zsplit(git("ls-files", *flags, repo=repo))


def collisions(ref: str, repo: Path, scope: str | None, *, ignored: bool) -> list[tuple[str, bool]]:
    """(path, identical) for local files whose name is tracked at `ref`."""
    blobs = tracked_blobs(ref, repo)
    found = []
    for path in local_files(repo, ignored=ignored):
        if scope and not path.startswith(scope):
            continue
        upstream = blobs.get(path)
        if upstream is None:
            continue
        local = git("hash-object", path, repo=repo).strip()
        found.append((path, local == upstream))
    return sorted(found)


def report(title: str, note: str, items: list[tuple[str, bool]]) -> None:
    if not items:
        return
    print(f"\n{title}")
    print(f"  {note}")
    same = [p for p, ident in items if ident]
    diff = [p for p, ident in items if not ident]
    if diff:
        print(f"\n  holds content the ref does not have -- rescue before removing ({len(diff)}):")
        for p in diff:
            print(f"    {p}")
    if same:
        print(f"\n  byte-identical to the ref's copy -- safe to delete ({len(same)}):")
        for p in same:
            print(f"    {p}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ref", default="origin/devel", help="ref to compare against (default: origin/devel)")
    ap.add_argument("--repo", default=".", type=Path, help="repository to inspect (default: cwd)")
    ap.add_argument("--scope", default="", help="restrict to a path prefix, e.g. backend/")
    args = ap.parse_args()

    repo = args.repo.resolve()
    try:
        git("rev-parse", "--verify", "--quiet", args.ref, repo=repo)
    except subprocess.CalledProcessError:
        print(f"ref not found: {args.ref} (fetch first?)", file=sys.stderr)
        return 2

    visible = collisions(args.ref, repo, args.scope, ignored=False)
    hidden = collisions(args.ref, repo, args.scope, ignored=True)

    if not visible and not hidden:
        where = args.scope or "the working tree"
        print(f"No collisions: a fast-forward to {args.ref} would not touch anything in {where}.")
        return 0

    report(
        f"Would BLOCK a fast-forward to {args.ref} ({len(visible)}):",
        "git refuses the merge and names these, so nothing is lost yet.",
        visible,
    )
    report(
        f"Would be SILENTLY OVERWRITTEN by {args.ref} ({len(hidden)}):",
        "these are ignored, so git replaces them during checkout without warning.",
        hidden,
    )
    print("\nCopy anything in the first list of each section somewhere outside the repo before syncing.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
