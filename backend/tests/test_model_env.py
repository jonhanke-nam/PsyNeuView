"""Model runs get an allow-listed environment, never the server's (#179, B2).

A secret the user exported before starting PsyNeuView (a ``GITHUB_TOKEN``,
cloud credentials, a key of their own, the page secret's variables) is
planted in the server's environment; a model that writes out its whole
``os.environ`` then shows none of them, through the warm worker, the fork
server, the pool, the one-shot fallback and a Learn job. Run the file with
``PSYNEUVIEW_OS_SANDBOX=on`` for the same under the operating-system sandbox.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services import model_env, sandbox
from tests.test_assistant_runner_guard import (  # noqa: F401  (st is a fixture)
    _wait_job,
    client,
    load,
    review,
    st,
)

PLANTED = {
    "GITHUB_TOKEN": "ghp_planted_github",
    "GH_TOKEN": "planted_gh",
    "AWS_ACCESS_KEY_ID": "AKIAPLANTED",
    "AWS_SECRET_ACCESS_KEY": "planted_aws_secret",
    "AWS_PROFILE": "planted_profile",
    "ANTHROPIC_API_KEY": "sk-ant-planted",
    "OPENAI_API_KEY": "sk-planted",
    "MY_SERVICE_TOKEN": "planted_service_token",
    "DB_PASSWORD": "planted_password",
    "SOME_SECRET": "planted_some_secret",
    "PSYNEUVIEW_GITHUB_TOKEN": "planted_pnv_github",
    "PSYNEUVIEW_MCP_TOKEN": "planted_mcp_token",
    "PSYNEUVIEW_PAGE_SECRET": "planted_page_secret_value_long_enough",
    "PSYNEUVIEW_PAGE_SECRET_FILE": "/tmp/planted-page-secret-file",
    "AN_UNLISTED_VARIABLE": "planted_unlisted",
}


# ── the rule itself ─────────────────────────────────────────────────────


@pytest.mark.parametrize("name", sorted(PLANTED))
def test_planted_names_are_dropped(name):
    assert not model_env.is_kept(name)


@pytest.mark.parametrize("name", ["PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "PYTHONPATH",
                                  "VIRTUAL_ENV", "GV_FILE_PATH", "PNL_LLVM_DEBUG",
                                  "PSYNEUVIEW_WORKER_ISOLATION", "PSYNEUVIEW_OS_SANDBOX_POLICY",
                                  "PSYNEUVIEW_ASSISTANT_REVIEW_FILE", "PSYNEUVIEW_TASK_MARK"])
def test_what_the_runner_needs_is_kept(name):
    assert model_env.is_kept(name)


def test_a_policy_is_added_to_the_clean_environment(monkeypatch):
    from app.services import os_sandbox
    monkeypatch.setenv("GITHUB_TOKEN", "x")
    env = os_sandbox.launch_env({"key": "k", "mark": "m"})
    assert "GITHUB_TOKEN" not in env
    assert env["PSYNEUVIEW_OS_SANDBOX_POLICY"] and env["PSYNEUVIEW_TASK_MARK"] == "m"


# ── through the real runner ─────────────────────────────────────────────


def _env_model(folder: Path) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    model = folder / "reads_env.py"
    model.write_text(
        "import os, json\n"
        "here = os.path.dirname(os.path.abspath(__file__))\n"
        "with open(os.path.join(here, 'env_seen.json'), 'w') as f:\n"
        "    json.dump(dict(os.environ), f)\n"
        "import psyneulink as pnl\n"
        "comp = pnl.Composition(name='env_probe')\n"
    )
    return model


def _check(seen_file: Path) -> None:
    seen = json.loads(seen_file.read_text())
    leaked = sorted(k for k, v in seen.items() if k in PLANTED or v in PLANTED.values())
    assert leaked == [], f"the model saw {leaked}"
    assert seen.get("PATH") and seen.get("HOME")
    # Nothing outside the allow-list reached it, whatever the server had.
    assert all(model_env.is_kept(k) or k.startswith("PSYNEUVIEW_OS_SANDBOX") for k in seen), \
        sorted(k for k in seen if not model_env.is_kept(k))


@pytest.fixture
def planted(monkeypatch):
    for k, v in PLANTED.items():
        monkeypatch.setenv(k, v)
    # Every worker already running started before the plant: start them again,
    # so a worker that inherited the server's environment would show it.
    sandbox.restart_warm_worker()
    yield
    for k in PLANTED:
        monkeypatch.delenv(k, raising=False)
    sandbox.restart_warm_worker()


def test_the_warm_worker_sees_no_planted_secret(planted, tmp_path):
    model = _env_model(tmp_path / "Own")
    r = load(model)
    assert r.status_code == 200, r.text
    _check(model.parent / "env_seen.json")


@pytest.mark.parametrize("mode", ["fork", "pool"])
def test_a_fresh_process_per_task_sees_no_planted_secret(planted, st, mode):
    # Something the assistant wrote is tracked (st), so each task runs in a
    # fresh process: the fork server's child, or a pool worker.
    st["monkeypatch"].setenv("PSYNEUVIEW_WORKER_ISOLATION", mode)
    model = _env_model(st["tmp"] / "Own")
    r = load(model)
    assert r.status_code == 200, r.text
    _check(model.parent / "env_seen.json")


def test_the_one_shot_fallback_sees_no_planted_secret(planted, tmp_path):
    model = _env_model(tmp_path / "Own")
    result = sandbox._run_cold("introspect", {"file_path": str(model)}, 120)
    assert "error" not in result, result
    _check(model.parent / "env_seen.json")


def test_a_learn_job_sees_no_planted_secret(planted, tmp_path):
    from tests.test_assistant_runner_guard import _job_body
    model = _env_model(tmp_path / "Own")
    model.write_text(model.read_text() + (
        "a = pnl.TransferMechanism(name='a', input_shapes=2)\n"
        "b = pnl.TransferMechanism(name='b', input_shapes=2)\n"
        "comp.add_backpropagation_learning_pathway([a, b])\n"))
    r = client.post("/api/jobs", json=_job_body(model))
    assert r.status_code == 200, r.text
    snap = _wait_job(r.json()["job"]["id"] if "job" in r.json() else r.json()["id"])
    assert snap["status"] == "done", snap.get("error")
    _check(model.parent / "env_seen.json")
