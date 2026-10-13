"""The Inspector shows enable_learning as the mechanism was built (#1385).

RecurrentTransferMechanism declares ``enable_learning = False`` among its
Parameters and never sets it from the constructor: it keeps the argument
aside and builds an AutoAssociativeLearningMechanism instead. Read straight
from the Parameter, the Hebbian demo's ``feature_layer`` (built with
``enable_learning=True``, and it learns) showed ``false``. Introspection now
reports the learning mechanism that exists.
"""

from pathlib import Path

import pytest

from app.services.introspector import _load_and_introspect_inprocess
from app.services.sandbox_worker import task_introspect

DEMO = Path(__file__).parent.parent / "demos" / "hebbian_learning.py"


def _node(result, name):
    assert "error" not in result, result.get("error")
    [node] = [n for c in result["compositions"] for n in c["nodes"] if n["name"] == name]
    return node


def test_sandbox_introspection_reports_learning_on():
    param = _node(task_introspect({"file_path": str(DEMO)}), "feature_layer")["params"]["enable_learning"]
    assert param["value"] is True
    # The class default is now known (the Parameter is a plain False), so the
    # row reads as set, with its type, rather than as an unknown.
    assert param["default"] is False
    assert param["isDefault"] is False


def test_in_process_introspection_reports_learning_on():
    params = _node(_load_and_introspect_inprocess(str(DEMO)), "feature_layer")["params"]
    assert params["enable_learning"] is True


def test_a_recurrent_layer_without_learning_still_reads_false(tmp_path):
    model = tmp_path / "no_learning.py"
    model.write_text(
        "import psyneulink as pnl\n"
        "layer = pnl.RecurrentTransferMechanism(name='layer', input_shapes=3)\n"
        "comp = pnl.Composition(name='comp')\n"
        "comp.add_node(layer)\n"
    )
    param = _node(task_introspect({"file_path": str(model)}), "layer")["params"]["enable_learning"]
    assert param["value"] is False
    assert param["isDefault"] is True


@pytest.mark.parametrize("value", [True, False])
def test_constructed_learning_flag_follows_the_constructor(value):
    import psyneulink as pnl

    from app.services.pathway_learning import constructed_learning_flag

    mech = pnl.RecurrentTransferMechanism(input_shapes=2, enable_learning=value)
    assert mech.parameters.enable_learning.get() is False  # PsyNeuLink's own reading
    assert constructed_learning_flag(mech) is value
    assert constructed_learning_flag(pnl.TransferMechanism(input_shapes=2)) is None
