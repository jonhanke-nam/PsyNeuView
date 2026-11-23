"""The runner's own enforcement of the review state (#179, #187).

The second re-check found that a queued Learn job started the sandbox
worker outside ``run_in_sandbox``, so nothing checked the model. The class
of bug, a route that starts a worker or executes model code without the
guard, is closed in three ways, each tested here with a marker file that
never appears:

* every way of starting a worker carries the review state, and the job
  route answers the 409 at once;
* the worker checks the model's path itself, whatever started it, finding
  the default state path when the task names none;
* a test fails if a new spawn of the worker or a new ``exec_module``
  appears in ``backend/app`` outside the listed, guarded sites.

Plus the narrower gaps from the same re-check: a tracked path under a
``site-packages`` name, a helper loaded by path, a finder a model added
earlier, the in-process stale cache, and a PsyNeuLink checkout that must
not be purged and re-imported on every task.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import jobs as job_service
from app.services.assistant import files, import_guard, review
from app.services.introspector import load_and_introspect
from app.services.sandbox import WORKER_PATH

client = TestClient(app, base_url="http://127.0.0.1:8000", headers={"origin": "http://127.0.0.1:8000"})

APP_DIR = Path(__file__).resolve().parents[1] / "app"


def marker_model(marker, extra: str = "") -> str:
    return (
        "from pathlib import Path\n"
        f"Path({str(marker)!r}).write_text('ran')\n"
        f"{extra}"
        "import psyneulink as pnl\n"
        "comp = pnl.Composition(name='poc')\n"
    )


def learnable_model(marker) -> str:
    """A model a Learn job can train, which also writes a marker when it runs."""
    return (
        "from pathlib import Path\n"
        f"Path({str(marker)!r}).write_text('ran')\n"
        "import psyneulink as pnl\n"
        "a = pnl.TransferMechanism(name='a', input_shapes=2)\n"
        "b = pnl.TransferMechanism(name='b', input_shapes=2)\n"
        "comp = pnl.Composition(name='comp')\n"
        "comp.add_backpropagation_learning_pathway([a, b])\n"
    )


def _helper(marker) -> str:
    return f"from pathlib import Path\nPath({str(marker)!r}).write_text('ran')\nimport psyneulink as pnl\n"


def _model_importing(statements: str) -> str:
    return (
        "import sys, os\n"
        "sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))\n"
        f"{statements}\n"
        "import psyneulink as pnl\n"
        "comp = pnl.Composition(name='h2')\n"
    )


def unreviewed(r) -> bool:
    return r.status_code == 409 and r.json().get("reason") == review.REASON


def load(path):
    return client.post("/api/model/load", json={"file_path": str(path)})


def approve(path):
    shown = client.post("/api/assistant/review/status", json={"path": str(path)}).json()
    r = client.post("/api/assistant/review/approve", json={"path": str(path), "content_hash": shown["content_hash"]})
    assert r.status_code == 200, r.text


@pytest.fixture
def st(tmp_path, monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_PREVIEW_ROOT", str(tmp_path / "previews"))
    models = tmp_path / "Models"
    models.mkdir()
    marker = tmp_path / "ran.txt"
    text = marker_model(marker)
    agent_file = models / "assistant_wrote.py"
    agent_file.write_text(text)
    review.mark_unreviewed(str(agent_file), text)
    return dict(models=models, marker=marker, text=text, agent_file=agent_file, tmp=tmp_path, monkeypatch=monkeypatch)


def _wait_job(job_id: str, seconds: float = 120) -> dict:
    deadline = time.time() + seconds
    while time.time() < deadline:
        snap = client.get(f"/api/jobs/{job_id}").json()
        if snap.get("status") in ("done", "error", "canceled"):
            return snap
        time.sleep(0.2)
    raise AssertionError("job never finished")


def _job_body(path) -> dict:
    return {"kind": "learn", "file_path": str(path), "composition_name": "comp",
            "inputs": {"a": [[0.1, 0.2]]}, "targets": {"b": [[0.0, 1.0]]}, "epochs": 1}


# ── 1. jobs ──────────────────────────────────────────────────────────────


def test_a_queued_job_cannot_run_an_unreviewed_model(st):
    model = st["models"] / "learn_me.py"
    text = learnable_model(st["marker"])
    model.write_text(text)
    review.mark_unreviewed(str(model), text)
    assert unreviewed(load(model))
    before = {j["id"] for j in client.get("/api/jobs").json().get("jobs", [])} if client.get("/api/jobs").status_code == 200 else set()
    r = client.post("/api/jobs", json=_job_body(model))
    assert unreviewed(r), r.text
    assert r.json()["path"] == str(model)
    assert job_service.job_manager.active_job() is None
    after = {j["id"] for j in client.get("/api/jobs").json().get("jobs", [])} if client.get("/api/jobs").status_code == 200 else set()
    assert after == before
    time.sleep(0.5)
    assert not st["marker"].exists()


def test_a_normal_learn_job_for_the_users_own_file_works_as_before(st):
    model = st["tmp"] / "Own" / "mine.py"
    model.parent.mkdir()
    marker = st["tmp"] / "mine_ran.txt"
    model.write_text(learnable_model(marker))
    r = client.post("/api/jobs", json=_job_body(model))
    assert r.status_code == 200, r.text
    snap = _wait_job(r.json()["job"]["id"] if "job" in r.json() else r.json()["id"])
    assert snap["status"] == "done", snap
    assert marker.exists()


def test_a_direct_worker_task_with_no_review_state_is_still_refused(st, monkeypatch):
    """An old or direct caller that sends no review_state: the worker finds
    the default state path itself and checks the model's own path."""
    env = {**os.environ, "PSYNEUVIEW_ASSISTANT_REVIEW_FILE": str(review.state_path())}
    payload = json.dumps({"task": "introspect", "params": {"file_path": str(st["agent_file"])}})
    proc = subprocess.run([sys.executable, WORKER_PATH], input=payload, capture_output=True, text=True, env=env, timeout=300)
    assert proc.returncode == 0, proc.stderr[-2000:]
    result = json.loads(proc.stdout.split("###PSYNEUVIEW_RESULT###")[-1].strip())
    assert result.get("unreviewed_import") == str(st["agent_file"].resolve()), result
    assert not st["marker"].exists()


def test_a_direct_worker_task_with_unreadable_state_fails_closed(st):
    review.state_path().write_text("{not json")
    review.backup_path().write_text("{not json either")
    env = {**os.environ, "PSYNEUVIEW_ASSISTANT_REVIEW_FILE": str(review.state_path())}
    own = st["tmp"] / "own.py"
    own.write_text(marker_model(st["tmp"] / "own_ran.txt"))
    payload = json.dumps({"task": "introspect", "params": {"file_path": str(own)}})
    proc = subprocess.run([sys.executable, WORKER_PATH], input=payload, capture_output=True, text=True, env=env, timeout=300)
    result = json.loads(proc.stdout.split("###PSYNEUVIEW_RESULT###")[-1].strip())
    assert result.get("unreviewed_state") is True, result
    assert not (st["tmp"] / "own_ran.txt").exists()


