"""The official PsyNeuLink releases, and the kept ones (#1295 round 5)."""

import pytest
from fastapi.testclient import TestClient

from app.api import routes as api_routes
from app.main import app
from app.services import install_manager as im
from app.services import pnl_releases as pr

client = TestClient(app)


@pytest.fixture(autouse=True)
def releases_dir(tmp_path, monkeypatch):
    folder = tmp_path / "releases"
    monkeypatch.setenv("PSYNEUVIEW_RELEASES_DIR", str(folder))
    pr.forget_cache()
    yield folder
    pr.forget_cache()


@pytest.fixture(autouse=True)
def loopback(monkeypatch):
    monkeypatch.setattr(api_routes, "_is_loopback", lambda request: True)


def _file(version, uploaded, requires=">=3.10", yanked=False):
    return {"upload_time_iso_8601": uploaded, "requires_python": requires, "yanked": yanked}


PAYLOAD = {"releases": {
    "0.20.2.0": [_file("0.20.2.0", "2026-08-14T10:00:00Z", ">=3.10,<3.14")],
    "0.19.1.0": [_file("0.19.1.0", "2026-03-01T10:00:00Z")],
    "0.18.0.0": [_file("0.18.0.0", "2025-09-12T10:00:00Z")],
    "0.20.1.0": [_file("0.20.1.0", "2026-07-01T10:00:00Z", yanked=True)],
    "0.21.0.0": [_file("0.21.0.0", "2026-09-30T10:00:00Z", ">=3.14")],
    "garbage": [_file("garbage", "2026-01-01T00:00:00Z")],
    "0.17.0.0": [],
}}


def test_releases_are_newest_first_with_dates_compatibility_and_limits():
    rows = pr.parse_releases(PAYLOAD, python_version="3.13.7")
    assert [r["version"] for r in rows] == ["0.21.0.0", "0.20.2.0", "0.20.1.0", "0.19.1.0", "0.18.0.0"]
    by = {r["version"]: r for r in rows}
    assert by["0.20.2.0"] == {
        "version": "0.20.2.0", "released": "2026-08-14", "requires_python": ">=3.10,<3.14",
        "yanked": False, "compatible": True, "reason": None, "limited": False, "limited_reason": None, "kept": False,
    }
    assert by["0.21.0.0"]["compatible"] is False
    assert by["0.21.0.0"]["reason"] == "Needs Python >=3.14; this PsyNeuView runs Python 3.13.7"
    assert by["0.20.1.0"]["yanked"] and by["0.20.1.0"]["reason"] == "Withdrawn by its authors"
    assert by["0.18.0.0"]["limited"] and by["0.18.0.0"]["limited_reason"] == pr.LIMITED_REASON
    assert by["0.19.1.0"]["limited"] is False  # the first release with the hook
    assert pr.FIRST_DEBUGGER_HOOK_VERSION == "0.19.1.0"


def test_the_endpoint_reads_pypi_once_keeps_a_copy_and_marks_kept_files(releases_dir, monkeypatch):
    calls = []

    def fake_fetch(timeout=0):
        calls.append(timeout)
        return PAYLOAD

    monkeypatch.setattr(pr, "fetch_pypi", fake_fetch)
    releases_dir.mkdir()
    (releases_dir / "psyneulink-0.19.1.0-py3-none-any.whl").write_bytes(b"x" * 100)

    first = client.get("/api/settings/pnl-releases").json()
    second = client.get("/api/settings/pnl-releases").json()
    assert len(calls) == 1  # cached in memory the second time
    assert first["offline"] is False and first["releases"] == second["releases"]
    kept = [r["version"] for r in first["releases"] if r["kept"]]
    assert kept == ["0.19.1.0"]
    assert (releases_dir / "pypi-psyneulink.json").exists()


def test_offline_falls_back_to_the_copy_then_to_kept_files(releases_dir, monkeypatch):
    def unreachable(timeout=0):
        raise OSError("no network")

    # No copy yet: only what is kept, newest first, still with the limit.
    monkeypatch.setattr(pr, "fetch_pypi", unreachable)
    releases_dir.mkdir()
    (releases_dir / "psyneulink-0.18.0.0.tar.gz").write_bytes(b"x")
    (releases_dir / "psyneulink-0.20.2.0-py3-none-any.whl").write_bytes(b"x")
    (releases_dir / "notes.txt").write_text("not a release")
    data = client.get("/api/settings/pnl-releases").json()
    assert data["offline"] is True
    assert [(r["version"], r["kept"], r["limited"]) for r in data["releases"]] == [
        ("0.20.2.0", True, False), ("0.18.0.0", True, True),
    ]

    # With a copy from an earlier fetch, the whole list, still marked offline.
    pr._write_disk_copy(PAYLOAD)
    pr.forget_cache()
    data = client.get("/api/settings/pnl-releases").json()
    assert data["offline"] is True
    assert [r["version"] for r in data["releases"]][:2] == ["0.21.0.0", "0.20.2.0"]


