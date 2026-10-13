"""Tests for sidecar placement: lateral vs. hidden dot-folder (#927).

Decided policy: lateral files win when present; new sidecars default to the
``.psyneuview/`` dot-folder — unless the model already carries lateral
companions, in which case new ones stay lateral. Managed clones are exempt
(their sidecars are already redirected out of tree).
"""

from pathlib import Path

import pytest

from app.services import app_settings, sidecar_placement as sp
from app.services.labels import labels_path, load_labels, save_labels
from app.services.layout import load_layout, save_layout, sidecar_path
from app.services.sidecar_index import (
    get_placement,
    index_path,
    list_sidecars,
    load_index,
    set_placement,
)


@pytest.fixture
def model(tmp_path):
    """A plain user model (not inside a managed clone), with the clone root
    pinned elsewhere so nothing here is treated as managed."""
    (tmp_path / "clones").mkdir()
    p = tmp_path / "models" / "m.py"
    p.parent.mkdir()
    p.write_text("# model\n")
    return str(p)


@pytest.fixture(autouse=True)
def _pin_clone_root(monkeypatch, tmp_path):
    # Keep the shared clone root off this test's tmp dir unless a test overrides.
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(tmp_path / "clones"))
    monkeypatch.delenv("PSYNEUVIEW_SIDECAR_PLACEMENT", raising=False)
    # Isolate the global-default config from the real ~/.psynewview.json so
    # resolution defaults to `auto` and set-default tests don't touch it.
    monkeypatch.setenv(CONFIG_ENV, str(tmp_path / "config.json"))


def _lateral(model_path, filename):
    return Path(model_path).with_name(filename)


def _dotted(model_path, filename):
    return Path(model_path).parent / sp.DOT_DIRNAME / filename


# --- new-file default: the dot-folder --------------------------------------


def test_new_model_writes_to_dot_folder(model):
    save_layout(model, {"a": {"x": 1, "y": 2}})
    assert not _lateral(model, "m.pnlview.json").exists()
    assert _dotted(model, "m.pnlview.json").exists()
    assert load_layout(model)["positions"]["a"] == {"x": 1, "y": 2}


def test_new_labels_and_index_also_dot_folder(model):
    save_labels(model, {"node": {"element_names": ["r", "g"]}})
    assert _dotted(model, "m.labels.yaml").exists()
    assert not _lateral(model, "m.labels.yaml").exists()
    assert load_labels(model) == {"node": {"element_names": ["r", "g"]}}
    # index path resolves to the dot-folder too (nothing lateral exists)
    assert index_path(model) == _dotted(model, "m.psyneuview.json")


# --- an existing lateral model keeps writing lateral -----------------------


def test_existing_lateral_keeps_new_sidecars_lateral(model):
    # Pre-seed a lateral layout — as if the model already had one on disk.
    _lateral(model, "m.pnlview.json").write_text('{"version": 1, "positions": {}}')
    # A *new* labels sidecar should join it laterally, not split into the dot-folder.
    save_labels(model, {"node": {"element_names": ["r", "g"]}})
    assert _lateral(model, "m.labels.yaml").exists()
    assert not _dotted(model, "m.labels.yaml").exists()


def test_lateral_layout_save_stays_lateral(model):
    _lateral(model, "m.pnlview.json").write_text('{"version": 1, "positions": {}}')
    save_layout(model, {"a": {"x": 9, "y": 9}})
    assert sidecar_path(model) == _lateral(model, "m.pnlview.json")
    assert not _dotted(model, "m.pnlview.json").exists()


# --- lateral wins over the dot-folder on read ------------------------------


def test_lateral_wins_when_both_exist(model):
    _lateral(model, "m.pnlview.json").write_text(
        '{"version": 1, "positions": {"lat": {"x": 1, "y": 1}}}'
    )
    _dotted(model, "m.pnlview.json").parent.mkdir(parents=True, exist_ok=True)
    _dotted(model, "m.pnlview.json").write_text(
        '{"version": 1, "positions": {"dot": {"x": 2, "y": 2}}}'
    )
    assert sidecar_path(model) == _lateral(model, "m.pnlview.json")
    assert "lat" in load_layout(model)["positions"]


# --- explicit overrides ----------------------------------------------------


