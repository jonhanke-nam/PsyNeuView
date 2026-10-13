"""Reading the model's file as it is on disk now, for "Changes since save" (#1348).

The dialog compares the editor against the file on disk, not against what
PsyNeuView last loaded, so it can say when the file changed outside the app.
These check the read is fresh, read-only, and limited to model files.
"""

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _read(path: Path):
    return client.post("/api/model/disk-source", json={"file_path": str(path)})


def test_returns_the_file_as_it_is_on_disk(tmp_path):
    p = tmp_path / "model.py"
    p.write_text("x = 1\n")

    resp = _read(p)

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"exists": True, "source": "x = 1\n"}


def test_reads_fresh_each_time_so_an_outside_change_shows(tmp_path):
    p = tmp_path / "model.py"
    p.write_text("x = 1\n")
    assert _read(p).json()["source"] == "x = 1\n"

    p.write_text("x = 1\n# saved in PyCharm\n")

    assert _read(p).json()["source"] == "x = 1\n# saved in PyCharm\n"


def test_does_not_change_the_file(tmp_path):
    p = tmp_path / "model.py"
    p.write_text("x = 1\n")
    before = p.stat().st_mtime_ns

    _read(p)

    assert p.read_text() == "x = 1\n"
    assert p.stat().st_mtime_ns == before


def test_a_missing_file_is_an_answer_not_an_error(tmp_path):
    resp = _read(tmp_path / "gone.py")

    assert resp.status_code == 200
    assert resp.json() == {"exists": False, "source": None}


def test_reads_only_model_files(tmp_path):
    p = tmp_path / "notes.txt"
    p.write_text("private\n")

    resp = _read(p)

    assert resp.status_code == 400
    assert "private" not in resp.text
