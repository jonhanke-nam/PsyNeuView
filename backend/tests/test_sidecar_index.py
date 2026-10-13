"""Tests for the sidecar index + convention discovery service (479a)."""

import json
import tempfile
from pathlib import Path

import pytest
import yaml

from app.services.sidecar_index import (
    VariantError,
    create_variant,
    delete_variant,
    duplicate_variant,
    index_path,
    list_layouts,
    list_settings,
    list_sidecars,
    load_index,
    rename_variant,
    reorder,
    save_index,
    set_active,
)


@pytest.fixture
def tmp_model():
    """A temporary .py model; cleans up any sidecars it spawned."""
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


def _layout_file(model_path: str, variant: str | None = None) -> Path:
    p = Path(model_path)
    suffix = ".pnlview.json" if variant is None else f".{variant}.pnlview.json"
    path = p.with_name(p.stem + suffix)
    path.write_text(json.dumps({"version": 1, "positions": {}}) + "\n")
    return path


def _settings_file(model_path: str, variant: str | None = None) -> Path:
    p = Path(model_path)
    suffix = ".labels.yaml" if variant is None else f".{variant}.labels.yaml"
    path = p.with_name(p.stem + suffix)
    path.write_text(yaml.safe_dump({"node": {"element_names": ["a"]}}))
    return path


def names(entries):
    return [e["name"] for e in entries]


def active_name(entries):
    return next((e["name"] for e in entries if e["active"]), None)


# --- index file ----------------------------------------------------------

def test_index_path_format(tmp_model):
    assert str(index_path(tmp_model)).endswith(".psyneuview.json")


def test_index_roundtrips(tmp_model):
    idx = {
        "layouts": [{"name": "Default", "file": "m.pnlview.json", "order": 0}],
        "activeLayout": "Default",
        "settings": [],
        "activeSetting": None,
    }
    save_index(tmp_model, idx)
    loaded = load_index(tmp_model)
    assert loaded["activeLayout"] == "Default"
    assert loaded["layouts"][0]["name"] == "Default"


def test_empty_index_is_deleted_not_left(tmp_model):
    save_index(tmp_model, {"layouts": [], "settings": []})
    assert load_index(tmp_model) is None
    assert not index_path(tmp_model).exists()


def test_malformed_index_degrades_to_none(tmp_model):
    index_path(tmp_model).write_text("not json {{{")
    assert load_index(tmp_model) is None


# --- discovery / merge ---------------------------------------------------

def test_list_empty_when_no_sidecars(tmp_model):
    assert list_layouts(tmp_model) == []
    assert list_settings(tmp_model) == []


def test_default_only_is_active(tmp_model):
    _layout_file(tmp_model)
    entries = list_layouts(tmp_model)
    assert names(entries) == ["Default"]
    assert active_name(entries) == "Default"


def test_variant_name_from_filename_token(tmp_model):
    _layout_file(tmp_model)
    _layout_file(tmp_model, "compact")
    entries = list_layouts(tmp_model)
    assert set(names(entries)) == {"Default", "compact"}


def test_unindexed_appended_in_name_order(tmp_model):
    # No index: Default first (it's the bare stem), then variants by name.
    _layout_file(tmp_model)
    _layout_file(tmp_model, "wide")
    _layout_file(tmp_model, "compact")
    entries = list_layouts(tmp_model)
    # Default is discovered unindexed too; all sort by name (case-insensitive).
    assert names(entries) == sorted(names(entries), key=str.lower)
    assert set(names(entries)) == {"Default", "compact", "wide"}


def test_index_order_precedes_unindexed(tmp_model):
    _layout_file(tmp_model)
    _layout_file(tmp_model, "compact")
    _layout_file(tmp_model, "wide")  # not in the index
    p = Path(tmp_model)
    save_index(tmp_model, {
        "layouts": [
            {"name": "compact", "file": p.with_name(p.stem + ".compact.pnlview.json").name, "order": 0},
            {"name": "Default", "file": p.with_name(p.stem + ".pnlview.json").name, "order": 1},
        ],
        "activeLayout": "compact",
    })
    entries = list_layouts(tmp_model)
    # Indexed order first (compact, Default), then the unindexed extra (wide).
    assert names(entries) == ["compact", "Default", "wide"]
    assert active_name(entries) == "compact"


