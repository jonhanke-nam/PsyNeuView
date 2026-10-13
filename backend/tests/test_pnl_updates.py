"""Keeping PsyNeuLink current (#1304): the schedule, the check, an update
ready for the next start, and the start-time install that keeps the current
install when it fails. Everything here is offline: the freshness check and
the release list are stand-ins, and the install manager is a fake whose job
ends however the test says."""

import time

import pytest
from fastapi.testclient import TestClient

from app.api import routes as api_routes
from app.main import app
from app.services import pnl_updates as pu

client = TestClient(app)

DEVEL = {
    "version": "0.20.2.0+260.g7a86e22", "source": "github", "branch": "devel",
    "repo": "PrincetonUniversity/PsyNeuLink", "commit": "7a86e22", "path": "/x/sources/PsyNeuLink-PrincetonUniversity",
}
PYPI = {"version": "0.20.2.0", "source": "pypi", "branch": None, "repo": None, "commit": None, "path": None}
CHECKOUT = {**DEVEL, "source": "editable", "path": "/Users/me/code/PsyNeuLink"}


def behind(n: int, head: str = "9ce038f"):
    def fresh(repo, branch, version, commit=None):
        status = "behind" if n else "current"
        return {
            "status": status, "behind_by": n, "installed_commit": commit, "head_commit": head,
            "head_date": "2026-10-06T18:02:00Z", "detail": f"{n} commits behind {branch}." if n else f"Up to date with {branch}.",
        }
    return fresh


class TestSchedule:
    def test_the_interval_is_four_hours_in_one_place(self):
        assert pu.CHECK_INTERVAL_S == 4 * 60 * 60

    def test_never_checked_is_due_now(self):
        assert pu.is_due(None, now=1000.0)
        assert pu.seconds_until_due(None, now=1000.0) == 0.0

    def test_due_once_the_interval_has_passed(self):
        assert not pu.is_due(1000.0, now=1000.0 + pu.CHECK_INTERVAL_S - 1)
        assert pu.is_due(1000.0, now=1000.0 + pu.CHECK_INTERVAL_S)
        assert pu.seconds_until_due(1000.0, now=1000.0 + 3600) == pu.CHECK_INTERVAL_S - 3600


class TestNewerRelease:
    def test_compares_versions_not_strings(self):
        assert pu.newer_release_available("0.20.2.0", "0.21.0.0")
        assert not pu.newer_release_available("0.21.0.0", "0.20.2.0")
        assert pu.newer_release_available("0.9.0.0", "0.10.0.0")  # "0.9" > "0.10" as strings
        assert not pu.newer_release_available("0.20.2.0", "0.20.2.0")

    def test_unknown_means_no(self):
        assert not pu.newer_release_available(None, "0.21.0.0")
        assert not pu.newer_release_available("0.20.2.0", None)
        assert not pu.newer_release_available("garbage", "0.21.0.0")


