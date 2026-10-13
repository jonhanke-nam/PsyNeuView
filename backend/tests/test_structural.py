"""Tests for structural changes — add/remove nodes and projections."""

import pytest
import tempfile
from pathlib import Path
from app.services.file_writer import apply_structural_change
from app.services.introspector import load_and_introspect
from tests.conftest import clean_name, find_node, find_projection

TEST_MODEL = str(Path(__file__).parent.parent / "test_model.py")


@pytest.fixture
def tmp_model():
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(Path(TEST_MODEL).read_text())
        f.flush()
        yield f.name
    Path(f.name).unlink(missing_ok=True)


def test_add_node(tmp_model):
    result = apply_structural_change(tmp_model, {
        "action": "add_node",
        "var_name": "new_mech",
        "type": "TransferMechanism",
        "params": {"input_shapes": "[2]"},
        "composition": "stroop_model",
    })
    assert "new_mech = pnl.TransferMechanism(" in result
    assert "stroop_model.add_node(new_mech)" in result


def test_add_node_valid_model(tmp_model):
    apply_structural_change(tmp_model, {
        "action": "add_node",
        "var_name": "new_mech",
        "type": "TransferMechanism",
        "params": {"input_shapes": "[2]"},
        "composition": "stroop_model",
    })
    model = load_and_introspect(tmp_model, use_sandbox=False)
    names = [clean_name(n["name"]) for n in model["compositions"][0]["nodes"]]
    assert "new_mech" in names
    assert len(names) == 4  # original 3 + new one


def test_remove_node(tmp_model):
    result = apply_structural_change(tmp_model, {
        "action": "remove_node",
        "var_name": "words_input",
    })
    assert "words_input = pnl.TransferMechanism(" not in result
    assert "stroop_model.add_node(words_input)" not in result


def test_remove_node_valid_model(tmp_model):
    # First remove the projection that depends on words_input
    apply_structural_change(tmp_model, {
        "action": "remove_projection",
        "var_name": "words_to_response",
    })
    apply_structural_change(tmp_model, {
        "action": "remove_node",
        "var_name": "words_input",
    })
    model = load_and_introspect(tmp_model, use_sandbox=False)
    names = [clean_name(n["name"]) for n in model["compositions"][0]["nodes"]]
    assert "words_input" not in names
    assert len(names) == 2


def test_add_projection(tmp_model):
    # First add a new node to project from
    apply_structural_change(tmp_model, {
        "action": "add_node",
        "var_name": "extra",
        "type": "TransferMechanism",
        "params": {"input_shapes": "[1]"},
        "composition": "stroop_model",
    })
    result = apply_structural_change(tmp_model, {
        "action": "add_projection",
        "var_name": "extra_to_response",
        "sender": "extra",
        "receiver": "response",
        "composition": "stroop_model",
    })
    assert "extra_to_response = pnl.MappingProjection(" in result
    assert "stroop_model.add_projection(extra_to_response)" in result


def test_add_projection_valid_model(tmp_model):
    apply_structural_change(tmp_model, {
        "action": "add_node",
        "var_name": "extra",
        "type": "TransferMechanism",
        "params": {"input_shapes": "[1]"},
        "composition": "stroop_model",
    })
    apply_structural_change(tmp_model, {
        "action": "add_projection",
        "var_name": "extra_to_response",
        "sender": "extra",
        "receiver": "response",
        "composition": "stroop_model",
    })
    model = load_and_introspect(tmp_model, use_sandbox=False)
    projs = [clean_name(p["name"]) for p in model["compositions"][0]["projections"]]
    assert "extra_to_response" in projs
    assert len(projs) == 3  # original 2 + new one


def test_add_projection_with_ports(tmp_model):
    # Port-to-port drag (#314): the sender/receiver carry explicit port names.
    # Codegen must reference them via .output_ports/.input_ports, never by
    # subscripting the mechanism (`mech['port']` is a TypeError in PsyNeuLink).
    apply_structural_change(tmp_model, {
        "action": "add_node",
        "var_name": "extra",
        "type": "TransferMechanism",
        "params": {"input_shapes": "[2]"},
        "composition": "stroop_model",
    })
    result = apply_structural_change(tmp_model, {
        "action": "add_projection",
        "var_name": "extra_to_response",
        "sender": "extra",
        "receiver": "response",
        "sender_port": "RESULT",
        "receiver_port": "InputPort-0",
        "composition": "stroop_model",
    })
    assert "extra.output_ports['RESULT']" in result
    assert "response.input_ports['InputPort-0']" in result
    # The broken form that shipped in #314 must not reappear.
    assert "extra['RESULT']" not in result
    assert "response['InputPort-0']" not in result


