"""Deployment mode resolution and its capability table (#1062)."""

import logging

import pytest

from app.services import deployment_mode as dm


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """Every test starts from an undeclared environment."""
    monkeypatch.delenv("PSYNEUVIEW_DEPLOYMENT_MODE", raising=False)
    monkeypatch.delenv("PSYNEUVIEW_MAC_APP", raising=False)


# ── Resolution ───────────────────────────────────────────────────────────


def test_defaults_to_local_when_unset():
    """The default has to be `local`, or every existing install changes
    behavior the moment this ships."""
    assert dm.current_mode() == dm.LOCAL


@pytest.mark.parametrize("mode", dm.VALID_MODES)
def test_each_valid_mode_round_trips(monkeypatch, mode):
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", mode)
    assert dm.current_mode() == mode


def test_value_is_normalized(monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", "  Container \n")
    assert dm.current_mode() == dm.CONTAINER


def test_unrecognized_value_falls_back_to_local(monkeypatch, caplog):
    """A typo in a deploy script should not take the backend down — but it
    must be loud, or the operator thinks they hardened something they didn't."""
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", "kubernetes")
    # app.* loggers are configured with propagate=False (main._configure_app_logging),
    # so caplog's root handler never sees them unless propagation is restored.
    monkeypatch.setattr(logging.getLogger("app"), "propagate", True)
    with caplog.at_level("WARNING", logger="app.services.deployment_mode"):
        assert dm.current_mode() == dm.LOCAL
    assert "kubernetes" in caplog.text


def test_legacy_mac_app_flag_still_resolves(monkeypatch):
    """PSYNEUVIEW_MAC_APP=1 predates this module; anything setting it keeps
    working."""
    monkeypatch.setenv("PSYNEUVIEW_MAC_APP", "1")
    assert dm.current_mode() == dm.MAC_APP


def test_legacy_flag_ignored_unless_exactly_one(monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_MAC_APP", "true")
    assert dm.current_mode() == dm.LOCAL


def test_explicit_mode_beats_legacy_flag(monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_MAC_APP", "1")
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", "container")
    assert dm.current_mode() == dm.CONTAINER


# ── Capability table ─────────────────────────────────────────────────────


def test_every_mode_has_capabilities():
    """A new mode without a row would KeyError at request time."""
    for mode in dm.VALID_MODES:
        assert isinstance(dm.capabilities(mode), dm.Capabilities)


def test_local_can_do_everything():
    caps = dm.capabilities(dm.LOCAL)
    assert caps.install and caps.github_token


def test_mac_app_can_install_like_any_local_client():
    """The Mac app is a conduit for source switching, not an exception to it.

    It used to be refused here and told to use its own Cmd+, Preferences,
    because the app kept a separate record of which PsyNeuLink was wanted and
    reinstalled from it on every update — so anything chosen in the gear icon
    was silently reverted later. The app reads what is installed now instead of
    remembering it, so both windows can drive the same endpoint (#132).

    Loopback still gates the endpoint itself, and the Mac app is loopback.
    """
    caps = dm.capabilities(dm.MAC_APP)
    assert caps.install
    assert caps.github_token


@pytest.mark.parametrize("mode", [dm.CONTAINER, dm.HOSTED])
def test_remote_modes_grant_nothing_privileged(mode):
    """This is the point of the issue: a read-only image can't pip, and the
    operator's GitHub credentials are not a visitor's to borrow."""
    caps = dm.capabilities(mode)
    assert not caps.install
    assert not caps.github_token


def test_capabilities_defaults_to_current_mode(monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", "hosted")
    assert dm.capabilities() == dm.capabilities(dm.HOSTED)


def test_is_remote_splits_local_from_container(monkeypatch):
    assert not dm.is_remote(dm.LOCAL)
    assert not dm.is_remote(dm.MAC_APP)
    assert dm.is_remote(dm.CONTAINER)
    assert dm.is_remote(dm.HOSTED)


def test_capabilities_are_immutable():
    """Frozen so a route can't narrow the table for everyone else."""
    caps = dm.capabilities(dm.LOCAL)
    with pytest.raises(Exception):
        caps.install = False  # type: ignore[misc]