class TestCheckNow:
    def test_a_branch_install_behind_is_marked_ready_when_auto_update_is_on(self):
        assert pu.auto_update_enabled() is True  # the default
        st = pu.check_now(info=DEVEL, now=1_000.0, freshness=behind(3))
        assert st["last_check_at"] == 1_000.0
        assert st["last_result"]["freshness"]["behind_by"] == 3
        assert st["update_ready"] is True
        assert st["ready_commit"] == "9ce038f"
        # The short form the Mac app's report reads.
        s = pu.summary()
        assert s["status"] == "behind" and s["behind_by"] == 3 and s["update_ready"] is True

    def test_up_to_date_is_not_ready(self):
        st = pu.check_now(info=DEVEL, freshness=behind(0))
        assert st["update_ready"] is False
        assert st["last_result"]["freshness"]["status"] == "current"

    def test_auto_update_off_checks_but_never_marks_ready(self):
        pu.set_auto_update(False)
        st = pu.check_now(info=DEVEL, freshness=behind(5))
        assert st["last_result"]["freshness"]["behind_by"] == 5
        assert st["update_ready"] is False

    def test_turning_auto_update_off_unmarks_a_ready_update(self):
        pu.check_now(info=DEVEL, freshness=behind(3))
        assert pu.state()["update_ready"]
        pu.set_auto_update(False)
        assert pu.state()["update_ready"] is False
        assert pu.status(info=DEVEL)["auto_update"] is False

    def test_a_checkout_is_checked_but_never_updated_here(self):
        # A checkout has its own pull in Developer; the automatic update is
        # only for the managed Latest development install.
        st = pu.check_now(info=CHECKOUT, freshness=behind(2))
        assert st["last_result"]["freshness"]["behind_by"] == 2
        assert st["update_ready"] is False

    def test_an_official_release_reports_a_newer_release_and_never_switches(self):
        st = pu.check_now(info=PYPI, freshness=behind(9), newest_release=lambda: ("0.21.0.0", False))
        result = st["last_result"]
        assert result["newest_release"] == "0.21.0.0"
        assert result["release_available"] is True
        assert result["freshness"]["status"] == "not_applicable"
        assert st["update_ready"] is False
        newest = pu.check_now(info=PYPI, newest_release=lambda: ("0.20.2.0", False))
        assert newest["last_result"]["release_available"] is False

    def test_status_reads_ready_only_for_the_same_branch_install(self):
        pu.check_now(info=DEVEL, freshness=behind(3))
        assert pu.status(info=DEVEL)["update_ready"] is True
        # Switched to a fork since: the ready update was for another branch.
        assert pu.status(info={**DEVEL, "repo": "jonhanke-nam/PsyNeuLink"})["update_ready"] is False
        assert pu.status(info=PYPI)["update_ready"] is False


class TestShouldInstallAtStart:
    def ready(self):
        pu.check_now(info=DEVEL, freshness=behind(3))
        return pu.state()

    def test_installs_a_ready_update_for_the_branch_still_in_use(self):
        assert pu.should_install_at_start(self.ready(), DEVEL, auto_update=True)

    def test_not_when_auto_update_is_off_or_nothing_is_ready(self):
        assert not pu.should_install_at_start(self.ready(), DEVEL, auto_update=False)
        nothing = {"last_check_at": None, "last_result": None, "update_ready": False, "ready_commit": None, "last_install": None}
        assert not pu.should_install_at_start(nothing, DEVEL, auto_update=True)

    def test_not_when_the_install_changed_since(self):
        st = self.ready()
        assert not pu.should_install_at_start(st, PYPI, auto_update=True)
        assert not pu.should_install_at_start(st, {**DEVEL, "branch": "master"}, auto_update=True)
        assert not pu.should_install_at_start(st, {**DEVEL, "repo": "jonhanke-nam/PsyNeuLink"}, auto_update=True)

    def test_not_when_already_at_the_ready_commit(self):
        st = self.ready()
        assert not pu.should_install_at_start(st, {**DEVEL, "commit": "9ce038f"}, auto_update=True)
        assert not pu.should_install_at_start(st, {**DEVEL, "commit": "9ce038ffa1"}, auto_update=True)


class FakeJob:
    def __init__(self, status, log=()):
        self.id = "job-fake"
        self.status = status
        self.log = list(log)


class FakeManager:
    """Stands in for install_manager.InstallManager: records the request,
    and its job is already finished however the test says."""

    def __init__(self, status="succeeded", log=(), raises=None):
        self.calls = []
        self._status = status
        self._log = log
        self._raises = raises

    def start(self, source, ref, path, repo=None, version=None):
        self.calls.append({"source": source, "ref": ref, "path": path, "repo": repo, "version": version})
        if self._raises:
            raise self._raises
        return FakeJob(self._status, self._log)