def test_missing_entry_surfaced_not_dropped(tmp_model):
    _layout_file(tmp_model)
    p = Path(tmp_model)
    save_index(tmp_model, {
        "layouts": [
            {"name": "Default", "file": p.with_name(p.stem + ".pnlview.json").name, "order": 0},
            {"name": "ghost", "file": p.with_name(p.stem + ".ghost.pnlview.json").name, "order": 1},
        ],
        "activeLayout": "ghost",
    })
    entries = list_layouts(tmp_model)
    ghost = next(e for e in entries if e["name"] == "ghost")
    assert ghost["missing"] is True
    # A missing entry is never auto-activated; falls back to first present.
    assert active_name(entries) == "Default"


def test_dropin_file_appears_without_index_edit(tmp_model):
    p = Path(tmp_model)
    save_index(tmp_model, {
        "layouts": [{"name": "Default", "file": p.with_name(p.stem + ".pnlview.json").name, "order": 0}],
        "activeLayout": "Default",
    })
    _layout_file(tmp_model)
    _layout_file(tmp_model, "fromfriend")  # dropped in, not in the index
    entries = list_layouts(tmp_model)
    assert "fromfriend" in names(entries)


def test_active_from_index(tmp_model):
    _layout_file(tmp_model)
    _layout_file(tmp_model, "compact")
    p = Path(tmp_model)
    save_index(tmp_model, {
        "layouts": [
            {"name": "Default", "file": p.with_name(p.stem + ".pnlview.json").name, "order": 0},
            {"name": "compact", "file": p.with_name(p.stem + ".compact.pnlview.json").name, "order": 1},
        ],
        "activeLayout": "compact",
    })
    assert active_name(list_layouts(tmp_model)) == "compact"


def test_active_fallback_prefers_default(tmp_model):
    _layout_file(tmp_model)
    _layout_file(tmp_model, "compact")
    entries = list_layouts(tmp_model)
    # No index → Default is active even though "compact" sorts first.
    assert active_name(entries) == "Default"
    assert sum(1 for e in entries if e["active"]) == 1


def test_active_fallback_first_when_no_default(tmp_model):
    _layout_file(tmp_model, "compact")
    _layout_file(tmp_model, "wide")
    entries = list_layouts(tmp_model)
    # No Default present → first present entry (name order) is active.
    assert entries[0]["active"] is True
    assert sum(1 for e in entries if e["active"]) == 1


def test_settings_discovery_independent_of_layouts(tmp_model):
    _settings_file(tmp_model)
    _settings_file(tmp_model, "debug")
    entries = list_settings(tmp_model)
    assert set(names(entries)) == {"Default", "debug"}
    assert active_name(entries) == "Default"


def test_list_sidecars_combines_both(tmp_model):
    _layout_file(tmp_model)
    _settings_file(tmp_model)
    view = list_sidecars(tmp_model)
    assert view["activeLayout"] == "Default"
    assert view["activeSetting"] == "Default"
    assert names(view["layouts"]) == ["Default"]
    assert names(view["settings"]) == ["Default"]


# --- managed-clone redirect ---------------------------------------------

def test_index_redirected_out_of_clone(monkeypatch, tmp_path):
    """The index file for a model inside a managed clone is written out of
    tree, leaving the clone's working tree clean (#349)."""
    root = tmp_path / "clones"
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(root))
    model = root / "PsyNeuLink-owner" / "scripts" / "m.py"
    model.parent.mkdir(parents=True)
    model.write_text("# model\n")

    save_index(str(model), {
        "layouts": [{"name": "Default", "file": "m.pnlview.json", "order": 0}],
        "activeLayout": "Default",
    })

    # Nothing written next to the model inside the clone.
    assert not model.with_name("m.psyneuview.json").exists()
    # Index lives out of tree and round-trips.
    assert index_path(str(model)).exists()
    assert load_index(str(model))["activeLayout"] == "Default"


def test_discovery_finds_redirected_variants(monkeypatch, tmp_path):
    """Discovery globs the redirected artifact dir for a clone-resident
    model, so variants written there are found."""
    root = tmp_path / "clones"
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(root))
    model = root / "PsyNeuLink-owner" / "scripts" / "m.py"
    model.parent.mkdir(parents=True)
    model.write_text("# model\n")

    # Write a layout sidecar to its redirected location.
    from app.services.layout import sidecar_path
    sc = sidecar_path(str(model))
    sc.write_text(json.dumps({"version": 1, "positions": {}}) + "\n")

    entries = list_layouts(str(model))
    assert names(entries) == ["Default"]


