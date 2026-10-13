#!/usr/bin/env python3
"""Surface-coverage check: is every user-facing surface documented? (#826)

The docs-drift guard (`docs_drift_check.py`) catches docs that *became* false.
This catches the other failure mode: a surface that exists and was never
documented at all. Nothing contradicts anything, so drift-checking is blind to
it — the gap is only visible by diffing the surface against the docs.

Found this way: `make status` was absent from the README for its whole life,
including the part that reports which checkout each server is serving (#983) —
a safeguard that only helps if people know it exists.

Checks:
  1. `make` targets carrying `##` help text  ->  README command table
  2. Bundled reference models                ->  docs/reference-models/
  3. Tutorials that name a reference model   ->  link to that model's doc

Exits non-zero if anything is undocumented. Deliberately reports rather than
guesses: some surfaces are intentionally internal, so the fix may be to
document it *or* to drop its help text — but somebody should decide.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Targets that exist for scripting/CI and are deliberately not in the README's
# "key ones" table. Listing them here is the decision, recorded.
INTERNAL_TARGETS = {
    "back-to-devel",      # release-workflow helper
    "checkout-release",   # release-workflow helper
    "clean-frontend",     # covered by `make clean`
    "clean-venv",         # covered by `make clean`
    "release-pdfs",       # release artefact generation
    "stop-all",           # emergency variant of `make stop`
}

# Reference models with no standalone doc page, and why.
MODELS_WITHOUT_DOCS: dict[str, str] = {}


def make_targets() -> set[str]:
    """Targets with `##` help text — i.e. ones `make help` advertises."""
    text = (ROOT / "Makefile").read_text()
    return set(re.findall(r"^([a-z][a-z0-9-]*):[^\n]*##", text, re.M))


def readme_targets() -> set[str]:
    """Targets named anywhere in the README, not only in the command table.

    A target mentioned in prose ("to stop everything: `make stop`") is
    documented, so matching the whole file avoids demanding a table row for
    something already explained.
    """
    text = (ROOT / "README.md").read_text()
    return {m.group(1) for m in re.finditer(r"`make ([a-z][a-z0-9-]*)`", text)}


def reference_models() -> set[str]:
    d = ROOT / "backend" / "reference_models"
    return {p.stem for p in d.glob("*.py")} if d.is_dir() else set()


def documented_models() -> int:
    """How many models the reference-models index actually links a page for.

    Doc filenames are slugs (`stroop-basic.md`) while models are Python stems
    (`stroop_reference_basic`), and the pages do not name their stem — an
    earlier version of this check matched on the stem and produced two false
    positives for models that *are* documented. The index table is the
    authoritative mapping, so count the pages it links and compare counts
    rather than trying to normalise slugs into stems.
    """
    index = ROOT / "docs" / "reference-models" / "README.md"
    if not index.is_file():
        return 0
    linked = set(re.findall(r"\(([a-z0-9-]+\.md)\)", index.read_text()))
    return len({name for name in linked if (index.parent / name).is_file()})


def tutorial_model_links() -> list[str]:
    """Tutorials naming a reference model but not linking to its doc."""
    names = {
        "EGO": "ego.md",
        "Stroop — Basic": "stroop-basic.md",
        "Stroop — with LC": "stroop-with-lc.md",
    }
    problems = []
    for p in sorted((ROOT / "docs" / "tutorials").glob("[01]*.md")):
        text = p.read_text()
        for name, target in names.items():
            # Named in the header region (the "What you need" block) but with
            # no link anywhere to that model's page.
            if f"**{name}**" in text[:900] and f"reference-models/{target}" not in text:
                problems.append(f"{p.name}: names {name!r} but never links reference-models/{target}")
    return problems


def main() -> int:
    problems: list[str] = []

    undocumented = make_targets() - readme_targets() - INTERNAL_TARGETS
    for t in sorted(undocumented):
        problems.append(
            f"make target '{t}' has help text but is never mentioned in the README "
            f"(document it, drop its ## help, or add it to INTERNAL_TARGETS)"
        )

    n_models = len(reference_models())
    n_docs = documented_models()
    if n_docs < n_models - len(MODELS_WITHOUT_DOCS):
        problems.append(
            f"{n_models} bundled reference models but only {n_docs} linked pages under "
            f"docs/reference-models/ — one or more models has no walkthrough"
        )

    problems.extend(tutorial_model_links())

    if problems:
        print("Undocumented surfaces:\n")
        for p in problems:
            print(f"  - {p}")
        print(f"\n{len(problems)} gap(s). See #826.")
        return 1

    print("Surface coverage: make targets, reference models and tutorial links all documented.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
