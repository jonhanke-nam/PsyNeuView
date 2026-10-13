"""Working copies of renamed reference models carry over (#1416).

Two reference models were renamed for the public release. A working copy
made under an old name (edits, an arranged layout, labels, a layout index)
must be what opens under the new name. The old stems here are stand-ins of
the same shape: the migration matches by shape, not by the old names.
"""

import json

from fastapi.testclient import TestClient

from app.main import app
from app.services import working_copies as wc

OLD = "stroop_basic_abc_defghi"  # same shape as the old stem
OLD_LC = "stroop_with_lc_abc_defg"


def test_an_old_working_copy_and_its_sidecars_are_adopted(tmp_path):
    (tmp_path / f"{OLD}.py").write_text("# edited\n")
    (tmp_path / f"{OLD}.pnlview.json").write_text("{}")
    (tmp_path / f"{OLD}.labels.yaml").write_text("x: y\n")
    (tmp_path / ".psyneuview").mkdir()
    (tmp_path / ".psyneuview" / f"{OLD}.1.pnlview.json").write_text("{}")

    moved = wc.adopt_renamed_working_copy("stroop_reference_basic", tmp_path)

    assert {p.name for p in moved} == {
        "stroop_reference_basic.py",
        "stroop_reference_basic.pnlview.json",
        "stroop_reference_basic.labels.yaml",
        "stroop_reference_basic.1.pnlview.json",
    }
    assert (tmp_path / "stroop_reference_basic.py").read_text() == "# edited\n"
    assert not (tmp_path / f"{OLD}.py").exists()


def test_the_layout_index_points_at_the_renamed_files(tmp_path):
    (tmp_path / f"{OLD_LC}.py").write_text("x = 1\n")
    (tmp_path / f"{OLD_LC}.psyneuview.json").write_text(json.dumps(
        {"layouts": [{"file": f"{OLD_LC}.1.pnlview.json"}, {"file": f"{OLD_LC}.pnlview.json"}]}
    ))
    wc.adopt_renamed_working_copy("stroop_reference_with_lc", tmp_path)
    index = json.loads((tmp_path / "stroop_reference_with_lc.psyneuview.json").read_text())
    assert [entry["file"] for entry in index["layouts"]] == [
        "stroop_reference_with_lc.1.pnlview.json",
        "stroop_reference_with_lc.pnlview.json",
    ]


def test_a_working_copy_under_the_new_name_is_never_overwritten(tmp_path):
    (tmp_path / "stroop_reference_basic.py").write_text("# new\n")
    (tmp_path / f"{OLD}.py").write_text("# old\n")
    assert wc.adopt_renamed_working_copy("stroop_reference_basic", tmp_path) == []
    assert (tmp_path / "stroop_reference_basic.py").read_text() == "# new\n"
    assert (tmp_path / f"{OLD}.py").exists()


def test_other_models_and_other_files_are_left_alone(tmp_path):
    (tmp_path / "stroop_basic.py").write_text("# the demo\n")
    (tmp_path / "stroop_basic_my_notes.py").write_text("# not the old shape\n")
    assert wc.adopt_renamed_working_copy("Cohen_Huston1994", tmp_path) == []
    assert wc.adopt_renamed_working_copy("stroop_reference_basic", tmp_path) == []
    assert (tmp_path / "stroop_basic.py").exists() and (tmp_path / "stroop_basic_my_notes.py").exists()


def test_opening_the_renamed_model_opens_the_old_edited_copy(tmp_path, monkeypatch):
    monkeypatch.setenv(wc.WORKING_DIR_ENV, str(tmp_path))
    from app.api import routes

    pristine = (routes.REFERENCE_DIR / "stroop_reference_basic.py").read_text()
    edited = pristine + "\n# my edit\n"
    (tmp_path / f"{OLD}.py").write_text(edited)

    resp = TestClient(app).post("/api/reference-models/load", json={"name": "stroop_reference_basic"})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["source"] == edited
    assert body["workingCopy"]["diverged"] is True
    assert body["file_path"].endswith("stroop_reference_basic.py")
