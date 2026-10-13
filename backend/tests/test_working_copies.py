"""Working copies of included models live outside the install, and the
one-time move there (#1319).

Until #1319 a Reference Model's working copy went in the running install's
``backend/`` — a folder the Mac app replaces on update, so edits were lost.
These pin the new location, the startup move from the old place(s), and
that the "your changes were kept" path still works from the new folder.

The preferences file and the working-copies folder are throwaway ones
(conftest); tests about the default location clear the variable and give
``Path.home`` a temp folder.
"""

import os
import subprocess

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import deployment_mode
from app.services import working_copies as wc

client = TestClient(app)

MODEL = "import psyneulink as pnl\n"


@pytest.fixture
def home(tmp_path, monkeypatch):
    """No PSYNEWVIEW_WORKING_DIR, a temp home, a local deployment."""
    monkeypatch.delenv(wc.WORKING_DIR_ENV, raising=False)
    h = tmp_path / "home"
    h.mkdir()
    monkeypatch.setattr(wc.Path, "home", classmethod(lambda cls: h))
    monkeypatch.setattr(deployment_mode, "current_mode", lambda: deployment_mode.LOCAL)
    return h


def _install(root, *, bundled=True, reference=("alpha",), demos=("beta",)):
    """An install tree: ``<root>/backend`` with the models it includes, and
    the Mac app's version stamp when ``bundled``."""
    backend = root / "backend"
    (backend / "reference_models").mkdir(parents=True)
    (backend / "demos").mkdir()
    for stem in reference:
        (backend / "reference_models" / f"{stem}.py").write_text(MODEL)
    for stem in demos:
        (backend / "demos" / f"{stem}.py").write_text(MODEL)
    if bundled:
        (root / wc.BUNDLED_VERSION_STAMP).write_text("version=1.0.0\n")
    return backend


#: Everything a working copy of ``alpha`` can consist of, plus a demo copy.
WORKING_COPY_FILES = {
    "alpha.py": MODEL + "# edited\n",
    "alpha.pnlview.json": "{}",
    "alpha.labels.yaml": "labels: {}\n",
    "alpha.psyneuview.json": '{"activeLayout": "1"}',
    "alpha.1.pnlview.json": "{}",
    ".psyneuview/alpha.labels.yaml": "labels: {}\n",
    "beta.py": MODEL,
}
#: Things in the same folder that are not working copies, and must stay.
OTHER_FILES = {
    "alpha_notes.py": "# not a working copy: another stem\n",
    "alpha.txt": "not a sidecar\n",
    "alpha.original.py": "# a backup, not a sidecar\n",
    "zeta.py": "# some other file\n",
    "README.md": "readme\n",
    "pyproject.toml": "[project]\n",
}


def _old_backend(root):
    backend = _install(root)
    (backend / ".psyneuview").mkdir()
    for rel, text in {**WORKING_COPY_FILES, **OTHER_FILES}.items():
        (backend / rel).write_text(text)
    # A symlink with a working-copy name is never one PsyNeuView wrote.
    os.symlink("alpha.py", backend / "beta.pnlview.json")
    return backend


def _files(folder):
    return sorted(
        str(p.relative_to(folder)) for p in folder.rglob("*") if p.is_file() or p.is_symlink()
    )


# ── Where ─────────────────────────────────────────────────────────────


def test_the_default_is_a_per_user_folder_outside_the_install(home):
    d = wc.working_copies_dir()
    assert d == home / ".psyneuview" / "working-copies"
    assert d.is_dir()
    assert not d.is_relative_to(wc.install_root())
    assert not wc.fixed_by_env()


def test_the_environment_variable_wins(tmp_path, monkeypatch):
    monkeypatch.setenv(wc.WORKING_DIR_ENV, str(tmp_path / "elsewhere"))
    assert wc.working_copies_dir() == (tmp_path / "elsewhere").resolve()
    assert (tmp_path / "elsewhere").is_dir()
    assert wc.fixed_by_env()


def test_the_old_place_was_the_backend_folder():
    assert wc.legacy_working_copies_dir().name == "backend"
    assert wc.legacy_working_copies_dir().parent == wc.install_root()


# ── The move ──────────────────────────────────────────────────────────


def test_the_move_carries_copies_and_sidecars_and_nothing_else(tmp_path):
    old = _old_backend(tmp_path / "old")
    new = tmp_path / "new"

    record = wc.migrate_from([old], new)

    assert record["ok"] and record["moved"] == len(WORKING_COPY_FILES), record
    assert record["conflicts"] == [] and record["failures"] == []
    assert record["from"] == [str(old)] and record["to"] == str(new)
    for rel, text in WORKING_COPY_FILES.items():
        assert (new / rel).read_text() == text, rel
        assert not (old / rel).exists(), f"{rel} left behind"
    for rel, text in OTHER_FILES.items():
        assert (old / rel).read_text() == text, f"{rel} touched"
        assert not (new / rel).exists(), f"{rel} moved"
    assert (old / "beta.pnlview.json").is_symlink()
    assert (old / "reference_models" / "alpha.py").exists()
    # Recorded for Report a Problem.
    last = wc.last_migration()
    assert last["moved"] == len(WORKING_COPY_FILES) and isinstance(last["at"], float)