def test_every_spawn_and_exec_site_is_listed():
    """A tripwire for reviewers, not a boundary: a new way of starting a
    process or executing code in ``backend/app``, under any of the spellings
    below, changes a count here and fails, so a reviewer looks at it and
    either adds its guard or lists it. Exact counts of matching lines per
    file (import statements and the WORKER_PATH definition set aside), so a
    second site in a listed file is caught too. Existing sites that aren't
    model execution (git, pip, the Keychain's ``security`` tool, the keyword
    ``eval`` of a parameter) are listed by count for the same reason.
    """
    allowed = {
        # file: (process starts, code loads)
        "api/routes.py": (1, 0),                 # git (subprocess.check_output)
        "services/assistant/keys.py": (3, 0),    # the Keychain's `security` tool
        "services/checkout_updates.py": (1, 0),  # git
        "services/clone_manager.py": (3, 0),     # git
        "services/converter.py": (0, 2),         # in-process load (spec + exec_module): require_runnable + guard_imports()
        "services/executor.py": (0, 8),          # in-process run, learn, input nodes (spec + exec_module each): require_runnable + guard_imports(); one keyword compile + eval of a parameter
        "services/file_writer.py": (0, 1),       # compile of a parameter value in "eval" mode to check its syntax; never run
        "services/github_auth.py": (1, 0),       # git credential helper
        "services/install_manager.py": (3, 0),   # pip or uv; whether uv runs (#259)
        "services/introspector.py": (0, 4),      # in-process load (spec + exec_module): require_runnable + guard_imports(); one keyword compile + eval of a parameter
        "services/jobs.py": (2, 0),              # the job worker: create_job → require_runnable; payload carries the state
        "services/locations.py": (1, 1),         # git; a dynamic import of an app module
        "services/quick_check.py": (0, 2),       # not a load: the "exec(" and "eval(" it looks for in the text (#256), and a compile that is never run
        "services/running_from.py": (1, 0),      # which process runs the app
        "services/sandbox.py": (4, 0),           # warm worker + cold fallback: run_in_sandbox → require_runnable; payload carries the state
        "services/sandbox_worker.py": (1, 12),   # the fork server's fork of a clean child per task (#187); the guard's own load (spec + exec_module); load_module (spec + exec_module) and load_module_resilient (spec, compile + exec): check_model_path + hooks; introspect's syntax compile; two keyword compile + eval
        "services/settings_info.py": (2, 0),     # git
        "services/working_copies.py": (2, 0),    # which files are open
    }
    spawn = re.compile(
        r"WORKER_PATH|sandbox_worker\.py|Popen\(|subprocess\.run\(|subprocess\.check_output\(|subprocess\.call\(|"
        r"subprocess\.check_call\(|subprocess\.getoutput\(|subprocess\.getstatusoutput\(|os\.system|os\.popen|"
        r"os\.exec|os\.spawn|os\.posix_spawn|os\.fork|pty\.spawn|create_subprocess_|ProcessPoolExecutor|multiprocessing"
    )
    load = re.compile(
        r"spec_from_file_location\(|SourceFileLoader\(|SourcelessFileLoader\(|ExtensionFileLoader\(|runpy|"
        r"(?<![\w.])exec\(|\.exec\(|(?<![\w.])eval\(|\.eval\(|__import__\(|import_module\(|"
        r"exec_module\(|\.load_module\(|(?<![\w.])reload\(|\.reload\(|(?<![\w.])compile\(|InteractiveInterpreter|"
        r"InteractiveConsole|execfile"
    )
    found: dict[str, tuple[int, int]] = {}
    for py in sorted(APP_DIR.rglob("*.py")):
        rel = str(py.relative_to(APP_DIR))
        if rel == "services/assistant/import_guard.py":
            continue  # the guard itself
        spawns = loads = 0
        for line in py.read_text(encoding="utf-8").splitlines():
            code = line.split("#", 1)[0].strip()
            if code.startswith(("from ", "import ")) or code.startswith("WORKER_PATH ="):
                continue
            if spawn.search(code):
                spawns += 1
            if load.search(code):
                loads += 1
        if spawns or loads:
            found[rel] = (spawns, loads)
    unexpected = {k: v for k, v in found.items() if k not in allowed}
    assert not unexpected, f"a process start or code load outside the listed, guarded sites: {unexpected}"
    for rel, expected in allowed.items():
        assert found.get(rel, (0, 0)) == expected, f"{rel}: {found.get(rel)} (starts, loads) matching lines, listed as {expected}"



def test_no_spawn_or_load_name_is_imported_under_another_name():
    """The counting tripwire above matches names as they are spelled
    (``subprocess.run(``, ``exec_module(``). It would miss one brought in
    under another name: ``from subprocess import run``, ``import runpy as r``,
    ``getattr(os, "system")``. None of those is allowed in ``backend/app``,
    except the worker's ``import os as _os``, whose calls the patterns above
    still match."""
    modules = r"(subprocess|runpy|multiprocessing|pty|code|builtins|importlib(\.util|\.machinery)?|concurrent\.futures|asyncio|os)"
    names = (
        r"(run|Popen|call|check_call|check_output|getoutput|getstatusoutput|run_path|run_module|"
        r"system|popen|exec\w*|spawn\w*|posix_spawn\w*|fork\w*|spec_from_file_location|module_from_spec|"
        r"SourceFileLoader|SourcelessFileLoader|import_module|reload|ProcessPoolExecutor|create_subprocess_\w+|"
        r"InteractiveInterpreter|InteractiveConsole|eval|compile|__import__)"
    )
    aliased_module = re.compile(rf"^\s*import\s+{modules}\s+as\s+\w+")
    from_import = re.compile(rf"^\s*from\s+{modules}\s+import\s+(.*)$")
    dynamic = re.compile(r"getattr\(\s*(os|subprocess|runpy|importlib|builtins|__builtins__)\b|__builtins__\[")
    allowed = {("services/sandbox_worker.py", "import os as _os")}
    found = []
    for py in sorted(APP_DIR.rglob("*.py")):
        rel = str(py.relative_to(APP_DIR))
        if rel == "services/assistant/import_guard.py":
            continue
        for line in py.read_text(encoding="utf-8").splitlines():
            code = line.split("#", 1)[0].rstrip()
            hit = bool(aliased_module.search(code) or dynamic.search(code))
            m = from_import.search(code)
            if m and re.search(rf"\b{names}\b", m.group(m.lastindex)):
                hit = True
            if hit and (rel, code.strip()) not in allowed:
                found.append((rel, code.strip()))
    assert not found, f"a spawn or code-load name imported under another name: {found}"

# ── 2. a tracked path under a site-packages name ─────────────────────────


def test_a_tracked_file_under_a_site_packages_name_is_still_vetted(st):
    marker2 = st["tmp"] / "ran2.txt"
    vend = st["models"] / "zz" / "site-packages" / "vend2.py"
    vend.parent.mkdir(parents=True)
    vend.write_text(_helper(marker2))
    review.mark_unreviewed(str(vend), vend.read_text())
    model = st["models"] / "uses_vend.py"
    model.write_text(_model_importing(f"sys.path.insert(0, {str(vend.parent)!r})\nimport vend2"))
    r = load(model)
    assert unreviewed(r), r.text
    assert r.json()["path"] == str(vend.resolve())
    assert not marker2.exists()
    # And the assistant can't write there in the first place: a folder that
    # holds a site-packages can't be designated at all (so the write is
    # outside every allowed folder), and a path with such a part inside an
    # allowed folder is refused by name even before it exists.
    st["monkeypatch"].setattr(files, "folders_provider", lambda: [{"path": str(st["models"]), "access": "read_write"}])
    with pytest.raises(files.PathRefused) as e:
        files.resolve_allowed(str(st["models"] / "zz" / "site-packages" / "vend3.py"), write=True)
    assert e.value.reason in ("python_install", "outside_allowed_folders")
    clean = st["tmp"] / "Clean"
    clean.mkdir()
    st["monkeypatch"].setattr(files, "folders_provider", lambda: [{"path": str(clean), "access": "read_write"}])
    for bad in ("lib/python3.12/x.py", "site-packages/y.py", "conda-meta/z.py", "dist-packages/w.py"):
        with pytest.raises(files.PathRefused) as e:
            files.resolve_allowed(str(clean / bad), write=True)
        assert e.value.reason == "python_install", bad
    (clean / "sub").mkdir()
    assert files.resolve_allowed(str(clean / "sub" / "fine.py"), write=True) == clean / "sub" / "fine.py"


# ── 3. a helper loaded by path ───────────────────────────────────────────


@pytest.mark.parametrize("how", ["spec_from_file_location", "SourceFileLoader.load_module"])
def test_a_helper_loaded_by_path_is_vetted(st, how):
    marker2 = st["tmp"] / "ran2.txt"
    helper = st["models"] / "helper_mod.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    if how == "spec_from_file_location":
        stmt = (
            "import importlib.util\n"
            f"spec = importlib.util.spec_from_file_location('h', {str(helper)!r})\n"
            "m = importlib.util.module_from_spec(spec)\n"
            "spec.loader.exec_module(m)"
        )
    else:
        stmt = f"import importlib.machinery\nimportlib.machinery.SourceFileLoader('h', {str(helper)!r}).load_module()"
    model = st["models"] / "by_path.py"
    model.write_text(_model_importing(stmt))
    r = load(model)
    assert unreviewed(r), r.text
    assert r.json()["path"] == str(helper.resolve())
    assert not marker2.exists()
    approve(helper)
    assert load(model).status_code == 200
    assert marker2.exists()


# ── 4. a finder a model added earlier ────────────────────────────────────


def test_a_finder_added_by_an_earlier_model_does_not_get_ahead(st):
    # A module name no other test uses: the finder a model adds stays in the
    # warm worker for the rest of the run.
    marker2 = st["tmp"] / "ran2.txt"
    helper = st["models"] / "sneaky_target.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    sneaky = st["models"] / "sneaky.py"
    # A finder that serves sneaky_target itself, ahead of everything.
    sneaky.write_text(
        "import sys, importlib.util, importlib.abc\n"
        "class Mine(importlib.abc.MetaPathFinder):\n"
        "    def find_spec(self, name, path=None, target=None):\n"
        f"        if name == 'sneaky_target': return importlib.util.spec_from_file_location(name, {str(helper)!r})\n"
        "sys.meta_path.insert(0, Mine())\n"
        "import psyneulink as pnl\ncomp = pnl.Composition(name='s')\n"
    )
    assert load(sneaky).status_code == 200
    model = st["models"] / "uses_it.py"
    model.write_text(_model_importing("import sneaky_target"))
    r = load(model)
    assert unreviewed(r), r.text
    assert r.json()["path"] == str(helper.resolve())
    assert not marker2.exists()


# ── 5. in-process: the stale cache ───────────────────────────────────────