def test_add_projection_with_ports_valid_model(tmp_model):
    # The original bug surfaced only on introspection — codegen looked fine but
    # the generated source raised "'...Mechanism' object is not subscriptable".
    # This asserts the port-qualified projection actually loads and runs.
    apply_structural_change(tmp_model, {
        "action": "add_node",
        "var_name": "extra",
        "type": "TransferMechanism",
        "params": {"input_shapes": "[2]"},
        "composition": "stroop_model",
    })
    apply_structural_change(tmp_model, {
        "action": "add_projection",
        "var_name": "extra_to_response",
        "sender": "extra",
        "receiver": "response",
        "sender_port": "RESULT",
        "receiver_port": "InputPort-0",
        "composition": "stroop_model",
    })
    model = load_and_introspect(tmp_model, use_sandbox=False)
    projs = [clean_name(p["name"]) for p in model["compositions"][0]["projections"]]
    assert "extra_to_response" in projs
    assert len(projs) == 3  # original 2 + new one


def test_remove_projection(tmp_model):
    result = apply_structural_change(tmp_model, {
        "action": "remove_projection",
        "var_name": "words_to_response",
    })
    assert "words_to_response = pnl.MappingProjection(" not in result
    assert "stroop_model.add_projection(words_to_response)" not in result


def test_remove_projection_valid_model(tmp_model):
    apply_structural_change(tmp_model, {
        "action": "remove_projection",
        "var_name": "words_to_response",
    })
    model = load_and_introspect(tmp_model, use_sandbox=False)
    projs = [clean_name(p["name"]) for p in model["compositions"][0]["projections"]]
    assert "words_to_response" not in projs
    assert len(projs) == 1


def test_add_whenfinished_condition(tmp_model):
    # The #385 priority use case: a node should run when another finishes,
    # i.e. comp.scheduler.add_condition(response, pnl.WhenFinished(words_input)).
    result = apply_structural_change(tmp_model, {
        "action": "add_basic_condition",
        "composition": "stroop_model",
        "owner_var": "response",
        "condition_type": "WhenFinished",
        "args": {"dependency": "words_input"},
    })
    assert (
        "stroop_model.scheduler.add_condition(response, pnl.WhenFinished(words_input))"
        in result
    )


def test_add_whenfinished_condition_valid_model(tmp_model):
    apply_structural_change(tmp_model, {
        "action": "add_basic_condition",
        "composition": "stroop_model",
        "owner_var": "response",
        "condition_type": "WhenFinished",
        "args": {"dependency": "words_input"},
    })
    model = load_and_introspect(tmp_model, use_sandbox=False)
    conds = model["compositions"][0]["basicConditions"]
    entry = next(c for c in conds if clean_name(c["owner"]) == "response")
    assert entry["condition"]["type"] == "WhenFinished"
    dep = entry["condition"]["args"]["positional"][0]
    assert clean_name(dep["_node"]) == "words_input"


def test_replace_basic_condition(tmp_model):
    # Adding a second basic condition for the same node replaces the first —
    # only one add_condition line should remain for that owner.
    apply_structural_change(tmp_model, {
        "action": "add_basic_condition",
        "composition": "stroop_model",
        "owner_var": "response",
        "condition_type": "WhenFinished",
        "args": {"dependency": "words_input"},
    })
    result = apply_structural_change(tmp_model, {
        "action": "add_basic_condition",
        "composition": "stroop_model",
        "owner_var": "response",
        "condition_type": "EveryNCalls",
        "args": {"dependency": "colors_input", "n": 2},
    })
    assert "pnl.WhenFinished(words_input)" not in result
    assert (
        "stroop_model.scheduler.add_condition(response, pnl.EveryNCalls(colors_input, 2))"
        in result
    )


def test_set_scheduler_mode_exact_time(tmp_model):
    # #381: switching to EXACT_TIME writes an explicit mode assignment.
    result = apply_structural_change(tmp_model, {
        "action": "set_scheduler_mode",
        "composition": "stroop_model",
        "mode": "EXACT_TIME",
    })
    assert "stroop_model.scheduler.mode = pnl.SchedulingMode.EXACT_TIME" in result