class _FakeProc:
    def __init__(self, lines, exit_code=0):
        self.stdout = iter(lines)
        self._exit_code = exit_code

    def wait(self):
        return self._exit_code


def test_a_named_release_is_downloaded_once_then_installed_from_the_kept_file(releases_dir, monkeypatch):
    commands = []

    def fake_popen(cmd, *a, **kw):
        commands.append(cmd)
        if cmd[1] == "download":
            releases_dir.mkdir(parents=True, exist_ok=True)
            (releases_dir / "psyneulink-0.20.2.0-py3-none-any.whl").write_bytes(b"wheel")
        return _FakeProc(["ok"])

    monkeypatch.setattr(im.subprocess, "Popen", fake_popen)
    manager = im.InstallManager()
    monkeypatch.setattr(im.threading, "Thread", lambda target, args, daemon: type("T", (), {"start": lambda self: None})())

    job = manager.start("pypi", None, None, None, "0.20.2.0")
    assert job.version == "0.20.2.0"
    manager._run(job)
    assert job.status == "succeeded"
    assert [c[1] for c in commands] == ["download", "install"]
    assert commands[0][2:] == ["--no-deps", "--dest", str(releases_dir), "psyneulink==0.20.2.0"]
    # Dependencies resolve normally; PsyNeuLink itself comes from the kept file.
    assert commands[1][1:] == ["install", "--upgrade", "--find-links", str(releases_dir), "psyneulink==0.20.2.0"]
    assert "--no-deps" not in commands[1] and "--no-index" not in commands[1]

    # Switching back: the kept file is used, nothing is downloaded.
    commands.clear()
    job2 = manager.start("pypi", None, None, None, "0.20.2.0")
    manager._run(job2)
    assert job2.status == "succeeded"
    assert [c[1] for c in commands] == ["install"]
    assert any("kept copy" in line for line in job2.log)


def test_a_bad_version_or_a_version_outside_pypi_is_refused():
    manager = im.InstallManager()
    with pytest.raises(ValueError):
        manager.start("pypi", None, None, None, "not-a-version")
    with pytest.raises(ValueError):
        manager.start("github", "devel", None, None, "0.20.2.0")


def test_the_install_endpoint_passes_the_version_through(monkeypatch):
    seen = {}

    class Fake:
        def start(self, source, ref, path, repo=None, version=None):
            seen.update(source=source, version=version)
            return im.InstallJob(id="j", source=source, ref=ref, path=path, repo=repo, version=version)

    monkeypatch.setattr(api_routes, "get_install_manager", lambda: Fake())
    resp = client.post("/api/settings/install", json={"source": "pypi", "version": "0.20.2.0"})
    assert resp.status_code == 200 and resp.json()["version"] == "0.20.2.0"
    assert seen == {"source": "pypi", "version": "0.20.2.0"}


def test_removing_a_kept_release_never_removes_the_one_in_use(releases_dir, monkeypatch):
    releases_dir.mkdir()
    (releases_dir / "psyneulink-0.20.2.0-py3-none-any.whl").write_bytes(b"x")
    (releases_dir / "psyneulink-0.19.1.0-py3-none-any.whl").write_bytes(b"x")
    monkeypatch.setattr(pr, "version_in_use", lambda: "0.20.2.0")

    listed = client.get("/api/locations").json()["keptReleases"]
    assert [(k["version"], k["in_use"]) for k in listed] == [("0.20.2.0", True), ("0.19.1.0", False)]

    resp = client.delete("/api/settings/pnl-releases/0.20.2.0")
    assert resp.status_code == 400 and "in use" in resp.json()["detail"]
    assert (releases_dir / "psyneulink-0.20.2.0-py3-none-any.whl").exists()

    assert client.delete("/api/settings/pnl-releases/0.19.1.0").status_code == 200
    assert not (releases_dir / "psyneulink-0.19.1.0-py3-none-any.whl").exists()
    assert client.delete("/api/settings/pnl-releases/0.19.1.0").status_code == 400
