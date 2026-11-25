"""Working copies of two different models never share a file (#422).

Working copies used to sit in one folder, named by the model's file name
alone, so a Reference Model and a PsyNeuLink example with the same file name,
or one example from two PsyNeuLink sources, would have written the same file.
Each source now has its own folder, and copies an older version left in the
shared folder move into theirs without losing edits (the #1010 rule).
"""

import json

from fastapi.testclient import TestClient

from app.main import app
from app.services import working_copies as wc

client = TestClient(app)
MODEL = "GilzenratModel"


def _separate(folder, **kw):
    kw.setdefault("references", {MODEL, "stroop_reference_basic"})
    kw.setdefault("demos", {"simple_stroop"})
    kw.setdefault("examples", {"Botvinick Model Composition"})
    kw.setdefault("example_source", "PrincetonUniversity-PsyNeuLink@devel")
    return wc.separate_by_source(folder, **kw)


def test_each_source_has_its_own_folder(tmp_path, monkeypatch):
    monkeypatch.setenv(wc.WORKING_DIR_ENV, str(tmp_path))
    ref = wc.reference_copies_dir() / f"{MODEL}.py"
    ex_a = wc.example_copies_dir("PrincetonUniversity-PsyNeuLink@devel") / f"{MODEL}.py"
    ex_b = wc.example_copies_dir("jonhanke-nam-PsyNeuLink@devel") / f"{MODEL}.py"
    demo = wc.demo_copies_dir() / f"{MODEL}.py"
    assert len({ref, ex_a, ex_b, demo}) == 4


def test_source_folder_names():
    assert wc.source_folder_name({"source": "github", "repo": "PrincetonUniversity/PsyNeuLink", "branch": "devel"}) \
        == "PrincetonUniversity-PsyNeuLink@devel"
    assert wc.source_folder_name({"source": "pypi", "version": "0.19.1.0"}) == "pypi-0.19.1.0"
    assert wc.source_folder_name(None) == "unknown"


def test_an_old_shared_copy_moves_with_its_edits_and_sidecars(tmp_path):
    (tmp_path / f"{MODEL}.py").write_text("# my edits\n")
    (tmp_path / f"{MODEL}.pnlview.json").write_text('{"positions": {}}')
    (tmp_path / ".psyneuview").mkdir()
    (tmp_path / ".psyneuview" / f"{MODEL}.1.pnlview.json").write_text("{}")
    (tmp_path / "simple_stroop.py").write_text("# demo\n")
    (tmp_path / "Botvinick Model Composition.py").write_text("# example\n")
    (tmp_path / "notes.py").write_text("# not a model PsyNeuView knows\n")

    record = _separate(tmp_path)

    assert record["moved"] == 5 and record["ok"] and record["conflicts"] == []
    ref = tmp_path / "reference-models"
    assert (ref / f"{MODEL}.py").read_text() == "# my edits\n"
    assert (ref / f"{MODEL}.pnlview.json").exists()
    assert (ref / ".psyneuview" / f"{MODEL}.1.pnlview.json").exists()
    assert (tmp_path / "demos" / "simple_stroop.py").exists()
    assert (tmp_path / "psyneulink-examples" / "PrincetonUniversity-PsyNeuLink@devel"
            / "Botvinick Model Composition.py").exists()
    assert (tmp_path / "notes.py").exists(), "an unknown file was moved"
    assert not (tmp_path / f"{MODEL}.py").exists()
    # A second run finds nothing to do.
    assert _separate(tmp_path) is None


def test_a_copy_is_never_overwritten(tmp_path):
    (tmp_path / "reference-models").mkdir()
    (tmp_path / "reference-models" / f"{MODEL}.py").write_text("# newer\n")
    (tmp_path / f"{MODEL}.py").write_text("# older, different\n")
    (tmp_path / "reference-models" / f"{MODEL}.pnlview.json").write_text("{}")
    (tmp_path / f"{MODEL}.pnlview.json").write_text("{}")

    record = _separate(tmp_path)

    assert (tmp_path / "reference-models" / f"{MODEL}.py").read_text() == "# newer\n"
    assert (tmp_path / f"{MODEL}.py").read_text() == "# older, different\n", "the different copy was lost"
    assert record["conflicts"] == [str(tmp_path / f"{MODEL}.py")]
    assert record["duplicates_removed"] == 1
    assert not (tmp_path / f"{MODEL}.pnlview.json").exists()


def test_a_renamed_models_old_copy_moves_and_is_adopted(tmp_path, monkeypatch):
    monkeypatch.setenv(wc.WORKING_DIR_ENV, str(tmp_path))
    old = "stroop_basic_" + "abc" + "_" + "defghi"  # the old name's shape (#1416)
    from app.api import routes

    edited = (routes.REFERENCE_DIR / "stroop_reference_basic.py").read_text() + "\n# mine\n"
    (tmp_path / f"{old}.py").write_text(edited)
    body = client.post("/api/reference-models/load", json={"name": "stroop_reference_basic"}).json()
    assert body["file_path"] == str(tmp_path / "reference-models" / "stroop_reference_basic.py")
    assert body["source"] == edited
    assert body["workingCopy"]["diverged"] is True


def test_reopening_after_the_move_keeps_the_edits(tmp_path, monkeypatch):
    """The whole path: an edited copy in the shared folder, then an open."""
    monkeypatch.setenv(wc.WORKING_DIR_ENV, str(tmp_path))
    from app.api import routes

    edited = (routes.REFERENCE_DIR / f"{MODEL}.py").read_text() + "\n# my edit\n"
    (tmp_path / f"{MODEL}.py").write_text(edited)
    body = client.post("/api/reference-models/load", json={"name": MODEL}).json()
    assert body["file_path"] == str(tmp_path / "reference-models" / f"{MODEL}.py")
    assert body["source"] == edited
    assert body["workingCopy"] == {"diverged": True, "restored": False}


def test_a_recent_entry_for_the_old_place_opens_the_moved_copy(tmp_path, monkeypatch):
    monkeypatch.setenv(wc.WORKING_DIR_ENV, str(tmp_path))
    opened = client.post("/api/reference-models/load", json={"name": MODEL}).json()["file_path"]
    old_place = tmp_path / f"{MODEL}.py"
    assert wc.relocated(old_place) == wc.Path(opened)
    r = client.post("/api/model/load", json={"file_path": str(old_place)})
    assert r.status_code == 200, r.text
    assert r.json()["file_path"] == opened
    assert r.json()["identity"]["source"] == "reference"
    # Something outside the working copies is never redirected.
    assert wc.relocated(tmp_path / "elsewhere" / f"{MODEL}.py") is None


def test_the_move_is_recorded_for_a_problem_report(tmp_path):
    (tmp_path / f"{MODEL}.py").write_text("x\n")
    _separate(tmp_path)
    from app.services.app_config import app_config_path

    record = json.loads(app_config_path().read_text())[wc.SEPARATION_KEY]
    assert record["moved"] == 1