def test_set_scheduler_mode_exact_time_valid_model(tmp_model):
    apply_structural_change(tmp_model, {
        "action": "set_scheduler_mode",
        "composition": "stroop_model",
        "mode": "EXACT_TIME",
    })
    model = load_and_introspect(tmp_model, use_sandbox=False)
    assert model["compositions"][0]["schedulerConfig"]["mode"] == "EXACT_TIME"


def test_set_scheduler_mode_standard_clears_line(tmp_model):
    # STANDARD is the default — selecting it removes any explicit assignment
    # rather than writing a redundant line, and round-trips back to STANDARD.
    apply_structural_change(tmp_model, {
        "action": "set_scheduler_mode",
        "composition": "stroop_model",
        "mode": "EXACT_TIME",
    })
    result = apply_structural_change(tmp_model, {
        "action": "set_scheduler_mode",
        "composition": "stroop_model",
        "mode": "STANDARD",
    })
    assert "scheduler.mode" not in result
    model = load_and_introspect(tmp_model, use_sandbox=False)
    assert model["compositions"][0]["schedulerConfig"]["mode"] == "STANDARD"


def test_set_scheduler_mode_invalid(tmp_model):
    with pytest.raises(ValueError, match="Unknown scheduler mode"):
        apply_structural_change(tmp_model, {
            "action": "set_scheduler_mode",
            "composition": "stroop_model",
            "mode": "BOGUS",
        })


def test_set_termination_condition(tmp_model):
    # #382: a termination condition keyed on a TimeScale should emit
    # comp.scheduler.termination_conds = {pnl.TimeScale.X: pnl.AfterNCalls(node, n)}.
    result = apply_structural_change(tmp_model, {
        "action": "set_termination",
        "composition": "stroop_model",
        "conditions": {
            "ENVIRONMENT_STATE_UPDATE": {
                "type": "AfterNCalls",
                "args": {"dependency": "response", "n": 5},
            },
        },
    })
    assert "stroop_model.scheduler.termination_conds = {" in result
    assert "pnl.TimeScale.ENVIRONMENT_STATE_UPDATE: pnl.AfterNCalls(response, 5)" in result


def test_set_termination_condition_valid_model(tmp_model):
    apply_structural_change(tmp_model, {
        "action": "set_termination",
        "composition": "stroop_model",
        "conditions": {
            "ENVIRONMENT_STATE_UPDATE": {
                "type": "AfterNCalls",
                "args": {"dependency": "response", "n": 5},
            },
        },
    })
    model = load_and_introspect(tmp_model, use_sandbox=False)
    term = model["compositions"][0]["terminationConditions"]
    assert "ENVIRONMENT_STATE_UPDATE" in term
    entry = term["ENVIRONMENT_STATE_UPDATE"]
    assert entry["type"] == "AfterNCalls"
    positional = entry["args"]["positional"]
    assert clean_name(positional[0]["_node"]) == "response"
    assert positional[1] == 5


def test_set_termination_replaces_existing(tmp_model):
    # A second set_termination call replaces the whole assignment rather than
    # appending — only the latest dict should survive.
    apply_structural_change(tmp_model, {
        "action": "set_termination",
        "composition": "stroop_model",
        "conditions": {
            "ENVIRONMENT_STATE_UPDATE": {
                "type": "AfterNCalls",
                "args": {"dependency": "response", "n": 5},
            },
        },
    })
    result = apply_structural_change(tmp_model, {
        "action": "set_termination",
        "composition": "stroop_model",
        "conditions": {
            "PASS": {"type": "AtPass", "args": {"n": 3}},
        },
    })
    assert result.count("termination_conds = {") == 1
    assert "pnl.AfterNCalls(response, 5)" not in result
    assert "pnl.TimeScale.PASS: pnl.AtPass(3)" in result


