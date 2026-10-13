"""Whether the installed PsyNeuLink actually works (#1143).

`importlib.metadata` says a package was installed once. It does not say
`import psyneulink` succeeds now, and the gap is not hypothetical: an editable
install keeps its metadata in the venv long after its source folder has moved.
"""

import json
from pathlib import Path

import pytest

from app.services import pnl_health


class FakeDist:
    def __init__(self, version="1.0", direct_url=None):
        self.version = version
        self._direct_url = direct_url

    def read_text(self, name):
        if name == "direct_url.json":
            return self._direct_url
        return None


def editable_at(path) -> str:
    return json.dumps({"dir_info": {"editable": True}, "url": f"file://{path}"})


def test_reports_not_installed_when_there_is_no_package(monkeypatch):
    def boom(_):
        raise pnl_health.PackageNotFoundError

    monkeypatch.setattr(pnl_health, "distribution", boom)
    assert pnl_health.check()["status"] == "not_installed"


def test_a_moved_editable_source_is_named(monkeypatch, tmp_path):
    """The most likely breakage, and the most actionable message.

    Metadata survives the folder going away, so the version keeps reporting
    healthy while every model load fails.
    """
    gone = tmp_path / "PsyNeuLink"
    monkeypatch.setattr(
        pnl_health, "distribution", lambda _: FakeDist(direct_url=editable_at(gone))
    )
    health = pnl_health.check()
    assert health["status"] == "source_missing"
    assert str(gone) in health["detail"]
    assert health["path"] == str(gone)


def test_a_present_editable_source_is_not_flagged(monkeypatch, tmp_path):
    here = tmp_path / "PsyNeuLink"
    here.mkdir()
    monkeypatch.setattr(
        pnl_health, "distribution", lambda _: FakeDist(direct_url=editable_at(here))
    )
    assert pnl_health.check()["status"] == "ok"


def test_an_import_failure_carries_the_real_error(monkeypatch):
    """The actual message, not a summary.

    An ImportError naming a missing dependency is what someone can act on;
    "PsyNeuLink is unavailable" is not.
    """
    monkeypatch.setattr(pnl_health, "distribution", lambda _: FakeDist())
    import builtins

    real_import = builtins.__import__

    def fail(name, *a, **k):
        if name == "psyneulink":
            raise ImportError("No module named 'numpy'")
        return real_import(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", fail)
    health = pnl_health.check()
    assert health["status"] == "import_failed"
    assert "numpy" in health["detail"]


def test_a_source_that_is_gone_is_reported_before_the_import_is_tried(
    monkeypatch, tmp_path
):
    """Order matters: the import would fail anyway, but "the folder is gone,
    here is the path" beats an ImportError."""
    gone = tmp_path / "vanished"
    monkeypatch.setattr(
        pnl_health, "distribution", lambda _: FakeDist(direct_url=editable_at(gone))
    )
    assert pnl_health.check()["status"] == "source_missing"


def test_a_non_editable_install_has_no_path_to_blame(monkeypatch):
    monkeypatch.setattr(pnl_health, "distribution", lambda _: FakeDist())
    assert pnl_health.check()["path"] is None


def test_unreadable_direct_url_does_not_crash_the_check(monkeypatch):
    monkeypatch.setattr(
        pnl_health, "distribution", lambda _: FakeDist(direct_url="{not json")
    )
    # Falls through to the import attempt rather than raising.
    assert pnl_health.check()["status"] in {"ok", "import_failed"}


@pytest.mark.parametrize(
    "status,usable",
    [("ok", True), ("not_installed", False), ("source_missing", False),
     ("import_failed", False)],
)
def test_only_ok_counts_as_usable(status, usable):
    assert pnl_health.is_usable({"status": status, "detail": "", "path": None}) is usable
