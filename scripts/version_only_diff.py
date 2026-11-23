#!/usr/bin/env python3
"""Is the diff BASE..HEAD nothing but a PsyNeuView version bump? (#299)

    python3 scripts/version_only_diff.py BASE HEAD

Exits 0 only when it is. Every CI `changes` job calls this after its path
filter has said "run": a release's version-bump PR changes nothing that could
change behaviour, and devel already passed the same jobs on the same code, so
the heavy jobs (backend pytest, tutorials) can skip it.

A diff counts as a version bump only when every changed file is one of these,
modified in place (no add, delete, rename or mode change), and the only lines
that differ are the version lines named here:

    backend/app/__init__.py   the `__version__ = "..."` line
    backend/pyproject.toml    the `version = "..."` line in the [project] table
    backend/uv.lock           the `version = "..."` line in psyneuview's own
                              [[package]] block

Anything else -- another file, a dependency, an extra line in the lock, an
empty diff, a git error -- exits 1, so CI runs everything. The script fails
safe: when in doubt, it says "not version only".
"""

import re
import subprocess
import sys

PACKAGE = "psyneuview"
VERSION_LINE = re.compile(r'^(\s*(?:__version__|version)\s*=\s*)"[^"\n]*"(\s*)$')


def _mask(line):
    """The line with its quoted version replaced, or None if not a version line."""
    m = VERSION_LINE.match(line)
    return f'{m.group(1)}"<version>"{m.group(2)}' if m else None


def mask_init(text):
    lines = text.split("\n")
    hits = [i for i, ln in enumerate(lines) if ln.startswith("__version__")]
    if len(hits) != 1 or _mask(lines[hits[0]]) is None:
        return None
    lines[hits[0]] = _mask(lines[hits[0]])
    return "\n".join(lines)


def mask_pyproject(text):
    lines = text.split("\n")
    table = None
    for i, ln in enumerate(lines):
        header = re.match(r"^\s*\[([^\[\]]+)\]\s*$", ln)
        if header:
            table = header.group(1).strip()
        elif table == "project" and ln.startswith("version"):
            masked = _mask(ln)
            if masked is None:
                return None
            lines[i] = masked
            return "\n".join(lines)
    return None


def mask_lock(text):
    lines = text.split("\n")
    in_ours = False
    for i, ln in enumerate(lines):
        if ln.strip() == "[[package]]":
            in_ours = False
        elif ln == f'name = "{PACKAGE}"':
            in_ours = True
        elif in_ours and ln.startswith("version"):
            masked = _mask(ln)
            if masked is None:
                return None
            lines[i] = masked
            return "\n".join(lines)
        elif in_ours and (ln.strip() == "" or ln.startswith("[")):
            in_ours = False
    return None


MASKERS = {
    "backend/app/__init__.py": mask_init,
    "backend/pyproject.toml": mask_pyproject,
    "backend/uv.lock": mask_lock,
}


def git(*args):
    return subprocess.run(
        ["git", *args], check=True, capture_output=True, text=True
    ).stdout


def why_not(base, head):
    """None if BASE..HEAD is a version bump only, else the reason it is not."""
    raw = git("diff", "--raw", "--no-renames", "-z", base, head)
    fields = raw.split("\0")
    changed = []
    # --raw -z: ":oldmode newmode oldsha newsha STATUS\0path\0" per file.
    for meta, path in zip(fields[0::2], fields[1::2]):
        if not meta:
            continue
        old_mode, new_mode, _, _, status = meta.lstrip(":").split(" ")
        if path not in MASKERS:
            return f"{path} is not a version file"
        if status != "M" or old_mode != new_mode:
            return f"{path}: {status} with mode {old_mode} -> {new_mode}, not an in-place edit"
        changed.append(path)
    if not changed:
        return "nothing changed"
    for path in changed:
        mask = MASKERS[path]
        before = mask(git("show", f"{base}:{path}"))
        after = mask(git("show", f"{head}:{path}"))
        if before is None or after is None:
            return f"{path}: version line not found where expected"
        if before != after:
            return f"{path}: lines other than the version line changed"
    return None


def main(argv):
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        reason = why_not(argv[1], argv[2])
    except Exception as exc:  # any failure means "not version only": run everything
        print(f"version-only check failed ({exc}); treating as not version only", file=sys.stderr)
        return 1
    if reason:
        print(f"not version only: {reason}", file=sys.stderr)
        return 1
    print("version only: the heavy jobs can skip (#299)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
