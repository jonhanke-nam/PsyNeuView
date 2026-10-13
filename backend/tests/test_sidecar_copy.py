"""Save a copy as… carries the model's sidecars to the copy (#1244).

``/api/models/save-as`` wrote only the ``.py``, so the copy opened with a
default layout and no labels, and its later layout changes went to files the
original never used. These pin that the layout, labels and index come along
— renamed to the copy's stem, placed by the destination's rules, read from
wherever the original keeps them (the redirected layouts folder for a
read-only PsyNeuLink file included) — that the copy starts unlocked and is
not a demo, that an existing file at the destination gets the same 409 and
``overwrite`` as the ``.py`` does, and that the route answers with what the
client needs to open the copy looking like the original.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import edit_lock, managed_layouts as ml, settings_info, sidecar_copy
from app.services import sidecar_placement as sp
from app.services.labels import load_labels, save_labels
from app.services.layout import load_layout, save_layout, sidecar_path, stamp_demo_origin
from app.services.sidecar_index import get_placement, list_sidecars, load_index, set_active, set_placement

client = TestClient(app)

MODEL = "import psyneulink as pnl\nA = pnl.TransferMechanism(name='A')\n"
POSITIONS = {"A": {"x": 40, "y": 60}}
ALT_POSITIONS = {"A": {"x": 400, "y": 600}}
LABELS = {"nodes": {"A": {"label": "The A node"}}}


@pytest.fixture(autouse=True)
def _isolated(monkeypatch, tmp_path):
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(tmp_path / "clones"))
    monkeypatch.delenv("PSYNEUVIEW_SIDECAR_PLACEMENT", raising=False)


@pytest.fixture
def original(tmp_path):
    """A user model with the full set: a default layout (locked, and stamped
    as a demo copy), a named layout variant that is the active one, labels,
    and the index that records the active variant. Lateral, like a model
    from before the dot-folder."""
    folder = tmp_path / "models"
    folder.mkdir()
    model = folder / "m.py"
    model.write_text(MODEL)
    # A lateral file first, so the rest stays lateral (the #927 rule).
    model.with_name("m.pnlview.json").write_text("{}\n")
    save_layout(str(model), POSITIONS, viewport={"x": 1, "y": 2, "zoom": 1.5})
    edit_lock.set_edit_mode(str(model), "viewOnly")
    layout = load_layout(str(model))
    layout["demo_origin"] = "stroop_basic"
    sidecar_path(str(model)).write_text(json.dumps(layout, indent=2) + "\n")
    save_layout(str(model), ALT_POSITIONS, variant="alt")
    save_labels(str(model), LABELS)
    set_active(str(model), "layout", "alt")
    assert list_sidecars(str(model))["activeLayout"] == "alt"
    return model


def _names(paths):
    return sorted(p.name for p in paths)


# ── The service ───────────────────────────────────────────────────────


def test_every_sidecar_is_planned_under_the_copys_stem(original, tmp_path):
    copy = tmp_path / "elsewhere" / "c.py"
    plan = sidecar_copy.plan(original, copy)
    assert _names(c.source for c in plan) == [
        "m.alt.pnlview.json", "m.labels.yaml", "m.pnlview.json", "m.psyneuview.json",
    ]
    assert _names(c.target for c in plan) == [
        "c.alt.pnlview.json", "c.labels.yaml", "c.pnlview.json", "c.psyneuview.json",
    ]
    assert not any(c.exists for c in plan)


def test_a_copy_of_a_file_over_itself_carries_nothing(original):
    assert sidecar_copy.plan(original, original) == []
    assert sidecar_copy.plan(original, Path(str(original))) == []


def test_a_model_without_sidecars_plans_nothing(tmp_path):
    bare = tmp_path / "bare.py"
    bare.write_text(MODEL)
    assert sidecar_copy.plan(bare, tmp_path / "c.py") == []
    assert sidecar_copy.plan(tmp_path / "missing.py", tmp_path / "c.py") == []


def test_the_copy_opens_like_the_original(original, tmp_path):
    copy = tmp_path / "elsewhere" / "c.py"
    copy.parent.mkdir()
    copy.write_text(MODEL)
    written = sidecar_copy.copy_sidecars(original, copy)
    assert len(written) == 4

    # Layouts: both variants, positions and viewport intact, the variant's
    # embedded name kept.
    assert load_layout(str(copy))["positions"] == POSITIONS
    assert load_layout(str(copy))["viewport"] == {"x": 1, "y": 2, "zoom": 1.5}
    assert load_layout(str(copy), "alt")["positions"] == ALT_POSITIONS
    assert load_layout(str(copy), "alt")["name"] == "alt"
    # Labels, as they were.
    assert load_labels(str(copy)) == LABELS
    # The index: entries renamed to the copy's stem, the active variant kept.
    sidecars = list_sidecars(str(copy))
    assert sidecars["activeLayout"] == "alt"
    assert {e["file"] for e in sidecars["layouts"]} == {"c.pnlview.json", "c.alt.pnlview.json"}
    assert not any(e.get("missing") for e in sidecars["layouts"])
    assert load_index(str(copy))["layouts"][0]["file"].startswith("c.")

    # The original is untouched.
    assert edit_lock.is_view_only(str(original))
    assert load_layout(str(original))["demo_origin"] == "stroop_basic"


def test_the_copy_starts_unlocked_and_is_not_a_demo(original, tmp_path):
    copy = tmp_path / "c.py"
    copy.write_text(MODEL)
    sidecar_copy.copy_sidecars(original, copy)
    layout = load_layout(str(copy))
    assert edit_lock.LOCK_KEY not in layout
    assert "demo_origin" not in layout
    assert not edit_lock.is_view_only(str(copy))
    # Everything else in the layout came across.
    assert layout["positions"] == POSITIONS


def test_the_copys_files_go_where_a_new_models_would(original, tmp_path):
    """The original is lateral; the copy is a new model in a folder with no
    lateral files, so under ``auto`` its files go to the dot-folder — the
    placement rule, not the original's accident of history."""
    copy = tmp_path / "fresh" / "c.py"
    copy.parent.mkdir()
    copy.write_text(MODEL)
    written = sidecar_copy.copy_sidecars(original, copy)
    assert {p.parent for p in written} == {copy.parent / sp.DOT_DIRNAME}
    assert not copy.with_name("c.pnlview.json").exists()