def test_override_lateral_forces_lateral_for_new(model, monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_SIDECAR_PLACEMENT", "lateral")
    save_layout(model, {"a": {"x": 1, "y": 2}})
    assert _lateral(model, "m.pnlview.json").exists()
    assert not _dotted(model, "m.pnlview.json").exists()


def test_override_dotfolder_still_honors_existing_lateral(model, monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_SIDECAR_PLACEMENT", "dotfolder")
    _lateral(model, "m.pnlview.json").write_text('{"version": 1, "positions": {}}')
    save_layout(model, {"a": {"x": 1, "y": 2}})
    # The visible lateral file is never shadowed, even in dot-folder mode.
    assert sidecar_path(model) == _lateral(model, "m.pnlview.json")


# --- managed clones are exempt ---------------------------------------------


def test_managed_clone_stays_redirected_no_dot_folder(monkeypatch, tmp_path):
    root = tmp_path / "clone_root"
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(root))
    model = root / "PsyNeuLink-owner" / "scripts" / "m.py"
    model.parent.mkdir(parents=True)
    model.write_text("# model\n")

    save_layout(str(model), {"a": {"x": 1, "y": 2}})

    # Nothing next to the model, and no dot-folder inside the clone tree.
    assert not model.with_name("m.pnlview.json").exists()
    assert not (model.parent / sp.DOT_DIRNAME).exists()
    # Redirected out of tree and round-trips.
    assert sidecar_path(str(model)).exists()
    assert load_layout(str(model))["positions"]["a"] == {"x": 1, "y": 2}


# --- discovery spans both directories, lateral-first -----------------------


def test_discovery_merges_both_locations_lateral_first(model):
    # A lateral Default + a dot-folder named variant should both be discovered.
    _lateral(model, "m.pnlview.json").write_text('{"version": 1, "positions": {}}')
    dot = _dotted(model, "m.compact.pnlview.json")
    dot.parent.mkdir(parents=True, exist_ok=True)
    dot.write_text('{"version": 1, "positions": {}, "name": "compact"}')

    view = list_sidecars(model)
    names = {e["name"] for e in view["layouts"]}
    assert {"Default", "compact"} <= names


def test_discovery_prefers_lateral_on_basename_collision(model):
    # Same basename in both dirs: the lateral one is authoritative.
    _lateral(model, "m.compact.pnlview.json").write_text(
        '{"version": 1, "positions": {}, "name": "lateral-one"}'
    )
    dot = _dotted(model, "m.compact.pnlview.json")
    dot.parent.mkdir(parents=True, exist_ok=True)
    dot.write_text('{"version": 1, "positions": {}, "name": "dot-one"}')

    view = list_sidecars(model)
    compact = [e for e in view["layouts"] if e["file"] == "m.compact.pnlview.json"]
    assert len(compact) == 1
    assert compact[0]["name"] == "lateral-one"


# --- #933: per-model override, precedence, migration, global default ---------


def test_per_model_override_persists_in_index(model):
    set_placement(model, "dotfolder")
    assert get_placement(model) == "dotfolder"
    # Stored in the index overlay, and a placement-only index survives on disk.
    assert load_index(model)["placement"] == "dotfolder"
    set_placement(model, None)  # clear → inherit
    assert get_placement(model) is None


def test_per_model_override_beats_global_default(model):
    app_settings.set_default_placement("lateral")
    set_placement(model, "dotfolder")
    # New sidecar follows the per-model override, not the global default.
    save_labels(model, {"n": {"element_names": ["a", "b"]}})
    assert _dotted(model, "m.labels.yaml").exists()
    assert not _lateral(model, "m.labels.yaml").exists()


def test_global_default_lateral_applies_without_override(model):
    app_settings.set_default_placement("lateral")
    save_layout(model, {"a": {"x": 1, "y": 2}})
    assert _lateral(model, "m.pnlview.json").exists()
    assert not _dotted(model, "m.pnlview.json").exists()


def test_env_overrides_global_default(model, monkeypatch):
    app_settings.set_default_placement("lateral")
    monkeypatch.setenv("PSYNEUVIEW_SIDECAR_PLACEMENT", "dotfolder")
    save_layout(model, {"a": {"x": 1, "y": 2}})
    assert _dotted(model, "m.pnlview.json").exists()


def test_migrate_lateral_to_dot_folder_moves_files(model):
    # Seed lateral sidecars, then migrate to the dot-folder.
    save_layout(model, {"a": {"x": 1, "y": 2}})   # auto → dot-folder for a fresh model
    # Force a lateral starting point instead:
    _dotted(model, "m.pnlview.json").unlink()
    _lateral(model, "m.pnlview.json").write_text('{"version": 1, "positions": {"a": {"x": 1, "y": 2}}}')
    save_labels(model, {"n": {"element_names": ["a", "b"]}})  # joins laterally (model is lateral now)
    assert _lateral(model, "m.labels.yaml").exists()

    result = sp.migrate(model, "dotfolder")
    assert set(result["moved"]) == {"m.pnlview.json", "m.labels.yaml"}
    assert result["conflicts"] == []
    assert _dotted(model, "m.pnlview.json").exists()
    assert not _lateral(model, "m.pnlview.json").exists()
    # Layout still loads after the move.
    assert load_layout(model)["positions"]["a"] == {"x": 1, "y": 2}


def test_migrate_reports_conflict_without_clobbering(model):
    lat = _lateral(model, "m.pnlview.json")
    lat.write_text('{"version": 1, "positions": {"lat": {"x": 1, "y": 1}}}')
    dot = _dotted(model, "m.pnlview.json")
    dot.parent.mkdir(parents=True, exist_ok=True)
    dot.write_text('{"version": 1, "positions": {"dot": {"x": 2, "y": 2}}}')

    result = sp.migrate(model, "dotfolder")
    assert result["conflicts"] == ["m.pnlview.json"]
    assert result["moved"] == []
    # Neither copy destroyed.
    assert "lat" in load_layout(model)["positions"]  # lateral still wins on read
    assert "dot" in __import__("json").loads(dot.read_text())["positions"]


def test_migrate_managed_clone_is_noop(monkeypatch, tmp_path):
    root = tmp_path / "clone_root"
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(root))
    m = root / "PsyNeuLink-owner" / "scripts" / "m.py"
    m.parent.mkdir(parents=True)
    m.write_text("# model\n")
    save_layout(str(m), {"a": {"x": 1, "y": 2}})
    result = sp.migrate(str(m), "dotfolder")
    assert result == {"moved": [], "conflicts": [], "managed": True}