def test_a_second_run_finds_nothing_and_changes_nothing(tmp_path):
    old = _old_backend(tmp_path / "old")
    new = tmp_path / "new"
    wc.migrate_from([old], new)
    before_old, before_new = _files(old), _files(new)
    first = wc.last_migration()

    assert wc.migrate_from([old], new) is None
    assert _files(old) == before_old and _files(new) == before_new
    assert wc.last_migration() == first


def test_a_failed_copy_leaves_the_original_and_is_recorded(tmp_path, monkeypatch):
    old = _old_backend(tmp_path / "old")
    new = tmp_path / "new"
    real = wc._copy_file

    def flaky(src, dst):
        if src.name == "alpha.py":
            raise OSError("disk full")
        real(src, dst)

    monkeypatch.setattr(wc, "_copy_file", flaky)
    record = wc.migrate_from([old], new)

    assert record["ok"] is False
    assert [f["file"] for f in record["failures"]] == [str(old / "alpha.py")]
    assert "disk full" in record["failures"][0]["error"]
    assert (old / "alpha.py").read_text() == WORKING_COPY_FILES["alpha.py"]
    assert not (new / "alpha.py").exists()
    # The rest still moved.
    assert record["moved"] == len(WORKING_COPY_FILES) - 1
    assert (new / "alpha.pnlview.json").exists() and not (old / "alpha.pnlview.json").exists()


def test_a_copy_that_does_not_verify_is_taken_back(tmp_path, monkeypatch):
    old = _old_backend(tmp_path / "old")
    new = tmp_path / "new"

    def corrupt(src, dst):
        dst.write_text("garbage")

    monkeypatch.setattr(wc, "_copy_file", corrupt)
    record = wc.migrate_from([old], new)

    assert record["ok"] is False and record["moved"] == 0
    assert len(record["failures"]) == len(WORKING_COPY_FILES)
    assert all("didn't copy correctly" in f["error"] for f in record["failures"])
    for rel, text in WORKING_COPY_FILES.items():
        assert (old / rel).read_text() == text
        assert not (new / rel).exists()


def test_a_newer_copy_in_the_new_folder_is_kept_and_the_old_one_left(tmp_path):
    old = _old_backend(tmp_path / "old")
    new = tmp_path / "new"
    new.mkdir()
    (new / "alpha.py").write_text(MODEL + "# edited here, later\n")
    (new / "alpha.pnlview.json").write_text("{}")  # identical to the old one

    record = wc.migrate_from([old], new)

    assert record["conflicts"] == [str(old / "alpha.py")]
    assert (new / "alpha.py").read_text() == MODEL + "# edited here, later\n"
    assert (old / "alpha.py").read_text() == WORKING_COPY_FILES["alpha.py"]
    # An identical file is just a duplicate: the old one goes.
    assert record["duplicates_removed"] == 1
    assert not (old / "alpha.pnlview.json").exists() and (new / "alpha.pnlview.json").exists()
    assert record["ok"] and record["moved"] == len(WORKING_COPY_FILES) - 2


def test_a_file_git_tracks_is_never_moved(tmp_path):
    old = _old_backend(tmp_path / "old")
    new = tmp_path / "new"
    subprocess.run(["git", "init", "-q"], cwd=old, check=True)
    subprocess.run(["git", "add", "alpha.py"], cwd=old, check=True)

    record = wc.migrate_from([old], new)

    assert record["skipped_tracked"] == 1
    assert (old / "alpha.py").exists() and not (new / "alpha.py").exists()
    assert record["moved"] == len(WORKING_COPY_FILES) - 1
    assert not (old / "alpha.pnlview.json").exists()


# ── When it runs, and where it looks ──────────────────────────────────


def test_only_a_bundled_install_has_siblings(tmp_path):
    support = tmp_path / "Application Support" / "PsyNeuView"
    running = support / "psyneuview-1.1.0"
    older = support / "psyneuview-1.0.0"
    _install(running)
    _install(older)
    _install(support / "psyneuview-0.9.0", bundled=False)  # no stamp: not an install
    _install(support / "something-else")  # not named like one
    (support / "psyneuview-stray.txt").write_text("")
    os.symlink(older, support / "psyneuview-link")

    assert wc.sibling_bundled_installs(running) == [older]

    checkout = tmp_path / "checkout"
    _install(checkout, bundled=False)
    _install(tmp_path / "psyneuview-2.0.0")
    assert wc.sibling_bundled_installs(checkout) == []