def test_in_process_stale_helper_is_not_served(st):
    marker2 = st["tmp"] / "ran2.txt"
    helper = st["models"] / "helper_mod.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    approve(helper)
    a = st["models"] / "a.py"
    a.write_text(_model_importing("import helper_mod"))
    load_and_introspect(str(a), use_sandbox=False)
    assert marker2.exists()
    marker3 = st["tmp"] / "ran3.txt"
    helper.write_text(_helper(marker3) + "# edited\n")
    b = st["models"] / "b.py"
    b.write_text(_model_importing("import helper_mod"))
    with pytest.raises(review.UnreviewedAssistantCode) as e:
        load_and_introspect(str(b), use_sandbox=False)
    assert e.value.path == str(helper.resolve())
    assert not marker3.exists()
    # The server's own modules were left alone.
    assert "app.services.introspector" in sys.modules


# ── 6. a PsyNeuLink checkout is never purged ─────────────────────────────


def test_a_source_checkout_is_not_purged_or_re_imported(st):
    """A fake checkout: a package whose import counts in a file. Once
    something is tracked, the guard's refresh between loads in one process
    doesn't purge it: imported once, refreshed twice, still imported once.
    (Each task now runs in a fresh process while something is tracked, so
    the count is checked within one task, where the worker's loaders
    refresh the guard again.)"""
    checkout = st["tmp"] / "sources" / "psyneulink-checkout"
    pkg = checkout / "fakepnl"
    pkg.mkdir(parents=True)
    count = st["tmp"] / "import_count.txt"
    (pkg / "__init__.py").write_text(
        "from pathlib import Path\n"
        f"p = Path({str(count)!r})\n"
        "p.write_text(str(int(p.read_text() or 0) + 1) if p.exists() else '1')\n"
    )
    st["monkeypatch"].setattr(review, "_exempt_cache", (0.0, []))
    from app.services import locations
    st["monkeypatch"].setattr(locations, "_active_pnl_path", lambda: checkout)
    assert review.exempt_roots() == [str(checkout)]
    model = st["models"] / "uses_checkout.py"
    assert review.is_tracked(str(st["agent_file"]))  # something is tracked
    model.write_text(_model_importing(
        f"sys.path.insert(0, {str(checkout)!r})\nimport fakepnl\nimport __main__\n"
        "__main__._guard.refresh()\n__main__._guard.refresh()\n"
        "import importlib\nimportlib.import_module('fakepnl')"))
    assert load(model).status_code == 200
    assert count.read_text() == "1", "the checkout was purged and imported again"
    # A model file under an exempt root that is tracked is still checked.
    inside = checkout / "model_here.py"
    inside.write_text(marker_model(st["tmp"] / "inside_ran.txt"))
    review.mark_unreviewed(str(inside), inside.read_text())
    assert unreviewed(load(inside))
    assert not (st["tmp"] / "inside_ran.txt").exists()


# ── 7. every task the worker runs, started directly with no review state ──


WORKER_TASKS = [
    "introspect", "run", "learn", "get_input_nodes", "show_graph",
    "export_mdf", "mdf_gaps", "connection_options", "connection_targets",
]


def _direct_worker(payload: dict, *, env_state=None) -> dict:
    env = {**os.environ}
    if env_state is not None:
        env["PSYNEUVIEW_ASSISTANT_REVIEW_FILE"] = str(env_state)
    proc = subprocess.run([sys.executable, WORKER_PATH], input=json.dumps(payload), capture_output=True,
                          text=True, env=env, timeout=300)
    assert proc.returncode == 0, proc.stderr[-2000:]
    return json.loads(proc.stdout.split("###PSYNEUVIEW_RESULT###")[-1].strip())


def test_the_worker_lists_exactly_these_tasks():
    """A new task in the worker has to be added to the direct-start test below."""
    source = Path(WORKER_PATH).read_text(encoding="utf-8")
    block = source.split("TASKS = {", 1)[1].split("}", 1)[0]
    assert sorted(re.findall(r'"(\w+)":', block)) == sorted(WORKER_TASKS)


@pytest.mark.parametrize("task", WORKER_TASKS)
def test_every_worker_task_refuses_an_unreviewed_model_when_started_directly(st, task):
    """Whatever the task, a worker started with no review state in its payload
    (an old or direct caller, or a new route that forgot the guard) finds the
    state itself and refuses the model before any of it runs."""
    params = {"file_path": str(st["agent_file"]), "composition_name": "poc", "inputs": {}, "targets": {},
              "epochs": 1, "num_trials": 1, "source": "poc", "target": "poc"}
    result = _direct_worker({"task": task, "params": params}, env_state=review.state_path())
    assert result.get("unreviewed_import") == str(st["agent_file"].resolve()), result
    assert not st["marker"].exists()


def test_a_job_started_without_the_route_is_refused_by_the_worker(st):
    """The job manager's own worker, started without the route's check (as
    the original hole did): the worker refuses, the job ends in an error that
    names the review, and the marker never appears."""
    model = st["models"] / "learn_direct.py"
    text = learnable_model(st["marker"])
    model.write_text(text)
    review.mark_unreviewed(str(model), text)
    body = _job_body(model)
    params = {"file_path": body["file_path"], "composition_name": "comp", "inputs": body["inputs"],
              "targets": body["targets"], "epochs": 1, "learning_rate": None, "execution_mode": None,
              "stream_progress": True}
    job, active = job_service.job_manager.submit("learn", "learn", params, {}, {})
    assert job is not None, active
    snap = _wait_job(job.id)
    assert snap["status"] == "error", snap
    assert snap["result"]["unreviewed_import"] == str(model.resolve()), snap
    assert snap["result"]["reason"] == review.REASON
    assert not st["marker"].exists()


def test_a_job_payload_carries_the_review_state(st, monkeypatch):
    """What the job worker is sent names the state file and the exempt roots,
    the same as the warm worker's tasks."""
    sent = {}
    real_popen = job_service.subprocess.Popen

    class Recording(real_popen):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            real_write = self.stdin.write

            def write(data):
                sent["payload"] = json.loads(data)
                return real_write(data)

            self.stdin.write = write

    monkeypatch.setattr(job_service.subprocess, "Popen", Recording)
    model = st["tmp"] / "Own" / "mine.py"
    model.parent.mkdir()
    model.write_text(learnable_model(st["tmp"] / "mine_ran.txt"))
    r = client.post("/api/jobs", json=_job_body(model))
    assert r.status_code == 200, r.text
    assert _wait_job(r.json()["id"])["status"] == "done"
    assert sent["payload"]["review_state"] == str(review.state_path())
    assert sent["payload"]["exempt_roots"] == review.exempt_roots()


# ── 8. a tracked file's text run without an import (the worker's audit hook) ─


def _other_way(how: str, helper: Path) -> str:
    """Model statements that run ``helper``'s text without importing it."""
    h, d, exe = str(helper), str(helper.parent), sys.executable
    return {
        "exec_open": f"exec(open({h!r}).read())",
        "exec_open_caught": f"try:\n    exec(open({h!r}).read())\nexcept Exception:\n    pass",
        "pathlib_read": f"from pathlib import Path as _P\nexec(_P({h!r}).read_text())",
        "exec_compile": f"exec(compile(open({h!r}).read(), {h!r}, 'exec'))",
        "runpy_run_path": f"import runpy\nrunpy.run_path({h!r})",
        "runpy_run_module": f"import runpy\nsys.path.insert(0, {d!r})\nrunpy.run_module({helper.stem!r})",
        "subprocess_list": f"import subprocess\nsubprocess.run([{exe!r}, {h!r}])",
        "subprocess_shell_by_name": f"import subprocess\nsubprocess.run('cd ' + {d!r} + ' && ' + {exe!r} + ' ' + {helper.name!r}, shell=True)",
        "os_system": f"os.system({exe!r} + ' ' + {h!r})",
        "copy_then_import": f"import shutil\nshutil.copy({h!r}, {str(helper.with_name('copied_' + helper.name))!r})\nimport copied_{helper.stem}",
        "rename_then_import": f"os.rename({h!r}, {str(helper.with_name('renamed_' + helper.name))!r})\nimport renamed_{helper.stem}",
        "link_then_import": f"os.link({h!r}, {str(helper.with_name('linked_' + helper.name))!r})\nimport linked_{helper.stem}",
        "symlink_then_exec": f"os.symlink({h!r}, {str(helper.with_name('sym_' + helper.name))!r})\nexec(open({str(helper.with_name('sym_' + helper.name))!r}).read())",
    }[how]


OTHER_WAYS = [
    "exec_open", "exec_open_caught", "pathlib_read", "exec_compile", "runpy_run_path", "runpy_run_module",
    "subprocess_list", "subprocess_shell_by_name", "os_system", "copy_then_import", "rename_then_import",
    "link_then_import", "symlink_then_exec",
]


@pytest.mark.parametrize("how", OTHER_WAYS)
def test_a_tracked_file_run_without_an_import_is_refused(st, how):
    """A reviewed-looking model that runs an unapproved helper's text by some
    other means than an import, through the real load route and the real
    worker: refused with the 409 naming the helper, and the helper's marker
    never appears."""
    marker2 = st["tmp"] / f"ran_{how}.txt"
    helper = st["models"] / f"helper_{how}.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    model = st["models"] / f"other_way_{how}.py"
    model.write_text(_model_importing(_other_way(how, helper)))
    r = load(model)
    assert unreviewed(r), r.text
    assert r.json()["path"] == str(helper.resolve())
    assert not marker2.exists()


