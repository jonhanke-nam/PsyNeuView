"""Tests for the clone_manager service (#262)."""

import json
import subprocess
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.services import clone_manager as cm


# ── path helpers ──────────────────────────────────────────────────────────


def test_clone_root_default(monkeypatch):
    monkeypatch.delenv("PSYNEUVIEW_CLONE_ROOT", raising=False)
    assert cm.clone_root() == Path.home() / ".psyneuview" / "sources"


def test_clone_root_env_override(monkeypatch, tmp_path):
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(tmp_path / "alt"))
    assert cm.clone_root() == tmp_path / "alt"


def test_clone_root_env_expands_tilde(monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", "~/my-clones")
    assert cm.clone_root() == Path.home() / "my-clones"


def test_slug_dirname_puts_owner_last():
    """Repo name leads (readable in ls); owner suffix disambiguates forks."""
    assert (
        cm._slug_dirname("PrincetonUniversity/PsyNeuLink")
        == "PsyNeuLink-PrincetonUniversity"
    )


def test_slug_dirname_disambiguates_forks():
    upstream = cm._slug_dirname("PrincetonUniversity/PsyNeuLink")
    fork = cm._slug_dirname("jonhanke-nam/PsyNeuLink")
    assert upstream != fork


def test_clone_path_for_combines_root_and_slug(monkeypatch, tmp_path):
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(tmp_path))
    assert cm.clone_path_for("owner/repo") == tmp_path / "repo-owner"


def test_https_url_form():
    assert cm._https_url("o/r") == "https://github.com/o/r.git"


# ── auth header injection ────────────────────────────────────────────────


def test_auth_args_empty_when_no_token():
    assert cm._auth_args(None) == []
    assert cm._auth_args("") == []


def test_auth_args_supplies_basic_header_when_token_given():
    """Token goes in -c http.extraheader as HTTP Basic with a base64-encoded
    ``x-access-token:TOKEN`` body — the GitHub Actions checkout form.
    (Bearer TOKEN looks plausible but git's HTTP transport rejects it.)"""
    import base64

    args = cm._auth_args("ghp_secret123")
    expected_creds = base64.b64encode(b"x-access-token:ghp_secret123").decode()
    assert args == [
        "-c",
        f"http.extraheader=Authorization: basic {expected_creds}",
    ]
    # Raw token must not appear in the args verbatim — only base64-wrapped.
    assert "ghp_secret123" not in args[1]


# ── token redaction ──────────────────────────────────────────────────────


def test_redact_masks_basic_credential():
    line = "$ git -c http.extraheader=Authorization: basic eC1hY2Nlc3MtdG9rZW46Z2hwXzEyMw== clone ..."
    redacted = cm._redact(line)
    assert "eC1hY2Nlc3MtdG9rZW46Z2hwXzEyMw==" not in redacted
    assert "Authorization: basic ***" in redacted


def test_redact_still_masks_bearer_form():
    """Older log entries / unexpected sources may still emit Bearer — keep masking."""
    line = "Authorization: Bearer ghp_secret123"
    assert "ghp_secret123" not in cm._redact(line)


def test_redact_is_case_insensitive():
    line = "AUTHORIZATION: BASIC eC1hY2Nlc3MtdG9rZW46Zm9v"
    assert "eC1hY2Nlc3MtdG9rZW46Zm9v" not in cm._redact(line)


def test_redact_noop_when_no_token_in_text():
    line = "Cloning into '/tmp/Foo'..."
    assert cm._redact(line) == line


# ── pyproject hash ───────────────────────────────────────────────────────


def test_pyproject_hash_returns_empty_when_file_missing(tmp_path):
    assert cm.pyproject_hash(tmp_path) == ""


def test_pyproject_hash_is_16_hex_chars(tmp_path):
    (tmp_path / "pyproject.toml").write_text('[project]\nname = "a"\n')
    h = cm.pyproject_hash(tmp_path)
    assert len(h) == 16
    int(h, 16)  # parses as hex


def test_pyproject_hash_changes_when_content_changes(tmp_path):
    p = tmp_path / "pyproject.toml"
    p.write_text('[project]\nname = "a"\n')
    h1 = cm.pyproject_hash(tmp_path)
    p.write_text('[project]\nname = "b"\n')
    h2 = cm.pyproject_hash(tmp_path)
    assert h1 != h2