def test_effective_placement_payload(model):
    # Default inherit → auto (fresh model → dot-folder).
    eff = sp.effective_placement(model)
    assert eff["perModel"] is None
    assert eff["default"] == "auto"
    assert eff["effective"] == "dotfolder"
    # Explicit override is reflected.
    set_placement(model, "lateral")
    assert sp.effective_placement(model)["perModel"] == "lateral"
    assert sp.effective_placement(model)["effective"] == "lateral"


def test_list_sidecars_includes_placement(model):
    view = list_sidecars(model)
    assert "placement" in view
    assert view["placement"]["effective"] in ("auto", "lateral", "dotfolder")


def test_global_default_roundtrip_and_clear(model):
    assert app_settings.get_default_placement() is None  # isolated → unset
    app_settings.set_default_placement("dotfolder")
    assert app_settings.get_default_placement() == "dotfolder"
    app_settings.set_default_placement(None)
    assert app_settings.get_default_placement() is None


def test_global_default_rejects_invalid(model):
    with pytest.raises(ValueError):
        app_settings.set_default_placement("sideways")


# --- #933: HTTP routes -------------------------------------------------------

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app.services.app_config import CONFIG_ENV

_client = TestClient(app)


def test_route_set_placement_migrates(model):
    # Seed a lateral sidecar, then flip the model to dot-folder via the API.
    _lateral(model, "m.pnlview.json").write_text('{"version": 1, "positions": {"a": {"x": 1, "y": 1}}}')
    r = _client.post("/api/model/sidecars/placement",
                     json={"file_path": model, "placement": "dotfolder"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["placement"]["perModel"] == "dotfolder"
    assert "m.pnlview.json" in body["migration"]["moved"]
    assert _dotted(model, "m.pnlview.json").exists()
    assert not _lateral(model, "m.pnlview.json").exists()


def test_route_set_placement_inherit_clears(model):
    set_placement(model, "lateral")
    r = _client.post("/api/model/sidecars/placement",
                     json={"file_path": model, "placement": "inherit"})
    assert r.status_code == 200, r.text
    assert r.json()["placement"]["perModel"] is None
    assert "migration" not in r.json()  # inherit doesn't move files


def test_route_set_placement_rejects_bad_value(model):
    r = _client.post("/api/model/sidecars/placement",
                     json={"file_path": model, "placement": "sideways"})
    assert r.status_code == 400


def test_route_global_default_get_set(model):
    assert _client.get("/api/settings/sidecar-placement").json()["placement"] == "auto"
    r = _client.post("/api/settings/sidecar-placement", json={"placement": "lateral"})
    assert r.status_code == 200
    assert r.json()["placement"] == "lateral"
    assert _client.get("/api/settings/sidecar-placement").json()["placement"] == "lateral"
    # Clear back to auto.
    assert _client.post("/api/settings/sidecar-placement",
                        json={"placement": None}).json()["placement"] == "auto"
