"""The PsyNeuLink examples' load status survives a restart (#175).

The probe is slow (it loads every example), so its answer is kept on disk
under a key that changes with the source's commit and with the example files
themselves. The probe step is replaced here: these tests are about what is
kept, under which key, and when it is not. There is no run pass.
"""

import json
import os
import threading
from pathlib import Path

from fastapi.testclient import TestClient

from app.api import routes
from app.main import app
from app.services import examples_status, sandbox

client = TestClient(app)


def _examples(tmp_path: Path, *names: str) -> Path:
    d = tmp_path / "Scripts" / "Examples"
    d.mkdir(parents=True)
    for name in names:
        (d / f"{name}.py").write_text(f"# {name}\n")
    return d


def _touch_later(path: Path, seconds: float = 2.0) -> None:
    """Move a file's modification time on, as an edit would."""
    st = path.stat()
    os.utime(path, (st.st_atime, st.st_mtime + seconds))


def _fake_load(monkeypatch, *, during=None, load_error=None):
    """Replace the runner's load step; ``during`` runs inside the first load."""
    calls: list[str] = []

    def load_and_introspect(p, use_sandbox=True, **kw):
        calls.append(Path(p).stem)
        assert sandbox.gives_way(), "the probe must give way to user work"
        if during and len(calls) == 1:
            during()
        if load_error:
            return {"error": load_error, "compositions": []}
        return {"compositions": [{"varName": "comp", "nodes": [{"name": "a"}, {"name": "b"}]}]}

    monkeypatch.setattr(examples_status, "load_and_introspect", load_and_introspect)
    return calls


# ── The key ───────────────────────────────────────────────────────────


def test_key_changes_with_an_edit_a_new_file_or_the_commit(tmp_path):
    d = _examples(tmp_path, "one", "two")
    key = examples_status.fingerprint(d, "abc123")
    assert key == examples_status.fingerprint(d, "abc123")
    assert key != examples_status.fingerprint(d, "abc123.dirty")

    _touch_later(d / "one.py")
    edited = examples_status.fingerprint(d, "abc123")
    assert edited != key

    (d / "helper.py").write_text("# a module an example imports\n")
    assert examples_status.fingerprint(d, "abc123") != edited


# ── Remembering ───────────────────────────────────────────────────────


def test_a_result_is_kept_on_disk_and_found_by_a_fresh_process(tmp_path):
    examples_status.remember("k1", {"one": {"load": "ok", "run": "ok", "nodes": 2}}, "abc123")
    path = Path(os.environ[examples_status.CACHE_DIR_ENV]) / "examples-status.json"
    assert path.is_file()
    assert json.loads(path.read_text())["entries"]["k1"]["commit"] == "abc123"

    examples_status.forget_all()  # as a restart would
    assert examples_status.cached("k1") == {"one": {"load": "ok", "run": "ok", "nodes": 2}}
    assert examples_status.cached("other") is None


def test_the_oldest_results_are_dropped_past_the_cap(monkeypatch):
    monkeypatch.setattr(examples_status, "MAX_ENTRIES", 2)
    for i in range(3):
        examples_status.remember(f"k{i}", {}, None)
    examples_status.forget_all()
    assert examples_status.cached("k0") is None
    assert examples_status.cached("k2") == {}


def test_a_damaged_file_is_treated_as_empty(tmp_path):
    path = examples_status.cache_dir(create=True) / "examples-status.json"
    path.write_text("not json")
    assert examples_status.cached("k1") is None
    examples_status.remember("k1", {}, None)
    assert json.loads(path.read_text())["entries"]["k1"]["status"] == {}


def test_a_file_from_the_old_probe_with_run_marks_is_ignored():
    path = examples_status.cache_dir(create=True) / "examples-status.json"
    path.write_text(json.dumps({"version": 1, "entries": {"k1": {"status": {"one": {"load": "ok", "run": "ok", "nodes": 2}}}}}))
    assert examples_status.cached("k1") is None
    examples_status.remember("k2", {"one": {"load": "ok", "nodes": 2}}, None)
    data = json.loads(path.read_text())
    assert data["version"] == examples_status.FORMAT
    assert "k1" not in data["entries"]