# ── sidecar state ────────────────────────────────────────────────────────


def _clone_with_parent(tmp_path):
    """Create a clone path under a parent dir so the sibling ``.state/``
    directory has somewhere to live."""
    clone = tmp_path / "PsyNeuLink-owner"
    clone.mkdir()
    return clone


def test_sidecar_hash_returns_none_when_missing(tmp_path):
    clone = _clone_with_parent(tmp_path)
    assert cm._sidecar_hash(clone) is None


def test_sidecar_hash_returns_none_when_malformed(tmp_path):
    clone = _clone_with_parent(tmp_path)
    sidecar = cm._sidecar_path(clone)
    sidecar.parent.mkdir(parents=True, exist_ok=True)
    sidecar.write_text("{ not json")
    assert cm._sidecar_hash(clone) is None


def test_mark_installed_writes_current_pyproject_hash(tmp_path):
    clone = _clone_with_parent(tmp_path)
    (clone / "pyproject.toml").write_text("name = 'x'")
    cm.mark_installed(clone)
    sidecar = cm._sidecar_path(clone)
    assert sidecar.exists()
    assert json.loads(sidecar.read_text())["pyproject_hash"] == cm.pyproject_hash(clone)


def test_mark_installed_when_pyproject_missing_records_empty_string(tmp_path):
    """No pyproject → still write a sidecar so the next check has a baseline."""
    clone = _clone_with_parent(tmp_path)
    cm.mark_installed(clone)
    sidecar = cm._sidecar_path(clone)
    assert json.loads(sidecar.read_text())["pyproject_hash"] == ""


def test_sidecar_lives_outside_the_clone(tmp_path):
    """Regression: the sidecar must not sit inside the clone or it dirties the working tree."""
    clone = _clone_with_parent(tmp_path)
    cm.mark_installed(clone)
    assert cm._sidecar_path(clone).exists()
    # Nothing should appear inside the clone itself.
    assert list(clone.iterdir()) == []


def test_mark_installed_removes_legacy_in_clone_sidecar(tmp_path):
    """Existing clones with the old in-tree sidecar self-heal on next install."""
    clone = _clone_with_parent(tmp_path)
    (clone / cm._LEGACY_STATE_FILENAME).write_text('{"pyproject_hash": "old"}')
    cm.mark_installed(clone)
    assert not (clone / cm._LEGACY_STATE_FILENAME).exists()
    assert cm._sidecar_path(clone).exists()


def test_sidecar_hash_removes_legacy_in_clone_sidecar(tmp_path):
    """Even a read-only probe cleans up the legacy file."""
    clone = _clone_with_parent(tmp_path)
    (clone / cm._LEGACY_STATE_FILENAME).write_text('{"pyproject_hash": "old"}')
    cm._sidecar_hash(clone)
    assert not (clone / cm._LEGACY_STATE_FILENAME).exists()


# ── EditableState logic ──────────────────────────────────────────────────


@pytest.mark.parametrize(
    "pointing_here, pyproject_unchanged, expected",
    [
        (True, True, True),
        (True, False, False),
        (False, True, False),
        (False, False, False),
    ],
)
def test_can_skip_pip_requires_both_conditions(
    pointing_here, pyproject_unchanged, expected
):
    state = cm.EditableState(
        pointing_here=pointing_here,
        pyproject_unchanged=pyproject_unchanged,
    )
    assert state.can_skip_pip is expected


def test_editable_state_skip_when_metadata_and_hash_align(tmp_path, monkeypatch):
    """The skip-pip case: pip says editable here, sidecar hash matches."""
    (tmp_path / "pyproject.toml").write_text("name = 'x'")
    cm.mark_installed(tmp_path)

    fake_dist = MagicMock()
    fake_dist.read_text.return_value = json.dumps(
        {
            "url": f"file://{tmp_path.resolve()}",
            "dir_info": {"editable": True},
        }
    )
    monkeypatch.setattr(cm, "distribution", lambda name: fake_dist)

    state = cm.editable_state(tmp_path)
    assert state.pointing_here is True
    assert state.pyproject_unchanged is True
    assert state.can_skip_pip is True


