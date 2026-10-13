"""Nodes written inside another constructor's arguments (#1117).

The classifier walks `vars(module)` to sort nodes into editable / generated /
read-only. A node declared inside another constructor's arguments has no
module-level variable at all, so it landed in none of them — the panel could
report "5 mechanisms — 4 editable" and never say what the fifth one was.

These load real models through the real path, because the distinction depends
on PsyNeuLink actually building the objects.
"""

import pytest

from app.services.introspector import load_and_introspect

REFS = "reference_models"


def diagnostics_for(name):
    model = load_and_introspect(f"{REFS}/{name}")
    return model.get("diagnostics") or {}


@pytest.mark.parametrize(
    "model_file,expected",
    [
        # `pnl.LCControlMechanism(objective_mechanism=pnl.ObjectiveMechanism(
        #      name='Combine values'))` — the user wrote it, inside another call.
        ("Nieuwenhuis2005Model.py", "Combine values"),
        ("GilzenratModel.py", "LC ObjectiveMechanism"),
        ("stroop_reference_with_lc.py", "LC_objective"),
    ],
)
def test_a_node_nested_in_a_constructor_is_named(model_file, expected):
    assert expected in diagnostics_for(model_file).get("inlineVars", [])


def test_the_notice_sends_you_to_the_code_rather_than_offering_conversion():
    # Conversion cannot help here: the node is in the file, just not on a line
    # of its own. Pointing at the code editor is the honest advice.
    notices = " ".join(diagnostics_for("Nieuwenhuis2005Model.py").get("notices", []))
    assert "Combine values" in notices
    assert "code editor" in notices


@pytest.mark.parametrize(
    "model_file",
    ["MontagueDayanSejnowski96.py", "Giallanza2024_ego_study2.py"],
)
def test_framework_built_nodes_are_not_called_hand_written(model_file):
    """Learning and EM internals must not land in the inline bucket.

    There is no source for them, so telling someone to edit them in the code
    would be a dead end.
    """
    d = diagnostics_for(model_file)
    assert d.get("generatedVars"), "expected framework-built nodes"
    assert not d.get("inlineVars"), f"misfiled as hand-written: {d.get('inlineVars')}"


def test_a_fully_declared_model_reports_nothing_extra():
    d = diagnostics_for("Cohen_Huston1994.py")
    assert not d.get("inlineVars")
