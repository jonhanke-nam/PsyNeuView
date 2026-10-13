"""Tests for the sidecar labels service, incl. the #478 clone redirect."""

import tempfile
from pathlib import Path

import pytest

from app.services.labels import labels_path, load_labels, save_labels


@pytest.fixture
def tmp_model():
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write("# test model\n")
        f.flush()
        name = f.name
    yield name
    stem = Path(name)
    for p in stem.parent.glob(stem.stem + "*"):
        if p.suffix != ".py":
            p.unlink(missing_ok=True)
    stem.unlink(missing_ok=True)


def test_labels_path_format(tmp_model):
    assert str(labels_path(tmp_model)).endswith(".labels.yaml")


def test_save_and_load_roundtrip(tmp_model):
    labels = {"node": {"element_names": ["a", "b"]}}
    save_labels(tmp_model, labels)
    assert load_labels(tmp_model) == labels


def test_empty_labels_deletes_file(tmp_model):
    save_labels(tmp_model, {"node": {"element_names": ["a"]}})
    assert labels_path(tmp_model).exists()
    save_labels(tmp_model, {})
    assert not labels_path(tmp_model).exists()
    assert load_labels(tmp_model) is None


def test_labels_redirected_out_of_clone(monkeypatch, tmp_path):
    """A model inside a managed clone gets its labels sidecar written out of
    tree, leaving the clone's working tree clean (#349 / #478)."""
    root = tmp_path / "clones"
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(root))
    model = root / "PsyNeuLink-owner" / "scripts" / "m.py"
    model.parent.mkdir(parents=True)
    model.write_text("# model\n")

    save_labels(str(model), {"node": {"element_names": ["a"]}})

    # Nothing written next to the model inside the clone.
    assert not model.with_name("m.labels.yaml").exists()
    # Sidecar lives out of tree and round-trips.
    assert labels_path(str(model)).exists()
    assert load_labels(str(model)) == {"node": {"element_names": ["a"]}}
