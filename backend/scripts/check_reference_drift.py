#!/usr/bin/env python3
"""Check vendored upstream reference models for drift against their source (#777; umbrella #577).

Each file in ``backend/reference_models/upstream/`` is a verbatim copy of an
upstream PsyNeuLink ``Scripts/Examples`` model, prefixed with a provenance
header naming its source path and the pinned PsyNeuLink commit it was taken
from. Over time upstream changes; this surfaces that so a human can decide
whether to re-vendor.

Two checks per file:

- **FIDELITY** — the vendored body (header stripped) must equal the upstream
  file *at the pinned commit*. A mismatch means our copy was hand-edited or the
  pinned ref is wrong. This is the hard error.
- **DRIFT** — whether upstream changed that file *since* the pinned commit.
  Informational: it means a newer version exists to consider re-vendoring.

This is a **review-time** tool, not a hermetic CI test: it needs the upstream
PsyNeuLink source tree present (that tree is exactly what we vendored *away*
from depending on in CI). If the tree is absent it skips cleanly. Surface it as
the "reference-model drift" status line in the /daily-backlog review.

Usage:
    python backend/scripts/check_reference_drift.py            # report
    PNL_SOURCE=/path/to/PsyNeuLink python .../check_reference_drift.py
Exit codes: 0 = all fidelity-clean (drift is informational); 1 = a fidelity
mismatch; 2 = upstream tree not found (skipped).
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

UPSTREAM_DIR = Path(__file__).resolve().parent.parent / "reference_models" / "upstream"
DEFAULT_SOURCE = Path.home() / ".psyneuview" / "sources" / "PsyNeuLink-PrincetonUniversity"
HEADER_SEP = "# " + "-" * 77  # matches the vendored-header separator line

SOURCE_RE = re.compile(r"^#\s*Source:\s*(.+?)\s*$", re.M)
COMMIT_RE = re.compile(r"^#\s*Pinned commit:\s*([0-9a-f]{7,40})", re.M)


def _git(repo: Path, *args: str) -> tuple[int, str]:
    p = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True,
    )
    return p.returncode, (p.stdout if p.returncode == 0 else p.stderr)


def _strip_header(text: str) -> str:
    """Return the vendored body — everything after the header separator line."""
    idx = text.find(HEADER_SEP)
    if idx == -1:
        return text
    nl = text.find("\n", idx)
    return text[nl + 1:] if nl != -1 else ""


def main() -> int:
    source = Path(os.environ.get("PNL_SOURCE", DEFAULT_SOURCE))
    if not (source / ".git").exists():
        print(f"reference-drift: upstream source tree not found at {source} — skipped.")
        print("  (set PNL_SOURCE to the pinned PsyNeuLink checkout to enable the check.)")
        return 2

    files = sorted(UPSTREAM_DIR.glob("*.py"))
    if not files:
        print("reference-drift: no vendored upstream models yet.")
        return 0

    # Pick the freshest upstream ref available to measure drift against.
    rc, _ = _git(source, "rev-parse", "--verify", "origin/devel")
    drift_ref = "origin/devel" if rc == 0 else "HEAD"

    fidelity_failures = 0
    drifted = []
    clean = 0
    for f in files:
        text = f.read_text()
        m_src, m_commit = SOURCE_RE.search(text), COMMIT_RE.search(text)
        if not (m_src and m_commit):
            print(f"  ⚠ {f.name}: missing/!parseable provenance header — cannot check.")
            fidelity_failures += 1
            continue
        src_path, pinned = m_src.group(1), m_commit.group(1)

        rc, upstream_at_pin = _git(source, "show", f"{pinned}:{src_path}")
        if rc != 0:
            print(f"  ⚠ {f.name}: cannot read {src_path}@{pinned[:9]} upstream — {upstream_at_pin.strip()[:80]}")
            fidelity_failures += 1
            continue

        if _strip_header(text).rstrip("\n") != upstream_at_pin.rstrip("\n"):
            print(f"  ✗ FIDELITY {f.name}: vendored body != {src_path}@{pinned[:9]} (edited or wrong pin).")
            fidelity_failures += 1
            continue

        rc, log = _git(source, "log", "--oneline", f"{pinned}..{drift_ref}", "--", src_path)
        changes = [ln for ln in log.splitlines() if ln.strip()]
        if changes:
            drifted.append((f.name, src_path, pinned, changes))
            print(f"  ⟳ DRIFT {f.name}: {len(changes)} upstream commit(s) since {pinned[:9]} (vs {drift_ref}).")
        else:
            clean += 1
            print(f"  ✓ {f.name}: fidelity ok, no drift since {pinned[:9]}.")

    print(
        f"reference-drift: {clean} clean, {len(drifted)} drifted, "
        f"{fidelity_failures} fidelity issue(s). Drift ref: {drift_ref} "
        f"(run `git -C {source} fetch` first for freshness)."
    )
    return 1 if fidelity_failures else 0


if __name__ == "__main__":
    sys.exit(main())
