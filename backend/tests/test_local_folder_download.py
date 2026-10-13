"""Another local checkout: the folder is checked as soon as it is typed, and
an empty or missing one can have PsyNeuLink downloaded into it (#1342).

No test touches the network or the real environment: ``git clone`` is
replaced by a fake that writes a small checkout, pip by a fake process, and
the clone root and preferences file are temporary (conftest guards the real
preferences file).
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import routes as api_routes
from app.main import app
from app.services import clone_manager, github_auth
from app.services import install_manager as im
from app.services import source_history as sh
from app.services.install_manager import InstallManager, check_local_folder

client = TestClient(app)


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(tmp_path / "clones"))
    monkeypatch.delenv("PSYNEUVIEW_GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.setattr(github_auth, "get_auth", lambda: github_auth.GithubAuth(token=None))
    im._install_manager = None
    yield
    im._install_manager = None


@pytest.fixture
def loopback(monkeypatch):
    monkeypatch.setattr(api_routes, "_is_loopback", lambda request: True)
    monkeypatch.delenv("PSYNEUVIEW_DEPLOYMENT_MODE", raising=False)
    monkeypatch.setattr(api_routes, "get_psyneulink_info", lambda: {"source": "unknown"})


def _checkout(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    (root / "pyproject.toml").write_text('[project]\nname = "psyneulink"\n')
    (root / "psyneulink").mkdir()
    (root / "psyneulink" / "__init__.py").write_text("")
    return root


# ── The check under the Path field ──────────────────────────────────────


def test_an_empty_folder_is_downloadable(tmp_path):
    folder = tmp_path / "PNV--my-local-PNL-repo"
    folder.mkdir()
    check = check_local_folder(str(folder))
    assert (check.status, check.exists, check.reason) == ("downloadable", True, None)


def test_a_folder_holding_only_finders_bookkeeping_counts_as_empty(tmp_path):
    folder = tmp_path / "empty"
    folder.mkdir()
    (folder / ".DS_Store").write_bytes(b"\0")
    assert check_local_folder(str(folder)).status == "downloadable"


def test_a_missing_folder_whose_parent_exists_is_downloadable(tmp_path):
    check = check_local_folder(str(tmp_path / "not-yet"))
    assert (check.status, check.exists) == ("downloadable", False)


def test_a_missing_folder_under_a_missing_parent_is_refused(tmp_path):
    check = check_local_folder(str(tmp_path / "nope" / "not-yet"))
    assert check.status == "refused"
    assert "doesn't exist" in check.reason


def test_a_folder_of_other_files_is_refused_in_plain_words(tmp_path):
    folder = tmp_path / "Thesis-notes"
    folder.mkdir()
    (folder / "chapter1.md").write_text("notes")
    check = check_local_folder(str(folder))
    assert check.status == "refused"
    assert "isn't a PsyNeuLink checkout" in check.reason
    # Says what a PsyNeuLink folder holds, and that an empty one would do.
    assert "psyneulink folder" in check.reason and "pyproject.toml" in check.reason
    assert "empty folder" in check.reason
    assert "doesn't look like" not in check.reason


def test_a_project_without_a_psyneulink_folder_is_refused(tmp_path):
    folder = tmp_path / "other-project"
    folder.mkdir()
    (folder / "pyproject.toml").write_text("[project]\n")
    check = check_local_folder(str(folder))
    assert check.status == "refused"
    assert "no psyneulink folder" in check.reason


def test_a_real_checkout_is_accepted(tmp_path):
    check = check_local_folder(str(_checkout(tmp_path / "PsyNeuLink")))
    assert (check.status, check.reason) == ("usable", None)


def test_a_file_and_a_relative_path_are_refused(tmp_path):
    f = tmp_path / "file.txt"
    f.write_text("x")
    assert check_local_folder(str(f)).status == "refused"
    relative = check_local_folder("code/PsyNeuLink")
    assert relative.status == "refused" and "full path" in relative.reason
    assert check_local_folder("  ").status == "refused"


def test_the_check_endpoint(loopback, tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    body = client.get("/api/settings/install/check-folder", params={"path": str(empty)}).json()
    assert body == {"status": "downloadable", "path": str(empty.resolve()), "exists": True, "reason": None}
    other = tmp_path / "other"
    other.mkdir()
    (other / "a.txt").write_text("x")
    body = client.get("/api/settings/install/check-folder", params={"path": str(other)}).json()
    assert body["status"] == "refused" and "isn't a PsyNeuLink checkout" in body["reason"]
    real = _checkout(tmp_path / "PsyNeuLink")
    assert client.get("/api/settings/install/check-folder", params={"path": str(real)}).json()["status"] == "usable"


# ── Starting a job: what is refused up front ────────────────────────────


def test_switching_to_an_empty_folder_without_a_download_says_to_download(tmp_path):
    folder = tmp_path / "empty"
    folder.mkdir()
    with pytest.raises(ValueError, match="Download PsyNeuLink here"):
        InstallManager().start("local", None, str(folder))


def test_a_download_into_a_folder_of_other_files_is_refused(tmp_path):
    folder = tmp_path / "Thesis-notes"
    folder.mkdir()
    (folder / "keep.txt").write_text("mine")
    with pytest.raises(ValueError, match="isn't a PsyNeuLink checkout"):
        InstallManager().start("local", None, str(folder), download_repo="PrincetonUniversity/PsyNeuLink", download_ref="devel")
    assert (folder / "keep.txt").read_text() == "mine"


def test_a_download_into_a_checkout_is_refused(tmp_path):
    real = _checkout(tmp_path / "PsyNeuLink")
    with pytest.raises(ValueError, match="already a PsyNeuLink checkout"):
        InstallManager().start("local", None, str(real), download_repo="PrincetonUniversity/PsyNeuLink", download_ref="devel")


def test_a_download_is_only_for_a_local_checkout():
    with pytest.raises(ValueError, match="only for source=local"):
        InstallManager().start("github", "devel", None, download_repo="PrincetonUniversity/PsyNeuLink")


# ── The download ─────────────────────────────────────────────────────────


class _FakeProc:
    def __init__(self, exit_code: int = 0):
        self.stdout = iter(["Successfully installed psyneulink"])
        self._exit_code = exit_code

    def wait(self) -> int:
        return self._exit_code


class _NoopThread:
    def __init__(self, target, args, daemon=True):
        pass

    def start(self) -> None:
        pass


def _fake_git(monkeypatch, *, clone_fails=False, checkout_fails=False, after_clone=None):
    """``clone_into`` writes a small checkout (and ``.git``) where it is
    told; ``checkout`` returns a SHA. Records the calls."""
    calls = {"clone_into": [], "checkout": [], "pip": []}

    def clone_into(repo, target, token, on_line):
        calls["clone_into"].append((repo, Path(target)))
        _checkout(Path(target))
        (Path(target) / ".git").mkdir()
        if after_clone:
            after_clone()
        if clone_fails:
            raise clone_manager.CloneError("git clone failed with exit code 128")

    def checkout(path, ref, on_line):
        calls["checkout"].append((Path(path), ref))
        if checkout_fails:
            raise clone_manager.CloneError(f"git checkout {ref} failed")
        return "abcdef0123" * 4

    def popen(cmd, **kw):
        calls["pip"].append(cmd)
        return _FakeProc()

    monkeypatch.setattr(im.clone_manager, "clone_into", clone_into)
    monkeypatch.setattr(im.clone_manager, "checkout", checkout)
    monkeypatch.setattr(im.subprocess, "Popen", popen)
    monkeypatch.setattr(im.threading, "Thread", _NoopThread)
    return calls


def _download(folder: Path, repo="PrincetonUniversity/PsyNeuLink", ref="devel"):
    manager = InstallManager()
    job = manager.start("local", None, str(folder), download_repo=repo, download_ref=ref)
    manager._run(job)
    return job


def _leftovers(parent: Path) -> list[str]:
    return [p.name for p in parent.iterdir() if "psyneuview-download" in p.name]


def test_downloading_into_an_empty_folder_installs_it_editable(monkeypatch, tmp_path):
    folder = tmp_path / "PNV--my-local-PNL-repo"
    folder.mkdir()
    (folder / ".DS_Store").write_bytes(b"\0")
    calls = _fake_git(monkeypatch)

    job = _download(folder)

    assert job.status == "succeeded", job.log
    assert (job.download_repo, job.download_ref) == ("PrincetonUniversity/PsyNeuLink", "devel")
    # Cloned somewhere of its own, then moved into the folder.
    (repo, staging), = calls["clone_into"]
    assert repo == "PrincetonUniversity/PsyNeuLink" and staging != folder and staging.parent == folder.parent
    assert calls["checkout"] == [(staging, "devel")]
    assert sorted(p.name for p in folder.iterdir()) == [".git", "psyneulink", "pyproject.toml"]
    assert _leftovers(tmp_path) == []
    # Installed editable from the folder itself.
    (pip,) = calls["pip"]
    assert pip[-2:] == ["-e", str(folder.resolve())]
    log = "\n".join(job.log)
    assert "✓ download PsyNeuLink in" in log and "✓ pip install -e in" in log
    # A known checkout from now on.
    assert [s["path"] for s in sh.list_sources() if s["kind"] == "local"] == [str(folder.resolve())]


def test_downloading_into_a_missing_folder_creates_it(monkeypatch, tmp_path):
    folder = tmp_path / "PsyNeuLink"
    _fake_git(monkeypatch)
    job = _download(folder, repo="jonhanke-nam/PsyNeuLink", ref="jonhanke-dev")
    assert job.status == "succeeded", job.log
    assert (folder / "psyneulink").is_dir() and (folder / ".git").is_dir()
    assert _leftovers(tmp_path) == []


def test_a_blank_branch_downloads_latest_development(monkeypatch, tmp_path):
    calls = _fake_git(monkeypatch)
    job = _download(tmp_path / "PsyNeuLink", ref="")
    assert job.status == "succeeded", job.log
    assert calls["checkout"][0][1] == "devel"


def test_a_failed_download_into_a_missing_folder_leaves_nothing(monkeypatch, tmp_path):
    folder = tmp_path / "PsyNeuLink"
    _fake_git(monkeypatch, clone_fails=True)
    job = _download(folder)
    assert job.status == "failed"
    assert not folder.exists()
    assert _leftovers(tmp_path) == []
    assert sh.list_sources() == []


def test_a_failed_download_into_an_empty_folder_keeps_the_folder_as_it_was(monkeypatch, tmp_path):
    folder = tmp_path / "mine"
    folder.mkdir()
    _fake_git(monkeypatch, checkout_fails=True)
    job = _download(folder)
    assert job.status == "failed"
    # The folder was the user's: still there, still empty; only the partial
    # download this job made is gone.
    assert folder.is_dir() and list(folder.iterdir()) == []
    assert _leftovers(tmp_path) == []
    assert "Removed the partly downloaded copy" in "\n".join(job.log)


def test_a_folder_that_fills_up_during_the_download_is_not_touched(monkeypatch, tmp_path):
    folder = tmp_path / "mine"
    folder.mkdir()

    def user_saves_a_file():
        (folder / "notes.txt").write_text("mine")

    _fake_git(monkeypatch, after_clone=user_saves_a_file)
    job = _download(folder)
    assert job.status == "failed"
    assert [p.name for p in folder.iterdir()] == ["notes.txt"]
    assert (folder / "notes.txt").read_text() == "mine"
    assert _leftovers(tmp_path) == []
    assert "no longer empty" in "\n".join(job.log)


def test_clone_into_uses_the_managed_clones_git_and_token(monkeypatch, tmp_path):
    seen = []
    monkeypatch.setattr(clone_manager, "_git", lambda args, cwd, on_line, token=None: seen.append((args, cwd, token)))
    clone_manager.clone_into("PrincetonUniversity/PsyNeuLink", tmp_path / "x", "tok", lambda line: None)
    assert seen == [(["clone", "--quiet", "https://github.com/PrincetonUniversity/PsyNeuLink.git", str(tmp_path / "x")], None, "tok")]


# ── The endpoint ─────────────────────────────────────────────────────────


def test_the_install_endpoint_takes_a_download_and_remembers_it_only_once_done(monkeypatch, loopback, tmp_path):
    monkeypatch.setattr(im.threading, "Thread", _NoopThread)
    folder = tmp_path / "PsyNeuLink"
    resp = client.post(
        "/api/settings/install",
        json={"source": "local", "path": str(folder), "download_repo": "PrincetonUniversity/PsyNeuLink", "download_ref": "devel"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["download_repo"], body["download_ref"]) == ("PrincetonUniversity/PsyNeuLink", "devel")
    # Not on intent: the job adds it when the folder holds PsyNeuLink.
    assert [s for s in sh.list_sources() if s["kind"] == "local"] == []


def test_the_install_endpoint_refuses_a_download_into_a_folder_of_other_files(loopback, tmp_path):
    folder = tmp_path / "Thesis-notes"
    folder.mkdir()
    (folder / "keep.txt").write_text("mine")
    resp = client.post(
        "/api/settings/install",
        json={"source": "local", "path": str(folder), "download_repo": "PrincetonUniversity/PsyNeuLink", "download_ref": "devel"},
    )
    assert resp.status_code == 400
    assert "isn't a PsyNeuLink checkout" in resp.json()["detail"]
    assert (folder / "keep.txt").read_text() == "mine"
