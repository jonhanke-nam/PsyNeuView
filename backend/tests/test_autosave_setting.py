"""The autosave setting (#1347): stored with the other app preferences, off by
default, and refused outside 2–600 seconds.

The saving itself is the page's (it sends the same request as Save); this
checks only that the choice is remembered and validated.
"""

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import app_settings
from app.services.app_config import CONFIG_ENV

_client = TestClient(app)


@pytest.fixture(autouse=True)
def _isolated_config(monkeypatch, tmp_path):
    monkeypatch.setenv(CONFIG_ENV, str(tmp_path / "config.json"))
    return tmp_path / "config.json"


def test_off_by_default():
    assert app_settings.get_autosave() == {"enabled": False, "seconds": 10}
    assert _client.get("/api/settings/autosave").json() == {"enabled": False, "seconds": 10}


def test_turn_on_and_change_delay_separately(_isolated_config):
    r = _client.post("/api/settings/autosave", json={"enabled": True})
    assert r.json() == {"enabled": True, "seconds": 10}
    r = _client.post("/api/settings/autosave", json={"seconds": 30})
    assert r.json() == {"enabled": True, "seconds": 30}
    # Persisted in the shared preferences file, beside the other settings.
    stored = json.loads(_isolated_config.read_text())
    assert stored["autosave"] == {"enabled": True, "seconds": 30}
    assert _client.post("/api/settings/autosave", json={"enabled": False}).json() == {
        "enabled": False,
        "seconds": 30,
    }


@pytest.mark.parametrize("seconds", [0, 1, 601, 10_000])
def test_rejects_out_of_range_seconds(seconds):
    r = _client.post("/api/settings/autosave", json={"seconds": seconds})
    assert r.status_code == 400
    assert app_settings.get_autosave()["seconds"] == 10


def test_bounds_are_accepted():
    assert _client.post("/api/settings/autosave", json={"seconds": 2}).json()["seconds"] == 2
    assert _client.post("/api/settings/autosave", json={"seconds": 600}).json()["seconds"] == 600


def test_hand_edited_garbage_reads_as_defaults(_isolated_config):
    _isolated_config.write_text(json.dumps({"autosave": {"enabled": "yes", "seconds": 1}}))
    assert app_settings.get_autosave() == {"enabled": False, "seconds": 10}


def test_keeps_other_preferences(_isolated_config):
    app_settings.set_default_placement("lateral")
    app_settings.set_autosave(enabled=True)
    assert app_settings.get_default_placement() == "lateral"
    assert app_settings.get_autosave()["enabled"] is True
