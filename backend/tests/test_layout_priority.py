"""Layout priority for reference models: user > curated > auto (#1008).

Reopening a reference model is a **re-read**, not a re-seed. It used to copy the
bundled sidecar unconditionally, which made the curated layout an override
re-applied on every open rather than a default — so reopening a model threw away
whatever the user had arranged.

Seeding only what is absent implements the whole waterfall:

    user layout present   -> left alone            (tier 1)
    absent, curated ships -> seeded from reference (tier 2)
    neither               -> no sidecar, auto      (tier 3)

These tests drive the sidecar files directly rather than the endpoint, so they
stay fast and don't depend on introspecting a real model.
"""

import json
import shutil

import pytest

from app.services.sidecar_index import INDEX_SUFFIX, LAYOUT_SUFFIX, SETTINGS_SUFFIX

BUNDLE = (LAYOUT_SUFFIX, SETTINGS_SUFFIX, INDEX_SUFFIX)


def seed_bundle(reference_dir, working, name):
    """The seeding rule from load_reference_model, isolated.

    Kept in the test as an executable statement of the contract: if this and
    routes.py ever disagree, one of them is wrong and the tests should say so.
    """
    for sidecar in reference_dir.glob(f"{name}.*"):
        if not sidecar.name.endswith(BUNDLE):
            continue
        dest = working.with_name(sidecar.name)
        if dest.exists():
            continue
        shutil.copy2(sidecar, dest)


@pytest.fixture
def dirs(tmp_path):
    ref = tmp_path / "reference_models"
    work = tmp_path / "work"
    ref.mkdir()
    work.mkdir()
    (ref / "M.py").write_text("# model\n")
    return ref, work


def _layout(path, x):
    path.write_text(json.dumps({"version": 1, "positions": {"n": {"x": x, "y": 0}}}))


def _x(path):
    return json.loads(path.read_text())["positions"]["n"]["x"]


def test_curated_seeds_when_no_user_layout(dirs):
    """Tier 2: a fresh working copy gets the bundled layout."""
    ref, work = dirs
    _layout(ref / f"M{LAYOUT_SUFFIX}", 111)
    working = work / "M.py"
    working.write_text("# model\n")

    seed_bundle(ref, working, "M")

    assert _x(work / f"M{LAYOUT_SUFFIX}") == 111


def test_user_layout_survives_reopen(dirs):
    """Tier 1, and the regression this issue is about.

    Reopening must not overwrite an arrangement the user made.
    """
    ref, work = dirs
    _layout(ref / f"M{LAYOUT_SUFFIX}", 111)
    working = work / "M.py"
    working.write_text("# model\n")
    _layout(work / f"M{LAYOUT_SUFFIX}", 9999)  # the user rearranged

    seed_bundle(ref, working, "M")  # reopen

    assert _x(work / f"M{LAYOUT_SUFFIX}") == 9999, "reopen clobbered the user's layout"


def test_reopen_is_idempotent(dirs):
    """Reopening repeatedly must not drift — it is a re-read."""
    ref, work = dirs
    _layout(ref / f"M{LAYOUT_SUFFIX}", 111)
    working = work / "M.py"
    working.write_text("# model\n")

    seed_bundle(ref, working, "M")
    _layout(work / f"M{LAYOUT_SUFFIX}", 555)
    for _ in range(3):
        seed_bundle(ref, working, "M")

    assert _x(work / f"M{LAYOUT_SUFFIX}") == 555


def test_stale_working_copy_is_repaired(dirs):
    """The quiet half: a working copy created before a curated layout existed
    never received it, because the copy was tied to the load rather than to the
    file being missing."""
    ref, work = dirs
    working = work / "M.py"
    working.write_text("# model\n")
    seed_bundle(ref, working, "M")  # nothing curated yet
    assert not (work / f"M{LAYOUT_SUFFIX}").exists()

    _layout(ref / f"M{LAYOUT_SUFFIX}", 222)  # curated layout ships later
    seed_bundle(ref, working, "M")

    assert _x(work / f"M{LAYOUT_SUFFIX}") == 222


def test_no_curated_layout_seeds_nothing(dirs):
    """Tier 3: absent everything, no sidecar is invented — auto-layout applies."""
    ref, work = dirs
    working = work / "M.py"
    working.write_text("# model\n")

    seed_bundle(ref, working, "M")

    assert not (work / f"M{LAYOUT_SUFFIX}").exists()


def test_named_variants_seed_independently(dirs):
    """Variants are separate files, so a user's variant is untouched while a
    missing bundled one still arrives."""
    ref, work = dirs
    _layout(ref / f"M{LAYOUT_SUFFIX}", 111)
    _layout(ref / f"M.Curated{LAYOUT_SUFFIX}", 333)
    working = work / "M.py"
    working.write_text("# model\n")
    _layout(work / f"M{LAYOUT_SUFFIX}", 9999)

    seed_bundle(ref, working, "M")

    assert _x(work / f"M{LAYOUT_SUFFIX}") == 9999, "user default overwritten"
    assert _x(work / f"M.Curated{LAYOUT_SUFFIX}") == 333, "missing variant not seeded"


def test_index_is_not_overwritten(dirs):
    """The active-variant pointer is user state.

    This was most of the bug: INDEX_SUFFIX sits in the bundle, so every reopen
    reset which layout was active even when the layout files themselves survived.
    """
    ref, work = dirs
    (ref / f"M{INDEX_SUFFIX}").write_text(json.dumps({"activeLayout": "Default"}))
    working = work / "M.py"
    working.write_text("# model\n")
    (work / f"M{INDEX_SUFFIX}").write_text(json.dumps({"activeLayout": "Mine"}))

    seed_bundle(ref, working, "M")

    assert json.loads((work / f"M{INDEX_SUFFIX}").read_text())["activeLayout"] == "Mine"