def test_set_termination_empty_clears_line(tmp_model):
    # Removing the last condition (empty dict) drops the assignment entirely
    # rather than leaving an empty termination_conds = {}.
    apply_structural_change(tmp_model, {
        "action": "set_termination",
        "composition": "stroop_model",
        "conditions": {
            "ENVIRONMENT_STATE_UPDATE": {
                "type": "AfterNCalls",
                "args": {"dependency": "response", "n": 5},
            },
        },
    })
    result = apply_structural_change(tmp_model, {
        "action": "set_termination",
        "composition": "stroop_model",
        "conditions": {},
    })
    assert "termination_conds" not in result
    # With no explicit assignment, PsyNeuLink falls back to its built-in
    # defaults (AllHaveRun for ENVIRONMENT_STATE_UPDATE) — our custom
    # AfterNCalls condition must be gone.
    model = load_and_introspect(tmp_model, use_sandbox=False)
    term = model["compositions"][0]["terminationConditions"]
    assert term.get("ENVIRONMENT_STATE_UPDATE", {}).get("type") != "AfterNCalls"


# #384: condition types newly exposed in the builder catalog. Each must
# codegen to pnl.<Type>(...) and survive a load+introspect round-trip with the
# same type name. Grouped by argument shape (node+n / n-only / no-arg).
_NEW_CONDITION_CASES = [
    ("AfterCall", {"dependency": "words_input", "n": 2}),
    ("BeforePass", {"n": 2}),
    ("AtTrial", {"n": 1}),
    ("AfterTrial", {"n": 1}),
    ("BeforeTrial", {"n": 2}),
    ("AfterNTrials", {"n": 2}),
    ("AtTimeStep", {"n": 1}),
    ("AfterTimeStep", {"n": 1}),
    ("BeforeTimeStep", {"n": 2}),
    ("AfterNTimeSteps", {"n": 2}),
    ("AtRun", {"n": 1}),
    ("AfterRun", {"n": 1}),
    ("AfterNRuns", {"n": 2}),
    ("AtTrialStart", {}),
    ("AtRunStart", {}),
]


@pytest.mark.parametrize("cond_type,args", _NEW_CONDITION_CASES)
def test_new_condition_type_round_trips(tmp_model, cond_type, args):
    apply_structural_change(tmp_model, {
        "action": "add_basic_condition",
        "composition": "stroop_model",
        "owner_var": "response",
        "condition_type": cond_type,
        "args": args,
    })
    model = load_and_introspect(tmp_model, use_sandbox=False)
    conds = model["compositions"][0]["basicConditions"]
    entry = next((c for c in conds if clean_name(c["owner"]) == "response"), None)
    assert entry is not None, f"{cond_type} produced no basic condition"
    assert entry["condition"]["type"] == cond_type


def test_add_composite_all_condition(tmp_model):
    # #383: a composite All() nests other conditions via a children list.
    result = apply_structural_change(tmp_model, {
        "action": "add_basic_condition",
        "composition": "stroop_model",
        "owner_var": "response",
        "condition_type": "All",
        "args": {"children": [
            {"type": "WhenFinished", "args": {"dependency": "words_input"}},
            {"type": "AtPass", "args": {"n": 3}},
        ]},
    })
    assert (
        "stroop_model.scheduler.add_condition(response, "
        "pnl.All(pnl.WhenFinished(words_input), pnl.AtPass(3)))"
        in result
    )


def test_add_composite_all_condition_valid_model(tmp_model):
    apply_structural_change(tmp_model, {
        "action": "add_basic_condition",
        "composition": "stroop_model",
        "owner_var": "response",
        "condition_type": "All",
        "args": {"children": [
            {"type": "WhenFinished", "args": {"dependency": "words_input"}},
            {"type": "AtPass", "args": {"n": 3}},
        ]},
    })
    model = load_and_introspect(tmp_model, use_sandbox=False)
    entry = next(c for c in model["compositions"][0]["basicConditions"]
                 if clean_name(c["owner"]) == "response")
    cond = entry["condition"]
    assert cond["type"] == "All"
    child_types = [c["type"] for c in cond["children"]]
    assert child_types == ["WhenFinished", "AtPass"]


def test_add_composite_not_condition(tmp_model):
    # Not() wraps a single child condition.
    result = apply_structural_change(tmp_model, {
        "action": "add_basic_condition",
        "composition": "stroop_model",
        "owner_var": "response",
        "condition_type": "Not",
        "args": {"children": [
            {"type": "WhenFinished", "args": {"dependency": "colors_input"}},
        ]},
    })
    assert "pnl.Not(pnl.WhenFinished(colors_input))" in result


