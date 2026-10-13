"""Previewing unsaved edits must never touch the user's file (#1029).

The whole point of the preview path is that PsyNeuView stops writing a file an
external editor has open. These tests assert that property directly — on the
bytes on disk — rather than trusting the endpoint's return value.
"""

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.preview import clear_preview, preview_path, write_preview

MODEL_SRC = """\
import psyneulink as pnl

a = pnl.TransferMechanism(name='a')
c = pnl.Composition(name='c')
c.add_node(a)
"""

EDITED_SRC = MODEL_SRC + "b = pnl.TransferMechanism(name='b')\nc.add_node(b)\n"


@pytest.fixture(autouse=True)
def isolated_preview_root(tmp_path, monkeypatch):
    """Never write into the developer's real ~/.psyneuview during tests."""
    monkeypatch.setenv("PSYNEUVIEW_PREVIEW_ROOT", str(tmp_path / "previews"))


@pytest.fixture
def model(tmp_path):
    # Its own folder, so "nothing new appeared beside the model" is a real
    # assertion and not confused by the tmp preview root above.
    project = tmp_path / "project"
    project.mkdir()
    p = project / "model.py"
    p.write_text(MODEL_SRC)
    return p


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_preview_does_not_modify_the_users_file(client, model):
    """The property this whole design exists for."""
    before = model.read_bytes()

    resp = client.post(
        "/api/model/preview", json={"file_path": str(model), "source": EDITED_SRC}
    )

    assert resp.status_code == 200
    assert model.read_bytes() == before, "preview must never write the user's model"


def test_preview_introspects_the_edited_source(client, model):
    """What you see on the canvas is the buffer, not what is on disk."""
    resp = client.post(
        "/api/model/preview", json={"file_path": str(model), "source": EDITED_SRC}
    )

    body = resp.json()
    names = [n["name"] for n in body["model"]["compositions"][0]["nodes"]]
    assert "b" in names, f"preview should reflect the unsaved edit: {names}"


def test_preview_file_lands_outside_the_model_directory(client, model):
    """Nothing new may appear in the folder the external editor is watching."""
    before = set(os.listdir(model.parent))

    client.post("/api/model/preview", json={"file_path": str(model), "source": EDITED_SRC})

    assert set(os.listdir(model.parent)) == before, "no new files beside the model"
    assert model.parent not in preview_path(model).parents


def test_invalid_source_reports_the_error_without_failing(client, model):
    """A half-typed model is the normal state, not a request failure."""
    resp = client.post(
        "/api/model/preview",
        json={"file_path": str(model), "source": "this is not python ("},
    )

    assert resp.status_code == 200
    assert resp.json()["model"]["error"]
    assert model.read_text() == MODEL_SRC, "a broken buffer must not reach the file"


def test_saving_clears_the_preview(client, model):
    """Once the buffer reaches the file there is nothing left to preview."""
    client.post("/api/model/preview", json={"file_path": str(model), "source": EDITED_SRC})
    assert preview_path(model).exists()

    resp = client.post(
        "/api/model/save-source", json={"file_path": str(model), "source": EDITED_SRC}
    )

    assert resp.status_code == 200
    assert model.read_text() == EDITED_SRC, "save is what actually writes the file"
    assert not preview_path(model).exists(), "a saved buffer leaves no stale preview"


def test_preview_of_a_missing_file_is_rejected(client, tmp_path):
    resp = client.post(
        "/api/model/preview",
        json={"file_path": str(tmp_path / "nope.py"), "source": MODEL_SRC},
    )
    assert resp.status_code == 404


def test_same_basename_in_different_folders_gets_separate_previews(tmp_path):
    """Two `model.py` files must not share one preview slot."""
    a, b = tmp_path / "one" / "model.py", tmp_path / "two" / "model.py"
    for p in (a, b):
        p.parent.mkdir(parents=True)
        p.write_text(MODEL_SRC)

    write_preview(a, "a = 1")
    write_preview(b, "b = 2")

    assert preview_path(a) != preview_path(b)
    assert preview_path(a).read_text() == "a = 1"
    assert preview_path(b).read_text() == "b = 2"


def test_preview_keeps_the_models_filename(tmp_path):
    """Tracebacks and sys.argv[0] should still name the file the user knows."""
    model = tmp_path / "stroop_with_lc.py"
    model.write_text(MODEL_SRC)
    assert write_preview(model, MODEL_SRC).name == "stroop_with_lc.py"


def test_clear_preview_is_safe_when_there_is_none(tmp_path):
    clear_preview(tmp_path / "never_previewed.py")  # must not raise
