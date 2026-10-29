"""The Elaborate Configurations demo computes what PsyNeuLink Tutorials lesson 8 says (#9).

The demo is the Basics and Primer's Stroop model, five pathway lists with
their matrices written between the mechanisms. The walkthrough quotes the
matrices; for the Primer's run (color naming, congruent then incongruent),
decision times of about 1.41 and 2.75 and a chance of answering red of 0.999
and 0.940; and for reading the word green in red ink, a time of about 1.38
and a chance of red of 0.001. The DDM's decision itself, 1 or -1, is drawn
at random, so it is not pinned. This pins the rest, so a PsyNeuLink change
fails here by name.
"""

from pathlib import Path

import numpy as np
import pytest

from app.services.executor import run_model
from app.services.introspector import load_and_introspect
from app.services.model_dirs import _format_label

DEMO = Path(__file__).parent.parent / "demos" / "elaborate_configurations.py"
RED, GREEN = [1, 0], [0, 1]
COLOR_TASK, WORD_TASK = [1, 0], [0, 1]


def _decisions(color, word, task):
    """Each trial's decision time and chance of red (the DDM's upper threshold)."""
    result = run_model(
        str(DEMO), "Stroop_model", {"COLOR INPUT": color, "WORD INPUT": word, "TASK INPUT": task}, use_sandbox=False
    )
    assert "error" not in result, result
    # The DDM's values: decision, response time, then the chances of the
    # upper and lower thresholds.
    return [(float(np.ravel(t[1])[0]), float(np.ravel(t[2])[0])) for t in result["logs"]["DECISION"]["values"]]


def test_the_menu_calls_it_elaborate_configurations():
    # The walkthrough opens it by this label.
    assert _format_label(DEMO.stem) == "Elaborate Configurations"


def test_the_pathways_write_the_primers_matrices():
    comp = load_and_introspect(str(DEMO))["compositions"][0]
    matrices = {
        (p["sender"]["mechanism"], p["receiver"]["mechanism"]): p["params"]["matrix"]["value"]
        for p in comp["projections"]
    }
    assert matrices[("COLOR INPUT", "COLOR HIDDEN")] == [[2, -2], [-2, 2]]
    assert matrices[("COLOR HIDDEN", "OUTPUT")] == [[2, -2], [-2, 2]]
    assert matrices[("WORD INPUT", "WORD HIDDEN")] == [[3, -3], [-3, 3]]
    assert matrices[("WORD HIDDEN", "OUTPUT")] == [[3, -3], [-3, 3]]
    assert matrices[("TASK INPUT", "COLOR HIDDEN")] == [[4, 4], [0, 0]]
    assert matrices[("TASK INPUT", "WORD HIDDEN")] == [[0, 0], [4, 4]]
    assert ("OUTPUT", "DECISION") in matrices
    names = {p["name"] for p in comp["projections"]}
    assert "MappingProjection from COLOR INPUT[OutputPort-0] to COLOR HIDDEN[InputPort-0]" in names
    assert "MappingProjection from WORD INPUT[OutputPort-0] to WORD HIDDEN[InputPort-0]" in names


def test_the_incongruent_trial_is_slower():
    congruent, incongruent = _decisions([RED, RED], [RED, GREEN], [COLOR_TASK, COLOR_TASK])
    assert congruent == pytest.approx((1.4128, 0.9986), abs=1e-4)
    assert incongruent == pytest.approx((2.7544, 0.9404), abs=1e-4)


def test_reading_the_word_is_barely_slowed_by_the_ink():
    [(time, chance_of_red)] = _decisions([RED], [GREEN], [WORD_TASK])
    assert time == pytest.approx(1.3797, abs=1e-4)
    assert chance_of_red == pytest.approx(0.0012, abs=1e-4)