def test_the_originals_placement_choice_follows_the_copy(original, tmp_path):
    """A per-model "beside the .py" choice travels in the index, so the copy
    is pinned the same way — and its files land there from the start, not
    split between where the index says and where the default would put them."""
    set_placement(str(original), sp.LATERAL)
    copy = tmp_path / "fresh" / "c.py"
    copy.parent.mkdir()
    copy.write_text(MODEL)
    written = sidecar_copy.copy_sidecars(original, copy)
    assert {p.parent for p in written} == {copy.parent}
    assert get_placement(str(copy)) == sp.LATERAL
    assert sp.effective_placement(str(copy))["effective"] == sp.LATERAL


def test_an_existing_lateral_file_at_the_destination_is_the_target(original, tmp_path):
    """Lateral-first: a visible file is never shadowed by a hidden copy."""
    copy = tmp_path / "fresh" / "c.py"
    copy.parent.mkdir()
    stale = copy.with_name("c.pnlview.json")
    stale.write_text(json.dumps({"version": 1, "positions": {"A": {"x": 0, "y": 0}}}))
    plan = sidecar_copy.plan(original, copy)
    assert sidecar_copy.existing_targets(plan) == [stale]
    sidecar_copy.apply(plan, original, copy)
    assert json.loads(stale.read_text())["positions"] == POSITIONS


class _FakeDist:
    def __init__(self, site):
        self._site = site
        self.version = "9.9.9"

    def read_text(self, name):
        return None

    def locate_file(self, rel):
        return self._site / rel


def test_an_original_in_a_read_only_psyneulink_is_read_from_the_layouts_folder(tmp_path, monkeypatch):
    """A library model from a PyPI release keeps its layout under
    ``~/.psyneuview/layouts`` (#1321). A copy of it into the user's folder
    takes that layout along, and nothing is written into the install."""
    site = tmp_path / "venv" / "site-packages"
    library = site / "psyneulink" / "library" / "models"
    library.mkdir(parents=True)
    model = library / "Model.py"
    model.write_text(MODEL)
    monkeypatch.setattr(settings_info, "distribution", lambda name: _FakeDist(site))
    monkeypatch.setattr(settings_info, "active_psyneulink_package_dir", lambda: site / "psyneulink")
    save_layout(str(model), POSITIONS)
    assert sidecar_path(str(model)).is_relative_to(ml.layouts_dir())

    copy = tmp_path / "mine" / "Model_copy.py"
    copy.parent.mkdir()
    copy.write_text(MODEL)
    written = sidecar_copy.copy_sidecars(model, copy)
    assert [p.name for p in written] == ["Model_copy.pnlview.json"]
    assert load_layout(str(copy))["positions"] == POSITIONS
    assert not any(p.is_relative_to(site) for p in written)
    assert not list(site.rglob("*.pnlview.json"))


# ── The routes ────────────────────────────────────────────────────────


def _save_as(original, directory, name="c.py", **extra):
    return client.post("/api/models/save-as", json={
        "source": MODEL, "file_name": name, "directory": str(directory),
        "source_path": str(original), **extra,
    })