# --- variant management (479b) ------------------------------------------

def test_create_variant_makes_it_active(tmp_model):
    _layout_file(tmp_model)
    view = create_variant(tmp_model, "layout", "compact")
    assert "compact" in names(view["layouts"])
    assert view["activeLayout"] == "compact"
    # The payload file exists and is self-describing.
    from app.services.layout import sidecar_path
    data = json.loads(sidecar_path(tmp_model, "compact").read_text())
    assert data["name"] == "compact"


def test_create_rejects_invalid_and_duplicate_names(tmp_model):
    _layout_file(tmp_model)
    with pytest.raises(VariantError):
        create_variant(tmp_model, "layout", "bad name!")  # space + punctuation
    with pytest.raises(VariantError):
        create_variant(tmp_model, "layout", "Default")  # reserved
    create_variant(tmp_model, "layout", "compact")
    with pytest.raises(VariantError):
        create_variant(tmp_model, "layout", "compact")  # already exists


def test_set_active_persists(tmp_model):
    _layout_file(tmp_model)
    create_variant(tmp_model, "layout", "compact")
    view = set_active(tmp_model, "layout", "Default")
    assert view["activeLayout"] == "Default"
    # Survives a fresh read.
    assert list_sidecars(tmp_model)["activeLayout"] == "Default"
    with pytest.raises(VariantError):
        set_active(tmp_model, "layout", "ghost")


def test_duplicate_copies_payload_and_updates_name(tmp_model):
    _layout_file(tmp_model)
    create_variant(tmp_model, "layout", "compact")
    set_active(tmp_model, "layout", "compact")
    view = duplicate_variant(tmp_model, "layout", "compact", "compact2")
    assert {"compact", "compact2"} <= set(names(view["layouts"]))
    # Duplicate leaves the active selection untouched.
    assert view["activeLayout"] == "compact"
    from app.services.layout import sidecar_path
    assert json.loads(sidecar_path(tmp_model, "compact2").read_text())["name"] == "compact2"


def test_rename_moves_file_and_follows_active(tmp_model):
    _layout_file(tmp_model)
    create_variant(tmp_model, "layout", "compact")  # active=compact
    view = rename_variant(tmp_model, "layout", "compact", "tidy")
    assert "compact" not in names(view["layouts"])
    assert "tidy" in names(view["layouts"])
    assert view["activeLayout"] == "tidy"  # active followed the rename
    from app.services.layout import sidecar_path
    assert not sidecar_path(tmp_model, "compact").exists()
    assert sidecar_path(tmp_model, "tidy").exists()


def test_rename_default_is_rejected(tmp_model):
    _layout_file(tmp_model)
    with pytest.raises(VariantError):
        rename_variant(tmp_model, "layout", "Default", "base")


def test_delete_removes_file_and_falls_back_active(tmp_model):
    _layout_file(tmp_model)
    create_variant(tmp_model, "layout", "compact")  # active=compact
    view = delete_variant(tmp_model, "layout", "compact")
    assert "compact" not in names(view["layouts"])
    # Active fell back to the present Default.
    assert view["activeLayout"] == "Default"
    from app.services.layout import sidecar_path
    assert not sidecar_path(tmp_model, "compact").exists()
    with pytest.raises(VariantError):
        delete_variant(tmp_model, "layout", "ghost")


def test_delete_drops_missing_index_entry(tmp_model):
    _layout_file(tmp_model)
    p = Path(tmp_model)
    save_index(tmp_model, {
        "layouts": [
            {"name": "Default", "file": p.with_name(p.stem + ".pnlview.json").name, "order": 0},
            {"name": "ghost", "file": p.with_name(p.stem + ".ghost.pnlview.json").name, "order": 1},
        ],
        "activeLayout": "Default",
    })
    # ghost has no file on disk; deleting it just drops the index entry.
    view = delete_variant(tmp_model, "layout", "ghost")
    assert "ghost" not in names(view["layouts"])


