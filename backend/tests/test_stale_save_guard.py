"""Saving must not discard a change that arrived after we loaded (#926).

Live sync (#1026) tells the editor as soon as the file changes, and that
handles the common case. But it is a notification, not a guarantee: the watcher
may not be running, the socket may have dropped, the backend may have
restarted, or the machine may have slept through the change.

This is the check that does not depend on having been told. The client sends
what it believes is on disk; if the file says otherwise, the write is refused
and the file is left alone.

The failure being prevented is silent — PyCharm's work vanishes and nothing
says so — which is why the assertions check the file's *contents* after a
refused save, not just the status code.
"""

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

ORIGINAL = "x = 1\n"
THEIRS = "x = 1\n# written in PyCharm\n"
MINE = "x = 2\n"


def _model(tmp_path: Path, body: str = ORIGINAL) -> Path:
    p = tmp_path / "model.py"
    p.write_text(body)
    return p


def test_refuses_to_overwrite_a_change_that_landed_after_we_loaded(tmp_path):
    p = _model(tmp_path)
    p.write_text(THEIRS)  # PyCharm saved; our buffer still believes ORIGINAL

    resp = client.post(
        "/api/model/save-source",
        json={"file_path": str(p), "source": MINE, "base_source": ORIGINAL},
    )

    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"]["reason"] == "stale_buffer"
    # The point of the whole exercise: their work is still on disk.
    assert p.read_text() == THEIRS


def test_the_conflict_carries_what_is_on_disk_so_the_user_can_choose(tmp_path):
    p = _model(tmp_path)
    p.write_text(THEIRS)

    detail = client.post(
        "/api/model/save-source",
        json={"file_path": str(p), "source": MINE, "base_source": ORIGINAL},
    ).json()["detail"]

    assert detail["disk_source"] == THEIRS
    assert detail["file_path"] == str(p)
    # Shaped like an external-change payload so the existing prompt can show it.
    assert "disk_model" in detail


def test_saving_against_the_current_contents_still_writes(tmp_path):
    p = _model(tmp_path)

    resp = client.post(
        "/api/model/save-source",
        json={"file_path": str(p), "source": MINE, "base_source": ORIGINAL},
    )

    assert resp.status_code == 200, resp.text
    assert p.read_text() == MINE


def test_an_unchanged_file_is_not_a_conflict(tmp_path):
    """Re-saving identical text must not trip the guard."""
    p = _model(tmp_path)
    resp = client.post(
        "/api/model/save-source",
        json={"file_path": str(p), "source": ORIGINAL, "base_source": ORIGINAL},
    )
    assert resp.status_code == 200, resp.text


def test_omitting_the_base_means_overwrite(tmp_path):
    """Callers that genuinely mean "write this" keep working, as do old clients."""
    p = _model(tmp_path)
    p.write_text(THEIRS)

    resp = client.post(
        "/api/model/save-source", json={"file_path": str(p), "source": MINE}
    )

    assert resp.status_code == 200, resp.text
    assert p.read_text() == MINE


def test_a_conflict_on_a_file_that_no_longer_parses_is_still_reported(tmp_path):
    """A broken file on disk must not turn the conflict into a 500."""
    p = _model(tmp_path)
    p.write_text("def (\n")  # not valid Python

    resp = client.post(
        "/api/model/save-source",
        json={"file_path": str(p), "source": MINE, "base_source": ORIGINAL},
    )

    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"]["disk_source"] == "def (\n"
    assert p.read_text() == "def (\n"
