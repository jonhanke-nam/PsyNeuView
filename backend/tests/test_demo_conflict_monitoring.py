"""The conflict-monitoring demo behaves as the course says it does (#57).

The Conflict Monitoring walkthrough runs the demo's incongruent and congruent
trial types and quotes the decision energy and the response units, then raises
TASK DEMAND's gain and runs the incongruent trial again. If the demo stopped
showing the paper's ordering (energy highest on incongruent trials, similar on
congruent and control), or the edit stopped resolving the conflict, the
walkthrough would still pass its own steps while teaching the wrong thing. So
this pins the numbers, not just that the demo loads.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

COMPOSITION = "conflict_monitoring"
# Each trial's results, in the order the composition reports them.
COLOR_HIDDEN, RESPONSE, ENERGY, WORD_HIDDEN, TASK_DEMAND = range(5)


@pytest.fixture
def loaded(tmp_path, monkeypatch):
    # /demos/reset writes a working copy; keep it out of backend/ (#1134).
    monkeypatch.setenv("PSYNEWVIEW_WORKING_DIR", str(tmp_path))
    resp = client.post("/api/demos/reset", json={"demo_name": "conflict_monitoring"})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _input_sets(loaded):
    return {s["name"]: s for s in loaded["model"]["inputSets"]}


def _run(file_path, inputs):
    resp = client.post(
        "/api/model/run",
        json={"file_path": file_path, "composition_name": COMPOSITION, "inputs": inputs},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "error" not in data or data["error"] is None, data.get("error")
    return data


def _trial(data, index):
    """One trial's outputs as floats: [COLOR HIDDEN, RESPONSE, ENERGY, …]."""
    return [list(_flatten(v)) for v in data["results"][index]["output"]]


def test_demo_is_listed_under_a_readable_label():
    labels = {d["name"]: d["label"] for d in client.get("/api/demos").json()["demos"]}
    assert labels.get("conflict_monitoring") == "Conflict Monitoring"


def test_the_three_trial_types_are_declared(loaded):
    """The walkthrough picks them by name from the Run tab's From menu."""
    sets = _input_sets(loaded)
    assert list(sets) == ["incongruent", "congruent", "control"]
    for s in sets.values():
        assert s["kind"] == "run"
        assert {len(v) for v in s["inputs"].values()} == {150}


def test_energy_is_highest_on_incongruent_trials(loaded):
    """Botvinick et al. (2001), Figure 1: the conflict signal is highest when
    the word disagrees with the ink, and similar when it agrees or is absent."""
    sets = _input_sets(loaded)
    last = {
        name: _trial(_run(loaded["file_path"], sets[name]["inputs"]), -1)
        for name in ("incongruent", "congruent", "control")
    }
    energy = {name: t[ENERGY][0] for name, t in last.items()}
    assert energy["incongruent"] == pytest.approx(1.87, abs=0.05)
    assert energy["congruent"] == pytest.approx(0.82, abs=0.05)
    assert energy["control"] == pytest.approx(0.90, abs=0.05)
    assert energy["incongruent"] > 2 * energy["congruent"]
    # The responses the walkthrough quotes: on the incongruent trial the word
    # wins (green over red); on the congruent trial red wins outright.
    assert last["incongruent"][RESPONSE] == pytest.approx([0.56, 0.84], abs=0.02)
    assert last["congruent"][RESPONSE] == pytest.approx([0.96, 0.21], abs=0.02)


def test_the_first_trial_is_half_active(loaded):
    """What the trace shows before the stimulus: both responses near 0.48 and
    the energy already about 0.9."""
    sets = _input_sets(loaded)
    first = _trial(_run(loaded["file_path"], sets["incongruent"]["inputs"]), 0)
    assert first[RESPONSE] == pytest.approx([0.48, 0.48], abs=0.01)
    assert first[ENERGY][0] == pytest.approx(0.91, abs=0.01)


def test_sharper_task_demand_resolves_the_conflict(loaded):
    """The walkthrough's edit: TASK DEMAND's gain 1 -> 2. The word-reading
    demand unit drops, red wins the incongruent trial, and the energy halves."""
    path = loaded["file_path"]
    source = open(path).read()
    needle = "    function=pnl.Logistic(),\n    hetero=INHIBITION,\n    integrator_mode=True,\n    integration_rate=RATE,\n    name='TASK DEMAND'"
    assert needle in source
    with open(path, "w") as f:
        f.write(source.replace(needle, needle.replace("pnl.Logistic()", "pnl.Logistic(gain=2)")))
    last = _trial(_run(path, _input_sets(loaded)["incongruent"]["inputs"]), -1)
    assert last[TASK_DEMAND][1] == pytest.approx(0.12, abs=0.03)
    assert last[RESPONSE] == pytest.approx([0.66, 0.35], abs=0.03)
    assert last[ENERGY][0] == pytest.approx(0.94, abs=0.05)


def _flatten(value):
    if isinstance(value, str):
        # The run endpoint renders each output vector as numpy's repr.
        yield from (float(v) for v in value.strip("[]").split())
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _flatten(item)
    else:
        yield float(value)
