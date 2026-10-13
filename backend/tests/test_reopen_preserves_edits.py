"""Reopening a reference model must not destroy working-copy edits (#1010).

Reopening used to `shutil.copy2` the pristine source over the working copy
unconditionally — the one place a user could lose work without being asked.

The bundled model itself was never at risk (`REFERENCE_DIR` is read-only), so
what these tests protect is the user's own copy.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
MODEL = "GilzenratModel"  # small, loads fast, ships no curated layout


def _load(**body):
    r = client.post("/api/reference-models/load", json={"name": MODEL, **body})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def working(tmp_path, monkeypatch):
    """Point the working dir at a tmp path so tests never touch backend/."""
    monkeypatch.setenv("PSYNEWVIEW_WORKING_DIR", str(tmp_path))
    return tmp_path / f"{MODEL}.py"


def test_fresh_load_reports_no_divergence(working):
    body = _load()
    assert body["workingCopy"] == {"diverged": False, "restored": False}
    assert working.exists()


def test_reopen_preserves_edits(working):
    """The regression this issue is about."""
    _load()
    working.write_text(working.read_text() + "\n# user edit\n")

    body = _load()

    assert "# user edit" in working.read_text(), "reopen destroyed the user's edits"
    assert body["workingCopy"]["diverged"] is True
    assert body["workingCopy"]["restored"] is False


def test_reopen_is_idempotent(working):
    """Repeated reopens must not drift — reopening is a re-read."""
    _load()
    working.write_text(working.read_text() + "\n# user edit\n")
    for _ in range(3):
        _load()
    assert working.read_text().count("# user edit") == 1


def test_restore_is_opt_in(working):
    """Losing work has to be asked for, not inferred."""
    _load()
    working.write_text(working.read_text() + "\n# user edit\n")

    body = _load(restore_pristine=True)

    assert "# user edit" not in working.read_text()
    assert body["workingCopy"] == {"diverged": False, "restored": True}


def test_restore_on_a_clean_copy_is_harmless(working):
    """Restoring when there is nothing to discard is a no-op, not an error."""
    _load()
    body = _load(restore_pristine=True)
    assert body["workingCopy"] == {"diverged": False, "restored": False}


def test_bundled_model_is_never_written(working):
    """The property that makes all of the above safe."""
    from app.api.routes import REFERENCE_DIR

    pristine = REFERENCE_DIR / f"{MODEL}.py"
    before = pristine.read_text()
    _load()
    working.write_text("# clobbered\n")
    _load()
    _load(restore_pristine=True)
    assert pristine.read_text() == before