def test_reorder_sets_order(tmp_model):
    _layout_file(tmp_model)
    create_variant(tmp_model, "layout", "compact")
    create_variant(tmp_model, "layout", "wide")
    view = reorder(tmp_model, "layout", ["wide", "Default", "compact"])
    assert names(view["layouts"]) == ["wide", "Default", "compact"]
    with pytest.raises(VariantError):
        reorder(tmp_model, "layout", ["wide", "Default"])  # not a permutation


def test_settings_variants_are_independent(tmp_model):
    _settings_file(tmp_model)
    view = create_variant(tmp_model, "settings", "debug")
    assert "debug" in names(view["settings"])
    assert view["activeSetting"] == "debug"
    # Layouts untouched by a settings mutation.
    assert view["layouts"] == []
    view = delete_variant(tmp_model, "settings", "debug")
    assert "debug" not in names(view["settings"])


# --- duplicate embedded names (#491) ------------------------------------

def _named_layout(model_path: str, token: str, embedded_name: str) -> Path:
    """A layout variant with a distinct filename ``token`` but a chosen
    embedded ``name`` — the drop-in-sharing case where two files can claim
    the same display name."""
    p = Path(model_path)
    path = p.with_name(f"{p.stem}.{token}.pnlview.json")
    path.write_text(
        json.dumps({"version": 1, "positions": {}, "name": embedded_name}) + "\n"
    )
    return path


def _file_of(entries, name):
    return next(e["file"] for e in entries if e["name"] == name)


def test_duplicate_embedded_names_are_disambiguated(tmp_model):
    # Two files, distinct tokens, same embedded name — the shared-layout case.
    a = _named_layout(tmp_model, "compact", "compact")
    b = _named_layout(tmp_model, "shared", "compact")
    entries = list_layouts(tmp_model)
    # Both surface as distinct, addressable rows (no silent merge).
    assert names(entries) == ["compact", "compact (2)"]
    assert _file_of(entries, "compact") == a.name
    assert _file_of(entries, "compact (2)") == b.name
    assert all(not e["missing"] for e in entries)


def test_set_active_under_collision_targets_the_addressed_file(tmp_model):
    _named_layout(tmp_model, "compact", "compact")
    b = _named_layout(tmp_model, "shared", "compact")
    view = set_active(tmp_model, "layout", "compact (2)")
    assert view["activeLayout"] == "compact (2)"
    # Active is stored by file basename, so it survives a fresh read and
    # unambiguously points at the second file.
    assert load_index(tmp_model)["activeLayout"] == b.name
    assert list_sidecars(tmp_model)["activeLayout"] == "compact (2)"


def test_delete_under_collision_removes_the_addressed_file(tmp_model):
    a = _named_layout(tmp_model, "compact", "compact")
    b = _named_layout(tmp_model, "shared", "compact")
    # Delete the second row — its file (b), not a's reconstructed-from-name path.
    view = delete_variant(tmp_model, "layout", "compact (2)")
    assert not b.exists()
    assert a.exists()
    # The survivor re-discovers cleanly, with no lingering disambiguation suffix.
    assert names(view["layouts"]) == ["compact"]
    assert _file_of(view["layouts"], "compact") == a.name


def test_rename_under_collision_moves_the_addressed_file(tmp_model):
    a = _named_layout(tmp_model, "compact", "compact")
    b = _named_layout(tmp_model, "shared", "compact")
    view = rename_variant(tmp_model, "layout", "compact (2)", "wide")
    assert a.exists()  # the first row is untouched
    assert not b.exists()  # the addressed file was moved
    from app.services.layout import sidecar_path
    assert sidecar_path(tmp_model, "wide").exists()
    assert set(names(view["layouts"])) == {"compact", "wide"}


def test_create_rejects_clobbering_an_existing_file(tmp_model):
    # A file whose token is "compact" already exists (embedded name differs),
    # so creating a "compact" variant must not silently overwrite it.
    _named_layout(tmp_model, "compact", "other")
    with pytest.raises(VariantError):
        create_variant(tmp_model, "layout", "compact")


def test_mutation_preserves_other_kind(tmp_model):
    _layout_file(tmp_model)
    _settings_file(tmp_model)
    create_variant(tmp_model, "layout", "compact")
    # A settings create must not disturb the layout slice of the index.
    view = create_variant(tmp_model, "settings", "debug")
    assert "compact" in names(view["layouts"])
    assert view["activeLayout"] == "compact"
    assert "debug" in names(view["settings"])