def test_save_as_carries_the_sidecars_and_answers_with_them(original, tmp_path):
    dest = tmp_path / "dest"
    resp = _save_as(original, dest)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    copy = Path(data["file_path"])
    assert copy == dest / "c.py" and copy.read_text() == MODEL

    # On disk: the whole set, under the copy's stem.
    assert _names(sp.model_sidecar_files(str(copy))) == [
        "c.alt.pnlview.json", "c.labels.yaml", "c.pnlview.json", "c.psyneuview.json",
    ]
    # In the answer: what the client opens the copy with — the *active*
    # variant's layout, the labels, the bundle and the variant lists.
    assert data["layout"]["positions"] == ALT_POSITIONS
    assert data["labels"] == LABELS
    assert data["sidecars"]["activeLayout"] == "alt"
    assert {b["kind"] for b in data["bundle"]} == {"source", "layout", "labels"}
    assert {b["name"] for b in data["bundle"] if b["kind"] == "layout"} == {
        "c.pnlview.json", "c.alt.pnlview.json",
    }
    assert "editLock" not in data["layout"]
    assert not edit_lock.is_view_only(str(copy))


def test_save_as_without_an_original_copies_nothing(tmp_path):
    """A brand-new file, the dev-tests loader, an import: nothing to carry."""
    resp = client.post("/api/models/save-as", json={
        "source": MODEL, "file_name": "new.py", "directory": str(tmp_path),
    })
    assert resp.status_code == 200, resp.text
    assert sp.model_sidecar_files(str(tmp_path / "new.py")) == []
    assert resp.json()["layout"] is None
    assert resp.json()["bundle"] == [{"kind": "source", "name": "new.py"}]


def test_a_sidecar_already_at_the_destination_gets_the_same_409_as_the_py(original, tmp_path):
    """Nothing — not even the .py — is written until the overwrite is confirmed,
    and the refusal names the file an overwrite would replace."""
    dest = tmp_path / "dest"
    dest.mkdir()
    stale = dest / "c.pnlview.json"
    stale.write_text(json.dumps({"version": 1, "positions": {"A": {"x": 0, "y": 0}}}))

    resp = _save_as(original, dest)
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == "File already exists: c.pnlview.json"
    assert not (dest / "c.py").exists()
    assert json.loads(stale.read_text())["positions"] == {"A": {"x": 0, "y": 0}}
    assert not (dest / "c.labels.yaml").exists()

    resp = _save_as(original, dest, overwrite=True)
    assert resp.status_code == 200, resp.text
    assert (dest / "c.py").read_text() == MODEL
    assert json.loads(stale.read_text())["positions"] == POSITIONS


def test_the_409_names_every_file_an_overwrite_would_replace(original, tmp_path):
    dest = tmp_path / "dest"
    _save_as(original, dest)
    resp = _save_as(original, dest)
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail.startswith("Files already exist: c.py")
    for name in ("c.pnlview.json", "c.alt.pnlview.json", "c.labels.yaml", "c.psyneuview.json"):
        assert name in detail


def test_save_as_onto_the_original_itself_keeps_its_files(original):
    """Overwriting the model with itself (same folder, same name) must not
    copy its sidecars over themselves — or drop the lock it carries."""
    resp = _save_as(original, original.parent, name="m.py", overwrite=True)
    assert resp.status_code == 200, resp.text
    assert edit_lock.is_view_only(str(original))
    assert list_sidecars(str(original))["activeLayout"] == "alt"


def test_save_copy_as_py_carries_the_sidecars_too(original, tmp_path):
    dest = tmp_path / "dest"
    resp = client.post("/api/model/save-copy", json={
        "file_path": str(original), "fmt": "py", "file_name": "c",
        "directory": str(dest), "source": MODEL,
    })
    assert resp.status_code == 200, resp.text
    copy = dest / "c.py"
    assert load_layout(str(copy), "alt")["positions"] == ALT_POSITIONS
    assert load_labels(str(copy)) == LABELS
    assert not edit_lock.is_view_only(str(copy))

    # And the same refusal when a sidecar is already there.
    (dest / "d.labels.yaml").write_text("nodes: {}\n")
    resp = client.post("/api/model/save-copy", json={
        "file_path": str(original), "fmt": "py", "file_name": "d",
        "directory": str(dest), "source": MODEL,
    })
    assert resp.status_code == 409
    assert resp.json()["detail"] == "File already exists: d.labels.yaml"
    assert not (dest / "d.py").exists()


def test_a_demo_working_copys_copy_is_not_a_demo(tmp_path):
    """The copy must not offer Reset to Original: that would put the demo
    back over the user's own file."""
    working = tmp_path / "work" / "stroop_basic.py"
    working.parent.mkdir()
    working.write_text(MODEL)
    stamp_demo_origin(str(working), "stroop_basic")
    save_layout(str(working), POSITIONS)
    assert load_layout(str(working))["demo_origin"] == "stroop_basic"

    resp = _save_as(working, tmp_path / "mine", name="my_stroop.py")
    assert resp.status_code == 200, resp.text
    assert resp.json()["layout"]["positions"] == POSITIONS
    assert "demo_origin" not in resp.json()["layout"]