def test_a_tracked_file_run_by_exec_runs_once_approved(st):
    marker2 = st["tmp"] / "ran_approved.txt"
    helper = st["models"] / "helper_approved.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    model = st["models"] / "execs_approved.py"
    model.write_text(_model_importing(_other_way("exec_open", helper)))
    assert unreviewed(load(model))
    approve(helper)
    assert load(model).status_code == 200
    assert marker2.exists()


def test_a_model_that_opens_files_and_starts_processes_works_while_something_is_tracked(st):
    """The hook refuses only tracked, unapproved files: a user's own model
    that writes and reads its own files and starts a process runs as before."""
    assert review.is_tracked(str(st["agent_file"]))
    out = st["tmp"] / "own_out.txt"
    child = st["tmp"] / "child_ran.txt"
    own = st["tmp"] / "Own2" / "busy.py"
    own.parent.mkdir()
    own.write_text(
        "import subprocess, sys, shutil, os\n"
        f"open({str(out)!r}, 'w').write('hello')\n"
        f"assert open({str(out)!r}).read() == 'hello'\n"
        f"shutil.copy({str(out)!r}, {str(out) + '.copy'!r})\n"
        f"subprocess.run([sys.executable, '-c', {f'open({str(child)!r}, chr(119)).write(chr(49))'!r}], check=True)\n"
        f"exec(compile('x = 1', {str(own)!r}, 'exec'))\n"
        "import psyneulink as pnl\n"
        "comp = pnl.Composition(name='busy')\n"
    )
    r = load(own)
    assert r.status_code == 200, r.text
    assert r.json()["model"].get("error") is None, r.text[:2000]
    assert out.exists() and child.exists()


@pytest.mark.parametrize("how", ["import", "exec_open", "runpy_run_path", "subprocess_list"])
def test_the_in_process_converter_refuses_a_tracked_file_run_any_way(st, how):
    """``/model/convert`` runs the model in the server's own process. A
    tracked, unapproved helper is refused there too, whether imported or run
    another way, and its marker never appears."""
    marker2 = st["tmp"] / f"conv_ran_{how}.txt"
    helper = st["models"] / f"conv_helper_{how}.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    stmt = f"import conv_helper_{how}" if how == "import" else _other_way(how, helper)
    model = st["tmp"] / "Own3" / f"convert_me_{how}.py"
    model.parent.mkdir(exist_ok=True)
    model.write_text(_model_importing(f"sys.path.insert(0, {str(st['models'])!r})\n{stmt}"))
    r = client.post("/api/model/convert", json={"file_path": str(model), "backup": False})
    assert r.status_code == 409, r.text
    assert not marker2.exists()
    if r.status_code == 409:
        assert r.json()["path"] == str(helper.resolve())


def test_the_server_hook_acts_only_inside_an_in_process_load(st):
    """Outside an in-process load the server reads an unapproved file freely
    (it has to, to show it for review); inside one, on that thread, it can't."""
    assert review.is_tracked(str(st["agent_file"]))
    assert st["agent_file"].read_text() == st["text"]
    with pytest.raises(review.UnreviewedAssistantCode):
        with review.guard_imports():
            open(st["agent_file"]).read()
    assert st["agent_file"].read_text() == st["text"]
    assert client.post("/api/assistant/review/status", json={"path": str(st["agent_file"])}).status_code == 200


def test_the_audit_hook_is_added_only_once_something_is_tracked(tmp_path):
    """With nothing tracked the hook would refuse nothing, so it isn't added
    and a task costs what it did before; the first refresh that finds a
    tracked file adds it. In a fresh interpreter, since a hook can't be removed."""
    state = tmp_path / "state.json"
    state.write_text(json.dumps({"files": {}}))
    guard_file = APP_DIR / "services" / "assistant" / "import_guard.py"
    script = (
        "import importlib.util, json, sys\n"
        f"spec = importlib.util.spec_from_file_location('g', {str(guard_file)!r})\n"
        "g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)\n"
        "g.install_audit_hook(everywhere=True)\n"
        f"g.refresh({str(state)!r})\n"
        "before = g._audit_installed\n"
        f"open({str(state)!r}, 'w').write(json.dumps({{'files': {{'/nowhere/x.py': {{'approved': None}}}}}}))\n"
        f"g.refresh({str(state)!r})\n"
        "print(json.dumps([before, g._audit_installed]))\n"
    )
    out = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    assert json.loads(out.stdout.strip().splitlines()[-1]) == [False, True]


# ── 9. the second review of #187: one identity for a file, any spelling ──


import unicodedata


def _case_insensitive(folder: Path) -> bool:
    probe = folder / "Case_Probe.txt"
    probe.write_text("x")
    try:
        return (folder / "case_probe.TXT").exists()
    finally:
        probe.unlink()


def _accents_folded(folder: Path) -> bool:
    nfd = folder / unicodedata.normalize("NFD", "é_probe")
    nfd.mkdir()
    try:
        return (folder / unicodedata.normalize("NFC", "é_probe")).exists()
    finally:
        nfd.rmdir()


def _upper(p: Path) -> Path:
    return p.with_name(p.stem.upper() + p.suffix)


@pytest.fixture
def ci_volume(st):
    if not _case_insensitive(st["tmp"]):
        pytest.skip("needs a volume that ignores case (macOS)")
    return st


def test_a_case_variant_of_an_unreviewed_model_is_refused_by_every_route(ci_volume):
    st = ci_volume
    variant = _upper(st["agent_file"])
    assert unreviewed(load(variant))
    r = client.post("/api/model/convert", json={"file_path": str(variant), "backup": False})
    assert unreviewed(r), r.text
    model = st["models"] / "learn_case.py"
    model.write_text(learnable_model(st["marker"]))
    review.mark_unreviewed(str(model), model.read_text())
    assert unreviewed(client.post("/api/jobs", json=_job_body(_upper(model))))
    result = _direct_worker({"task": "introspect", "params": {"file_path": str(variant)}}, env_state=review.state_path())
    assert result.get("unreviewed_import") == str(st["agent_file"].resolve()), result
    assert not st["marker"].exists()


CASE_WAYS = {
    "exec_open": lambda up, h: f"exec(open({up!r}).read())",
    "runpy": lambda up, h: f"import runpy\nrunpy.run_path({up!r})",
    "spec": lambda up, h: (f"import importlib.util as u\ns = u.spec_from_file_location('zz', {up!r})\n"
                           "m = u.module_from_spec(s)\ns.loader.exec_module(m)"),
    "symlink": lambda up, h: f"os.symlink({up!r}, {str(h.parent / 'alias_x.py')!r})\nexec(open({str(h.parent / 'alias_x.py')!r}).read())",
    "link": lambda up, h: f"os.link({up!r}, {str(h.parent / 'lnk_case.py')!r})\nimport lnk_case",
    "rename": lambda up, h: f"os.rename({up!r}, {str(h.parent / 'ren_case.py')!r})\nimport ren_case",
    "copy": lambda up, h: f"import shutil\nshutil.copy({up!r}, {str(h.parent / 'cp_case.py')!r})\nimport cp_case",
}


@pytest.mark.parametrize("how", list(CASE_WAYS))
def test_a_case_variant_of_an_unreviewed_helper_is_refused(ci_volume, how):
    st = ci_volume
    marker2 = st["tmp"] / f"case_ran_{how}.txt"
    helper = st["models"] / f"hx_case_{how}.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    model = st["tmp"] / "OwnCase" / f"m_{how}.py"
    model.parent.mkdir(exist_ok=True)
    model.write_text(_model_importing(f"sys.path.insert(0, {str(st['models'])!r})\n" + CASE_WAYS[how](str(_upper(helper)), helper)))
    r = load(model)
    assert unreviewed(r), r.text
    assert not marker2.exists()


def test_approving_through_a_case_variant_approves_the_same_entry(ci_volume):
    st = ci_volume
    approve(_upper(st["agent_file"]))
    state = json.loads(review.state_path().read_text())["files"]
    assert len([k for k in state if k.lower().endswith("assistant_wrote.py")]) == 1
    assert load(st["agent_file"]).status_code == 200
    assert st["marker"].exists()


@pytest.fixture
def nfd_folder(st):
    if not _accents_folded(st["tmp"]):
        pytest.skip("needs a volume that folds accents (macOS)")
    root = st["tmp"] / "AssistantFolder"
    root.mkdir()
    sub = root / unicodedata.normalize("NFD", "Modèles")
    sub.mkdir()
    files.set_folders_provider(lambda: [{"path": str(root), "access": "read_write"}])
    yield root, sub
    files.set_folders_provider(files._folders_from_settings)


def test_an_assistant_model_in_a_decomposed_folder_is_refused_by_its_listed_path(st, nfd_folder):
    root, sub = nfd_folder
    nfc = os.path.join(os.path.realpath(root), unicodedata.normalize("NFC", "Modèles"), "agent_model.py")
    files.write_model_file(nfc, marker_model(st["marker"]), base_hash=None)
    listed = os.path.join(os.path.realpath(sub), os.listdir(sub)[0])
    assert unreviewed(load(listed))
    assert unreviewed(client.post("/api/model/convert", json={"file_path": listed, "backup": False}))
    assert not st["marker"].exists()


