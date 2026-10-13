"""The EGO demo learns Coffee Shop World the way the course says it does (#55).

The EGO walkthrough runs the demo's blocked day and then its interleaved day
(the same twelve visits, in a different order) and quotes what PREDICTION says
on the last trial of each: blocked puts about 0.93 on the right state,
interleaved splits it about evenly between what the two coffee shops do next.
If the demo stopped showing that, the walkthrough would still pass its steps
while teaching the wrong thing, so this pins the numbers, not just that a run
completes.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

COMPOSITION = "ego_coffee_shop"
# Each trial's results, in the order the composition reports them.
PREVIOUS_RETRIEVED, CONTEXT_RETRIEVED, PREDICTION = range(3)
TRIALS = 60
LAST = TRIALS - 1


@pytest.fixture(scope="module")
def loaded(tmp_path_factory):
    # /demos/reset writes a working copy; keep it out of backend/ (#1134).
    # Module-scoped (one load, two runs), so set the variable by hand rather
    # than with the function-scoped monkeypatch.
    import os

    saved = os.environ.get("PSYNEWVIEW_WORKING_DIR")
    os.environ["PSYNEWVIEW_WORKING_DIR"] = str(tmp_path_factory.mktemp("ego"))
    try:
        resp = client.post("/api/demos/reset", json={"demo_name": COMPOSITION})
        assert resp.status_code == 200, resp.text
        yield resp.json()
    finally:
        if saved is None:
            os.environ.pop("PSYNEWVIEW_WORKING_DIR", None)
        else:
            os.environ["PSYNEWVIEW_WORKING_DIR"] = saved


def _sets(loaded):
    return {s["name"]: s for s in loaded["model"]["inputSets"]}


@pytest.fixture(scope="module")
def runs(loaded):
    """Both days, run as the Run tab runs them."""
    out = {}
    for name in ("blocked", "interleaved"):
        resp = client.post(
            "/api/model/run",
            json={
                "file_path": loaded["file_path"],
                "composition_name": COMPOSITION,
                "inputs": _sets(loaded)[name]["inputs"],
            },
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert not data.get("error"), data.get("error")
        out[name] = data
    return out


def _states(loaded, name):
    """The day's states, 1-10, from the one-hot STATE inputs."""
    rows = next(iter(_sets(loaded)[name]["inputs"].values()))
    return [row.index(1) + 1 for row in rows]


def _prediction(data, trial):
    return [float(v) for v in data["results"][trial]["output"][PREDICTION]]


def _predictable_accuracy(loaded, data, name):
    """Mean weight PREDICTION puts on the actual state, over the three
    predictable states of every visit (the last three of each five)."""
    states = _states(loaded, name)
    scores = [
        _prediction(data, t)[states[t] - 1]
        for t in range(TRIALS)
        if t % 5 >= 2
    ]
    return sum(scores) / len(scores)


def test_demo_is_listed_under_a_readable_label():
    labels = {d["name"]: d["label"] for d in client.get("/api/demos").json()["demos"]}
    assert labels.get(COMPOSITION) == "EGO Coffee Shop"


def test_the_two_days_are_declared(loaded):
    """The walkthrough picks them by name from the Run tab's From menu."""
    sets = _sets(loaded)
    assert [(n, s["kind"]) for n, s in sets.items()] == [
        ("blocked", "run"),
        ("interleaved", "run"),
    ]
    for name in ("blocked", "interleaved"):
        assert len(next(iter(sets[name]["inputs"].values()))) == TRIALS


def test_the_two_days_are_the_same_visits_in_a_different_order(loaded):
    def visits(name):
        states = _states(loaded, name)
        return sorted(tuple(states[i:i + 5]) for i in range(0, TRIALS, 5))

    assert visits("blocked") == visits("interleaved")
    # Blocked: six visits to the cue-9 shop, then six to the cue-10 shop.
    cues = _states(loaded, "blocked")[::5]
    assert cues == [9] * 6 + [10] * 6
    assert _states(loaded, "interleaved")[::5] == [9, 10] * 6


def test_the_walkthrough_names_what_the_app_draws(loaded):
    """The walkthrough selects these nodes on the canvas."""
    text = str(loaded["model"])
    for name in ("STATE", "PREVIOUS STATE", "CONTEXT", "CONTEXT [NORMALIZED]", "PREDICTION", "EM"):
        assert f"'{name}'" in text, name


def test_the_outputs_are_labelled(runs):
    assert runs["blocked"]["outputLabels"] == [
        "EM: PREVIOUS STATE [RETRIEVED]",
        "EM: CONTEXT [RETRIEVED]",
        "PREDICTION",
    ]


def test_blocked_predicts_the_last_state(loaded, runs):
    """Trial 60 is state 7, after 6, in the cue-10 shop."""
    assert _states(loaded, "blocked")[LAST] == 7
    pred = _prediction(runs["blocked"], LAST)
    assert pred[7 - 1] == pytest.approx(0.93, abs=0.05)
    assert pred[8 - 1] < 0.1


def test_interleaved_splits_between_the_two_shops(loaded, runs):
    """The same trial, interleaved: 6 is followed by 7 in one shop and by 8
    in the other, and the model can't tell which shop it is in."""
    assert _states(loaded, "interleaved")[LAST] == 7
    pred = _prediction(runs["interleaved"], LAST)
    assert pred[7 - 1] == pytest.approx(0.48, abs=0.08)
    assert pred[8 - 1] == pytest.approx(0.47, abs=0.08)


def test_blocked_learns_the_day_better(loaded, runs):
    blocked = _predictable_accuracy(loaded, runs["blocked"], "blocked")
    interleaved = _predictable_accuracy(loaded, runs["interleaved"], "interleaved")
    assert blocked == pytest.approx(0.58, abs=0.05)
    assert interleaved == pytest.approx(0.29, abs=0.05)
    assert blocked > interleaved + 0.2