def test_editable_state_no_skip_when_package_not_installed(tmp_path, monkeypatch):
    (tmp_path / "pyproject.toml").write_text("name = 'x'")
    cm.mark_installed(tmp_path)

    def raise_not_found(name):
        raise cm.PackageNotFoundError(name)

    monkeypatch.setattr(cm, "distribution", raise_not_found)
    state = cm.editable_state(tmp_path)
    assert state.pointing_here is False
    assert state.can_skip_pip is False


def test_editable_state_no_skip_when_installed_elsewhere(tmp_path, monkeypatch):
    (tmp_path / "pyproject.toml").write_text("name = 'x'")
    cm.mark_installed(tmp_path)

    fake_dist = MagicMock()
    fake_dist.read_text.return_value = json.dumps(
        {
            "url": "file:///some/other/place",
            "dir_info": {"editable": True},
        }
    )
    monkeypatch.setattr(cm, "distribution", lambda name: fake_dist)

    state = cm.editable_state(tmp_path)
    assert state.pointing_here is False


def test_editable_state_no_skip_when_not_an_editable_install(tmp_path, monkeypatch):
    """A regular wheel install at the same path shouldn't pass the skip gate."""
    (tmp_path / "pyproject.toml").write_text("name = 'x'")
    cm.mark_installed(tmp_path)

    fake_dist = MagicMock()
    fake_dist.read_text.return_value = json.dumps(
        {
            "url": f"file://{tmp_path.resolve()}",
            "dir_info": {"editable": False},
        }
    )
    monkeypatch.setattr(cm, "distribution", lambda name: fake_dist)

    state = cm.editable_state(tmp_path)
    assert state.pointing_here is False


def test_editable_state_no_skip_when_pip_has_no_direct_url(tmp_path, monkeypatch):
    """Older pip-installed dists have no direct_url.json — treat as not-here."""
    (tmp_path / "pyproject.toml").write_text("name = 'x'")
    cm.mark_installed(tmp_path)

    fake_dist = MagicMock()
    fake_dist.read_text.return_value = None
    monkeypatch.setattr(cm, "distribution", lambda name: fake_dist)

    state = cm.editable_state(tmp_path)
    assert state.pointing_here is False


def test_editable_state_no_skip_when_pyproject_changed(tmp_path, monkeypatch):
    """Same clone, but pyproject has been modified since last install."""
    (tmp_path / "pyproject.toml").write_text("name = 'old'")
    cm.mark_installed(tmp_path)
    (tmp_path / "pyproject.toml").write_text("name = 'new'")

    fake_dist = MagicMock()
    fake_dist.read_text.return_value = json.dumps(
        {
            "url": f"file://{tmp_path.resolve()}",
            "dir_info": {"editable": True},
        }
    )
    monkeypatch.setattr(cm, "distribution", lambda name: fake_dist)

    state = cm.editable_state(tmp_path)
    assert state.pointing_here is True
    assert state.pyproject_unchanged is False
    assert state.can_skip_pip is False


# ── artifact path redirection (#349) ──────────────────────────────────────


def test_artifact_path_passes_through_outside_clone(monkeypatch, tmp_path):
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(tmp_path / "clones"))
    outside = tmp_path / "models" / "my_model.pnlview.json"
    assert cm.artifact_path(outside) == outside


def test_artifact_path_redirects_inside_clone(monkeypatch, tmp_path):
    """Out of the clone, into the per-user layouts folder keyed by the copy's
    name (#1321; before that, ``sources/.state/artifacts``)."""
    from app.services.managed_layouts import layouts_dir

    root = tmp_path / "clones"
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(root))
    inside = root / "PsyNeuLink-owner" / "scripts" / "m.pnlview.json"
    redirected = cm.artifact_path(inside)
    assert redirected == layouts_dir() / "PsyNeuLink-owner" / "scripts" / "m.pnlview.json"
    assert not redirected.is_relative_to(root)
    # Parent created so callers can write immediately.
    assert redirected.parent.is_dir()


def test_artifact_path_is_idempotent(monkeypatch, tmp_path):
    root = tmp_path / "clones"
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(root))
    inside = root / "PsyNeuLink-owner" / "m.original.py"
    once = cm.artifact_path(inside)
    twice = cm.artifact_path(once)
    assert once == twice


# ── stray-artifact purge on checkout (#316 / #349) ─────────────────────────