class TestInstallReadyUpdate:
    def test_installs_through_the_one_install_mechanism_and_records_success(self):
        pu.check_now(info=DEVEL, freshness=behind(3))
        manager = FakeManager("succeeded")
        record = pu.install_ready_update(manager, info=DEVEL, after_info=lambda: {**DEVEL, "commit": "9ce038f"})
        # The same request Settings' Apply & restart would post for Latest development.
        assert manager.calls == [{"source": "github", "ref": "devel", "path": None, "repo": "PrincetonUniversity/PsyNeuLink", "version": None}]
        assert record["outcome"] == "succeeded"
        assert record["from_commit"] == "7a86e22" and record["to_commit"] == "9ce038f"
        st = pu.state()
        assert st["last_install"]["outcome"] == "succeeded"
        assert st["update_ready"] is False

    def test_a_failed_install_keeps_the_current_install_and_is_recorded(self):
        pu.check_now(info=DEVEL, freshness=behind(3))
        manager = FakeManager("failed", log=["$ git fetch", "fatal: unable to access"])
        reads = []

        def after():
            reads.append(1)
            return {**DEVEL, "commit": "changed?"}

        record = pu.install_ready_update(manager, info=DEVEL, after_info=after)
        assert record["outcome"] == "failed"
        assert "unable to access" in record["detail"]
        assert record["to_commit"] is None and reads == []  # nothing claimed to have changed
        st = pu.state()
        assert st["last_install"]["outcome"] == "failed"
        # Unmarked, so a failing update doesn't retry on every start; the next
        # check marks it ready again if it is still behind.
        assert st["update_ready"] is False
        assert pu.summary()["last_install"]["outcome"] == "failed"

    def test_an_install_that_cannot_start_is_a_failure_not_a_crash(self):
        pu.check_now(info=DEVEL, freshness=behind(3))
        record = pu.install_ready_update(FakeManager(raises=RuntimeError("An install is already running")), info=DEVEL)
        assert record["outcome"] == "failed"
        assert "already running" in record["detail"]

    def test_run_at_start_does_nothing_in_the_test_harness(self, monkeypatch):
        monkeypatch.setenv("PSYNEWVIEW_TEST_MODE", "1")
        assert pu.checks_enabled() is False
        pu.run_at_start()  # no scheduler, no install
        assert pu._scheduler is None

    def test_checks_can_be_switched_off_by_environment(self, monkeypatch):
        monkeypatch.delenv("PSYNEWVIEW_TEST_MODE", raising=False)
        monkeypatch.setenv(pu.ENABLE_ENV, "0")
        assert pu.checks_enabled() is False


class TestScheduler:
    def test_ticks_at_start_then_every_interval_until_stopped(self):
        ticks = []
        s = pu.Scheduler(lambda: ticks.append(time.monotonic()), interval_s=0.05)
        s.start()
        deadline = time.monotonic() + 2.0
        while len(ticks) < 3 and time.monotonic() < deadline:
            time.sleep(0.01)
        s.stop()
        assert len(ticks) >= 3

    def test_a_failing_tick_does_not_end_the_schedule(self):
        ticks = []

        def tick():
            ticks.append(1)
            raise RuntimeError("boom")

        s = pu.Scheduler(tick, interval_s=0.02)
        s.start()
        deadline = time.monotonic() + 2.0
        while len(ticks) < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        s.stop()
        assert len(ticks) >= 2


@pytest.fixture
def loopback(monkeypatch):
    monkeypatch.setattr(api_routes, "_is_loopback", lambda request: True)


class TestRoutes:
    def test_status_and_check_now_and_the_switch(self, loopback, monkeypatch):
        monkeypatch.setattr(pu.pnl_freshness, "check", behind(4))
        from app.services import settings_info
        monkeypatch.setattr(settings_info, "get_psyneulink_info", lambda: DEVEL)

        before = client.get("/api/settings/pnl-updates").json()
        assert before["auto_update"] is True and before["interval_s"] == pu.CHECK_INTERVAL_S
        assert before["last_check_at"] is None and before["update_ready"] is False
        assert "checkouts" in before

        after = client.post("/api/settings/pnl-updates/check").json()
        assert after["last_result"]["freshness"]["behind_by"] == 4
        assert after["update_ready"] is True

        off = client.post("/api/settings/pnl-updates/auto-update", json={"enabled": False}).json()
        assert off["auto_update"] is False and off["update_ready"] is False

        # The summary rides along in /settings/info for Report a Problem.
        info = client.get("/api/settings/info").json()
        assert info["updates"]["status"] == "behind" and info["updates"]["behind_by"] == 4
        assert info["updates"]["auto_update"] is False

    def test_the_switch_is_gated_like_install(self, monkeypatch):
        monkeypatch.setattr(api_routes, "_is_loopback", lambda request: False)
        r = client.post("/api/settings/pnl-updates/auto-update", json={"enabled": False})
        assert r.status_code == 403
