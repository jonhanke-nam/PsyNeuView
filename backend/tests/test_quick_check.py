"""The live preview's fast check, before the model runs (#256).

A syntax error or an undefined name is found in milliseconds without running
the model; the preview answers at once with the error and its line. It must
never block a model that would run.
"""

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import routes
from app.main import app
from app.services.quick_check import quick_check

BACKEND = Path(__file__).resolve().parents[1]

GOOD = """import psyneulink as pnl
A = pnl.ProcessingMechanism(name='A')
comp = pnl.Composition(name='comp', pathways=[A])
"""


def test_good_code_passes():
    assert quick_check(GOOD) is None


def test_a_syntax_error_with_its_line():
    found = quick_check(GOOD + "B = pnl.ProcessingMechanism(name='B'\n")
    assert found is not None and found["line"] == 4


def test_an_undefined_name_in_python_s_words():
    found = quick_check(GOOD + "comp.scheduler.add_condition(A, pnl.BeforeNode(AN_UNDEFINED_VAR))\n")
    assert found == {"error": "name 'AN_UNDEFINED_VAR' is not defined", "line": 4}


@pytest.mark.parametrize("dynamic", [
    "from psyneulink import *\n",
    "globals()['B'] = 1\n",
    "exec('B = 1')\n",
])
def test_names_it_cannot_follow_never_block(dynamic):
    assert quick_check(dynamic + GOOD + "print(B)\n") is None


def test_it_is_fast():
    source = GOOD * 200 + "x = UNDEFINED\n"
    start = time.perf_counter()
    assert quick_check(source) is not None
    assert time.perf_counter() - start < 0.5


@pytest.mark.parametrize("model", sorted(
    p for folder in ("reference_models", "demos") for p in (BACKEND / folder).rglob("*.py")
), ids=lambda p: p.name)
def test_no_bundled_model_is_blocked(model):
    """Every model PsyNeuView ships runs, so the check must pass them all."""
    assert quick_check(model.read_text(), str(model)) is None


# ── The preview endpoint ─────────────────────────────────────────────────


@pytest.fixture
def model_file(tmp_path):
    path = tmp_path / "m.py"
    path.write_text(GOOD)
    return path


def test_the_preview_answers_without_running_the_model(model_file, monkeypatch):
    ran = []
    monkeypatch.setattr(routes, "load_and_introspect", lambda *a, **k: ran.append(1) or {})
    client = TestClient(app)
    resp = client.post("/api/model/preview", json={
        "file_path": str(model_file),
        "source": GOOD + "comp.scheduler.add_condition(A, pnl.BeforeNode(NOPE))\n",
    })
    assert resp.status_code == 200
    model = resp.json()["model"]
    assert model["error"] == "name 'NOPE' is not defined"
    assert model["errorLine"] == 4
    assert model["quickCheck"] is True
    assert ran == [], "the model must not run when the fast check found a problem"


def test_good_code_still_runs(model_file, monkeypatch):
    ran = []
    monkeypatch.setattr(routes, "load_and_introspect",
                        lambda *a, **k: ran.append(1) or {"compositions": [], "lineMap": {}})
    client = TestClient(app)
    resp = client.post("/api/model/preview", json={"file_path": str(model_file), "source": GOOD})
    assert resp.status_code == 200
    assert ran == [1]
