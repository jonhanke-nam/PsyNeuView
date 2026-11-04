"""The page's activity log on disk (#177): batches appended as sent, the
file rotated at start so the previous launch is kept, a size cap, and
the actions removed when action logging is turned off.

Every test writes under a temporary folder: the module follows the
redirected preferences file (conftest sets it) unless told otherwise.
"""

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import activity_log

_client = TestClient(app)


@pytest.fixture(autouse=True)
def _own_folder(monkeypatch, tmp_path):
    monkeypatch.setenv(activity_log.ACTIVITY_LOG_DIR_ENV, str(tmp_path / "activity-log"))
    return tmp_path / "activity-log"


def _entry(t, kind, text, **data):
    return {"t": t, "kind": kind, "text": text, **({"data": data} if data else {})}


def test_the_folder_follows_the_redirected_preferences_file(monkeypatch, tmp_path):
    monkeypatch.delenv(activity_log.ACTIVITY_LOG_DIR_ENV)
    monkeypatch.setenv("PSYNEUVIEW_CONFIG_FILE", str(tmp_path / "prefs.json"))
    assert activity_log.activity_log_dir(create=False) == tmp_path / "activity-log"
    monkeypatch.delenv("PSYNEUVIEW_CONFIG_FILE")
    assert activity_log.activity_log_dir(create=False) == activity_log.default_dir()
    assert activity_log.default_dir().name == "activity-log"
    assert activity_log.default_dir().parent.name == ".psyneuview"


def test_batches_are_appended_as_sent_with_the_page_id(_own_folder):
    r = _client.post("/api/activity-log", json={"page": "p1", "entries": [
        _entry("2026-11-03T09:14:19.779Z", "menu", "Open › Open from path…", where="Open"),
        _entry("2026-11-03T09:14:20.000Z", "wait", "GET /api/model/load", label="GET /api/model/load", outcome="ok"),
        "not an entry",
        {"kind": "menu"},  # no time, no text
    ]})
    assert r.status_code == 200 and r.json() == {"kept": 2}
    lines = (_own_folder / "current.jsonl").read_text().splitlines()
    assert [json.loads(line) for line in lines] == [
        {"t": "2026-11-03T09:14:19.779Z", "kind": "menu", "text": "Open › Open from path…", "page": "p1",
         "data": {"where": "Open"}},
        {"t": "2026-11-03T09:14:20.000Z", "kind": "wait", "text": "GET /api/model/load", "page": "p1",
         "data": {"label": "GET /api/model/load", "outcome": "ok"}},
    ]
    saved = _client.get("/api/activity-log").json()
    assert [e["text"] for e in saved["current"]] == ["Open › Open from path…", "GET /api/model/load"]
    assert saved["previous"] == []
    assert saved["path"] == str(_own_folder)


def test_a_batch_without_a_page_or_too_big_is_refused():
    assert _client.post("/api/activity-log", json={"page": "", "entries": []}).status_code == 400
    too_many = [_entry("2026-11-03T09:14:19.779Z", "menu", "x")] * (activity_log.MAX_ENTRIES_PER_BATCH + 1)
    assert _client.post("/api/activity-log", json={"page": "p", "entries": too_many}).status_code == 400
    # A runaway entry is left out, the rest kept.
    r = _client.post("/api/activity-log", json={"page": "p", "entries": [
        _entry("2026-11-03T09:14:19.779Z", "error", "x" * 10_000),
        _entry("2026-11-03T09:14:19.779Z", "error", "short"),
    ]})
    assert r.json() == {"kept": 2}
    texts = [e["text"] for e in activity_log.read()["current"]]
    assert texts[1] == "short" and len(texts[0]) == activity_log.MAX_TEXT_LENGTH


def test_the_previous_launch_is_kept_at_the_next_start(_own_folder):
    activity_log.append("p1", [_entry("2026-11-03T09:00:00.000Z", "menu", "first launch")])
    activity_log.start_launch()
    assert not (_own_folder / "current.jsonl").exists()
    activity_log.append("p2", [_entry("2026-11-03T10:00:00.000Z", "menu", "second launch")])
    saved = activity_log.read()
    assert [e["text"] for e in saved["previous"]] == ["first launch"]
    assert [e["text"] for e in saved["current"]] == ["second launch"]
    # A start whose current file is empty (a launch that never got a page)
    # keeps the previous one as it is, rather than wiping it.
    (_own_folder / "current.jsonl").write_text("")
    activity_log.start_launch()
    activity_log.start_launch()
    assert [e["text"] for e in activity_log.read()["previous"]] == ["first launch"]
    assert not (_own_folder / "current.jsonl").exists()


def test_the_file_is_capped(monkeypatch, _own_folder):
    monkeypatch.setattr(activity_log, "MAX_BYTES", 4000)
    monkeypatch.setattr(activity_log, "TARGET_BYTES", 2000)
    for i in range(100):
        activity_log.append("p", [_entry("2026-11-03T09:00:00.000Z", "menu", f"entry {i:03d} " + "x" * 60)])
    size = (_own_folder / "current.jsonl").stat().st_size
    assert size <= 4000
    entries = activity_log.read()["current"]
    assert entries[-1]["text"].startswith("entry 099")
    assert all(line.startswith("{") for line in (_own_folder / "current.jsonl").read_text().splitlines())


def test_turning_action_logging_off_removes_the_actions_from_both_files(_own_folder):
    activity_log.append("p1", [
        _entry("2026-11-03T09:00:00.000Z", "menu", "old action"),
        _entry("2026-11-03T09:00:01.000Z", "error", "old error"),
    ])
    activity_log.start_launch()
    activity_log.append("p2", [
        _entry("2026-11-03T10:00:00.000Z", "click", "Toolbar › Save"),
        _entry("2026-11-03T10:00:01.000Z", "wait", "POST /api/model/save"),
        _entry("2026-11-03T10:00:02.000Z", "canvas", "Selected node a"),
    ])
    r = _client.post("/api/activity-log/remove", json={"kinds": ["menu", "click", "canvas", "edit", "step"]})
    assert r.json() == {"removed": 3}
    saved = activity_log.read()
    assert [e["text"] for e in saved["previous"]] == ["old error"]
    assert [e["text"] for e in saved["current"]] == ["POST /api/model/save"]
    assert _client.post("/api/activity-log/remove", json={"kinds": "menu"}).status_code == 422


def test_a_bad_line_in_the_file_is_skipped(_own_folder):
    (_own_folder).mkdir(exist_ok=True)
    (_own_folder / "current.jsonl").write_text('{"t":"x","kind":"menu","text":"ok"}\nnot json\n[1]\n')
    assert [e["text"] for e in activity_log.read()["current"]] == ["ok"]
