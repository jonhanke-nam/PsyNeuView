"""Inspector function-dropdown scoping (#334).

A mechanism whose `function` slot accepts functions from more than one family
(the DDM) must offer exactly its accepted set, not the MRO siblings of whichever
function happens to be selected. Ordinary single-family mechanisms keep the
family-sibling behavior.
"""

import tempfile
from pathlib import Path

import psyneulink as pnl
from app.services import sandbox_worker as sw
from app.services.introspector import load_and_introspect
from tests.conftest import find_node

DDM_FUNCS = ["DriftDiffusionAnalytical", "DriftDiffusionIntegrator"]


def test_ddm_lists_both_functions_with_analytical_selected():
    ddm = pnl.DDM(name="ddm_a", function=pnl.DriftDiffusionAnalytical())
    assert sw._valid_function_types(ddm, ddm.function) == DDM_FUNCS


def test_ddm_lists_both_functions_with_integrator_selected():
    # The list must not depend on which accepted function is currently set —
    # the Integrator case is exactly where the old MRO walk omitted Analytical.
    ddm = pnl.DDM(name="ddm_i", function=pnl.DriftDiffusionIntegrator())
    assert sw._valid_function_types(ddm, ddm.function) == DDM_FUNCS


def test_single_family_mechanism_keeps_sibling_walk():
    tm = pnl.TransferMechanism(name="tm", function=pnl.Logistic())
    valid = sw._valid_function_types(tm, tm.function)
    # Real family siblings are present...
    assert "Logistic" in valid
    assert "Linear" in valid
    # ...and the DDM-only functions are not leaked in.
    assert "DriftDiffusionAnalytical" not in valid
    assert "DriftDiffusionIntegrator" not in valid


def test_ddm_valid_types_surface_through_introspection():
    """End-to-end: the serialized mechanism the frontend consumes carries the
    allow-list in function.validTypes."""
    src = (
        "import psyneulink as pnl\n"
        "decision = pnl.DDM(name='decision', "
        "function=pnl.DriftDiffusionAnalytical())\n"
        "comp = pnl.Composition(name='ddm_comp')\n"
        "comp.add_node(decision)\n"
    )
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(src)
        f.flush()
        path = f.name
    try:
        result = load_and_introspect(path, use_sandbox=True)
        node = find_node(result["compositions"][0]["nodes"], "decision")
        assert node["function"]["type"] == "DriftDiffusionAnalytical"
        assert node["function"]["validTypes"] == DDM_FUNCS
    finally:
        Path(path).unlink(missing_ok=True)
