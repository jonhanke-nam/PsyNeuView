"""Warnings for the known MDF round-trip gaps (#83, #84, #85, #87).

``find_mdf_gaps`` inspects the live Composition before an MDF export, and
``detect_shared_nodes`` reads an MDF file before import. Each gap is pinned
as it behaves today in test_known_gaps.py / test_condition_round_trip.py;
these tests check the warnings fire for those cases and stay quiet otherwise.
"""
from pathlib import Path
from types import SimpleNamespace

import psyneulink as pnl

from app.services.mdf_metadata import detect_shared_nodes
from app.services.sandbox_worker import (
    _mdf_matrix_2d_variable_projections,
    find_mdf_gaps,
)
from tests.mdf.harness import exec_model

FIXTURES = Path(__file__).parent.parent / "fixtures" / "mdf"


def _by_issue(gaps):
    return {g["issue"]: g for g in gaps}


def _chain():
    a = pnl.TransferMechanism(name="a")
    b = pnl.TransferMechanism(name="b")
    d = pnl.TransferMechanism(name="d")
    comp = pnl.Composition(name="chain")
    comp.add_linear_processing_pathway([a, b, d])
    return comp, a, b, d


def test_a_plain_model_has_nothing_to_warn_about():
    module = exec_model(FIXTURES / "basic_linear.py")
    comp = next(v for v in vars(module).values() if isinstance(v, pnl.Composition))
    assert find_mdf_gaps(module, comp) == []


def test_83_a_component_shared_with_another_composition_is_flagged():
    module = exec_model(FIXTURES / "conjoint_comps.py")
    gap = _by_issue(find_mdf_gaps(module, module.c1))[83]
    assert gap["items"] == ["shared (also in c2)"]
    assert gap["upstream"].endswith("PsyNeuLink/issues/4")


def test_83_shared_nodes_are_found_when_importing_an_mdf_file():
    from psyneulink.core.globals.mdf import get_mdf_serialized

    module = exec_model(FIXTURES / "conjoint_comps.py")
    both = get_mdf_serialized(module.c1, module.c2, fmt="json")
    assert detect_shared_nodes(both, "json") == ["shared (in c1, c2)"]
    assert detect_shared_nodes(get_mdf_serialized(module.c1, fmt="yaml"), "yaml") == []
    assert detect_shared_nodes("not: [valid", "yaml") == []


class MatrixTransform:
    """Stand-in: a projection with a 2D variable can't be built from a model
    script (see test_known_gaps), so the check is exercised on its shape."""

    def _is_identity(self, defaults=False):
        return False


def _projection(name, variable):
    return SimpleNamespace(name=name, function=MatrixTransform(), defaults=SimpleNamespace(variable=variable))


def test_84_a_2d_variable_projection_is_flagged_and_1d_is_not():
    comp = SimpleNamespace(projections=[
        _projection("p_2d", [[0.0, 0.0], [0.0, 0.0], [0.0, 0.0]]),
        _projection("p_1row", [[0.0, 0.0]]),
        _projection("p_1d", [0.0, 0.0]),
    ])
    assert _mdf_matrix_2d_variable_projections(comp) == ["p_2d (variable 3×2)"]


def test_84_ordinary_weight_matrices_are_not_flagged():
    module = exec_model(FIXTURES / "matrix_2d.py")
    comp = next(v for v in vars(module).values() if isinstance(v, pnl.Composition))
    assert 84 not in _by_issue(find_mdf_gaps(module, comp))


def test_85_only_the_conditions_that_break_are_flagged():
    comp, a, b, d = _chain()
    comp.scheduler.add_condition(b, pnl.All(pnl.EveryNCalls(a, 1), pnl.While(lambda: True)))
    comp.scheduler.add_condition(d, pnl.WhenFinishedAny(a, b))
    module = SimpleNamespace(chain=comp)
    items = _by_issue(find_mdf_gaps(module, comp))[85]["items"]
    assert len(items) == 2
    assert items[0].startswith("b — While:")
    assert items[1] == "d — WhenFinishedAny: the import fails"


def test_85_conditions_that_survive_are_not_flagged():
    comp, a, b, d = _chain()
    comp.scheduler.add_condition(b, pnl.Any(pnl.AtPass(1), pnl.EveryNCalls(a, 2)))
    comp.scheduler.add_condition(d, pnl.Threshold(b, "variable", 0.5, ">="))
    comp.scheduler.termination_conds = {pnl.TimeScale.TRIAL: pnl.AfterNCalls(d, 1)}
    assert find_mdf_gaps(SimpleNamespace(chain=comp), comp) == []


def test_85_a_threshold_on_a_renamed_node_or_a_port_is_flagged():
    comp, a, b, d = _chain()
    spaced = pnl.TransferMechanism(name="my input")
    comp.add_node(spaced)
    comp.scheduler.add_condition(b, pnl.Threshold(spaced, "value", 0.5, ">="))
    comp.scheduler.add_condition(d, pnl.Threshold(a.output_port, "value", 0.5, ">="))
    items = _by_issue(find_mdf_gaps(SimpleNamespace(chain=comp), comp))[85]["items"]
    assert items == [
        "b — Threshold on my input's value: the imported script fails "
        "(the name isn't a plain identifier, so MDF renames the node)",
        f"d — Threshold on the port {a.output_port.name}: the import fails",
    ]


def test_85_a_threshold_on_a_plainly_named_value_is_not_flagged():
    comp, a, b, d = _chain()
    comp.scheduler.add_condition(b, pnl.Threshold(a, "value", 0.5, ">="))
    assert find_mdf_gaps(SimpleNamespace(chain=comp), comp) == []


def test_87_random_noise_gets_a_notice_and_constant_noise_does_not():
    randomly = pnl.IntegratorMechanism(name="randomly", function=pnl.SimpleIntegrator(noise=pnl.NormalDist(standard_deviation=0.1)))
    steadily = pnl.IntegratorMechanism(name="steadily", function=pnl.SimpleIntegrator(noise=0.1))
    comp = pnl.Composition(name="noisy")
    comp.add_nodes([randomly, steadily])
    gap = _by_issue(find_mdf_gaps(SimpleNamespace(noisy=comp), comp))[87]
    assert gap["severity"] == "info"
    assert gap["items"] == ["randomly"]


def test_87_a_deterministic_integrator_gets_no_notice():
    module = exec_model(FIXTURES / "stateful_integrator.py")
    assert find_mdf_gaps(module, module.comp) == []
