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
    result = json.loads(proc.stdout.split("###PSYNEWVIEW_RESULT###")[-1].strip())
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
    result = json.loads(proc.stdout.split("###PSYNEWVIEW_RESULT###")[-1].strip())
    assert result.get("unreviewed_state") is True, result
    assert not (st["tmp"] / "own_ran.txt").exists()


def test_every_spawn_and_exec_site_is_listed():
    """A new way of starting the worker or executing model code has to be
    added here, with its guard, or this fails. Exact counts per file, so a
    second site in a listed file is caught too."""
    allowed = {
        # file: (worker spawns, by-path loads)
        "services/sandbox.py": (2, 0),          # warm worker + cold fallback: run_in_sandbox → require_runnable; payload carries the state
        "services/jobs.py": (1, 0),             # job worker: create_job → require_runnable; payload carries the state
        "services/sandbox_worker.py": (0, 4),   # the guard's own load, load_module, load_module_resilient (+ its exec): check_model_path + hooks
        "services/introspector.py": (0, 1),     # in-process: require_runnable + guard_imports()
        "services/executor.py": (0, 3),         # in-process run, learn, input nodes: require_runnable + guard_imports()
        "services/converter.py": (0, 1),        # convert: require_runnable + guard_imports()
    }
    spawn = "[sys.executable, WORKER_PATH"  # with or without "--persistent"
    load = re.compile(r"spec_from_file_location\(|SourceFileLoader\(|runpy\.|(?<![\w.])exec\(")
    found: dict[str, tuple[int, int]] = {}
    for py in sorted(APP_DIR.rglob("*.py")):
        rel = str(py.relative_to(APP_DIR))
        if rel == "services/assistant/import_guard.py":
            continue  # the guard itself
        spawns = loads = 0
        for line in py.read_text(encoding="utf-8").splitlines():
            code = line.split("#", 1)[0]
            if spawn in code:
                spawns += 1
            if load.search(code):
                loads += 1
        if spawns or loads:
            found[rel] = (spawns, loads)
    unexpected = {k: v for k, v in found.items() if k not in allowed}
    assert not unexpected, f"a worker spawn or by-path load outside the guarded list: {unexpected}"
    for rel, expected in allowed.items():
        assert found.get(rel, (0, 0)) == expected, f"{rel}: {found.get(rel)} (spawns, loads), listed as {expected}"


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