def test_add_nested_composite_condition(tmp_model):
    # Composites nest recursively: Any(All(...), Not(...)).
    result = apply_structural_change(tmp_model, {
        "action": "add_basic_condition",
        "composition": "stroop_model",
        "owner_var": "response",
        "condition_type": "Any",
        "args": {"children": [
            {"type": "All", "args": {"children": [
                {"type": "EveryNCalls", "args": {"dependency": "words_input", "n": 2}},
                {"type": "AtPass", "args": {"n": 5}},
            ]}},
            {"type": "Not", "args": {"children": [
                {"type": "WhenFinished", "args": {"dependency": "colors_input"}},
            ]}},
        ]},
    })
    assert (
        "pnl.Any(pnl.All(pnl.EveryNCalls(words_input, 2), pnl.AtPass(5)), "
        "pnl.Not(pnl.WhenFinished(colors_input)))"
        in result
    )


def test_add_nested_composite_condition_valid_model(tmp_model):
    apply_structural_change(tmp_model, {
        "action": "add_basic_condition",
        "composition": "stroop_model",
        "owner_var": "response",
        "condition_type": "Any",
        "args": {"children": [
            {"type": "All", "args": {"children": [
                {"type": "EveryNCalls", "args": {"dependency": "words_input", "n": 2}},
                {"type": "AtPass", "args": {"n": 5}},
            ]}},
            {"type": "Not", "args": {"children": [
                {"type": "WhenFinished", "args": {"dependency": "colors_input"}},
            ]}},
        ]},
    })
    model = load_and_introspect(tmp_model, use_sandbox=False)
    entry = next(c for c in model["compositions"][0]["basicConditions"]
                 if clean_name(c["owner"]) == "response")
    cond = entry["condition"]
    assert cond["type"] == "Any"
    assert cond["children"][0]["type"] == "All"
    assert cond["children"][1]["type"] == "Not"


def test_condition_explanation_flat(tmp_model):
    # #388: introspection attaches a plain-English explanation to each condition.
    apply_structural_change(tmp_model, {
        "action": "add_basic_condition",
        "composition": "stroop_model",
        "owner_var": "response",
        "condition_type": "WhenFinished",
        "args": {"dependency": "words_input"},
    })
    model = load_and_introspect(tmp_model, use_sandbox=False)
    entry = next(c for c in model["compositions"][0]["basicConditions"]
                 if clean_name(c["owner"]) == "response")
    explanation = entry["condition"]["explanation"]
    assert "finishes" in explanation
    assert "words_input" in explanation


def test_condition_explanation_composite(tmp_model):
    # Composite explanations read recursively, leading with the joiner phrase.
    apply_structural_change(tmp_model, {
        "action": "add_basic_condition",
        "composition": "stroop_model",
        "owner_var": "response",
        "condition_type": "All",
        "args": {"children": [
            {"type": "WhenFinished", "args": {"dependency": "words_input"}},
            {"type": "AtPass", "args": {"n": 3}},
        ]},
    })
    model = load_and_introspect(tmp_model, use_sandbox=False)
    entry = next(c for c in model["compositions"][0]["basicConditions"]
                 if clean_name(c["owner"]) == "response")
    explanation = entry["condition"]["explanation"]
    assert explanation.startswith("all of:")
    assert "finishes" in explanation
    assert "pass 3" in explanation


# --- Graph Structure Conditions (#389) -------------------------------------
# GSCs reorder the scheduler's dependency graph. Each codegen path is checked
# both for generated source text and for a clean load-and-introspect round-trip
# into the composition's `scheduling` list. Owner/target pairs are chosen to
# avoid introducing graph cycles in the stroop fixture.

# (gsc_type, owner_var, target_vars) — single- and multi-target variants.
_GSC_CASES = [
    ("BeforeNode", "colors_input", ["words_input"]),
    ("AfterNode", "words_input", ["colors_input"]),
    ("BeforeNodes", "response", ["words_input", "colors_input"]),
    ("AfterNodes", "response", ["words_input", "colors_input"]),
    ("WithNode", "colors_input", ["words_input"]),
    ("AddEdgeTo", "colors_input", ["words_input"]),
    ("RemoveEdgeFrom", "response", ["colors_input"]),
]


