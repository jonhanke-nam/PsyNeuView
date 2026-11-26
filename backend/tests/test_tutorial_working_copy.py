"""A tutorial opens its model as a fresh copy of its own (#172).

Bundled models share one working copy. A tutorial that used it started on
whatever the learner last did to the model, and a second window opening the
same model wrote over the copy the tutorial was using. With ``tutorial`` in
the request the copy goes in ``tutorials/<id>/`` under the working dir, and is
fresh every time.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
REFERENCE = "GilzenratModel"  # small, loads fast
DEMO = "bistable_attractor"


@pytest.fixture
def working(tmp_path, monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_WORKING_DIR", str(tmp_path))
    return tmp_path


def _reference(**body):
    r = client.post("/api/reference-models/load", json={"name": REFERENCE, **body})
    assert r.status_code == 200, r.text
    return r.json()


def _demo(**body):
    r = client.post("/api/demos/reset", json={"demo_name": DEMO, **body})
    assert r.status_code == 200, r.text
    return r.json()


def test_reference_goes_in_the_tutorials_own_folder(working):
    body = _reference(tutorial="stroop")
    assert body["file_path"] == str(working / "tutorials" / "stroop" / f"{REFERENCE}.py")
    assert not (working / "reference-models" / f"{REFERENCE}.py").exists(), "the shared copy was touched"


def test_reference_tutorial_copy_is_fresh_every_time(working):
    first = _reference(tutorial="stroop")
    path = working / "tutorials" / "stroop" / f"{REFERENCE}.py"
    path.write_text(path.read_text() + "\n# a learner's edit\n")
    second = _reference(tutorial="stroop")
    assert "# a learner's edit" not in path.read_text()
    assert second["source"] == first["source"]
    assert second["workingCopy"]["diverged"] is False


def test_learners_own_copy_is_left_alone(working):
    _reference()
    own = working / "reference-models" / f"{REFERENCE}.py"
    own.write_text(own.read_text() + "\n# my own work\n")
    _reference(tutorial="stroop")
    assert "# my own work" in own.read_text()


def test_demo_goes_in_the_tutorials_own_folder(working):
    body = _demo(tutorial="dynamics")
    path = working / "tutorials" / "dynamics" / f"{DEMO}.py"
    assert body["file_path"] == str(path)
    path.write_text(path.read_text() + "\n# edit\n")
    _demo(tutorial="dynamics")
    assert "# edit" not in path.read_text()


def test_tutorials_have_separate_folders(working):
    a = _demo(tutorial="dynamics")["file_path"]
    b = _demo(tutorial="orientation-running")["file_path"]
    assert a != b


@pytest.mark.parametrize("bad", ["../escape", "a/b", "", "UPPER", ".hidden"])
def test_tutorial_id_is_checked(working, bad):
    r = client.post("/api/demos/reset", json={"demo_name": DEMO, "tutorial": bad})
    if bad == "":
        # Empty means no tutorial: the shared copy, as before.
        assert r.status_code == 200
        return
    assert r.status_code == 400
