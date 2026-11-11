"""The independent review of #179's Phase 3: each attack it proved, kept as
a test that now asserts the attack fails.

Every test puts a model that writes a marker file where the review found a
way to run it, and asserts the marker never appears. Everything is under
``tmp_path``: the preview root, the bundles root and the review state are
redirected, so nothing touches the user's own folders.
"""

from __future__ import annotations

import http.server
import json
import os
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.assistant import agents, files, review, tools
from app.services.assistant import log as alog
from app.services.assistant import settings as asettings

client = TestClient(app, base_url="http://127.0.0.1:8000", headers={"origin": "http://127.0.0.1:8000"})


def marker_model(marker, extra: str = "") -> str:
    return (
        "from pathlib import Path\n"
        f"Path({str(marker)!r}).write_text('ran')\n"
        f"{extra}"
        "import psyneulink as pnl\n"
        "comp = pnl.Composition(name='poc')\n"
    )


@pytest.fixture
def st(tmp_path, monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_PREVIEW_ROOT", str(tmp_path / "previews"))
    monkeypatch.setenv("PSYNEUVIEW_BUNDLES_ROOT", str(tmp_path / "bundles"))
    models = tmp_path / "Models"
    models.mkdir()
    # The user's own model lives in its own folder; the assistant wrote in another.
    own = tmp_path / "Own"
    own.mkdir()
    victim = own / "users_own.py"
    victim.write_text("import psyneulink as pnl\ncomp = pnl.Composition(name='own')\n")
    marker = tmp_path / "ran.txt"
    text = marker_model(marker)
    agent_file = models / "assistant_wrote.py"
    agent_file.write_text(text)
    review.mark_unreviewed(str(agent_file), text)
    assert review.is_unreviewed_content(text)
    return dict(models=models, own=own, victim=victim, marker=marker, text=text, agent_file=agent_file, tmp=tmp_path, monkeypatch=monkeypatch)


def unreviewed(r) -> bool:
    return r.status_code == 409 and r.json().get("reason") == review.REASON


# ── 1. preview, the stale save, disk-source ──────────────────────────────


def test_preview_refuses_unreviewed_text_and_run_has_no_copy_to_target(st):
    r = client.post("/api/model/preview", json={"file_path": str(st["victim"]), "source": st["text"]})
    assert unreviewed(r), r.text
    assert not st["marker"].exists()
    # No preview copy was written, so Run has nothing untracked to target.
    from app.services.preview import preview_path
    assert not preview_path(str(st["victim"])).exists()
    # A trivially changed copy is refused too.
    r = client.post("/api/model/preview", json={"file_path": str(st["victim"]), "source": st["text"] + "# \n"})
    assert unreviewed(r)
    assert not st["marker"].exists()


def test_preview_of_a_tracked_file_is_refused_until_approved(st):
    """Typing in the editor of a tracked, unreviewed file previews nothing;
    the review offer is the way forward, and after approval previews work."""
    r = client.post("/api/model/preview", json={"file_path": str(st["agent_file"]), "source": "x = 1\n"})
    assert unreviewed(r)
    shown = client.post("/api/assistant/review/status", json={"path": str(st["agent_file"])}).json()
    assert client.post("/api/assistant/review/approve", json={"path": str(st["agent_file"]), "content_hash": shown["content_hash"]}).status_code == 200
    r = client.post("/api/model/preview", json={"file_path": str(st["agent_file"]), "source": st["text"]})
    assert r.status_code == 200, r.text


def test_stale_save_does_not_hand_over_unreviewed_text(st):
    r = client.post("/api/model/save-source", json={
        "file_path": str(st["agent_file"]), "source": "x = 2\n", "base_source": "x = 1\n",
    })
    assert unreviewed(r), r.text
    assert "disk_source" not in r.text
    assert st["agent_file"].read_text() == st["text"]  # nothing written over it
    assert not st["marker"].exists()
    # disk-source still reads (reading isn't running) but says so.
    r = client.post("/api/model/disk-source", json={"file_path": str(st["agent_file"])})
    assert r.status_code == 200 and r.json()["assistant_unreviewed"] is True
    r = client.post("/api/model/disk-source", json={"file_path": str(st["victim"])})
    assert r.status_code == 200 and r.json()["assistant_unreviewed"] is False


# ── 2 and 3. save-as, save-copy, open-project ────────────────────────────


def test_save_as_of_unreviewed_text_is_written_not_run(st):
    r = client.post("/api/models/save-as", json={"source": st["text"], "file_name": "copy.py", "directory": str(st["own"])})
    assert unreviewed(r), r.text
    copy = st["own"] / "copy.py"
    assert copy.read_text() == st["text"] and review.is_tracked(str(copy))
    assert not st["marker"].exists()
    assert unreviewed(client.post("/api/model/load", json={"file_path": str(copy)}))
    assert not st["marker"].exists()


def test_save_copy_py_of_unreviewed_text_is_tracked(st):
    r = client.post("/api/model/save-copy", json={
        "file_path": str(st["victim"]), "fmt": "py", "file_name": "copy2.py", "directory": str(st["own"]), "source": st["text"],
    })
    assert unreviewed(r), r.text
    copy2 = st["own"] / "copy2.py"
    assert copy2.read_text() == st["text"] and review.is_tracked(str(copy2))
    assert unreviewed(client.post("/api/model/load", json={"file_path": str(copy2)}))
    assert not st["marker"].exists()


def test_save_copy_bundle_of_unreviewed_file_is_refused(st):
    r = client.post("/api/model/save-copy", json={
        "file_path": str(st["agent_file"]), "fmt": "pnlproject", "file_name": "b.pnlproject", "directory": str(st["own"]),
    })
    assert unreviewed(r), r.text
    assert not (st["own"] / "b.pnlproject").exists()
    for fmt in ("mdf-yaml", "mdf-json"):
        r = client.post("/api/model/save-copy", json={"file_path": str(st["agent_file"]), "fmt": fmt, "file_name": "m", "directory": str(st["own"])})
        assert unreviewed(r), r.text
    assert not st["marker"].exists()


def test_open_project_of_a_bundle_carrying_unreviewed_text_is_refused(st):
    """A bundle built elsewhere (here: by hand) that carries the unreviewed
    text: open-project extracts, tracks the working copy, and doesn't run it."""
    from app.services import bundle

    # Build the bundle from a harmless file, then put the unreviewed text in it.
    data, _ = bundle.build_bundle_bytes(str(st["victim"]), model_name="poc", pnl_version="0")
    import io
    import zipfile
    src = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as dst:
        for item in src.infolist():
            payload = src.read(item.filename)
            if item.filename.endswith(".py"):
                payload = st["text"].encode()
            dst.writestr(item, payload)
    bundle_path = st["own"] / "carried.pnlproject"
    bundle_path.write_bytes(out.getvalue())
    r = client.post("/api/model/open-project", json={"bundle_path": str(bundle_path)})
    assert unreviewed(r), r.text
    assert not st["marker"].exists()
    working = r.json()["path"]
    assert working.startswith(str(st["tmp"] / "bundles")) and review.is_tracked(working)


# ── 4. the normalised index ──────────────────────────────────────────────


@pytest.mark.parametrize("variant", [
    lambda t: t + "\n",
    lambda t: t.replace("\n", "\r\n"),
    lambda t: t.replace("\n", "   \n"),
    lambda t: "# a comment\n\n" + t + "\n# another\n",
    lambda t: "\n".join(line + "  # trailing" if False else line for line in t.splitlines()) + "\n\n\n",
])
def test_trivially_changed_copies_are_still_unreviewed(st, variant):
    text = variant(st["text"])
    assert review.is_unreviewed_content(text)
    victim2 = st["own"] / "another_own.py"
    victim2.write_text("x = 1\n")
    r = client.post("/api/model/save-source", json={"file_path": str(victim2), "source": text})
    assert unreviewed(r), r.text
    assert review.is_tracked(str(victim2)) and not st["marker"].exists()


def test_a_copy_the_user_edits_by_hand_is_the_users(st):
    """What still gets through, by design: a real edit makes it the user's file."""
    assert not review.is_unreviewed_content(st["text"].replace("'poc'", "'mine'"))


def test_approval_stays_exact(st):
    shown = client.post("/api/assistant/review/status", json={"path": str(st["agent_file"])}).json()
    assert client.post("/api/assistant/review/approve", json={"path": str(st["agent_file"]), "content_hash": shown["content_hash"]}).status_code == 200
    assert review.is_runnable(str(st["agent_file"]), st["text"])
    assert not review.is_runnable(str(st["agent_file"]), st["text"] + "\n")
    # Approved content is no longer "unreviewed content" anywhere, exactly or normalised.
    assert not review.is_unreviewed_content(st["text"]) and not review.is_unreviewed_content(st["text"] + "\n")


# ── 5. star-import conversion ────────────────────────────────────────────


def test_star_import_conversion_waits_for_review(st):
    text = "from psyneulink import *\n" + marker_model(st["marker"]).replace("import psyneulink as pnl\ncomp = pnl.Composition(name='poc')\n", "comp = Composition(name='poc')\n")
    f = st["models"] / "star.py"
    f.write_text(text)
    review.mark_unreviewed(str(f), text)
    assert unreviewed(client.post("/api/model/load", json={"file_path": str(f)}))
    assert not st["marker"].exists()
    assert not (st["models"] / "star.star_import_original.py").exists(), "a copy was made before the guard"
    assert f.read_text() == text


# ── 6. folders and names ─────────────────────────────────────────────────


def test_another_python_install_cannot_be_designated(tmp_path, monkeypatch):
    home = tmp_path / "home"
    sp = home / "miniconda3" / "envs" / "e" / "lib" / "python3.12" / "site-packages"
    sp.mkdir(parents=True)
    (home / "miniconda3" / "conda-meta").mkdir()
    venv = home / "proj" / "venv"
    venv.mkdir(parents=True)
    (venv / "pyvenv.cfg").write_text("home = /usr/bin\n")
    hidden = home / "proj2" / ".venv"
    hidden.mkdir(parents=True)
    (hidden / "pyvenv.cfg").write_text("home = /usr/bin\n")
    (home / "proj" / "models").mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    for p in (home / "miniconda3", home / "miniconda3" / "envs" / "e", sp, home / "miniconda3" / "envs" / "e" / "lib" / "python3.12",
              home / "proj", venv):
        with pytest.raises(files.PathRefused) as e:
            files.validate_folder(str(p))
        assert e.value.reason == "python_install", p
    # A plain folder beside them is fine, and so is a project whose
    # environment is hidden (.venv): the assistant can't enter hidden folders.
    assert files.validate_folder(str(home / "proj" / "models")) == home / "proj" / "models"
    assert files.validate_folder(str(home / "proj2")) == home / "proj2"
    with pytest.raises(files.PathRefused):
        files.validate_folder(str(hidden))


def test_install_scan_is_bounded(tmp_path, monkeypatch):
    monkeypatch.setattr(files, "MAX_INSTALL_SCAN_ENTRIES", 50)
    big = tmp_path / "big"
    for i in range(80):
        (big / f"d{i:03d}").mkdir(parents=True)
    deep = big / "d079" / "venv"
    deep.mkdir()
    (deep / "pyvenv.cfg").write_text("")
    # Past the limit the scan stops rather than reading everything; the folder
    # is accepted, and the ancestors check still protects the install itself.
    assert files.validate_folder(str(big)) == big
    with pytest.raises(files.PathRefused):
        files.validate_folder(str(deep))


@pytest.mark.parametrize("name", ["numpy.py", "psyneulink.py", "__init__.py", "sitecustomize.py", "usercustomize.py", "os.py", "json.py", "torch.py", "_private.py"])
def test_shadowing_names_are_refused(st, name):
    st["monkeypatch"].setattr(files, "folders_provider", lambda: [{"path": str(st["models"]), "access": "read_write"}])
    with pytest.raises(files.PathRefused) as e:
        files.resolve_allowed(str(st["models"] / name), write=True)
    assert e.value.reason == "shadows_module"
    with pytest.raises(files.PathRefused):
        files.write_model_file(str(st["models"] / name), "import psyneulink as pnl\n", base_hash=None)
    assert not (st["models"] / name).exists()


def test_new_files_are_classified_by_content(st):
    st["monkeypatch"].setattr(files, "folders_provider", lambda: [{"path": str(st["models"]), "access": "read_write"}])
    helper = st["models"] / "helper_mod.py"
    with pytest.raises(files.PathRefused) as e:
        files.write_model_file(str(helper), "from pathlib import Path\nPath('x').write_text('ran')\n", base_hash=None)
    assert e.value.reason == "wrong_type" and not helper.exists()
    files.write_model_file(str(helper), "import psyneulink as pnl\ncomp = pnl.Composition(name='h')\n", base_hash=None)
    assert helper.exists() and review.is_tracked(str(helper))


# ── 7. a file the assistant wrote, imported by a model ───────────────────
#
# Through the real runner (the warm worker behind /model/load), so the
# import guard is the one the app uses, with its per-task refresh.


def _model_importing(what: str, marker_hint: str = "") -> str:
    return (
        "import sys, os\n"
        "sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))\n"
        f"{what}\n"
        "import psyneulink as pnl\n"
        "comp = pnl.Composition(name='h2')\n"
    )


def _helper(marker) -> str:
    return f"from pathlib import Path\nPath({str(marker)!r}).write_text('ran')\nimport psyneulink as pnl\n"


def load(path):
    return client.post("/api/model/load", json={"file_path": str(path)})


def approve(path):
    shown = client.post("/api/assistant/review/status", json={"path": str(path)}).json()
    r = client.post("/api/assistant/review/approve", json={"path": str(path), "content_hash": shown["content_hash"]})
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("layout", ["subfolder_module", "package_init", "importlib", "abs_sys_path"])
def test_unreviewed_import_is_refused_and_named(st, layout):
    marker2 = st["tmp"] / "ran2.txt"
    models = st["models"]
    if layout == "subfolder_module":
        helper = models / "pkg" / "helper.py"
        helper.parent.mkdir()
        (models / "pkg" / "__init__.py").write_text("")
        importer = "import pkg.helper"
    elif layout == "package_init":
        helper = models / "pkg2" / "__init__.py"
        helper.parent.mkdir()
        importer = "import pkg2"
    elif layout == "importlib":
        helper = models / "helper_mod.py"
        importer = "import importlib\nimportlib.import_module('helper_mod')"
    else:
        elsewhere = st["tmp"] / "Elsewhere"
        elsewhere.mkdir()
        helper = elsewhere / "far_helper.py"
        importer = f"sys.path.insert(0, {str(elsewhere)!r})\nimport far_helper"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    model = models / "uses_it.py"
    model.write_text(_model_importing(importer))
    r = load(model)
    assert unreviewed(r), r.text
    assert r.json()["path"] == str(helper.resolve()), r.json()
    assert "imports it" in r.json()["detail"]
    assert not marker2.exists()
    # Approving the helper lets the model run, through the same runner.
    approve(helper)
    r = load(model)
    assert r.status_code == 200, r.text
    assert marker2.exists()


def test_helper_approved_then_edited_across_two_tasks_in_the_same_worker(st):
    """Task 1 imports the approved helper (now cached in the worker). The
    helper is edited. Task 2 must import it again, through the guard."""
    marker2 = st["tmp"] / "ran2.txt"
    helper = st["models"] / "helper_mod.py"
    helper.write_text(_helper(marker2))
    review.mark_unreviewed(str(helper), helper.read_text())
    approve(helper)
    model = st["models"] / "uses_it.py"
    model.write_text(_model_importing("import helper_mod"))
    assert load(model).status_code == 200
    assert marker2.exists()
    marker2.unlink()
    marker3 = st["tmp"] / "ran3.txt"
    # Edited: no longer the approved text. A different length too, since Python
    # keys __pycache__ on the source's mtime (whole seconds) and size.
    helper.write_text(_helper(marker3) + "# edited\n")
    r = load(model)
    assert unreviewed(r), r.text
    assert r.json()["path"] == str(helper.resolve())
    assert not marker3.exists() and not marker2.exists()
    approve(helper)
    assert load(model).status_code == 200
    assert marker3.exists()


def test_a_model_beside_an_unapproved_file_runs_if_it_does_not_import_it(st):
    beside = st["models"] / "beside.py"
    marker2 = st["tmp"] / "beside_ran.txt"
    beside.write_text("from pathlib import Path\n" + f"Path({str(marker2)!r}).write_text('ran')\n" + "import psyneulink as pnl\ncomp = pnl.Composition(name='b')\n")
    assert review.is_tracked(str(st["agent_file"])) and not review.is_runnable(str(st["agent_file"]), st["text"])
    r = load(beside)
    assert r.status_code == 200, r.text
    assert marker2.exists() and not st["marker"].exists()


def test_nothing_tracked_means_no_change(tmp_path, monkeypatch):
    from app.services.assistant import import_guard

    monkeypatch.setenv(review.STATE_ENV, str(tmp_path / "none" / "review.json"))
    review._cache = None
    import_guard.refresh()
    assert import_guard.tracked_count() == 0 and not import_guard.is_broken()
    own = tmp_path / "own.py"
    helper = tmp_path / "plain_helper.py"
    helper.write_text("VALUE = 1\n")
    own.write_text(_model_importing("import plain_helper"))
    assert client.post("/api/model/load", json={"file_path": str(own)}).status_code == 200


def test_library_paths_are_never_vetted():
    from app.services.assistant import import_guard
    import psyneulink

    assert import_guard.is_library_path(os.path.realpath(psyneulink.__file__))
    assert import_guard.is_library_path(os.path.realpath(json.__file__))
    assert not import_guard.is_library_path("/Users/someone/Models/helper.py")


def test_state_unreadable_fails_closed_at_import_time(st):
    from app.services.assistant import import_guard

    review.state_path().write_text("{not json")
    review.backup_path().write_text("{not json either")
    review._cache = None
    import_guard.refresh()
    assert import_guard.is_broken()
    r = load(st["victim"])
    assert r.status_code == 409 and r.json()["reason"] == "assistant_review_state_unreadable"


# ── 8. redirects ─────────────────────────────────────────────────────────


def _serve(handler_cls):
    srv = http.server.HTTPServer(("127.0.0.1", 0), handler_cls)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def test_redirect_is_not_followed_and_the_key_stays(monkeypatch):
    seen = {}

    class Collector(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            seen["headers"] = dict(self.headers)
            self._ok()

        do_POST = do_GET

        def _ok(self):
            body = json.dumps({"content": [{"type": "text", "text": "hi"}], "usage": {}}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    collector = _serve(Collector)
    target = f"http://localhost:{collector.server_port}/elsewhere"

    class Redirector(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            self.send_response(302)
            self.send_header("Location", target)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *a):
            pass

    redirector = _serve(Redirector)
    agent = agents.AnthropicAgent(model="m", key="sk-SECRET", base_url=f"http://127.0.0.1:{redirector.server_port}")
    try:
        with pytest.raises(agents.AgentError) as e:
            agent.reply(system="s", history=[{"role": "user", "text": "hello"}], tools=[])
    finally:
        redirector.shutdown()
        collector.shutdown()
    assert "redirect" in str(e.value) and "sk-SECRET" not in str(e.value)
    assert seen == {}, "the redirect target was reached"


# ── 9. a leftover base_url ───────────────────────────────────────────────


def test_base_url_does_not_carry_over_to_another_agent_type(tmp_path):
    cfg = tmp_path / "prefs.json"
    asettings.update_settings({"agent": {"type": "openai_compatible", "base_url": "https://proxy.example.com"}}, config_file=cfg, confirm_raise=True)
    cur = asettings.get_settings(config_file=cfg)
    new = asettings.update_settings({"agent": {"type": "anthropic"}}, config_file=cfg, confirm_raise=True)
    assert new["agent"]["base_url"] == ""
    assert agents.make_agent(new["agent"], key="sk")._base_url == agents.ANTHROPIC_URL
    # Changing where messages go is a raise, named with the real destination.
    raised = asettings.permission_raises(cur, new)
    assert any("api.anthropic.com" in r for r in raised), raised
    assert any("proxy.example.com" in r for r in asettings.permission_raises(asettings.defaults(), cur))
    with pytest.raises(asettings.RaiseNeedsConfirmation):
        asettings.update_settings({"agent": {"base_url": "https://other.example.com"}}, config_file=cfg)


# ── 10. a corrupt state file ─────────────────────────────────────────────


def test_corrupt_state_file_loads_the_backup(st):
    assert review.backup_path().exists()
    review.state_path().write_text("{not json")
    review._cache = None
    assert review.is_tracked(str(st["agent_file"]))
    assert unreviewed(client.post("/api/model/load", json={"file_path": str(st["agent_file"])}))
    assert not st["marker"].exists()


def test_corrupt_state_and_backup_fail_closed(st):
    review.state_path().write_text("{not json")
    review.backup_path().write_text("{not json either")
    review._cache = None
    assert review.state_broken()
    r = client.post("/api/model/load", json={"file_path": str(st["agent_file"])})
    assert r.status_code == 409 and r.json()["reason"] == "assistant_review_state_unreadable"
    r = client.post("/api/model/load", json={"file_path": str(st["victim"])})
    assert r.status_code == 409 and "review state" in r.json()["detail"]
    assert not st["marker"].exists()


def test_no_state_file_at_all_is_unaffected(tmp_path, monkeypatch):
    monkeypatch.setenv(review.STATE_ENV, str(tmp_path / "nowhere" / "review.json"))
    review._cache = None
    assert not review.state_broken()
    own = tmp_path / "own.py"
    own.write_text("import psyneulink as pnl\ncomp = pnl.Composition(name='own')\n")
    assert client.post("/api/model/load", json={"file_path": str(own)}).status_code == 200


# ── 11, 13, 14 and the suspected ones ────────────────────────────────────


class _FakeSession:
    def __init__(self):
        self.proposals = []

    def add_proposal(self, **fields):
        p = {"id": "p1", "state": "pending", "warnings": fields.get("warnings") or [], **fields}
        self.proposals.append(p)
        return p


def test_propose_file_write_needs_files_visibility(st):
    st["monkeypatch"].setattr(files, "folders_provider", lambda: [{"path": str(st["models"]), "access": "read_write"}])
    settings = asettings.defaults()
    settings["enabled"] = True
    settings["folders"] = [{"path": str(st["models"]), "access": "read_write"}]
    settings["visibility"]["files"] = False
    session = _FakeSession()
    ctx = tools.ToolContext(settings=settings, context={}, session=session)
    with pytest.raises(tools.ToolRefused):
        tools.propose_file_write(ctx, {"path": str(st["agent_file"]), "text": "x=1\n", "summary": "s"})
    assert session.proposals == []


def test_log_keeps_a_hash_never_the_text(tmp_path, monkeypatch):
    monkeypatch.setenv("PSYNEUVIEW_ASSISTANT_LOG", str(tmp_path / "log.jsonl"))
    secret = "SECRET_IN_MODEL = 1\n" * 50
    alog.record(session_id="s", tool="propose_file_write", args={"path": "/x.py", "text": secret, "summary": "s"}, allowed=True, ok=True)
    entries = alog.read_entries()
    assert "SECRET_IN_MODEL" not in json.dumps(entries)
    assert entries[-1]["args"]["text"].startswith("sha256:") and "1000 chars" in entries[-1]["args"]["text"]


def test_non_finite_values_are_refused():
    for value in ("1e999", "-1e999", "1e999j", [1e999], float("nan"), "[1, 1e999]", "{'a': -1e999}"):
        with pytest.raises(tools.ToolRefused):
            tools.plain_literal(value)
    assert tools.plain_literal("1e300") == "1e+300"


def test_invisible_characters_are_flagged():
    for text in ("x = 1  # ‮ desrever", "x = 1​", "﻿x = 1", "a⁦b⁩"):
        assert any("invisible" in w for w in tools.python_warnings(text)), repr(text)
    assert not any("invisible" in w for w in tools.python_warnings("x = 1\n"))


def test_rename_node_name_is_plain():
    ok = tools.check_app_edit_op({"op": "rename_node", "args": {"var_name": "a", "new_name": "STATE [VALUE] (2)"}})
    assert ok["args"]["new_name"] == "STATE [VALUE] (2)"
    for bad in ("<b>x</b>", "a‮b", "x'y", 'x"y', "x\\y", "a\nb", "{x}", "x;y", "#x"):
        with pytest.raises(tools.ToolRefused):
            tools.check_app_edit_op({"op": "rename_node", "args": {"var_name": "a", "new_name": bad}})
