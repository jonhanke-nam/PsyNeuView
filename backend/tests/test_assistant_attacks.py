"""Attack tests for the two routes by which an accepted proposal could have
carried code (#179), through the real routes with a scripted agent:

* Hole A, free-form text through an app edit: an ``app_edit`` carries only
  structured ops from a fixed allowlist. An unknown op is refused by the tool,
  so no proposal exists to accept, and ``after`` is never source.
* Hole B, code through a structured value: every op argument must be plain
  data. A ``new_value`` with a call or a name, an identifier that isn't one, a
  context that isn't a choice, or text that would break out of the generated
  code is refused.

"Did it run" is a question about a marker file in ``tmp_path``: the hostile
edits would create it, and it never exists.
"""

from __future__ import annotations

import pytest

from app.services.assistant import tools
from tests.test_assistant_backend import client, fake, run_turn, sha, turn_on  # noqa: F401  (fixtures)

MODEL = (
    "import psyneulink as pnl\n"
    "a = pnl.TransferMechanism(name='a', function=pnl.Linear(slope=1))\n"
    "comp = pnl.Composition(name='comp')\n"
    "comp.add_node(a)\n"
)


@pytest.fixture
def model(tmp_path):
    folder = tmp_path / "models"
    folder.mkdir(exist_ok=True)
    path = folder / "m.py"
    path.write_text(MODEL)
    return {"path": path, "marker": tmp_path / "ran.txt", "folder": folder}


def marker_code(marker) -> str:
    return f"__import__('pathlib').Path({str(marker)!r}).write_text('ran')"


def propose(client, fake, ops, context):
    """One turn in which the agent proposes ``ops``; the events it produced."""
    _, events = run_turn(
        client, fake, [("", [("propose_app_edit", {"summary": "edit", "ops": ops})])], context=context,
    )
    return events


def accept_everything_proposed(client, events, source):
    """What a user who clicks Accept on every card would get back."""
    out = []
    for e in events:
        if e["type"] == "proposal":
            r = client.post(f"/api/assistant/proposals/{e['proposal']['id']}/accept", json={"current_hash": sha(source)})
            out.append((e["proposal"], r))
    return out


def apply_as_the_page_would(client, proposal, path):
    """The page applies an accepted app_edit through the user's own routes,
    exactly as ``assistantApply.ts`` does, and only for ops it knows."""
    for op in proposal["ops"]:
        assert op["op"] in tools.APP_EDIT_OPS
        if op["op"] == "update_param":
            a = op["args"]
            r = client.post("/api/model/update-param", json={
                "file_path": str(path), "var_name": a["var_name"], "param_name": a["param_name"],
                "new_value": a["new_value"], "context": a.get("context", "mechanism"), "is_default": a.get("is_default", False),
                "function_class": a.get("function_class"), "skip_introspect": True,
            })
            assert r.status_code == 200, r.text


# ── Hole A ───────────────────────────────────────────────────────────────


def test_hole_a_unknown_op_with_source_is_refused(client, fake, model):
    """An op the allowlist doesn't have, carrying hostile source as its
    text and as ``after``: refused by the tool; no proposal; nothing to accept."""
    turn_on(client, model["path"].parent.parent)
    hostile = MODEL + marker_code(model["marker"]) + "\n"
    context = {"file_path": str(model["path"]), "source": MODEL}
    for op in (
        {"op": "replace_source", "args": {"after": hostile}},
        {"op": "set_source", "args": {"source": hostile}},
        {"op": "append_comment", "args": {"text": hostile}},
        {"op": "update_param", "args": {"var_name": "a", "param_name": "slope", "new_value": "2", "after": hostile}},
    ):
        events = propose(client, fake, [op], context)
        refused = [e for e in events if e["type"] == "refused"]
        assert refused and refused[0]["tool"] == "propose_app_edit", events
        assert not [e for e in events if e["type"] == "proposal"]
        assert hostile not in str(events)
    assert not model["marker"].exists()
    assert model["path"].read_text() == MODEL
    # Nothing to accept: the ids a rogue page might guess don't exist.
    assert client.post("/api/assistant/proposals/anything/accept", json={"current_hash": sha(MODEL)}).status_code == 404


def test_hole_a_app_edit_after_is_a_description_never_source(client, fake, model):
    """A good proposal's ``after`` is a description of the ops. It is not
    source, so a page that showed it as such would show a line, not a program."""
    turn_on(client, model["path"].parent.parent)
    events = propose(client, fake, [{"op": "update_param", "args": {"var_name": "a", "param_name": "slope", "new_value": "2", "context": "function"}}],
                     {"file_path": str(model["path"]), "source": MODEL})
    proposal = [e for e in events if e["type"] == "proposal"][0]["proposal"]
    assert proposal["kind"] == "app_edit" and proposal["freeform_python"] is False
    assert proposal["after"] == "a.function.slope = 2" and proposal["before"] is None
    assert "import" not in proposal["after"]


