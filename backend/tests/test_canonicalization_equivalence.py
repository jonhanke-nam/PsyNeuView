"""Equivalence harness — strategy (b) from #215.

Pins that *textually different but semantically equivalent* PsyNeuLink
sources normalize to the same standardized form when run through
``convert_to_standard_format``. Catches structural drift in either the
canonicalizer or any future write-path (e.g. inspector edits, port
management) that emits source the canonicalizer should treat as
equivalent.

Scope (intentional carve-out, see #215):

- Strategy (b) only: code-standardization equivalence. Behavioral
  equivalence (strategy a — same numerical outputs at run-time) is
  separate work (#221).

Reference models:

- ``simple_stroop`` — TransferMechanisms + MappingProjections.
- ``feedforward_network`` — 3-layer feedforward (#222).
- ``neural_network_with_ddm`` — TransferMechanisms feeding a ``DDM`` with
  non-default ``DriftDiffusionAnalytical`` parameters; pins DDM
  function-kwarg serialization (#222).
- ``nested_compositions`` — outer composition containing an inner
  composition alongside a top-level mechanism; pins nested-composition
  emission order so each ``add_node(<nested>)`` reference resolves
  forward (#234).

``scheduling_demo`` is intentionally *not* in the equivalence matrix: the
canonicalizer drops scheduler conditions entirely, so all of its textual
variants would normalize identically (passing the matrix) while silently
losing the conditions — false confidence. Instead it gets a dedicated
characterization test (``test_scheduling_demo_conditions_dropped_gap``) that
pins the current lossy behavior and references the round-trip gap tracked in
#85 (#222).

Variant kinds (per model):

- ``canonical`` — alias import, tight formatting, alphabetically pre-sorted.
- ``star_import`` — ``from psyneulink import *``.
- ``comments_whitespace`` — heavy comments + looser formatting.
- ``reordered`` *(simple_stroop only, pins #220)* — declarations and
  composition members all scrambled relative to canonical order.
"""

import shutil
import tempfile
from pathlib import Path

import pytest

from app.services.converter import convert_to_standard_format


FIXTURES = Path(__file__).parent / "fixtures" / "equivalence"


MODELS: dict[str, dict[str, str]] = {
    "simple_stroop": {
        "canonical": "simple_stroop_v1_canonical.py",
        "star_import": "simple_stroop_v2_star_import.py",
        "comments_whitespace": "simple_stroop_v3_comments_whitespace.py",
        "reordered": "simple_stroop_v4_reordered.py",
    },
    "feedforward_network": {
        "canonical": "feedforward_network_v1_canonical.py",
        "star_import": "feedforward_network_v2_star_import.py",
        "comments_whitespace": "feedforward_network_v3_comments_whitespace.py",
    },
    "neural_network_with_ddm": {
        "canonical": "neural_network_with_ddm_v1_canonical.py",
        "star_import": "neural_network_with_ddm_v2_star_import.py",
        "comments_whitespace": "neural_network_with_ddm_v3_comments_whitespace.py",
    },
    "nested_compositions": {
        "canonical": "nested_compositions_v1_canonical.py",
        "star_import": "nested_compositions_v2_star_import.py",
        "comments_whitespace": "nested_compositions_v3_comments_whitespace.py",
    },
}


def _canonicalize(fixture_name: str) -> str:
    """Copy a fixture to a temp dir and run the canonicalizer on it."""
    src = FIXTURES / fixture_name
    with tempfile.TemporaryDirectory() as tmpdir:
        dst = Path(tmpdir) / fixture_name
        shutil.copy2(src, dst)
        return convert_to_standard_format(str(dst), backup=False)


@pytest.fixture(scope="module", params=list(MODELS.keys()))
def model_variants(request) -> tuple[str, dict[str, str]]:
    """For each model, return (model_name, {variant_kind: canonical_output})."""
    model = request.param
    return model, {
        kind: _canonicalize(filename)
        for kind, filename in MODELS[model].items()
    }


def test_all_variants_have_standardized_header(model_variants):
    """Every variant produces output starting with the format header."""
    model, variants = model_variants
    for kind, out in variants.items():
        assert out.startswith("# PsyNeuLink Model File"), (
            f"{model}.{kind} canonical output missing standardized header:\n"
            f"first 100 chars: {out[:100]!r}"
        )


def test_star_import_normalizes_to_pnl_alias(model_variants):
    """``from psyneulink import *`` variants must emit the alias form."""
    _, variants = model_variants
    star = variants["star_import"]
    assert "import psyneulink as pnl" in star
    assert "from psyneulink import *" not in star


def test_canonical_matches_star_import_variant(model_variants):
    """canonical and star_import variants produce identical output."""
    model, variants = model_variants
    a = variants["canonical"]
    b = variants["star_import"]
    assert a == b, _diff(a, b, f"{model}.canonical", f"{model}.star_import")


def test_canonical_matches_comment_whitespace_variant(model_variants):
    """canonical and comments_whitespace variants produce identical output."""
    model, variants = model_variants
    a = variants["canonical"]
    b = variants["comments_whitespace"]
    assert a == b, _diff(a, b, f"{model}.canonical", f"{model}.comments_whitespace")


def test_canonical_matches_reordered_variant(model_variants):
    """canonical and reordered variants produce identical output (pins #220).

    Skipped for models that don't ship a reordered fixture.
    """
    model, variants = model_variants
    if "reordered" not in variants:
        pytest.skip(f"{model} has no reordered variant")
    a = variants["canonical"]
    b = variants["reordered"]
    assert a == b, _diff(a, b, f"{model}.canonical", f"{model}.reordered")


def test_all_variants_identical(model_variants):
    """Transitive check: every variant of a given model normalizes identically."""
    model, variants = model_variants
    outputs = list(variants.values())
    assert all(out == outputs[0] for out in outputs[1:]), (
        f"Not all {model} variants normalized to the same output. "
        f"See pairwise tests above for the specific diff."
    )


_CONDITION_MARKERS = (
    "add_condition",
    "BeforeNode",
    "AddEdgeTo",
    "AfterNode",
    "WithNode",
    "EveryNCalls",
    "AfterNCalls",
)


def test_scheduling_demo_conditions_dropped_gap():
    """Characterize (don't mask) the canonicalizer's scheduler-condition loss.

    ``scheduling_demo`` carries graph-structure and timing conditions. The
    canonicalizer currently emits no ``scheduler`` block at all, so every
    condition is dropped on the way through ``convert_to_standard_format``.

    This is the gap #222 anticipated for ``scheduling_demo`` and is tracked for
    a real fix in #85 (Scheduler Conditions lossy on round-trip). The model is
    deliberately kept out of the equivalence matrix above — adding it there
    would "pass" while hiding the loss. When #85 is fixed this test will start
    failing, which is the signal to promote ``scheduling_demo`` into ``MODELS``
    with full variant coverage.
    """
    out = _canonicalize("scheduling_demo_conditions.py")
    surviving = [m for m in _CONDITION_MARKERS if m in out]
    assert not surviving, (
        "Scheduler conditions unexpectedly survived canonicalization: "
        f"{surviving}. If #85 was fixed, promote scheduling_demo into the "
        "MODELS equivalence matrix and delete this characterization test."
    )


def _diff(a: str, b: str, name_a: str, name_b: str) -> str:
    """Compact diff helper for failure messages."""
    import difflib

    diff_lines = difflib.unified_diff(
        a.splitlines(),
        b.splitlines(),
        fromfile=name_a,
        tofile=name_b,
        lineterm="",
    )
    return "Canonical outputs differ:\n" + "\n".join(diff_lines)
