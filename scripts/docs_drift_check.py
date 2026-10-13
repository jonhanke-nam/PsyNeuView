#!/usr/bin/env python3
"""Docs-drift guard for ``docs/testing.md`` (#826).

Checks the machine-verifiable invariants that tend to drift silently between the
CI workflows and the testing doc:

1. **PsyNeuLink pin** — the ``PSYNEULINK_GIT_REF`` the workflows install must be
   cited in ``docs/testing.md`` (this is exactly what went stale before #825:
   the pin had moved to the 0.19 sync but the doc still said ``jonhanke-dev``).
2. **Gate-workflow coverage** — every test/typecheck gate workflow (one that
   pins PsyNeuLink or runs ``tsc``) must be named in ``docs/testing.md``, so a
   newly added suite can't skip documentation.

Prints a human-readable report and exits non-zero if anything is out of sync.
Deliberately does NOT check the ``~N files`` counts (they're approximate and
churn every PR) or the ``devel`` required-check set (reading branch protection
needs an admin token) — those stay with the periodic human review (#826).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW_DIR = ROOT / ".github" / "workflows"
DOC = ROOT / "docs" / "testing.md"
SELF_WORKFLOW = "docs-drift-guard.yml"


def main() -> int:
    if not DOC.exists():
        print(f"drift-guard: {DOC.relative_to(ROOT)} is missing")
        return 1

    doc_text = DOC.read_text()
    problems: list[str] = []

    workflows = sorted(WORKFLOW_DIR.glob("*.yml"))

    # 1. PsyNeuLink pin cited in the doc.
    refs: set[str] = set()
    for wf in workflows:
        for m in re.finditer(r"PSYNEULINK_GIT_REF:\s*([0-9a-fA-F]{7,40})", wf.read_text()):
            refs.add(m.group(1))
    for ref in sorted(refs):
        if ref[:10] not in doc_text:
            problems.append(
                f"PsyNeuLink pin '{ref[:12]}' (in workflows) is not cited in docs/testing.md"
            )

    # 2. Every gate workflow (pins PsyNeuLink or runs tsc) is documented.
    for wf in workflows:
        if wf.name == SELF_WORKFLOW:
            continue
        content = wf.read_text()
        is_gate = "PSYNEULINK_GIT_REF" in content or "tsc" in content
        if is_gate and wf.name not in doc_text:
            problems.append(f"gate workflow '{wf.name}' is not mentioned in docs/testing.md")

    if problems:
        print("DOCS DRIFT DETECTED — docs/testing.md is out of sync with CI workflows:")
        for p in problems:
            print(f"  - {p}")
        print("\nUpdate docs/testing.md (see its 'Keeping this doc current' section).")
        return 1

    print("docs/testing.md is in sync with the CI workflows (PsyNeuLink pin + gate list).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
