"""Attack tests for the assistant's file rules (#179). Every path here is a
path an untrusted agent might name; every one must be refused. Uses tmp_path
only."""

from __future__ import annotations

import hashlib
import os
import sys

import pytest

from app.services.assistant import files, review
from app.services.assistant.files import PathRefused

MODEL = "import psyneulink as pnl\ncomp = pnl.Composition(name='c')\n"


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


@pytest.fixture
def folders(tmp_path, monkeypatch):
    """A read folder and a read-write folder, with model files in each."""
    ro = tmp_path / "ReadOnly"
    rw = tmp_path / "Models"
    ro.mkdir()
    rw.mkdir()
    (ro / "model.py").write_text(MODEL)
    (rw / "model.py").write_text(MODEL)
    (rw / "sub").mkdir()
    (rw / "sub" / "nested.py").write_text(MODEL)
    monkeypatch.setenv(files.STATE_DIR_ENV, str(tmp_path / "state"))
    monkeypatch.setenv(review.STATE_ENV, str(tmp_path / "state" / "review.json"))
    files.set_folders_provider(lambda: [
        {"path": str(ro), "access": "read"},
        {"path": str(rw), "access": "read_write"},
    ])
    yield {"ro": ro, "rw": rw, "outside": tmp_path}
    files.set_folders_provider(files._folders_from_settings)


# --- What is allowed, so the refusals below mean something ---

def test_reads_and_lists_inside(folders):
    assert files.read_model_file(str(folders["rw"] / "model.py")) == MODEL
    assert files.read_model_file(str(folders["ro"] / "model.py")) == MODEL
    names = sorted(f["name"] for f in files.list_model_files())
    assert names == ["model.py", "model.py", "nested.py"]
    assert files.resolve_allowed(str(folders["rw"] / "sub" / "nested.py")).name == "nested.py"


def test_write_keeps_previous_and_marks_unreviewed(folders):
    p = folders["rw"] / "model.py"
    new = MODEL + "# changed\n"
    out = files.write_model_file(str(p), new, base_hash=sha(MODEL))
    assert out == p and p.read_text() == new
    kept = files.previous_versions(str(p))
    assert len(kept) == 1 and open(kept[0]["path"]).read() == MODEL
    assert not review.is_runnable(str(p), new)
    # A new file needs no base hash and is unreviewed too.
    q = folders["rw"] / "fresh.py"
    files.write_model_file(str(q), MODEL, base_hash=None)
    assert q.read_text() == MODEL and not review.is_runnable(str(q), MODEL)
    assert not any(n.startswith(".") for n in os.listdir(folders["rw"]))  # no temp file left


# --- Refusals ---

def test_dot_dot_refused(folders):
    outside = folders["outside"] / "secret.py"
    outside.write_text(MODEL)
    with pytest.raises(PathRefused):
        files.read_model_file(str(folders["rw"]) + "/../secret.py")
    with pytest.raises(PathRefused):
        files.read_model_file(str(folders["rw"]) + "/sub/../../secret.py")
    with pytest.raises(PathRefused):
        files.write_model_file(str(folders["rw"]) + "/../secret.py", "x", base_hash=sha(MODEL))
    assert outside.read_text() == MODEL


def test_absolute_path_outside_refused(folders):
    outside = folders["outside"] / "secret.py"
    outside.write_text(MODEL)
    with pytest.raises(PathRefused, match="outside_allowed_folders|Not inside"):
        files.read_model_file(str(outside))
    with pytest.raises(PathRefused):
        files.read_model_file("/etc/hosts")
    with pytest.raises(PathRefused, match="absolute"):
        files.read_model_file("model.py")


def test_symlink_to_file_outside_refused(folders):
    outside = folders["outside"] / "secret.py"
    outside.write_text("SECRET = 1\n")
    link = folders["rw"] / "link.py"
    link.symlink_to(outside)
    with pytest.raises(PathRefused):
        files.read_model_file(str(link))
    with pytest.raises(PathRefused):
        files.write_model_file(str(link), "x", base_hash=sha("SECRET = 1\n"))
    assert outside.read_text() == "SECRET = 1\n"
    assert all(f["name"] != "link.py" for f in files.list_model_files())