# ── Probing ───────────────────────────────────────────────────────────


def test_the_probe_loads_each_example_once_and_keeps_the_result(tmp_path, monkeypatch):
    d = _examples(tmp_path, "one", "two", "__init__")
    calls = _fake_load(monkeypatch)
    key = examples_status.fingerprint(d, "abc")
    status, complete = examples_status.probe(d, key, "abc")
    assert complete
    assert status == {"one": {"load": "ok", "nodes": 2}, "two": {"load": "ok", "nodes": 2}}
    assert calls == ["one", "two"]
    assert not sandbox.gives_way()
    examples_status.forget_all()
    assert examples_status.cached(key) == status


def test_a_load_failure_is_marked_with_its_first_line(tmp_path, monkeypatch):
    d = _examples(tmp_path, "one")
    _fake_load(monkeypatch, load_error="NameError: x\nmore")
    status, _ = examples_status.probe(d, examples_status.fingerprint(d, None), None)
    assert status["one"] == {"load": "fail", "error": "NameError: x"}


def test_a_probe_whose_files_changed_meanwhile_is_answered_but_not_kept(tmp_path, monkeypatch):
    d = _examples(tmp_path, "one", "two")
    _fake_load(monkeypatch, during=lambda: _touch_later(d / "two.py"))
    key = examples_status.fingerprint(d, "abc")
    status, complete = examples_status.probe(d, key, "abc")
    assert not complete
    assert set(status) == {"one", "two"}
    assert examples_status.cached(key) is None
    assert examples_status.cached(examples_status.fingerprint(d, "abc")) is None


def test_a_probe_the_runner_cut_short_is_not_kept(tmp_path, monkeypatch):
    d = _examples(tmp_path, "one")
    _fake_load(monkeypatch, load_error="Worker process died during execution")
    key = examples_status.fingerprint(d, "abc")
    status, complete = examples_status.probe(d, key, "abc")
    assert not complete
    assert status["one"]["load"] == "fail"
    assert examples_status.cached(key) is None


def test_two_requests_at_once_probe_the_corpus_once(tmp_path, monkeypatch):
    d = _examples(tmp_path, "one")
    started = threading.Event()
    release = threading.Event()

    def during():
        started.set()
        release.wait(5)

    calls = _fake_load(monkeypatch, during=during)
    key = examples_status.fingerprint(d, "abc")
    results = []
    threads = [threading.Thread(target=lambda: results.append(examples_status.probe(d, key, "abc"))) for _ in range(2)]
    for t in threads:
        t.start()
    assert started.wait(5)
    release.set()
    for t in threads:
        t.join(5)
    assert calls == ["one"]
    assert results[0][0] == results[1][0]


# ── The route ─────────────────────────────────────────────────────────


def test_status_route_probes_once_then_answers_from_disk_across_a_restart(tmp_path, monkeypatch):
    d = _examples(tmp_path, "one")
    calls = _fake_load(monkeypatch)
    monkeypatch.setattr(routes, "_pnl_scripts_dir", lambda: d)

    first = client.get("/api/psyneulink-examples/status").json()
    assert first["available"] and first["cached"] is False and first["complete"] is True
    assert first["status"]["one"] == {"load": "ok", "nodes": 2}

    examples_status.forget_all()  # a new launch
    again = client.get("/api/psyneulink-examples/status").json()
    assert again["cached"] is True
    assert again["status"] == first["status"]
    assert calls == ["one"]

    # An edit to an example brings a fresh probe.
    _touch_later(d / "one.py")
    edited = client.get("/api/psyneulink-examples/status").json()
    assert edited["cached"] is False
    assert calls == ["one", "one"]


def test_status_route_without_examples_says_so(monkeypatch):
    monkeypatch.setattr(routes, "_pnl_scripts_dir", lambda: None)
    assert client.get("/api/psyneulink-examples/status").json() == {"status": {}, "available": False}


def test_where_things_live_names_the_cache_folder():
    data = client.get("/api/locations").json()["appData"]
    assert data["cache"] == str(examples_status.cache_dir())
    assert data["cacheFixedBy"] == examples_status.CACHE_DIR_ENV
