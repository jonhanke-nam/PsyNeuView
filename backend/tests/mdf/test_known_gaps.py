"""Pins the *current* behavior of known MDF round-trip gaps (#82-#87).

These are regression-protection tests, not aspirations: each one asserts
what the round-trip does **today**, including the broken parts. When an
upstream PsyNeuLink fix lands, the corresponding pinned-failure test will
start failing — that's the signal to flip it to a full
``assert_round_trip_equivalent`` check.

Gap map (PsyNeuView issue → upstream PsyNeuLink issue):

* #82 nested Compositions   → jonhanke-nam/PsyNeuLink#3 (import crashes)
* #83 conjoint Compositions → jonhanke-nam/PsyNeuLink#4 (shared identity lost)
* #84 2D MatrixTransform    → jonhanke-nam/PsyNeuLink#5 (exporter truncates)
* #87 stateful semantics    → modeci_mdf reference engine divergence
"""
from pathlib import Path

import pytest

pytest.importorskip("modeci_mdf")

from app.services.mdf_metadata import _canonical
from tests.mdf.harness import (
    assert_round_trip_equivalent,
    exec_model,
    export_to_mdf,
    regenerate_script,
    top_level_compositions,
)

FIXTURES = Path(__file__).parent.parent / "fixtures" / "mdf"


def test_nested_composition_import_crashes(tmp_path):
    """#82: export of a nested Composition "succeeds", but re-importing the
    resulting MDF crashes inside generate_script_from_mdf. The failure today
    is a hard error, not silent structure loss. Flip to
    assert_round_trip_equivalent once upstream PsyNeuLink#3 is fixed."""
    module = exec_model(FIXTURES / "nested_comps.py")
    comps = top_level_compositions(module)
    assert [c.name for c in comps] == [module.outer.name]

    mdf_path = export_to_mdf(module.outer, tmp_path / "nested.json")
    with pytest.raises(TypeError):
        regenerate_script(mdf_path, tmp_path / "regen.py")


def test_conjoint_shared_mechanism_identity_lost(tmp_path):
    """#83: two Compositions sharing one mechanism round-trip into two
    *separate* mechanisms (the regenerated script re-instantiates "shared"
    once per composition). Each graph looks right in isolation; the shared
    object identity — and with it any cross-composition state — is silently
    lost. Flip to an identity-preserving assertion once upstream
    PsyNeuLink#4 is fixed."""
    module = exec_model(FIXTURES / "conjoint_comps.py")
    assert module.shared in module.c1.nodes
    assert module.shared in module.c2.nodes

    mdf_path = export_to_mdf([module.c1, module.c2], tmp_path / "conjoint.json")
    script_path = regenerate_script(mdf_path, tmp_path / "regen.py")

    regen = exec_model(script_path)
    comps = sorted(top_level_compositions(regen), key=lambda c: _canonical(c.name))
    assert [_canonical(c.name) for c in comps] == ["c1", "c2"]

    def shared_node(comp):
        matches = [n for n in comp.nodes if _canonical(n.name) == "shared"]
        assert len(matches) == 1, f"{comp.name}: {[n.name for n in comp.nodes]}"
        return matches[0]

    # Pinned current behavior: identity is LOST (two distinct objects).
    assert shared_node(comps[0]) is not shared_node(comps[1])


def test_matrix_2d_weights_round_trip(tmp_path):
    """#84: a non-square explicit weight matrix survives the round-trip
    (structure + numerics). The genuinely-corrupting case — a MatrixTransform
    with a 2D *variable*, which the exporter truncates to its last row
    (projection.py:1251) — is not constructible from a vanilla model script,
    so this pins the closest user-reachable path; upstream PsyNeuLink#5
    tracks the real fix."""
    assert_round_trip_equivalent(FIXTURES / "matrix_2d.py", tmp_path)


def test_stateful_integrator_round_trip(tmp_path):
    """#87: stateful parameters round-trip cleanly PNL→PNL — structure and
    multi-trial numerics both match (0.5, 1.0, 1.5 for three trials of a
    rate-0.5 SimpleIntegrator). The #87 divergence is in modeci_mdf's
    *reference execution engine*, i.e. non-PsyNeuLink consumers of the
    exported MDF; that engine's input-feeding semantics differ and are out
    of scope for this PNL→PNL harness."""
    report = assert_round_trip_equivalent(
        FIXTURES / "stateful_integrator.py", tmp_path, num_trials=3
    )
    results_a, _ = report["results"]
    # Guard that the run actually exercised state: strictly increasing trials.
    flat = results_a.flatten()
    assert list(flat) == sorted(set(flat)) and len(flat) == 3
