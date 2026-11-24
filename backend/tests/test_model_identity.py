"""Every open says which model it is, as the menus name it (#422).

The toolbar shows the menu label beside the file name, with where the model
came from. The server works that out from the path, so these check it for
each kind of model, through the load routes and the lookup a Recent entry uses.
"""

from fastapi.testclient import TestClient

from app.api.routes import REFERENCE_DIR, REFERENCE_MODELS, model_identity
from app.main import app

client = TestClient(app)
MODEL = "GilzenratModel"  # small, loads fast
LABEL = next(e["label"] for e in REFERENCE_MODELS if e["name"] == MODEL)


def test_reference_load_carries_label_file_and_source():
    r = client.post("/api/reference-models/load", json={"name": MODEL})
    assert r.status_code == 200, r.text
    ident = r.json()["identity"]
    assert ident["source"] == "reference"
    assert ident["label"] == LABEL
    assert ident["file"] == f"{MODEL}.py"
    assert ident["workingCopy"] is True
    assert ident["original"] == str(REFERENCE_DIR / f"{MODEL}.py")


def test_reopening_the_working_copy_by_path_keeps_the_label():
    """A Recent entry reopens the working copy through /model/load."""
    path = client.post("/api/reference-models/load", json={"name": MODEL}).json()["file_path"]
    r = client.post("/api/model/load", json={"file_path": path})
    assert r.status_code == 200, r.text
    assert r.json()["identity"]["label"] == LABEL
    q = client.get("/api/model/identity", params={"file_path": path})
    assert q.json()["source"] == "reference" and q.json()["label"] == LABEL


def test_a_tutorial_copy_is_still_the_reference_model():
    r = client.post("/api/reference-models/load", json={"name": MODEL, "tutorial": "identity-test"})
    assert r.json()["identity"]["label"] == LABEL


def test_demo_load_is_a_demo():
    r = client.post("/api/demos/reset", json={"demo_name": "simple_stroop"})
    assert r.status_code == 200, r.text
    ident = r.json()["identity"]
    assert ident["source"] == "demo" and ident["file"] == "simple_stroop.py"


def test_a_users_file_is_named_by_its_file(tmp_path):
    f = tmp_path / "deep" / "folder" / "GilzenratModel.py"
    f.parent.mkdir(parents=True)
    f.write_text("x = 1\n")
    # Same file name as a reference model, but not one: it's the user's.
    ident = model_identity(f)
    assert ident.source == "user"
    assert ident.label is None
    assert ident.file == "GilzenratModel.py"
    assert ident.path == str(f)