def _git(args, cwd):
    env = {
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_SYSTEM": "/dev/null",
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@t",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@t",
        "HOME": str(cwd),
        "PATH": __import__("os").environ.get("PATH", ""),
    }
    subprocess.run(["git", *args], cwd=str(cwd), env=env, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _make_clone_with_remote(tmp_path):
    """A clone with an ``origin/work`` tracking branch, ready for checkout()."""
    remote = tmp_path / "remote.git"
    remote.mkdir()
    _git(["init", "--bare", "-b", "work"], cwd=remote)

    clone = tmp_path / "PsyNeuLink-owner"
    _git(["clone", str(remote), str(clone)], cwd=tmp_path)
    (clone / "model.py").write_text("# tracked\n")
    _git(["add", "model.py"], cwd=clone)
    _git(["commit", "-m", "init"], cwd=clone)
    _git(["push", "-u", "origin", "work"], cwd=clone)
    return clone


def test_purge_removes_stray_pnv_artifacts(tmp_path):
    clone = _make_clone_with_remote(tmp_path)
    (clone / "model.pnlview.json").write_text("{}")
    (clone / "model.original.py").write_text("# old\n")
    (clone / "model.star_import_original.py").write_text("# old\n")
    (clone / "keep.txt").write_text("not ours\n")

    assert cm.is_dirty(clone) is True
    cm._purge_pnv_artifacts(clone, lambda _l: None)

    assert not (clone / "model.pnlview.json").exists()
    assert not (clone / "model.original.py").exists()
    assert not (clone / "model.star_import_original.py").exists()
    # Non-PsyNeuView untracked files are left alone.
    assert (clone / "keep.txt").exists()


def test_checkout_self_heals_stray_sidecar(tmp_path):
    clone = _make_clone_with_remote(tmp_path)
    (clone / "model.pnlview.json").write_text("{}")
    # Before #349 this stray untracked file would raise CloneError.
    sha = cm.checkout(clone, "work", lambda _l: None)
    assert sha
    assert not (clone / "model.pnlview.json").exists()


def _current_branch(clone: Path) -> str:
    """``git symbolic-ref --short HEAD`` — empty string on detached HEAD."""
    return subprocess.check_output(
        ["git", "symbolic-ref", "--short", "HEAD"],
        cwd=str(clone),
        stderr=subprocess.DEVNULL,
    ).decode().strip()


def test_checkout_branch_switches_head_to_named_branch(tmp_path):
    """#452 regression: checkout(branch) must move HEAD onto a local
    branch named after the ref, not just reset whatever branch was
    already checked out. Otherwise the settings panel reads back the
    clone-time default branch (e.g. ``master``) instead of what was
    actually requested."""
    clone = _make_clone_with_remote(tmp_path)
    # Add a second branch on the remote so we have somewhere to switch to.
    (clone / "feature.txt").write_text("on feature\n")
    _git(["checkout", "-b", "feat/x"], cwd=clone)
    _git(["add", "feature.txt"], cwd=clone)
    _git(["commit", "-m", "feat"], cwd=clone)
    _git(["push", "-u", "origin", "feat/x"], cwd=clone)
    # Return to ``work`` so the clone is on the default branch again,
    # mirroring the post-clone state ``ensure_clone`` leaves behind.
    _git(["checkout", "work"], cwd=clone)
    assert _current_branch(clone) == "work"

    cm.checkout(clone, "feat/x", lambda _l: None)

    # The crucial assertion: HEAD is now on a *named* local branch
    # matching the ref, not still on ``work``.
    assert _current_branch(clone) == "feat/x"


def test_checkout_branch_handles_slashed_ref_name(tmp_path):
    """Namespaced refs like ``refactor/foo/bar`` must survive the
    local-branch creation step. git allows slashes; -B accepts them."""
    clone = _make_clone_with_remote(tmp_path)
    _git(["checkout", "-b", "refactor/foo/bar"], cwd=clone)
    (clone / "x.txt").write_text("x\n")
    _git(["add", "x.txt"], cwd=clone)
    _git(["commit", "-m", "x"], cwd=clone)
    _git(["push", "-u", "origin", "refactor/foo/bar"], cwd=clone)
    _git(["checkout", "work"], cwd=clone)

    cm.checkout(clone, "refactor/foo/bar", lambda _l: None)

    assert _current_branch(clone) == "refactor/foo/bar"