def test_symlinked_parent_refused(folders):
    elsewhere = folders["outside"] / "elsewhere"
    elsewhere.mkdir()
    (elsewhere / "secret.py").write_text("SECRET = 1\n")
    (folders["rw"] / "dir").symlink_to(elsewhere)
    with pytest.raises(PathRefused):
        files.read_model_file(str(folders["rw"] / "dir" / "secret.py"))
    with pytest.raises(PathRefused):
        files.write_model_file(str(folders["rw"] / "dir" / "secret.py"), "x", base_hash=sha("SECRET = 1\n"))
    assert (elsewhere / "secret.py").read_text() == "SECRET = 1\n"
    # A symlink inside the folder pointing inside it is refused as well.
    (folders["rw"] / "same.py").symlink_to(folders["rw"] / "model.py")
    with pytest.raises(PathRefused):
        files.resolve_allowed(str(folders["rw"] / "same.py"))


def test_hard_link_refused_for_write_but_readable(folders):
    outside = folders["outside"] / "secret.py"
    outside.write_text(MODEL)
    linked = folders["rw"] / "linked.py"
    os.link(outside, linked)
    with pytest.raises(PathRefused, match="hard link"):
        files.write_model_file(str(linked), "x", base_hash=sha(MODEL))
    assert outside.read_text() == MODEL
    assert files.read_model_file(str(linked)) == MODEL


def test_case_variant_refused(folders):
    p = folders["rw"] / "model.py"
    with pytest.raises(PathRefused):
        files.read_model_file(str(folders["rw"] / "MODEL.py"))
    with pytest.raises(PathRefused):
        files.read_model_file(str(folders["rw"] / "Model.PY"))
    # A case variant of the folder name isn't inside the folder either.
    variant = str(p).replace("Models", "MODELS")
    with pytest.raises(PathRefused):
        files.read_model_file(variant)


def test_unicode_lookalike_refused(folders):
    # Cyrillic 'о' and 'е' in place of Latin o/e.
    with pytest.raises(PathRefused):
        files.read_model_file(str(folders["rw"] / "mоdel.py"))
    with pytest.raises(PathRefused):
        files.read_model_file(str(folders["rw"]).replace("Models", "Mоdels") + "/model.py")
    # A decomposed form of a composed name is the same entry, not a different one.
    (folders["rw"] / "café.py").write_text(MODEL)
    assert files.read_model_file(str(folders["rw"] / "café.py")) == MODEL


def test_swap_between_check_and_use_refused(folders, monkeypatch):
    """Simulate the file being replaced after the content was hashed but
    before the rename: the write must not land."""
    p = folders["rw"] / "model.py"
    outside = folders["outside"] / "secret.py"
    outside.write_text("SECRET = 1\n")
    real_open = os.open

    def swap_when_temp_opened(name, flags, *a, **kw):
        if isinstance(name, str) and name.endswith(".tmp") and "dir_fd" in kw:
            # The content has been hashed and the previous version kept; now
            # the entry is made to name a different inode before the rename.
            os.unlink(p)
            os.link(outside, p)
        return real_open(name, flags, *a, **kw)

    monkeypatch.setattr(os, "open", swap_when_temp_opened)
    with pytest.raises(PathRefused, match="replaced|swapped"):
        files.write_model_file(str(p), "x", base_hash=sha(MODEL))
    assert outside.read_text() == "SECRET = 1\n"
    assert not [n for n in os.listdir(folders["rw"]) if n.endswith(".tmp")]


def test_write_to_read_folder_refused(folders):
    p = folders["ro"] / "model.py"
    with pytest.raises(PathRefused, match="read-write"):
        files.write_model_file(str(p), "x", base_hash=sha(MODEL))
    assert p.read_text() == MODEL


def test_stale_base_hash_refused(folders):
    p = folders["rw"] / "model.py"
    with pytest.raises(PathRefused, match="changed since"):
        files.write_model_file(str(p), "x", base_hash=sha("something older"))
    with pytest.raises(PathRefused):
        files.write_model_file(str(p), "x", base_hash=None)
    assert p.read_text() == MODEL
    assert files.previous_versions(str(p)) == []


