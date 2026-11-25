"""Memory, processor-time and process limits for model runs (#179, B3).

Models that allocate without end, spin, or fork over and over are each
stopped, with a plain-English reason, through the warm worker, the fork
server and the pool (and, with ``PSYNEUVIEW_OS_SANDBOX=on``, under the
operating-system sandbox). The limits are lowered for these tests only;
the defaults are generous.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

import pytest

from app.services import run_limits, sandbox
from tests.test_assistant_runner_guard import load, st  # noqa: F401  (st is a fixture)

APPLY = Path(run_limits.__file__).resolve().parent / "os_sandbox_apply.py"


# ── settings and wording ────────────────────────────────────────────────


def test_defaults_are_generous(monkeypatch):
    for env in (run_limits.MEMORY_ENV, run_limits.CPU_ENV, run_limits.PROCESSES_ENV):
        monkeypatch.delenv(env, raising=False)
    lim = run_limits.limits()
    assert lim["memory_mb"] >= 2048
    assert lim["cpu_seconds"] == run_limits.CPU_DEFAULT
    assert lim["processes"] == run_limits.PROCESSES_DEFAULT


@pytest.mark.parametrize("raw,expected", [("1", 2), ("10", 10), ("10000000", 86_400), ("lots", run_limits.CPU_DEFAULT)])
def test_settings_are_bounded(monkeypatch, raw, expected):
    monkeypatch.setenv(run_limits.CPU_ENV, raw)
    assert run_limits.limits()["cpu_seconds"] == expected


def test_memory_and_processes_are_bounded(monkeypatch):
    monkeypatch.setenv(run_limits.MEMORY_ENV, "1")
    monkeypatch.setenv(run_limits.PROCESSES_ENV, "1")
    lim = run_limits.limits()
    assert lim["memory_mb"] == run_limits.MEMORY_BOUNDS_MIN
    assert lim["processes"] == run_limits.PROCESSES_BOUNDS[0]


@pytest.mark.parametrize("error,reason", [
    ("Traceback ...\npsyneuview_os_sandbox_apply.RunLimitExceeded: cpu: the model used up", "cpu"),
    ("Traceback ...\nMemoryError", "memory"),
    ("BlockingIOError: [Errno 35] Resource temporarily unavailable", "processes"),
    ("[Errno 11] Resource temporarily unavailable", "processes"),
])
def test_what_the_worker_leaves_is_explained(error, reason):
    out = run_limits.explain({"error": error})
    assert out["run_limit"] == reason
    assert "the limit for a model run" in out["error"] and "Traceback" not in out["error"]


def test_a_limit_met_by_module_level_code_is_explained_too():
    out = run_limits.explain({"compositions": [{}], "notices": [
        "Non-fatal: model definition loaded, but its module-level driver raised after the no-op'd run: "
        "[Errno 35] Resource temporarily unavailable"]})
    assert out["run_limit"] == "processes"


def test_an_ordinary_error_is_left_alone():
    assert run_limits.explain({"error": "NameError: x"}) == {"error": "NameError: x"}


# ── the worker's own limits, in a bare process ──────────────────────────


def _bare(code: str, lim: dict) -> subprocess.CompletedProcess:
    script = (
        "import importlib.util, json, sys\n"
        f"spec = importlib.util.spec_from_file_location('a', {str(APPLY)!r})\n"
        "a = importlib.util.module_from_spec(spec); spec.loader.exec_module(a)\n"
        f"print(json.dumps(a.apply_run_limits({lim!r})), flush=True)\n"
        f"{code}\n"
    )
    return subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=60)


def test_a_spin_is_stopped_by_the_processor_time_limit():
    t0 = time.time()
    r = _bare("while True: pass", {"cpu_seconds": 2, "processes": 64, "memory_mb": 4096, "hard": True,
                                   "base_processes": None})
    assert "cpu" in json.loads(r.stdout.splitlines()[0])
    assert "RunLimitExceeded: cpu" in r.stderr
    assert time.time() - t0 < 30


@pytest.mark.skipif(sys.platform == "win32", reason="no RLIMIT_NPROC")
def test_forking_over_and_over_is_refused_by_the_process_limit():
    base = run_limits._user_process_count()
    r = _bare(
        "import os, time\n"
        "n = 0\n"
        "try:\n"
        "    while n < 2000:\n"
        "        if os.fork() == 0:\n"
        "            time.sleep(5); os._exit(0)\n"
        "        n += 1\n"
        "except BlockingIOError as e:\n"
        "    print('refused after', n, e)\n",
        {"cpu_seconds": 60, "processes": 16, "memory_mb": 4096, "hard": True, "base_processes": base})
    assert "processes" in json.loads(r.stdout.splitlines()[0])
    assert "refused after" in r.stdout, r.stdout + r.stderr
    assert int(r.stdout.split("refused after")[1].split()[0]) < 200


# ── through the real runner, every way a task can run ───────────────────

HOG = (
    "import time\n"
    "blocks = []\n"
    "for _ in range(64):  # at most 4 GB, if nothing stopped it\n"
    "    blocks.append(bytearray(b'x' * (64 << 20)))\n"
    "    time.sleep(0.05)\n"
)
SPIN = "while True:\n    pass\n"
FORKS = (
    "import os, time\n"
    "for _ in range(400):\n"
    "    if os.fork() == 0:\n"
    "        time.sleep(15)\n"
    "        os._exit(0)\n"
    "    time.sleep(0.01)\n"
    "time.sleep(15)\n"
)
MODELS = {"memory": HOG, "cpu": SPIN, "processes": FORKS}


@pytest.fixture
def low_limits(monkeypatch):
    monkeypatch.setenv(run_limits.MEMORY_ENV, "1536")  # above a warm worker that has run many models
    monkeypatch.setenv(run_limits.CPU_ENV, "4")
    monkeypatch.setenv(run_limits.PROCESSES_ENV, "16")
    yield


def _hostile(folder: Path, what: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    model = folder / f"too_much_{what}.py"
    model.write_text(MODELS[what] + "import psyneulink as pnl\ncomp = pnl.Composition(name='c')\n")
    return model


def _stopped_for(r, what: str) -> None:
    assert r.status_code != 200, (r.json().get("model") or {}).get("error") or r.text[:500]
    text = r.text
    assert "the limit for a model run" in text, text[:2000]
    word = {"memory": "of memory", "cpu": "processor time", "processes": "too many processes"}[what]
    assert word in text, text[:2000]


@pytest.mark.parametrize("what", sorted(MODELS))
def test_the_warm_worker_stops_a_model_over_a_limit(low_limits, tmp_path, what):
    t0 = time.time()
    r = load(_hostile(tmp_path / "Own", what))
    _stopped_for(r, what)
    assert time.time() - t0 < 60
    # And the next model runs as usual.
    ok = tmp_path / "Own" / "fine.py"
    ok.write_text("import psyneulink as pnl\ncomp = pnl.Composition(name='fine')\n")
    assert load(ok).status_code == 200


@pytest.mark.parametrize("mode", ["fork", "pool"])
@pytest.mark.parametrize("what", sorted(MODELS))
def test_a_fresh_process_per_task_stops_a_model_over_a_limit(low_limits, st, mode, what):
    st["monkeypatch"].setenv("PSYNEUVIEW_WORKER_ISOLATION", mode)
    t0 = time.time()
    r = load(_hostile(st["tmp"] / "Own", what))
    _stopped_for(r, what)
    assert time.time() - t0 < 60


def test_the_one_shot_fallback_stops_a_spin(low_limits, tmp_path):
    result = sandbox._run_cold("introspect", {"file_path": str(_hostile(tmp_path / "Own", "cpu"))}, 60)
    assert result.get("run_limit") == "cpu", result


def test_the_sandboxed_converter_stops_a_spin(low_limits, tmp_path):
    from app.services import os_sandbox
    from tests.test_assistant_runner_guard import client
    if not os_sandbox.active():
        pytest.skip("the converter runs in its own process only under the sandbox (PSYNEUVIEW_OS_SANDBOX=on)")
    model = _hostile(tmp_path / "Own", "cpu")
    t0 = time.time()
    r = client.post("/api/model/convert", json={"file_path": str(model), "backup": False})
    assert r.status_code == 422 and r.json()["limit"] == "cpu", r.text[:400]
    assert time.time() - t0 < 60