def test_a_plain_import_of_an_assistant_helper_in_a_decomposed_folder_is_refused(st, nfd_folder):
    """No attacker: the user's own model beside a helper the assistant wrote."""
    root, sub = nfd_folder
    marker2 = st["tmp"] / "nfd_helper_ran.txt"
    nfc_dir = os.path.join(os.path.realpath(root), unicodedata.normalize("NFC", "Modèles"))
    files.write_model_file(os.path.join(nfc_dir, "agent_helper.py"), _helper(marker2), base_hash=None)
    (sub / "users_model.py").write_text(_model_importing("import agent_helper"))
    r = load(os.path.join(os.path.realpath(sub), "users_model.py"))
    assert unreviewed(r), r.text
    assert not marker2.exists()


def test_a_decomposed_file_name_is_the_same_tracked_file(st):
    if not _accents_folded(st["tmp"]):
        pytest.skip("needs a volume that folds accents (macOS)")
    marker2 = st["tmp"] / "nfd_name_ran.txt"
    nfc = st["models"] / unicodedata.normalize("NFC", "modèle_aide.py")
    nfc.write_text(_helper(marker2))
    review.mark_unreviewed(str(nfc), nfc.read_text())
    nfd = st["models"] / unicodedata.normalize("NFD", "modèle_aide.py")
    model = st["tmp"] / "OwnNfd" / "uses.py"
    model.parent.mkdir()
    model.write_text(_model_importing(f"exec(open({str(nfd)!r}).read())"))
    assert unreviewed(load(model))
    assert not marker2.exists()


def test_a_hard_link_made_beforehand_is_the_same_tracked_file(st):
    """Any volume: the file on disk, not the name, is what is tracked."""
    marker2 = st["tmp"] / "hard_ran.txt"
    helper = st["models"] / "hard_helper.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    other = st["tmp"] / "Elsewhere" / "innocent_name.py"
    other.parent.mkdir()
    os.link(helper, other)
    model = st["tmp"] / "OwnHard" / "uses.py"
    model.parent.mkdir()
    model.write_text(_model_importing(f"sys.path.insert(0, {str(other.parent)!r})\nimport innocent_name"))
    assert unreviewed(load(model))
    assert not marker2.exists()


def test_a_case_variant_on_a_case_sensitive_volume_is_still_treated_as_tracked(tmp_path):
    """Folding case can only refuse more: where the volume tells ``hx.py``
    from ``HX.py``, the second is still taken for the first."""
    index = import_guard.TrackedIndex({str(tmp_path / "hx.py"): {"approved": None}})
    assert index.find(str(tmp_path / "HX.py")) == str(tmp_path / "hx.py")
    assert index.find(str(tmp_path / unicodedata.normalize("NFD", "é.py"))) is None
    index2 = import_guard.TrackedIndex({str(tmp_path / unicodedata.normalize("NFC", "é.py")): {}})
    assert index2.find(str(tmp_path / unicodedata.normalize("NFD", "É.py"))) is not None


# ── 10. a write whose review record can't be saved isn't written ────────


def test_a_write_is_refused_when_the_review_state_cant_be_saved(st):
    own_dir = st["tmp"] / "RW"
    own_dir.mkdir()
    own = own_dir / "mine.py"
    original = "import psyneulink as pnl\ncomp = pnl.Composition(name='c')\n"
    own.write_text(original)
    files.set_folders_provider(lambda: [{"path": str(own_dir), "access": "read_write"}])
    ro = st["tmp"] / "ro_state"
    ro.mkdir()
    st["monkeypatch"].setenv("PSYNEUVIEW_ASSISTANT_REVIEW_FILE", str(ro / "review.json"))
    os.chmod(ro, 0o500)
    try:
        with pytest.raises(files.PathRefused) as e:
            files.write_model_file(str(own.resolve()), marker_model(st["marker"]), base_hash=review.content_hash(original))
        assert e.value.reason == "cannot_record"
    finally:
        os.chmod(ro, 0o700)
        files.set_folders_provider(files._folders_from_settings)
    assert own.read_text() == original
    assert not [p for p in own_dir.iterdir() if p.name.startswith(".")]
    assert load(own).status_code == 200
    assert not st["marker"].exists()


def test_a_write_whose_rename_fails_leaves_the_entry_as_it_was(st, monkeypatch):
    own_dir = st["tmp"] / "RW3"
    own_dir.mkdir()
    own = own_dir / "mine.py"
    original = "import psyneulink as pnl\ncomp = pnl.Composition(name='c')\n"
    own.write_text(original)
    files.set_folders_provider(lambda: [{"path": str(own_dir), "access": "read_write"}])
    real_rename = os.rename

    def failing(src, dst, *a, **k):
        if str(dst) == "mine.py":
            raise OSError("disk full")
        return real_rename(src, dst, *a, **k)

    monkeypatch.setattr(files.os, "rename", failing)
    try:
        with pytest.raises(OSError):
            files.write_model_file(str(own.resolve()), marker_model(st["marker"]), base_hash=review.content_hash(original))
    finally:
        files.set_folders_provider(files._folders_from_settings)
    assert own.read_text() == original
    assert not review.is_tracked(str(own))


# ── 11. what one task's model does to the guard doesn't reach the next ──


@pytest.mark.parametrize("tamper", [
    "__main__._guard._audit_local.busy = True",
    "__main__._guard._state.tracked = {}",
    "__main__._guard._AUDIT_EVENTS = frozenset()",
    "__main__._guard._audit_everywhere = False",
    "__main__._guard.vet = lambda p: None\n__main__._guard._audit = lambda e, a: None",
])
def test_a_model_cannot_switch_the_guard_off_for_later_tasks(st, tamper):
    marker2 = st["tmp"] / "later_ran.txt"
    helper = st["models"] / "later_helper.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    a = st["tmp"] / "Tamper"
    a.mkdir()
    (a / "first.py").write_text(f"import __main__\n{tamper}\nimport psyneulink as pnl\ncomp = pnl.Composition(name='c')\n")
    (a / "second.py").write_text(_model_importing(f"exec(open({str(helper)!r}).read())"))
    (a / "third.py").write_text(_model_importing(f"sys.path.insert(0, {str(st['models'])!r})\nimport later_helper"))
    load(a / "first.py")
    assert unreviewed(load(a / "second.py"))
    assert unreviewed(load(a / "third.py"))
    assert not marker2.exists()


# ── 12. the process check reads shell and interpreter text ──────────────


PROCESS_WAYS = {
    "shell_glob": lambda h: f"import subprocess\nexec(subprocess.run('cat ' + {str(h.parent)!r} + '/' + {h.name[:-6]!r} + '*', shell=True, capture_output=True, text=True).stdout)",
    "shell_redirect": lambda h: f"import subprocess\nexec(subprocess.run('cd ' + {str(h.parent)!r} + ' && cat <' + {h.name!r}, shell=True, capture_output=True, text=True).stdout)",
    "sh_c_list": lambda h: f"import subprocess\nexec(subprocess.run(['sh', '-c', 'cat ' + {str(h)!r}], capture_output=True, text=True).stdout)",
    "env_value": lambda h: f"import subprocess\nexec(subprocess.run(['sh', '-c', 'cat \"$P\"'], env={{'P': {str(h)!r}}}, capture_output=True, text=True).stdout)",
    "putenv": lambda h: f"import subprocess\nos.environ['P'] = {str(h)!r}\nexec(subprocess.run(['sh', '-c', 'cat \"$P\"'], capture_output=True, text=True).stdout)",
    "python_c": lambda h: f"import subprocess\nsubprocess.run([sys.executable, '-c', 'exec(open(' + repr({str(h)!r}) + ').read())'])",
}


@pytest.mark.parametrize("how", list(PROCESS_WAYS))
def test_a_process_whose_text_mentions_an_unreviewed_file_is_refused(st, how):
    marker2 = st["tmp"] / f"proc_ran_{how}.txt"
    helper = st["models"] / f"hx_proc_{how}_zz.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    model = st["tmp"] / "OwnProc" / f"m_{how}.py"
    model.parent.mkdir(exist_ok=True)
    model.write_text(_model_importing(PROCESS_WAYS[how](helper)))
    r = load(model)
    assert unreviewed(r), r.text
    assert not marker2.exists()


def test_an_open_relative_to_another_folder_is_not_covered(st):
    """Round 3 (F4, F5): checking a relative name against every tracked file
    of that name refused ordinary models (a new file of the same name being
    written), and a decoy in the working folder defeated it anyway. Only a
    path that leads to the tracked file is checked now, so an
    ``os.open(name, dir_fd=d)`` relative to another folder isn't covered,
    as the threat model says. This test records that, so a change to it is
    noticed."""
    marker2 = st["tmp"] / "dirfd_ran.txt"
    helper = st["models"] / "hx_dirfd.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    model = st["tmp"] / "OwnFd" / "m.py"
    model.parent.mkdir()
    model.write_text(_model_importing(
        f"os.chdir('/')\nd = os.open({str(helper.parent)!r}, os.O_RDONLY)\n"
        f"fd = os.open({helper.name!r}, os.O_RDONLY, dir_fd=d)\nexec(os.read(fd, 1 << 20).decode())"))
    load(model)
    assert marker2.exists()


