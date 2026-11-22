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
        "services/converter.py": (0, 1),         # in-process load: require_runnable + guard_imports()
        "services/executor.py": (0, 4),          # in-process run, learn, input nodes: require_runnable + guard_imports(); one keyword eval of a parameter
        "services/github_auth.py": (1, 0),       # git credential helper
        "services/install_manager.py": (3, 0),   # pip or uv; whether uv runs (#259)
        "services/introspector.py": (0, 2),      # in-process load: require_runnable + guard_imports(); one keyword eval of a parameter
        "services/jobs.py": (2, 0),              # the job worker: create_job → require_runnable; payload carries the state
        "services/locations.py": (1, 1),         # git; a dynamic import of an app module
        "services/quick_check.py": (0, 1),       # not a load: the "exec(" and "eval(" it looks for in the text (#256); parse and compile only
        "services/running_from.py": (1, 0),      # which process runs the app
        "services/sandbox.py": (4, 0),           # warm worker + cold fallback: run_in_sandbox → require_runnable; payload carries the state
        "services/sandbox_worker.py": (0, 6),    # the guard's own load, load_module, load_module_resilient and its exec: check_model_path + hooks; two keyword evals
        "services/settings_info.py": (2, 0),     # git
        "services/working_copies.py": (2, 0),    # which files are open
    }
    spawn = re.compile(
        r"WORKER_PATH|sandbox_worker\.py|Popen\(|subprocess\.run\(|subprocess\.check_output\(|subprocess\.call\(|"
        r"subprocess\.check_call\(|os\.system|os\.popen|os\.exec|os\.spawn|multiprocessing"
    )
    load = re.compile(
        r"spec_from_file_location\(|SourceFileLoader\(|SourcelessFileLoader\(|ExtensionFileLoader\(|runpy|"
        r"(?<![\w.])exec\(|\.exec\(|(?<![\w.])eval\(|\.eval\(|__import__\(|import_module\("
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
    something is tracked, two tasks later the count is still one."""
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
    model.write_text(_model_importing(f"sys.path.insert(0, {str(checkout)!r})\nimport fakepnl"))
    assert load(model).status_code == 200
    assert count.read_text() == "1"
    assert review.is_tracked(str(st["agent_file"]))  # something is tracked
    assert load(model).status_code == 200
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
    }[how]


OTHER_WAYS = [
    "exec_open", "exec_open_caught", "pathlib_read", "exec_compile", "runpy_run_path", "runpy_run_module",
    "subprocess_list", "subprocess_shell_by_name", "os_system", "copy_then_import", "rename_then_import",
    "link_then_import",
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
