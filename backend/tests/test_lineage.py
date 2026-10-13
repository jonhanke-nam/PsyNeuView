"""Tests for the vendored-provenance ("lineage") parser (#835)."""

from pathlib import Path

import pytest

from app.services.lineage import parse_lineage

BOTVINICK_HEADER = """\
# Vendored from PsyNeuLink — PrincetonUniversity/PsyNeuLink
# Source: psyneulink/library/models/Botvinick_conflict_monitoring_model.py
# Pinned commit: 83cc4165b7 (v0.19.1.0-10-g83cc4165b7, 2026-08-01)
# Vendored: 2026-08-04 for PsyNeuView reference-model seamless load (Refs #806, #808)
#
# Curated extract: the composition construction only.
import numpy as np
import psyneulink as pnl
"""


def test_parses_full_header():
    lin = parse_lineage(BOTVINICK_HEADER)
    assert lin is not None
    assert lin["repo"] == "PrincetonUniversity/PsyNeuLink"
    assert lin["sourcePath"] == "psyneulink/library/models/Botvinick_conflict_monitoring_model.py"
    assert lin["commit"] == "83cc4165b7"
    assert lin["commitTag"] == "v0.19.1.0-10-g83cc4165b7"
    assert lin["vendoredDate"] == "2026-08-04"
    assert lin["refs"] == ["#806", "#808"]
    assert lin["url"] == (
        "https://github.com/PrincetonUniversity/PsyNeuLink/blob/83cc4165b7/"
        "psyneulink/library/models/Botvinick_conflict_monitoring_model.py"
    )


def test_none_for_no_header():
    assert parse_lineage("import psyneulink as pnl\n# Refs #123 in a comment\n") is None
    assert parse_lineage("") is None
    assert parse_lineage(None) is None


def test_ignores_refs_outside_header_block():
    # A "Refs #999" far down the file must not be mistaken for provenance, and
    # without a "Vendored from" line there is no lineage at all.
    body = "import psyneulink as pnl\n" + "\n".join(f"# line {i}" for i in range(40))
    body += "\n# Refs #999\n"
    assert parse_lineage(body) is None


def test_partial_header_no_url_without_commit():
    src = (
        "# Vendored from PsyNeuLink — PrincetonUniversity/PsyNeuLink\n"
        "# Source: psyneulink/library/models/Foo.py\n"
        "import psyneulink as pnl\n"
    )
    lin = parse_lineage(src)
    assert lin is not None
    assert lin["repo"] == "PrincetonUniversity/PsyNeuLink"
    assert lin["sourcePath"] == "psyneulink/library/models/Foo.py"
    assert lin["commit"] is None
    assert lin["url"] is None  # can't build a permalink without a commit


def _reference_dir():
    d = Path(__file__).resolve().parent.parent / "reference_models"
    return d if d.is_dir() else None


REF_DIR = _reference_dir()


@pytest.mark.skipif(REF_DIR is None, reason="reference_models dir not found")
def test_vendored_reference_files_carry_parseable_lineage():
    """Every vendored reference file with a 'Vendored from' header must parse to
    a complete lineage (repo + source + commit + url).

    Files without the header (e.g. EGO, tracked in #791) are reported but not
    failed — this documents the coverage gap without blocking.
    """
    missing_header = []
    for py in sorted(REF_DIR.glob("*.py")):
        src = py.read_text()
        lin = parse_lineage(src)
        if lin is None:
            missing_header.append(py.name)
            continue
        assert lin["repo"], f"{py.name}: no repo parsed"
        assert lin["sourcePath"], f"{py.name}: no sourcePath parsed"
        assert lin["commit"], f"{py.name}: no commit parsed"
        assert lin["url"], f"{py.name}: no GitHub url built"

    # Informational: which bundled models still lack a provenance header.
    print(f"reference models without a lineage header: {missing_header}")