@pytest.fixture
def bundled(tmp_path, home, monkeypatch):
    """Running from a Mac-app bundled install, with an older install beside it
    that still holds an edited reference model."""
    support = tmp_path / "Application Support" / "PsyNeuView"
    running = support / "psyneuview-1.1.0"
    older = support / "psyneuview-1.0.0"
    _install(running)
    _install(older)
    (older / "backend" / "alpha.py").write_text(MODEL + "# edited before the update\n")
    (older / "backend" / "alpha.pnlview.json").write_text("{}")
    (older / "backend" / "notes.py").write_text("# not a working copy\n")
    monkeypatch.setattr(wc, "install_root", lambda: running)
    monkeypatch.setattr(wc, "legacy_working_copies_dir", lambda: running / "backend")
    return running, older


def test_on_start_copies_left_in_an_older_install_are_carried_over(bundled, home):
    running, older = bundled
    record = wc.migrate_legacy_working_copies()

    new = home / ".psyneuview" / "working-copies"
    assert record["ok"] and record["moved"] == 2
    assert record["from"] == [str(older / "backend")]
    assert (new / "alpha.py").read_text() == MODEL + "# edited before the update\n"
    assert (new / "alpha.pnlview.json").exists()
    assert not (older / "backend" / "alpha.py").exists()
    assert (older / "backend" / "notes.py").exists() and not (new / "notes.py").exists()
    assert wc.migrate_legacy_working_copies() is None


def test_the_running_install_and_an_older_one_both_holding_a_copy(bundled, home):
    running, older = bundled
    (running / "backend" / "alpha.py").write_text(MODEL + "# edited after the update\n")
    os.utime(running / "backend" / "alpha.py", (2_000_000_000, 2_000_000_000))

    record = wc.migrate_legacy_working_copies()

    # The newest goes to the new folder; the other is a conflict, left alone.
    new = home / ".psyneuview" / "working-copies"
    assert (new / "alpha.py").read_text() == MODEL + "# edited after the update\n"
    assert record["conflicts"] == [str(older / "backend" / "alpha.py")]
    assert (older / "backend" / "alpha.py").exists()


def test_a_checkout_does_not_look_at_folders_beside_it(tmp_path, home, monkeypatch):
    checkout = tmp_path / "checkout"
    _install(checkout, bundled=False)
    neighbour = tmp_path / "psyneuview-1.0.0"
    _install(neighbour)
    (neighbour / "backend" / "alpha.py").write_text(MODEL)
    monkeypatch.setattr(wc, "install_root", lambda: checkout)
    monkeypatch.setattr(wc, "legacy_working_copies_dir", lambda: checkout / "backend")

    assert wc.migrate_legacy_working_copies() is None
    assert (neighbour / "backend" / "alpha.py").exists()


def test_skipped_when_the_environment_variable_is_set(bundled, tmp_path, monkeypatch):
    running, older = bundled
    monkeypatch.setenv(wc.WORKING_DIR_ENV, str(tmp_path / "fixed"))
    assert wc.migrate_legacy_working_copies() is None
    assert (older / "backend" / "alpha.py").exists()
    assert not (tmp_path / "fixed" / "alpha.py").exists()


@pytest.mark.parametrize("mode", [deployment_mode.CONTAINER, deployment_mode.HOSTED])
def test_skipped_in_container_and_hosted_deployments(bundled, home, monkeypatch, mode):
    running, older = bundled
    monkeypatch.setattr(deployment_mode, "current_mode", lambda: mode)
    assert wc.migrate_legacy_working_copies() is None
    assert (older / "backend" / "alpha.py").exists()


# ── Through the API ───────────────────────────────────────────────────


REFERENCE = "GilzenratModel"  # small, loads fast


def _load(**body):
    r = client.post("/api/reference-models/load", json={"name": REFERENCE, **body})
    assert r.status_code == 200, r.text
    return r.json()


def test_a_reference_model_opens_as_a_working_copy_in_the_new_folder(home):
    body = _load()
    working = wc.Path(body["file_path"])
    assert working.parent == home / ".psyneuview" / "working-copies"
    assert working.exists()
    assert not working.is_relative_to(wc.install_root())
    assert body["workingCopy"] == {"diverged": False, "restored": False}


def test_your_edited_copy_is_kept_from_the_new_folder(home):
    working = wc.Path(_load()["file_path"])
    working.write_text(working.read_text() + "\n# user edit\n")

    body = _load()

    assert body["file_path"] == str(working)
    assert body["workingCopy"] == {"diverged": True, "restored": False}
    assert "# user edit" in working.read_text()


def test_a_demo_resets_into_the_new_folder(home):
    r = client.post("/api/demos/reset", json={"demo_name": "scheduling_demo"})
    assert r.status_code == 200, r.text
    assert wc.Path(r.json()["file_path"]).parent == home / ".psyneuview" / "working-copies"


def test_locations_say_where_working_copies_are(home, tmp_path):
    old = _old_backend(tmp_path / "old")
    wc.migrate_from([old], wc.working_copies_dir())

    app_data = client.get("/api/locations").json()["appData"]
    assert app_data["workingCopies"] == str(home / ".psyneuview" / "working-copies")
    assert app_data["workingCopiesFixedBy"] is None
    assert app_data["workingCopiesLastMigration"]["moved"] == len(WORKING_COPY_FILES)
