"""Remembered PsyNeuLink sources and quick switching between them (#1276).

Covers the list Settings shows (add, dedupe, rename, remove, which is active),
its endpoints, and the local-checkout fast path that skips pip when nothing
moved. Every install is stubbed: no test runs pip or touches the real
environment, and the preferences file and clone root are temporary.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import routes as api_routes
from app.main import app
from app.services import install_manager as im
from app.services import source_history as sh
from app.services.install_manager import InstallManager

client = TestClient(app)


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    """Temporary clone root, so the local fast path's state file never lands in
    the real ~/.psyneuview. (conftest already isolates the preferences file.)"""
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(tmp_path / "clones"))
    im._install_manager = None
    yield
    im._install_manager = None


@pytest.fixture
def config_path(tmp_path) -> Path:
    return tmp_path / "prefs.json"


@pytest.fixture
def two_checkouts(tmp_path):
    a = tmp_path / "PsyNeuLink-a"
    b = tmp_path / "PsyNeuLink-b"
    for d in (a, b):
        d.mkdir()
        (d / "pyproject.toml").write_text('[project]\nname = "psyneulink"\n')
        # What install_manager.local_checkout_problem looks for (#1331).
        (d / "psyneulink").mkdir()
        (d / "psyneulink" / "__init__.py").write_text("")
    return a, b


# ── The list ────────────────────────────────────────────────────────────


def test_switching_to_a_source_adds_it_to_the_top_of_the_list(config_path, two_checkouts):
    a, b = two_checkouts
    sh.remember_source("local", path=str(a), config_file=config_path)
    sh.remember_source("pypi", config_file=config_path)
    sh.remember_source("github", repo="PrincetonUniversity/PsyNeuLink", ref="devel", config_file=config_path)
    ids = [e["id"] for e in sh.list_sources(config_file=config_path)]
    assert ids == ["github:princetonuniversity/psyneulink@devel", "pypi", f"local:{a.resolve()}"]


def test_the_same_source_twice_is_one_entry_moved_to_the_top(config_path, two_checkouts):
    a, b = two_checkouts
    sh.remember_source("local", path=str(a), config_file=config_path)
    sh.remember_source("local", path=str(b), config_file=config_path)
    # A trailing slash and a differently cased repo are still the same source.
    sh.remember_source("local", path=str(a) + "/", config_file=config_path)
    sh.remember_source("github", repo="princetonuniversity/PsyNeuLink", ref="devel", config_file=config_path)
    sh.remember_source("github", repo="PrincetonUniversity/PsyNeuLink", ref="devel", config_file=config_path)
    sources = sh.list_sources(config_file=config_path)
    assert [e["id"] for e in sources] == [
        "github:princetonuniversity/psyneulink@devel",
        f"local:{a.resolve()}",
        f"local:{b.resolve()}",
    ]
    assert sources[0]["repo"] == "PrincetonUniversity/PsyNeuLink"  # latest spelling kept


def test_local_checkouts_are_editable_and_github_and_pypi_are_managed(config_path, two_checkouts):
    a, _ = two_checkouts
    sh.remember_source("local", path=str(a), config_file=config_path)
    sh.remember_source("pypi", config_file=config_path)
    sh.remember_source("github", repo="o/r", ref="main", config_file=config_path)
    editable = {e["kind"]: e["editable"] for e in sh.list_sources(config_file=config_path)}
    assert editable == {"local": True, "pypi": False, "github": False}


def test_the_active_source_is_marked(config_path, two_checkouts):
    a, b = two_checkouts
    sh.remember_source("local", path=str(a), config_file=config_path)
    sh.remember_source("local", path=str(b), config_file=config_path)
    active = sh.active_source_from_info({"source": "editable", "path": str(a), "repo": "o/r", "branch": "devel"})
    sources = sh.list_sources(active=active, config_file=config_path)
    assert [e["active"] for e in sources] == [False, True]
    assert all(e["remembered"] for e in sources)


def test_an_active_source_not_on_the_list_is_still_shown_first(config_path, two_checkouts):
    """Installed outside Settings (the Mac app's setup, a terminal): listed,
    marked active, but not remembered until the user switches to it or names it."""
    a, _ = two_checkouts
    sh.remember_source("pypi", config_file=config_path)
    active = sh.active_source_from_info({"source": "editable", "path": str(a)})
    sources = sh.list_sources(active=active, config_file=config_path)
    assert sources[0]["id"] == f"local:{a.resolve()}"
    assert sources[0]["active"] and not sources[0]["remembered"]
    assert [e["kind"] for e in json.loads(config_path.read_text())["pnl_sources"]] == ["pypi"]


def test_a_managed_github_clone_is_active_as_its_repo_and_branch(config_path):
    sh.remember_source("github", repo="jonhanke-nam/PsyNeuLink", ref="jonhanke-dev", config_file=config_path)
    active = sh.active_source_from_info(
        {"source": "github", "repo": "jonhanke-nam/PsyNeuLink", "branch": "jonhanke-dev", "path": "/clones/x"}
    )
    assert sh.list_sources(active=active, config_file=config_path)[0]["active"]


def test_rename_keeps_the_name_across_later_switches(config_path, two_checkouts):
    a, _ = two_checkouts
    sh.remember_source("local", path=str(a), config_file=config_path)
    sid = f"local:{a.resolve()}"
    sh.rename_source(sid, "  My fork work  ", config_file=config_path)
    sh.remember_source("local", path=str(a), config_file=config_path)
    assert sh.list_sources(config_file=config_path)[0]["label"] == "My fork work"
    sh.rename_source(sid, "   ", config_file=config_path)  # blank restores the default
    assert sh.list_sources(config_file=config_path)[0]["label"] is None


def test_naming_the_unremembered_active_source_remembers_it(config_path, two_checkouts):
    a, _ = two_checkouts
    active = sh.active_source_from_info({"source": "editable", "path": str(a)})
    sh.rename_source(f"local:{a.resolve()}", "Wizard clone", active=active, config_file=config_path)
    entry = sh.list_sources(active=active, config_file=config_path)[0]
    assert entry["remembered"] and entry["label"] == "Wizard clone"


def test_rename_of_an_unknown_source_is_an_error(config_path):
    with pytest.raises(KeyError):
        sh.rename_source("local:/nowhere", "x", config_file=config_path)


def test_remove_takes_it_off_the_list_and_leaves_the_folder(config_path, two_checkouts):
    a, b = two_checkouts
    sh.remember_source("local", path=str(a), config_file=config_path)
    sh.remember_source("local", path=str(b), config_file=config_path)
    assert sh.remove_source(f"local:{a.resolve()}", config_file=config_path)
    assert [e["path"] for e in sh.list_sources(config_file=config_path)] == [str(b.resolve())]
    assert (a / "pyproject.toml").exists()
    assert not sh.remove_source(f"local:{a.resolve()}", config_file=config_path)


def test_a_local_checkout_whose_folder_is_gone_is_flagged_missing(config_path, tmp_path):
    gone = tmp_path / "deleted-checkout"
    gone.mkdir()
    sh.remember_source("local", path=str(gone), config_file=config_path)
    gone.rmdir()
    assert sh.list_sources(config_file=config_path)[0]["missing"]


def test_the_list_starts_from_recent_github_selections(config_path):
    """People upgrading see the branches they already used, until they change the list."""
    sh.record_selection("o/r", "devel", config_file=config_path)
    sh.record_selection("o/r", "feature", config_file=config_path)
    assert [e["id"] for e in sh.list_sources(config_file=config_path)] == [
        "github:o/r@feature", "github:o/r@devel",
    ]
    sh.remove_source("github:o/r@devel", config_file=config_path)
    assert [e["id"] for e in sh.list_sources(config_file=config_path)] == ["github:o/r@feature"]
    # The branch typeahead's own history is untouched.
    assert sh.list_refs_for_repo("o/r", config_file=config_path) == ["feature", "devel"]


def test_the_source_in_use_is_adopted_once_and_kept_after_a_switch(config_path, two_checkouts):
    """A checkout installed outside Settings (the Mac app's setup wizard, a
    terminal) was listed only while in use, so no local checkout was ever a
    known source (#1331). Adopting it puts it on the list for good."""
    a, b = two_checkouts
    active = sh.active_source_from_info({"source": "editable", "path": str(a)})
    assert sh.remember_active(active, config_file=config_path)
    assert not sh.remember_active(active, config_file=config_path)  # already listed: no churn
    assert not sh.remember_active(None, config_file=config_path)
    assert [e["kind"] for e in json.loads(config_path.read_text())["pnl_sources"]] == ["local"]
    sh.remember_source("local", path=str(b), config_file=config_path)
    assert [e["path"] for e in sh.list_sources(config_file=config_path)] == [str(b.resolve()), str(a.resolve())]


def test_a_placeholder_github_source_is_never_listed(config_path):
    """``owner/repo`` is the example in the docs and the Repo field, not a
    source (#1292): refused when remembered, dropped from the file and from
    the seed history when read."""
    assert sh.remember_source("github", repo="owner/repo", ref="devel", config_file=config_path) is None
    assert not config_path.exists()
    config_path.write_text(json.dumps({
        "pnl_sources": [
            {"kind": "github", "repo": "owner/repo", "ref": "devel", "selected_at": 2},
            {"kind": "github", "repo": "jonhanke-nam/PsyNeuLink", "ref": "devel", "selected_at": 1},
        ],
    }))
    assert [e["id"] for e in sh.list_sources(config_file=config_path)] == ["github:jonhanke-nam/psyneulink@devel"]
    config_path.write_text(json.dumps({
        "source_history": [
            {"repo": "owner/repo", "ref": "devel", "selected_at": 2},
            {"repo": "jonhanke-nam/PsyNeuLink", "ref": "devel", "selected_at": 1},
        ],
    }))
    assert [e["id"] for e in sh.list_sources(config_file=config_path)] == ["github:jonhanke-nam/psyneulink@devel"]


def test_malformed_entries_are_dropped(config_path):
    config_path.write_text(json.dumps({"pnl_sources": [
        "junk", {"kind": "github", "repo": "o/r"}, {"kind": "nope"}, {"kind": "pypi"},
    ]}))
    assert [e["id"] for e in sh.list_sources(config_file=config_path)] == ["pypi"]


# ── Endpoints ───────────────────────────────────────────────────────────


@pytest.fixture
def loopback(monkeypatch):
    monkeypatch.setattr(api_routes, "_is_loopback", lambda request: True)
    monkeypatch.delenv("PSYNEUVIEW_DEPLOYMENT_MODE", raising=False)


def test_endpoints_list_rename_and_remove(monkeypatch, loopback, two_checkouts):
    a, b = two_checkouts
    monkeypatch.setattr(
        api_routes, "get_psyneulink_info",
        lambda: {"source": "editable", "path": str(a), "repo": None, "branch": None,
                 "commit": None, "version": "0.19.1.0"},
    )
    sh.remember_source("local", path=str(b))
    sources = client.get("/api/settings/pnl-sources").json()["sources"]
    # The one in use is adopted the first time Settings lists it (#1331).
    assert [(e["path"], e["active"], e["remembered"]) for e in sources] == [
        (str(a.resolve()), True, True), (str(b.resolve()), False, True),
    ]
    renamed = client.post(
        "/api/settings/pnl-sources/rename", json={"id": f"local:{b.resolve()}", "label": "Second"},
    ).json()["sources"]
    assert [e["label"] for e in renamed] == [None, "Second"]
    left = client.post("/api/settings/pnl-sources/remove", json={"id": f"local:{b.resolve()}"}).json()
    assert [e["path"] for e in left["sources"]] == [str(a.resolve())]
    assert client.post("/api/settings/pnl-sources/remove", json={"id": "pypi"}).status_code == 404


def test_installing_remembers_the_source(monkeypatch, loopback, two_checkouts):
    a, _ = two_checkouts
    monkeypatch.setattr(api_routes, "get_psyneulink_info", lambda: {"source": "unknown"})
    monkeypatch.setattr(im.threading, "Thread", lambda target, args, daemon: _Inert())
    resp = client.post("/api/settings/install", json={"source": "local", "path": str(a)})
    assert resp.status_code == 200
    assert [e["id"] for e in sh.list_sources()] == [f"local:{a.resolve()}"]


def test_installing_keeps_the_source_being_left(monkeypatch, loopback, two_checkouts):
    """Switching away from a checkout installed outside Settings keeps it on
    the list (#1331), below the new one."""
    a, b = two_checkouts
    monkeypatch.setattr(
        api_routes, "get_psyneulink_info",
        lambda: {"source": "editable", "path": str(a), "repo": None, "branch": None},
    )
    monkeypatch.setattr(im.threading, "Thread", lambda target, args, daemon: _Inert())
    resp = client.post("/api/settings/install", json={"source": "local", "path": str(b)})
    assert resp.status_code == 200
    assert [e["id"] for e in sh.list_sources()] == [f"local:{b.resolve()}", f"local:{a.resolve()}"]


def test_installing_from_the_placeholder_repo_is_refused_and_not_recorded(monkeypatch, loopback):
    monkeypatch.setattr(api_routes, "get_psyneulink_info", lambda: {"source": "unknown"})
    resp = client.post("/api/settings/install", json={"source": "github", "repo": "owner/repo", "ref": "devel"})
    assert resp.status_code == 400
    assert "placeholder" in resp.json()["detail"]
    assert sh.list_sources() == []
    assert sh.list_repos() == []


def test_installing_from_a_folder_that_is_not_a_checkout_is_refused(monkeypatch, loopback, tmp_path):
    monkeypatch.setattr(api_routes, "get_psyneulink_info", lambda: {"source": "unknown"})
    not_a_checkout = tmp_path / "Documents"
    not_a_checkout.mkdir()
    (not_a_checkout / "letter.txt").write_text("not PsyNeuLink")
    resp = client.post("/api/settings/install", json={"source": "local", "path": str(not_a_checkout)})
    assert resp.status_code == 400
    # In the panel's own plain words (#1342), the same as under the Path field.
    assert "isn't a PsyNeuLink checkout" in resp.json()["detail"]
    assert sh.list_sources() == []


def test_installing_from_an_empty_folder_without_a_download_says_to_download(monkeypatch, loopback, tmp_path):
    monkeypatch.setattr(api_routes, "get_psyneulink_info", lambda: {"source": "unknown"})
    empty = tmp_path / "PNV--my-local-PNL-repo"
    empty.mkdir()
    resp = client.post("/api/settings/install", json={"source": "local", "path": str(empty)})
    assert resp.status_code == 400
    assert "is empty" in resp.json()["detail"] and "Download PsyNeuLink here" in resp.json()["detail"]
    assert sh.list_sources() == []


class _Inert:
    def start(self):
        pass


# ── Quick switching: skip pip when nothing moved ────────────────────────


def _editable_at(monkeypatch, path: Path | None):
    """Pretend psyneulink is installed editable from ``path`` (None: elsewhere)."""
    monkeypatch.setattr(
        im.clone_manager, "_editable_install_targets",
        lambda p: path is not None and Path(p).resolve() == path.resolve(),
    )


class _FakeProc:
    def __init__(self):
        self.stdout = iter(["Successfully installed psyneulink"])

    def wait(self):
        return 0


def _run_local(monkeypatch, path: Path) -> tuple[im.InstallJob, list]:
    popen_calls: list = []

    def fake_popen(cmd, **kw):
        popen_calls.append(cmd)
        return _FakeProc()

    monkeypatch.setattr(im.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(im.threading, "Thread", lambda target, args, daemon: _Inert())
    manager = InstallManager()
    job = manager.start("local", None, str(path))
    manager._run(job)
    return job, popen_calls


def test_switching_to_a_different_checkout_runs_pip_without_dependencies(monkeypatch, two_checkouts):
    a, b = two_checkouts
    _editable_at(monkeypatch, a)
    assert not im.local_install_can_skip_pip(str(b))
    job, calls = _run_local(monkeypatch, b)
    assert job.status == "succeeded"
    assert len(calls) == 1 and "--no-deps" in calls[0] and calls[0][-2:] == ["-e", str(b.resolve())]


def test_switching_back_to_the_installed_checkout_skips_pip(monkeypatch, two_checkouts):
    a, _ = two_checkouts
    _editable_at(monkeypatch, None)
    _run_local(monkeypatch, a)  # first install records its pyproject.toml
    _editable_at(monkeypatch, a)
    assert im.local_install_can_skip_pip(str(a))
    job, calls = _run_local(monkeypatch, a)
    assert job.status == "succeeded" and calls == []
    assert any("skipping pip install -e" in line for line in job.log)


def test_a_changed_pyproject_reinstalls_even_the_installed_checkout(monkeypatch, two_checkouts):
    a, _ = two_checkouts
    _editable_at(monkeypatch, None)
    _run_local(monkeypatch, a)
    _editable_at(monkeypatch, a)
    (a / "pyproject.toml").write_text('[project]\nname = "psyneulink"\ndependencies = ["numpy"]\n')
    assert not im.local_install_can_skip_pip(str(a))
    _, calls = _run_local(monkeypatch, a)
    assert len(calls) == 1


def test_a_checkout_never_installed_through_psyneuview_is_reinstalled(monkeypatch, two_checkouts):
    """Installed by the Mac app or a terminal: no record of its pyproject.toml,
    so the first switch through Settings runs pip once to be sure."""
    a, _ = two_checkouts
    _editable_at(monkeypatch, a)
    assert not im.local_install_can_skip_pip(str(a))


def test_the_fast_path_record_lives_outside_the_checkout(monkeypatch, two_checkouts, tmp_path):
    a, _ = two_checkouts
    _editable_at(monkeypatch, None)
    _run_local(monkeypatch, a)
    assert sorted(p.name for p in a.iterdir()) == ["psyneulink", "pyproject.toml"]
    assert list((tmp_path / "clones" / ".state" / "local").glob("*.json"))