def test_hidden_and_wrong_type_refused(folders):
    rw = folders["rw"]
    for name in [".hidden.py", ".env", ".bashrc", "run.sh", "config.toml", "setup.cfg",
                 "Makefile", "notes.txt", "data.csv", "bundle.pnlproject", "x.pyc"]:
        (rw / name).write_text("x")
        with pytest.raises(PathRefused):
            files.read_model_file(str(rw / name))
        with pytest.raises(PathRefused):
            files.write_model_file(str(rw / name), "y", base_hash=sha("x"))
        assert (rw / name).read_text() == "x"
    (rw / ".git").mkdir()
    (rw / ".git" / "config.py").write_text("x")
    with pytest.raises(PathRefused):
        files.read_model_file(str(rw / ".git" / "config.py"))
    # Bare .json that isn't MDF (and isn't a layout) is refused by the classifier.
    (rw / "settings.json").write_text('{"key": "value"}')
    with pytest.raises(PathRefused):
        files.read_model_file(str(rw / "settings.json"))
    # A layout file is allowed.
    (rw / "model.pnlview.json").write_text('{"nodes": {}}')
    assert files.read_model_file(str(rw / "model.pnlview.json")) == '{"nodes": {}}'
    names = sorted(f["name"] for f in files.list_model_files())
    assert names == ["model.pnlview.json", "model.py", "model.py", "nested.py"]


def test_oversized_refused(folders):
    big = folders["rw"] / "big.py"
    with open(big, "wb") as f:
        f.truncate(files.MAX_FILE_BYTES + 1)
    with pytest.raises(PathRefused, match="too_large|Larger"):
        files.read_model_file(str(big))
    with pytest.raises(PathRefused):
        files.write_model_file(str(big), "x", base_hash=None)
    with pytest.raises(PathRefused, match="too_large"):
        files.write_model_file(str(folders["rw"] / "new.py"), "x" * (files.MAX_FILE_BYTES + 1), base_hash=None)
    assert all(f["name"] != "big.py" for f in files.list_model_files())


def test_list_is_bounded(folders, monkeypatch):
    monkeypatch.setattr(files, "MAX_LIST", 3)
    for i in range(6):
        (folders["rw"] / f"m{i}.py").write_text(MODEL)
    assert len(files.list_model_files()) == 3


def test_refused_folders(tmp_path):
    home = os.path.expanduser("~")
    for bad in ["/", home, "/System", "/usr/bin", "/etc", "/Library", os.path.join(home, "Library"),
                os.path.join(home, ".ssh"), os.path.join(home, ".aws"), sys.prefix,
                str(files.Path(files.__file__).resolve().parents[4]), str(tmp_path / "missing")]:
        if bad.startswith(home) and not os.path.isdir(bad) and "." not in os.path.basename(bad):
            continue
        with pytest.raises(PathRefused):
            files.validate_folder(bad)
    with pytest.raises(PathRefused, match="absolute"):
        files.validate_folder("Models")
    hidden = tmp_path / ".secrets"
    hidden.mkdir()
    with pytest.raises(PathRefused, match="Hidden"):
        files.validate_folder(str(hidden))
    # A symlink to a refused place is resolved first.
    link = tmp_path / "innocent"
    link.symlink_to("/usr")
    with pytest.raises(PathRefused):
        files.validate_folder(str(link))
    # A folder the user would reasonably designate is accepted.
    good = tmp_path / "Models"
    good.mkdir()
    assert files.validate_folder(str(good)) == good.resolve()


def test_refused_folder_in_settings_is_skipped(tmp_path, monkeypatch):
    monkeypatch.setenv(review.STATE_ENV, str(tmp_path / "review.json"))
    files.set_folders_provider(lambda: [{"path": "/", "access": "read_write"}, {"path": "/usr", "access": "read"}])
    try:
        assert files.allowed_folders() == []
        assert files.list_model_files() == []
        with pytest.raises(PathRefused):
            files.read_model_file("/etc/hosts")
    finally:
        files.set_folders_provider(files._folders_from_settings)


def test_reading_never_runs(folders):
    marker = folders["outside"] / "ran.txt"
    p = folders["rw"] / "model.py"
    p.write_text(f"open({str(marker)!r}, 'w').write('ran')\n")
    files.read_model_file(str(p))
    files.list_model_files()
    files.resolve_allowed(str(p))
    assert not marker.exists()