@pytest.mark.parametrize("gsc_type,owner,targets", _GSC_CASES)
def test_add_gsc_condition(tmp_model, gsc_type, owner, targets):
    result = apply_structural_change(tmp_model, {
        "action": "add_gsc",
        "composition": "stroop_model",
        "owner_var": owner,
        "gsc_type": gsc_type,
        "target_vars": targets,
    })
    expected = (
        f"stroop_model.scheduler.add_condition({owner}, "
        f"pnl.{gsc_type}({', '.join(targets)}))"
    )
    assert expected in result


@pytest.mark.parametrize("gsc_type,owner,targets", _GSC_CASES)
def test_add_gsc_condition_round_trips(tmp_model, gsc_type, owner, targets):
    apply_structural_change(tmp_model, {
        "action": "add_gsc",
        "composition": "stroop_model",
        "owner_var": owner,
        "gsc_type": gsc_type,
        "target_vars": targets,
    })
    model = load_and_introspect(tmp_model, use_sandbox=False)
    gscs = model["compositions"][0]["scheduling"]
    entry = next(g for g in gscs if g["type"] == gsc_type)
    assert clean_name(entry["owner"]) == owner
    assert [clean_name(n) for n in entry["nodes"]] == targets


def test_remove_gsc_condition(tmp_model):
    apply_structural_change(tmp_model, {
        "action": "add_gsc",
        "composition": "stroop_model",
        "owner_var": "colors_input",
        "gsc_type": "BeforeNode",
        "target_vars": ["words_input"],
    })
    result = apply_structural_change(tmp_model, {
        "action": "remove_gsc",
        "composition": "stroop_model",
        "owner_var": "colors_input",
        "gsc_type": "BeforeNode",
        "target_var": "words_input",
    })
    assert "pnl.BeforeNode(words_input)" not in result


def test_remove_gsc_condition_round_trips(tmp_model):
    apply_structural_change(tmp_model, {
        "action": "add_gsc",
        "composition": "stroop_model",
        "owner_var": "colors_input",
        "gsc_type": "BeforeNode",
        "target_vars": ["words_input"],
    })
    apply_structural_change(tmp_model, {
        "action": "remove_gsc",
        "composition": "stroop_model",
        "owner_var": "colors_input",
        "gsc_type": "BeforeNode",
        "target_var": "words_input",
    })
    model = load_and_introspect(tmp_model, use_sandbox=False)
    gscs = model["compositions"][0]["scheduling"]
    assert not any(g["type"] == "BeforeNode" for g in gscs)


def test_unknown_action(tmp_model):
    with pytest.raises(ValueError, match="Unknown structural action"):
        apply_structural_change(tmp_model, {"action": "invalid"})


# --- #1092: a removal that changes nothing must not report success -----------
#
# A tester deleted a node from the canvas and the file came back
# unchanged, with no error anywhere. _remove_node is line-based: it recognises
# `var = pnl.Thing(...)` at the start of a line. A mechanism written inline in a
# pathway matches nothing, and the function used to hand back the untouched
# source, which the API then reported as a successful edit.

FREE_FORM_MODEL = '''import psyneulink as pnl

comp = pnl.Composition(
    name="FreeForm",
    pathways=[[
        pnl.TransferMechanism(name="input_layer"),
        pnl.TransferMechanism(name="hidden"),
    ]],
)
'''


@pytest.fixture
def free_form_model():
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(FREE_FORM_MODEL)
        f.flush()
        yield f.name
    Path(f.name).unlink(missing_ok=True)


def test_remove_node_inline_in_pathway_raises(free_form_model):
    """The node exists, but not as a top-level assignment. Say so."""
    with pytest.raises(ValueError) as excinfo:
        apply_structural_change(free_form_model, {
            "action": "remove_node",
            "var_name": "input_layer",
        })
    assert "input_layer" in str(excinfo.value)


def test_refused_removal_leaves_the_file_alone(free_form_model):
    """A refusal must not half-write the file."""
    before = Path(free_form_model).read_text()
    with pytest.raises(ValueError):
        apply_structural_change(free_form_model, {
            "action": "remove_node",
            "var_name": "input_layer",
        })
    assert Path(free_form_model).read_text() == before


def test_remove_node_unknown_name_raises(tmp_model):
    """A name that is not in the file at all is also a failure, not a no-op."""
    with pytest.raises(ValueError):
        apply_structural_change(tmp_model, {
            "action": "remove_node",
            "var_name": "no_such_mechanism",
        })