# ── 13. a task naming a state file that doesn't exist ───────────────────


def test_a_task_naming_a_missing_state_file_still_sees_the_tracked_files(st):
    result = _direct_worker({"task": "introspect", "params": {"file_path": str(st["agent_file"])},
                             "review_state": str(st["tmp"] / "nonexistent.json")}, env_state=review.state_path())
    assert result.get("unreviewed_import") == str(st["agent_file"].resolve()), result
    assert not st["marker"].exists()


# ── 14. threads, and the guard's refusal when the server's step is skipped ─


def test_a_thread_in_the_worker_is_refused(st):
    marker2 = st["tmp"] / "thread_ran.txt"
    helper = st["models"] / "hx_thread.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    model = st["tmp"] / "OwnThread" / "m.py"
    model.parent.mkdir()
    model.write_text(_model_importing(
        "import threading\nerr = []\n"
        f"def go():\n    try:\n        exec(open({str(helper)!r}).read())\n    except BaseException as e:\n        err.append(e)\n"
        "t = threading.Thread(target=go); t.start(); t.join()\nif err: raise err[0]"))
    assert unreviewed(load(model))
    assert not marker2.exists()


def test_a_thread_in_the_in_process_converter_is_refused(st):
    marker2 = st["tmp"] / "conv_thread_ran.txt"
    helper = st["models"] / "conv_thread_helper.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    model = st["tmp"] / "ConvThread" / "conv_thread.py"
    model.parent.mkdir()
    model.write_text(_model_importing(
        f"import threading\nt = threading.Thread(target=lambda: exec(open({str(helper)!r}).read())); t.start(); t.join()"))
    client.post("/api/model/convert", json={"file_path": str(model), "backup": False})
    assert not marker2.exists()


def test_the_guards_refusal_is_a_409_even_when_the_servers_step_is_skipped(st, monkeypatch):
    """With ``guard_imports`` replaced (say, by a model run earlier in the
    server), the import guard's own refusal still reaches the page as the
    review 409, not as a failed request."""
    import contextlib
    from app.services import converter
    monkeypatch.setattr(converter.assistant_review, "guard_imports", lambda: contextlib.nullcontext())
    marker2 = st["tmp"] / "skip_ran.txt"
    helper = st["models"] / "skip_helper.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    import_guard.refresh()
    model = st["tmp"] / "Skip" / "m.py"
    model.parent.mkdir()
    model.write_text(_model_importing(f"sys.path.insert(0, {str(st['models'])!r})\nimport skip_helper"))
    r = client.post("/api/model/convert", json={"file_path": str(model), "backup": False})
    assert unreviewed(r), r.text
    assert not marker2.exists()


# ── 15. the second round of review of PR #310 ───────────────────────────


R1_TAMPERS = {
    "state_refresh_on_the_class": "__main__._guard._State.refresh = lambda self, *a, **k: None",
    "index_find_on_the_class": "__main__._guard.TrackedIndex.find = lambda self, p: None",
    "forged_fingerprint": "__main__._guard.refresh = lambda *a, **k: None\n__main__._GUARD_FINGERPRINT = __main__._guard.fingerprint()",
    "replaced_check": "__main__._guard.refresh = lambda *a, **k: None\n__main__._guard_was_replaced = lambda: False",
    "threading_local": "import threading\nclass L:\n    busy = True\n    active = 0\nthreading.local = L",
    "json_load": "import json\njson.load = lambda f, *a, **k: {'files': {}}",
    "swapped_guard": ("import types\nreal = __main__._guard\n"
                      "fake = types.SimpleNamespace(**{k: getattr(real, k) for k in dir(real) if not k.startswith('__')})\n"
                      "fake.reset_for_task = lambda: None\nfake.refresh = lambda *a, **k: None\nfake.check_model_path = lambda p: None\n"
                      "__main__._guard = fake\nreal._state.tracked = {}\nreal._state.index = real._EMPTY_INDEX"),
}


@pytest.mark.parametrize("how", list(R1_TAMPERS))
def test_tampering_in_one_task_never_reaches_the_next(st, how):
    """While anything is tracked, each task runs in a process that has run
    no other: whatever the first model did to the guard, the next model's
    exec(open(...)) of an unapproved file is refused."""
    marker2 = st["tmp"] / f"r1_ran_{how}.txt"
    helper = st["models"] / f"hx_r1_{how}.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    a = st["tmp"] / "R1"
    a.mkdir()
    (a / "first.py").write_text(f"import __main__\n{R1_TAMPERS[how]}\nimport psyneulink as pnl\ncomp = pnl.Composition(name='c')\n")
    (a / "second.py").write_text(_model_importing(f"exec(open({str(helper)!r}).read())"))
    load(a / "first.py")
    assert unreviewed(load(a / "second.py"))
    assert not marker2.exists()


def test_each_task_runs_in_a_new_process_only_while_something_is_tracked(st):
    from app.services import sandbox
    pid_model = st["tmp"] / "Pid" / "pid.py"
    pid_model.parent.mkdir()
    out = st["tmp"] / "pids.txt"
    pid_model.write_text(f"import os\nopen({str(out)!r}, 'a').write(str(os.getpid()) + chr(10))\n"
                         "import psyneulink as pnl\ncomp = pnl.Composition(name='c')\n")
    assert review.is_tracked(str(st["agent_file"]))
    load(pid_model)
    load(pid_model)
    tracked_pids = out.read_text().split()
    assert len(set(tracked_pids)) == 2, tracked_pids
    review.state_path().write_text(json.dumps({"files": {}}))
    out.unlink()
    load(pid_model)
    load(pid_model)
    untracked_pids = out.read_text().split()
    assert len(set(untracked_pids)) == 1, untracked_pids
    assert sandbox._get_warm_worker().is_alive()