# ── Hole B ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("args", [
    # a call, dressed as a value
    {"var_name": "a", "param_name": "slope", "new_value": "MARKER"},
    # a name
    {"var_name": "a", "param_name": "slope", "new_value": "os.environ"},
    # breaking out of the keyword argument
    {"var_name": "a", "param_name": "slope", "new_value": "2), b=(MARKER"},
    {"var_name": "a", "param_name": "slope", "new_value": "2)\nMARKER\n#"},
    {"var_name": "a", "param_name": "slope", "new_value": "2 if MARKER else 3"},
    {"var_name": "a", "param_name": "slope", "new_value": "[MARKER]"},
    {"var_name": "a", "param_name": "slope", "new_value": "lambda: MARKER"},
    {"var_name": "a", "param_name": "slope", "new_value": "f'{MARKER}'"},
    # identifiers that aren't
    {"var_name": "a", "param_name": "slope=2), b=(MARKER", "new_value": "2"},
    {"var_name": "a; MARKER", "param_name": "slope", "new_value": "2"},
    {"var_name": "a", "param_name": "import", "new_value": "2"},
    {"var_name": "a", "param_name": "__class__", "new_value": "2"},
    {"var_name": "a", "param_name": "slope", "new_value": "2", "function_class": "Linear(MARKER); x"},
    # a context that isn't a choice
    {"var_name": "a", "param_name": "slope", "new_value": "2", "context": "MARKER"},
    # a value that is data but too much of it
    {"var_name": "a", "param_name": "slope", "new_value": [[["x"] * 3] * 3] * 200},
])
def test_hole_b_hostile_update_param_is_refused(client, fake, model, args):
    turn_on(client, model["path"].parent.parent)
    args = {k: (v.replace("MARKER", marker_code(model["marker"])) if isinstance(v, str) else v) for k, v in args.items()}
    context = {"file_path": str(model["path"]), "source": MODEL}
    events = propose(client, fake, [{"op": "update_param", "args": args}], context)
    assert [e for e in events if e["type"] == "refused"], events
    assert not [e for e in events if e["type"] == "proposal"]
    # Nothing was proposed, so nothing can be accepted, so nothing reached the file.
    assert accept_everything_proposed(client, events, MODEL) == []
    assert model["path"].read_text() == MODEL
    assert not model["marker"].exists()


@pytest.mark.parametrize("op", [
    {"op": "rename_node", "args": {"var_name": "a", "new_name": "x\n" + "MARKER"}},
    {"op": "rename_node", "args": {"var_name": "a; MARKER", "new_name": "b"}},
    {"op": "add_port", "args": {"var_name": "a", "port_kind": "input", "new_name": "p'); MARKER; ('"}},
    {"op": "add_port", "args": {"var_name": "a", "port_kind": "MARKER", "new_name": "p"}},
    {"op": "remove_port", "args": {"var_name": "a", "port_kind": "input", "port_name": "p\"]+[MARKER"}},
    {"op": "rename_port", "args": {"var_name": "a", "port_kind": "output", "old_name": "p", "new_name": "q;MARKER"}},
    {"op": "rename_port", "args": {"var_name": "a", "port_kind": "output", "old_name": "p", "new_name": "q", "extra": "MARKER"}},
])
def test_hole_b_hostile_names_are_refused(client, fake, model, op):
    turn_on(client, model["path"].parent.parent)
    op = {"op": op["op"], "args": {k: v.replace("MARKER", marker_code(model["marker"])) for k, v in op["args"].items()}}
    events = propose(client, fake, [op], {"file_path": str(model["path"]), "source": MODEL})
    assert [e for e in events if e["type"] == "refused"], events
    assert not [e for e in events if e["type"] == "proposal"]
    assert not model["marker"].exists()


def test_hole_b_a_plain_value_goes_through_and_only_that(client, fake, model):
    """The honest edit: proposed, accepted, applied by the page's route, and
    the file holds the literal the backend rebuilt, nothing else."""
    turn_on(client, model["path"].parent.parent)
    context = {"file_path": str(model["path"]), "source": MODEL}
    events = propose(client, fake, [{"op": "update_param", "args": {"var_name": "a", "param_name": "slope", "new_value": "2  # pragma", "context": "function"}}], context)
    accepted = accept_everything_proposed(client, events, MODEL)
    assert len(accepted) == 1 and accepted[0][1].status_code == 200
    proposal = accepted[0][0]
    assert proposal["ops"] == [{"op": "update_param", "args": {"var_name": "a", "param_name": "slope", "new_value": "2", "context": "function"}}]
    apply_as_the_page_would(client, proposal, model["path"])
    assert "function=pnl.Linear(slope=2)" in model["path"].read_text()
    assert "pragma" not in model["path"].read_text()
    assert not model["marker"].exists()


def test_hole_b_the_users_own_edits_are_not_narrowed(client, model):
    """The checks are on the assistant's ops, at the point they are accepted.
    The user's own update-param still takes any expression, as before."""
    r = client.post("/api/model/update-param", json={
        "file_path": str(model["path"]), "var_name": "a", "param_name": "slope", "new_value": "np.float64(2)",
        "context": "function", "skip_introspect": True,
    })
    assert r.status_code == 200 and "slope=np.float64(2)" in model["path"].read_text()


def test_plain_literal_rebuilds_the_value():
    assert tools.plain_literal("2 # x") == "2"
    assert tools.plain_literal("'a\\nb'") == "'a\\nb'"
    assert tools.plain_literal([1, 2.5, None, True, "s"]) == "[1, 2.5, None, True, 's']"
    assert tools.plain_literal({"k": [1]}) == "{'k': [1]}"
    for bad in ("x", "f()", "1+1", "a.b", "...", "b'x'", "", "2)\n", "{**{}}", "[*a]"):
        with pytest.raises(tools.ToolRefused):
            tools.plain_literal(bad)
    with pytest.raises(tools.ToolRefused):
        tools.plain_literal(object())