def _plain_model(folder: Path, body: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    model = folder / "model.py"
    model.write_text("import os, sys\n" + body + "import psyneulink as pnl\ncomp = pnl.Composition(name='c')\n")
    return model


def _tracked_unapproved(st, name: str) -> Path:
    p = st["models"] / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(_helper(st["tmp"] / "never.txt"))
    review.mark_unreviewed(str(p), p.read_text())
    return p


def _runs_normally(r) -> bool:
    return r.status_code == 200 and not (r.json().get("model") or {}).get("error")


def test_a_relative_open_of_the_users_own_same_named_file_runs(st):
    _tracked_unapproved(st, "utils.py")
    own = st["tmp"] / "Mine"
    own.mkdir()
    (own / "utils.py").write_text("X = 1\n")
    model = _plain_model(own, f"import os\nos.chdir({str(own)!r})\nsrc = open('utils.py').read()\n")
    r = load(model)
    assert _runs_normally(r), r.text[:400]


def test_a_module_name_as_a_word_in_shell_text_runs(st):
    _tracked_unapproved(st, "data.py")
    model = _plain_model(st["tmp"] / "Mine3", f"import subprocess\nsubprocess.run(['sh', '-c', 'mkdir -p {st['tmp']}/out/data'], check=True)\n")
    r = load(model)
    assert _runs_normally(r), r.text[:400]


def test_a_module_name_as_a_word_in_the_environment_runs(st):
    _tracked_unapproved(st, "config.py")
    model = _plain_model(st["tmp"] / "Mine4", "import os\nos.environ['MY_APP_HOME'] = '/Users/someone/config/app'\n")
    r = load(model)
    assert _runs_normally(r), r.text[:400]


def test_a_bare_glob_elsewhere_runs(st):
    _tracked_unapproved(st, "helper.py")
    out = st["tmp"] / "outdir"
    out.mkdir()
    (out / "a.log").write_text("x")
    model = _plain_model(st["tmp"] / "Mine5", f"import subprocess\nsubprocess.run('rm -f {out}/*', shell=True, check=True)\n")
    r = load(model)
    assert _runs_normally(r), r.text[:400]
    assert not (out / "a.log").exists()


def test_a_module_name_in_python_c_text_runs(st):
    _tracked_unapproved(st, "analysis.py")
    model = _plain_model(st["tmp"] / "Mine6", "import subprocess, sys\nsubprocess.run([sys.executable, '-c', 'print(\"analysis done\")'], check=True)\n")
    r = load(model)
    assert _runs_normally(r), r.text[:400]


def test_a_refusal_that_isnt_an_import_says_so(st):
    marker2 = st["tmp"] / "msg_ran.txt"
    helper = st["models"] / "hx_msg.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    model = _plain_model(st["tmp"] / "Msg", f"exec(open({str(helper)!r}).read())\n")
    r = load(model)
    assert unreviewed(r)
    assert "named in a file, process or setting the model used" in r.json()["detail"]
    assert "imports it" not in r.json()["detail"]


def test_a_symlink_chain_made_during_the_task_is_refused(st):
    marker2 = st["tmp"] / "chain_ran.txt"
    helper = st["models"] / "hx_chain.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    t = st["tmp"]
    for first in ("dangling_by_name", "folder_link"):
        stmt = {
            # A link made while its target is missing, then the folder link that completes it.
            "dangling_by_name": (f"os.symlink({str(t / 'dirlink' / helper.name)!r}, {str(t / 'alias.py')!r})\n"
                                 f"os.symlink({str(helper.parent)!r}, {str(t / 'dirlink')!r})\n"
                                 f"exec(open({str(t / 'alias.py')!r}).read())\n"),
            # A link to the folder, then a copy through it.
            "folder_link": (f"os.symlink({str(helper.parent)!r}, {str(t / 'dl')!r})\n"
                            f"import shutil\nshutil.copyfile({str(t / 'dl' / helper.name)!r}, {str(t / 'c.py')!r})\n"
                            f"exec(open({str(t / 'c.py')!r}).read())\n"),
        }[first]
        model = _plain_model(t / f"Chain_{first}", stmt)
        assert unreviewed(load(model)), first
    assert not marker2.exists()


def test_a_symlink_to_an_unrelated_folder_runs(st):
    _tracked_unapproved(st, "helper.py")
    other = st["tmp"] / "Data"
    other.mkdir()
    (other / "x.csv").write_text("1")
    model = _plain_model(st["tmp"] / "MineLink", f"os_ = __import__('os')\nos_.symlink({str(other)!r}, {str(st['tmp'] / 'datalink')!r})\n"
                                                  f"open({str(st['tmp'] / 'datalink' / 'x.csv')!r}).read()\n")
    r = load(model)
    assert _runs_normally(r), r.text[:400]


R4_WAYS = {
    "perl_E": lambda h: ["perl", "-E", f"open F, '<', '{h}'; print <F>"],
    "awk_program": lambda h: ["awk", f'BEGIN {{ while ((getline l < "{h}") > 0) print l }}'],
    "ruby_e": lambda h: ["ruby", "-e", f"print File.read('{h}')"],
    "bash_C_upper": lambda h: ["bash", "-c", f"cat {h}"],
}


@pytest.mark.parametrize("how", list(R4_WAYS))
def test_interpreter_program_text_naming_the_file_is_refused(st, how):
    import shutil
    if not shutil.which(R4_WAYS[how](Path("x"))[0]):
        pytest.skip("interpreter not installed")
    marker2 = st["tmp"] / f"r4_ran_{how}.txt"
    helper = st["models"] / f"hx_r4_{how}.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    argv = R4_WAYS[how](helper)
    model = _plain_model(st["tmp"] / f"R4_{how}", f"import subprocess\nexec(subprocess.run({argv!r}, capture_output=True, text=True).stdout)\n")
    assert unreviewed(load(model))
    assert not marker2.exists()


# ── 16. the fork server: a clean parent, one child per task ──────────────


def _isolation_mode() -> str:
    from app.services import sandbox
    return sandbox.isolation_mode()


def test_tasks_run_in_children_of_one_clean_parent_while_something_is_tracked(st):
    if _isolation_mode() != "fork":
        pytest.skip("the fork server's test; the pool's is test_tasks_run_in_never_used_pool_workers")
    """While anything is tracked, each task runs in a new child of the fork
    server, whose parent stays the same and runs no model code."""
    from app.services import sandbox
    out = st["tmp"] / "parents.txt"
    model = _plain_model(st["tmp"] / "Fork", f"open({str(out)!r}, 'a').write(f'{{os.getpid()}} {{os.getppid()}}' + chr(10))\n")
    for _ in range(3):
        assert _runs_normally(load(model))
    rows = [line.split() for line in out.read_text().splitlines()]
    assert len({pid for pid, _ in rows}) == 3
    assert len({ppid for _, ppid in rows}) == 1
    assert int(rows[0][1]) == sandbox._get_fork_server()._proc.pid


def test_tasks_run_in_never_used_pool_workers(st):
    """The pool, where forking isn't usable: every task in a process that
    was started ahead and had run nothing, and that ends after it."""
    if _isolation_mode() != "pool":
        pytest.skip("the pool's test")
    out = st["tmp"] / "pool.txt"
    model = _plain_model(st["tmp"] / "Pool", f"open({str(out)!r}, 'a').write(str(os.getpid()) + chr(10))\n")
    for _ in range(3):
        assert _runs_normally(load(model))
    pids = [int(p) for p in out.read_text().split()]
    assert len(set(pids)) == 3
    for pid in pids:
        try:
            os.kill(pid, 0)
            alive = True
        except ProcessLookupError:
            alive = False
        assert not alive, "a pool worker was kept after its task"


def test_a_child_that_kills_its_parent_doesnt_reach_the_next_task(st):
    if _isolation_mode() != "fork":
        pytest.skip("in the pool a task's parent is the server itself")
    """A model that ends the fork server's parent (or tampers with anything
    in its own process) leaves the next task to a freshly started parent:
    the next model's exec(open(...)) of an unapproved file is refused."""
    marker2 = st["tmp"] / "parent_ran.txt"
    helper = st["models"] / "hx_parent.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    # Only the fork server's parent: if the server falls back to a one-shot
    # worker for the retry, that worker's parent is this test process.
    first = _plain_model(st["tmp"] / "KillParent", "import __main__, signal\n__main__._guard._state.tracked = {}\n"
                         f"if os.getppid() != {os.getpid()}:\n    os.kill(os.getppid(), signal.SIGKILL)\n")
    load(first)
    second = _plain_model(st["tmp"] / "After", f"exec(open({str(helper)!r}).read())\n")
    assert unreviewed(load(second))
    assert not marker2.exists()


def test_a_process_a_model_starts_doesnt_outlive_its_task(st):
    pid_file = st["tmp"] / "bg.pid"
    model = _plain_model(st["tmp"] / "Bg", "import subprocess\n"
                         f"p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
                         f"open({str(pid_file)!r}, 'w').write(str(p.pid))\n")
    assert _runs_normally(load(model))
    pid = int(pid_file.read_text())
    deadline = time.time() + 5
    alive = True
    while time.time() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            alive = False
            break
        time.sleep(0.1)
    assert not alive, "a process the model started outlived its task"


def test_nothing_tracked_keeps_the_warm_worker(st):
    review.state_path().write_text(json.dumps({"files": {}}))
    out = st["tmp"] / "warm.txt"
    model = _plain_model(st["tmp"] / "Warm", f"open({str(out)!r}, 'a').write(str(os.getpid()) + chr(10))\n")
    load(model)
    load(model)
    assert len(set(out.read_text().split())) == 1


# ── 17. the third round of review of PR #310 ────────────────────────────


@pytest.mark.parametrize("how", ["approve_in_record", "delete_record", "delete_backup", "replace_record", "rewrite_guard"])
def test_a_model_cannot_change_the_review_record_or_the_guard(st, how):
    """F1: the next task, in a fresh process, reads the record from disk; a
    model may not change it (or the guard's own files) while something is
    tracked. The change is refused, and the next model's exec(open(...))
    of the unapproved helper is refused too."""
    marker2 = st["tmp"] / f"rec_ran_{how}.txt"
    helper = st["models"] / f"hx_rec_{how}.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    sp = str(review.state_path())
    guard_src = str(APP_DIR / "services" / "assistant" / "import_guard.py")
    stmt = {
        # The model knows the text it wants approved; it needn't read the file.
        "approve_in_record": (f"import json\ns = json.load(open({sp!r}))\n"
                              f"for k, e in s['files'].items():\n    e['approved'] = {review.content_hash(helper.read_text())!r}\n"
                              f"json.dump(s, open({sp!r}, 'w'))\n"),
        "delete_record": f"os.remove({sp!r})\n",
        "delete_backup": f"os.unlink({sp + '.bak'!r})\n",
        "replace_record": f"open({sp + '.new'!r}, 'w').write('{{\"files\": {{}}}}')\nos.replace({sp + '.new'!r}, {sp!r})\n",
        "rewrite_guard": f"open({guard_src!r}, 'a').write('# changed')\n",
    }[how]
    before = Path(guard_src).read_text()
    first = _plain_model(st["tmp"] / f"Rec_{how}", stmt)
    r1 = load(first)
    assert unreviewed(r1), r1.text[:300]
    assert "review record" in r1.json()["detail"]
    assert Path(guard_src).read_text() == before
    second = _plain_model(st["tmp"] / f"Rec2_{how}", f"exec(open({str(helper)!r}).read())\n")
    assert unreviewed(load(second))
    assert not marker2.exists()


def test_a_symlink_to_a_folder_holding_a_tracked_file_runs(st):
    _tracked_unapproved(st, "deep/er/still/helper2.py")
    model = _plain_model(st["tmp"] / "L_f", f"os.symlink({str(st['tmp'])!r}, {str(st['tmp'] / 'link_to_parent')!r})\n")
    assert _runs_normally(load(model))


def test_a_symlink_to_the_users_own_same_named_file_runs(st):
    _tracked_unapproved(st, "results.py")
    mine = st["tmp"] / "MineR"
    mine.mkdir()
    (mine / "results.py").write_text("X = 1\n")
    model = _plain_model(st["tmp"] / "L_g", f"os.symlink({str(mine / 'results.py')!r}, {str(st['tmp'] / 'r_link.py')!r})\n"
                                               f"open({str(st['tmp'] / 'r_link.py')!r}).read()\n")
    assert _runs_normally(load(model))


def test_a_script_writing_a_same_named_output_runs(st):
    _tracked_unapproved(st, "report.py")
    script = st["tmp"] / "gen.py"
    script.write_text("import sys\nopen(sys.argv[2], 'w').write('# generated')\n")
    out = st["tmp"] / "outR"
    out.mkdir()
    model = _plain_model(st["tmp"] / "L_h", f"import subprocess\nsubprocess.run([sys.executable, {str(script)!r}, '--out', {str(out / 'report.py')!r}], check=True)\n")
    assert _runs_normally(load(model))
    assert (out / "report.py").exists()


def test_writing_a_new_same_named_file_relatively_runs(st):
    _tracked_unapproved(st, "summary.py")
    out = st["tmp"] / "outS"
    out.mkdir()
    model = _plain_model(st["tmp"] / "L_i", f"os.chdir({str(out)!r})\nopen('summary.py', 'w').write('# mine')\n")
    assert _runs_normally(load(model))


def test_a_name_as_a_pattern_for_another_command_runs(st):
    _tracked_unapproved(st, "notes.py")
    lg = st["tmp"] / "log.txt"
    lg.write_text("notes.py ok\n")
    model = _plain_model(st["tmp"] / "L_j", f"import subprocess\nsubprocess.run(['grep', '-E', 'notes.py', {str(lg)!r}], check=True)\n")
    assert _runs_normally(load(model))


def test_the_refusal_names_the_path_the_model_used(st):
    marker2 = st["tmp"] / "named_ran.txt"
    helper = st["models"] / "hx_named.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    link = st["tmp"] / "other_name.py"
    model = _plain_model(st["tmp"] / "Named", f"os.symlink({str(st['models'])!r}, {str(st['tmp'] / 'mlink')!r})\n"
                                               f"exec(open({str(st['tmp'] / 'mlink' / helper.name)!r}).read())\n")
    r = load(model)
    assert unreviewed(r)
    assert r.json()["path"] == str(helper.resolve())
    assert "mlink" in r.json()["detail"]
    assert not marker2.exists()


def test_an_interpreter_behind_env_is_read(st):
    import shutil
    if not shutil.which("awk"):
        pytest.skip("awk not installed")
    marker2 = st["tmp"] / "envawk_ran.txt"
    helper = st["models"] / "hx_envawk.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    argv = ["env", "LC_ALL=C", "awk", f'BEGIN {{ while ((getline l < "{helper}") > 0) print l }}']
    model = _plain_model(st["tmp"] / "EnvAwk", f"import subprocess\nexec(subprocess.run({argv!r}, capture_output=True, text=True).stdout)\n")
    assert unreviewed(load(model))
    assert not marker2.exists()


@pytest.mark.parametrize("something_tracked", [False, True])
def test_a_helper_the_assistant_writes_while_a_model_loads_is_refused(tmp_path, monkeypatch, something_tracked):
    """The review state is read again during a task when it changed on
    disk, so a file the assistant writes while a model is running is
    checked like any other, in the warm worker and in a forked child."""
    import threading
    monkeypatch.setenv("PSYNEUVIEW_PREVIEW_ROOT", str(tmp_path / "previews"))
    folder = tmp_path / "RW"
    folder.mkdir()
    files.set_folders_provider(lambda: [{"path": str(folder), "access": "read_write"}])
    try:
        if something_tracked:
            files.write_model_file(str(folder / "other_model.py"), marker_model(tmp_path / "never.txt"), base_hash=None)
        marker2 = tmp_path / "midload_ran.txt"
        own = tmp_path / "Own" / "slow.py"
        own.parent.mkdir()
        own.write_text(f"import sys, time\nsys.path.insert(0, {str(folder)!r})\ntime.sleep(3)\nimport mid_helper\n"
                       "import psyneulink as pnl\ncomp = pnl.Composition(name='c')\n")

        def writer():
            time.sleep(1.0)
            files.write_model_file(str(folder.resolve() / "mid_helper.py"),
                                   f"from pathlib import Path\nPath({str(marker2)!r}).write_text('ran')\nimport psyneulink as pnl\n",
                                   base_hash=None)

        t = threading.Thread(target=writer)
        t.start()
        r = load(own)
        t.join()
        assert unreviewed(r), r.text[:300]
        assert not marker2.exists()
    finally:
        files.set_folders_provider(files._folders_from_settings)


# ── 18. the fourth round of review of PR #310 ───────────────────────────


def test_a_leftover_process_cannot_forge_a_later_tasks_answer(st):
    """G3: a process the model starts that leaves the process group
    (``setsid``) outlives the task. In the fork server it never holds the
    server's output pipe, and an answer must carry the task's token, so it
    can't answer for a later task: the next model still gets its 409, and
    the three tasks after that still get their own answers."""
    marker2 = st["tmp"] / "forge_ran.txt"
    helper = st["models"] / "hx_forge_out.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    alive = st["tmp"] / "gc_alive.txt"
    fake = json.dumps({"compositions": [], "forged": True})
    gc = ("import os, time, sys\nos.setsid()\ntime.sleep(2.5)\n"
          f"open({str(alive)!r}, 'w').write('alive')\n"
          "for fd in (1, 2):\n"
          "    try:\n"
          f"        os.write(fd, ('###PSYNEUVIEW_CHILD### 1\\n###PSYNEUVIEW_RESULT###\\n' + {fake!r} + '\\n').encode())\n"
          "    except OSError:\n"
          "        pass\n")
    first = _plain_model(st["tmp"] / "G3a", f"import subprocess\nsubprocess.Popen([sys.executable, '-c', {gc!r}])\n")
    assert _runs_normally(load(first))
    second = _plain_model(st["tmp"] / "G3b", f"import time\ntime.sleep(4)\nexec(open({str(helper)!r}).read())\n")
    r = load(second)
    assert unreviewed(r), r.text[:300]
    assert "forged" not in r.text
    assert not marker2.exists()
    for i in range(3):
        model = _plain_model(st["tmp"] / f"G3c{i}", f"comp_name_{i} = 'c{i}'\n")
        r = load(model)
        assert _runs_normally(r), r.text[:300]
        assert "forged" not in r.text


SHELL_SPELLINGS = {
    "quoted_split": lambda d, n: ["sh", "-c", f"cd {d} && cat {n[:3]}''{n[3:]}"],
    "backslash_split": lambda d, n: ["sh", "-c", f"cd {d} && cat {n[:3]}\\{n[3:]}"],
    "double_quoted": lambda d, n: ["bash", "-c", f'cd {d} && cat "{n}"'],
    "redirect": lambda d, n: ["sh", "-c", f"cd {d} && cat <{n}"],
    "find_name_glob": lambda d, n: ["sh", "-c", f"find {d} -name '{n[:6]}*' -exec cat {{}} \;"],
    "shell_true": lambda d, n: f"cd {d} && cat {n[:3]}''{n[3:]}",
}


@pytest.mark.parametrize("how", list(SHELL_SPELLINGS))
def test_shell_text_spellings_of_an_unreviewed_file_are_refused(st, how):
    """G4: in shell command text, a name is read as the shell reads it,
    quotes and escapes taken out, and a pattern with a literal start that
    matches a tracked, unapproved file's name counts."""
    marker2 = st["tmp"] / f"g4_ran_{how}.txt"
    helper = st["models"] / f"hx_g4_{how}.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    argv = SHELL_SPELLINGS[how](str(helper.parent), helper.name)
    shell = ", shell=True" if isinstance(argv, str) else ""
    model = _plain_model(st["tmp"] / f"G4_{how}", f"import subprocess\nexec(subprocess.run({argv!r}{shell}, capture_output=True, text=True).stdout)\n")
    assert unreviewed(load(model))
    assert not marker2.exists()


def test_a_model_cannot_write_code_that_later_tasks_import(st):
    """G1, partly: while something is tracked, a model in the worker can't
    write, move or remove the app's code, PsyNeuLink's or an installed
    package's (a process it starts can; #311 closes that)."""
    import psyneulink
    target = APP_DIR / "services" / "show_graph_guard.py"
    before = target.read_text()
    pnl_file = Path(psyneulink.__file__)
    for stmt in (f"open({str(target)!r}, 'a').write('# changed')\n",
                 f"open({str(APP_DIR / 'services' / 'new_module.py')!r}, 'w').write('x = 1')\n",
                 f"open({str(pnl_file.parent / 'zz_planted.py')!r}, 'w').write('x = 1')\n"):
        r = load(_plain_model(st["tmp"] / f"G1_{abs(hash(stmt))}", stmt))
        assert unreviewed(r), r.text[:300]
    assert target.read_text() == before
    assert not (APP_DIR / "services" / "new_module.py").exists()
    assert not (pnl_file.parent / "zz_planted.py").exists()
