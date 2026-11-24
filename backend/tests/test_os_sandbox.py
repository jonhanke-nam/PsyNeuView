"""The operating-system sandbox for model runs (#311), tested at the process.

A process applies the policy the server builds (``os_sandbox.policy``) to
itself, exactly as the model runner does, and then tries each way the
security review found to get round the import guard on disk, through
child processes, through ``ctypes`` and over the network. Every one must
be refused by the kernel. The same attacks through the real routes and the
real runner are in ``test_os_sandbox_routes.py``.

Skipped, with the reason, where no sandbox can be applied (native Windows,
a Linux kernel without Landlock). CI runs this on Linux (Landlock and
seccomp); macOS (Seatbelt) is checked locally.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import textwrap
import threading
import unicodedata
from pathlib import Path

import pytest

from app.services import os_sandbox, os_sandbox_apply
from app.services.assistant import review

CAP = os_sandbox.capability()
needs_sandbox = pytest.mark.skipif(not CAP.get("ok"), reason=f"no OS sandbox here: {CAP.get('reason')}")

SERVICES = Path(os_sandbox_apply.__file__).resolve().parent

# The attacks, run inside a sandboxed process. Each entry is the name and
# a statement; ``ok`` means it worked, an exception means it was refused.
ATTACKS = r'''
import ctypes, json, os, shutil, socket, subprocess, sys, time
A = json.loads(sys.argv[1])
sys.path.insert(0, A["services"])
import os_sandbox_apply
os_sandbox_apply.apply(A["policy"])
U, OK_FILE, STATE, OUT, SCRATCH = A["unapproved"], A["approved"], A["state"], A["out"], A["policy"]["scratch"]
res = {}
def t(name, fn):
    try:
        v = fn()
        res[name] = ["ok", repr(v)[:80]]
    except BaseException as e:
        res[name] = ["refused", type(e).__name__ + ": " + str(e)[:80]]
def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=20, **kw)
    if r.returncode != 0:
        raise RuntimeError(f"exit {r.returncode}: {r.stderr.strip()[-80:]}")
    return r.stdout
def read_with_libc(p):
    libc = ctypes.CDLL(None, use_errno=True)
    fd = libc.open(p.encode(), 0)
    if fd < 0:
        raise OSError(ctypes.get_errno(), "libc open refused")
    buf = ctypes.create_string_buffer(4096)
    n = libc.read(fd, buf, 4096)
    libc.close(fd)
    return buf.raw[:n]
def chain():
    # R3/G5: a link made while its target is missing, then a folder link.
    a, d = os.path.join(SCRATCH, "alias.py"), os.path.join(SCRATCH, "dl")
    os.symlink(os.path.join(d, os.path.basename(U)), a)
    os.symlink(os.path.dirname(U), d)
    return open(a).read()
def ln_chain():
    a, d = os.path.join(SCRATCH, "alias2.py"), os.path.join(SCRATCH, "dl2")
    run(["ln", "-s", os.path.join(d, os.path.basename(U)), a])
    run(["ln", "-s", os.path.dirname(U), d])
    return open(a).read()
def grandchild():
    # G3: a process that leaves the task's process group still can't read it.
    code = f"import os; os.setsid(); print(open({U!r}).read())"
    return run([sys.executable, "-c", code])
def ctypes_child():
    code = f"import ctypes; l = ctypes.CDLL(None); fd = l.open({U!r}.encode(), 0); assert fd >= 0, 'refused'"
    return run([sys.executable, "-c", code])
def tcp():
    s = socket.create_connection(("127.0.0.1", A["port"]), timeout=3)
    s.sendall(b"hello"); s.close()
def write(p, text="x"):
    with open(p, "w") as f:
        f.write(text)
t("read_unapproved", lambda: open(U).read())
t("read_unapproved_bytes_os_open", lambda: os.read(os.open(U, os.O_RDONLY), 100))
t("read_unapproved_ctypes", lambda: read_with_libc(U))
t("read_unapproved_symlink", lambda: (os.symlink(U, os.path.join(SCRATCH, "s.py")), open(os.path.join(SCRATCH, "s.py")).read()))
t("read_unapproved_symlink_chain", chain)
t("read_unapproved_ln_chain_child", ln_chain)
t("read_unapproved_hardlink", lambda: (os.link(U, os.path.join(SCRATCH, "h.py")), open(os.path.join(SCRATCH, "h.py")).read()))
t("read_unapproved_rename", lambda: (os.rename(U, os.path.join(os.path.dirname(U), "moved.py")), open(os.path.join(os.path.dirname(U), "moved.py")).read()))
t("read_unapproved_copy", lambda: shutil.copy(U, os.path.join(SCRATCH, "c.py")))
t("read_unapproved_cat", lambda: run(["cat", U]))
t("read_unapproved_shell", lambda: run(["/bin/sh", "-c", f"cat '{U}'"]))
t("read_unapproved_child_python", lambda: run([sys.executable, "-c", f"print(open({U!r}).read())"]))
t("read_unapproved_child_ctypes", ctypes_child)
t("read_unapproved_setsid_grandchild", grandchild)
for i, variant in enumerate(A.get("variants", [])):
    t(f"read_unapproved_variant_{i}", lambda v=variant: open(v).read())
t("write_state", lambda: write(STATE, "{}"))
t("remove_state", lambda: os.remove(STATE))
t("replace_state", lambda: (write(os.path.join(SCRATCH, "forged.json"), "{}"), os.replace(os.path.join(SCRATCH, "forged.json"), STATE)))
t("remove_state_backup", lambda: os.remove(STATE + ".bak"))
t("cp_over_state", lambda: run(["cp", "/dev/null", STATE]))
t("rm_state", lambda: run(["rm", "-f", STATE]))
t("python_child_writes_state", lambda: run([sys.executable, "-c", f"open({STATE!r}, 'w').write('{{}}')"]))
t("rewrite_show_graph_guard", lambda: write(os.path.join(A["services"], "show_graph_guard.py"), "X = 1\n"))
t("new_module_in_services", lambda: write(os.path.join(A["services"], "zz_shadow.py"), "X = 1\n"))
t("rewrite_import_guard", lambda: write(os.path.join(A["services"], "assistant", "import_guard.py"), "X = 1\n"))
t("write_pth", lambda: write(os.path.join(A["site_packages"], "zz_psyneuview_attack.pth"), "import os\n"))
t("write_psyneulink", lambda: write(os.path.join(A["pnl_dir"], "zz_attack.py"), "X = 1\n"))
t("write_home", lambda: write(os.path.join(A["home"], ".zz_psyneuview_attack"), "x"))
t("tcp_localhost", tcp)
t("dns", lambda: socket.getaddrinfo("example.com", 80))
t("udp", lambda: socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(b"x", ("127.0.0.1", A["port"])))
if A.get("ssh"):
    t("read_ssh", lambda: os.listdir(A["ssh"]))
    if A.get("ssh_file"):
        t("read_ssh_file", lambda: open(A["ssh_file"], "rb").close())
# What must keep working.
t("ok_read_approved", lambda: open(OK_FILE).read())
t("ok_write_scratch", lambda: write(os.path.join(SCRATCH, "w.txt")))
t("ok_tempfile", lambda: __import__("tempfile").NamedTemporaryFile().close())
t("ok_write_output_folder", lambda: write(os.path.join(OUT, "result.txt")))
t("ok_child_python", lambda: run([sys.executable, "-c", "print(1)"]))
t("ok_pipe_to_child", lambda: run([sys.executable, "-c", "import sys; print(sys.stdin.read())"], input="x"))
if A.get("dot"):
    t("ok_graphviz", lambda: run([A["dot"], "-Tsvg"], input="digraph { a -> b }"))
print("###RESULT###" + json.dumps(res))
'''


@pytest.fixture(scope="module")
def attacked(tmp_path_factory):
    """Run every attack once, in one sandboxed process, and return what happened."""
    if not CAP.get("ok"):
        pytest.skip(f"no OS sandbox here: {CAP.get('reason')}")
    tmp = tmp_path_factory.mktemp("os_sandbox").resolve()
    state = tmp / "assistant-state" / "review.json"
    old_env = os.environ.get(review.STATE_ENV)
    old_write = os.environ.get(os_sandbox.WRITE_FOLDERS_ENV)
    os.environ[review.STATE_ENV] = str(state)
    try:
        models = tmp / "Models"
        models.mkdir()
        unapproved = models / "hx_helper.py"
        unapproved.write_text("SECRET = 'assistant wrote this'\n")
        review.mark_unreviewed(str(unapproved), unapproved.read_text())
        approved = models / "approved_helper.py"
        approved.write_text("X = 1\n")
        review.mark_unreviewed(str(approved), approved.read_text())
        review.mark_reviewed(str(approved), approved.read_text())
        out = tmp / "Out"
        out.mkdir()
        os.environ[os_sandbox.WRITE_FOLDERS_ENV] = str(out)
        policy = os_sandbox.policy()
        variants = []
        if sys.platform == "darwin":
            variants = [str(unapproved).replace("hx_helper", "HX_HELPER"), str(models / "HX_helper.py")]
            accented = models / "modèle.py"
            accented.write_text("SECRET = 1\n")
            review.mark_unreviewed(str(accented), accented.read_text())
            policy = os_sandbox.policy()
            variants.append(str(models / unicodedata.normalize("NFD", "modèle.py")))
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        got = []

        def accept():
            listener.settimeout(15)
            try:
                conn, _ = listener.accept()
                got.append(conn.recv(10))
                conn.close()
            except OSError:
                pass

        th = threading.Thread(target=accept, daemon=True)
        th.start()
        import site

        import psyneulink

        ssh = Path.home() / ".ssh"
        args = {
            "services": str(SERVICES), "policy": policy, "unapproved": str(unapproved),
            "approved": str(approved), "state": str(state), "out": str(out),
            "site_packages": site.getsitepackages()[0], "pnl_dir": str(Path(psyneulink.__file__).parent),
            "home": str(Path.home()), "port": listener.getsockname()[1], "variants": variants,
            "ssh": str(ssh) if ssh.is_dir() else None, "dot": shutil.which("dot"),
            # A file in it, found from here (only its name is used).
            "ssh_file": next((str(f) for f in sorted(ssh.rglob("*")) if f.is_file()), None) if ssh.is_dir() else None,
        }
        state_before = state.read_bytes()
        proc = subprocess.run([sys.executable, "-I", "-c", ATTACKS, json.dumps(args)],
                              capture_output=True, text=True, timeout=120)
        listener.close()
        line = [ln for ln in proc.stdout.splitlines() if ln.startswith("###RESULT###")]
        assert line, f"the sandboxed process didn't finish:\n{proc.stdout[-2000:]}\n{proc.stderr[-2000:]}"
        res = json.loads(line[0][len("###RESULT###"):])
        res["_outside"] = {
            "state_unchanged": state.exists() and state.read_bytes() == state_before,
            "unapproved_still_there": unapproved.exists(),
            "listener_got": [g.decode() for g in got],
            "no_shadow": not (SERVICES / "zz_shadow.py").exists(),
            "no_pth": not Path(args["site_packages"], "zz_psyneuview_attack.pth").exists(),
            "no_home_file": not Path(args["home"], ".zz_psyneuview_attack").exists(),
        }
        res["_policy"] = policy
        yield res
    finally:
        for leftover in (SERVICES / "zz_shadow.py",):
            if leftover.exists():
                leftover.unlink()
        if old_env is None:
            os.environ.pop(review.STATE_ENV, None)
        else:
            os.environ[review.STATE_ENV] = old_env
        if old_write is None:
            os.environ.pop(os_sandbox.WRITE_FOLDERS_ENV, None)
        else:
            os.environ[os_sandbox.WRITE_FOLDERS_ENV] = old_write
        review._cache = None


REFUSED = [
    # Reading the unapproved file: the strongest form of the approval rule.
    "read_unapproved", "read_unapproved_bytes_os_open", "read_unapproved_ctypes", "read_unapproved_symlink",
    "read_unapproved_symlink_chain", "read_unapproved_ln_chain_child", "read_unapproved_hardlink",
    "read_unapproved_rename", "read_unapproved_copy", "read_unapproved_cat", "read_unapproved_shell",
    "read_unapproved_child_python", "read_unapproved_child_ctypes", "read_unapproved_setsid_grandchild",
    # The review record (round 3 F1, round 4 G2).
    "write_state", "remove_state", "replace_state", "remove_state_backup", "cp_over_state", "rm_state",
    "python_child_writes_state",
    # The app's own code, PsyNeuLink and the Python install (round 4 G1, .pth).
    "rewrite_show_graph_guard", "new_module_in_services", "rewrite_import_guard", "write_pth",
    "write_psyneulink", "write_home",
    # The network.
    "tcp_localhost", "dns", "udp",
]
WORKS = ["ok_read_approved", "ok_write_scratch", "ok_tempfile", "ok_write_output_folder", "ok_child_python",
         "ok_pipe_to_child"]


@needs_sandbox
@pytest.mark.parametrize("attack", REFUSED)
def test_the_sandbox_refuses(attacked, attack):
    assert attacked[attack][0] == "refused", f"{attack} got through: {attacked[attack]}"


@needs_sandbox
def test_nothing_changed_outside(attacked):
    outside = attacked["_outside"]
    assert outside["state_unchanged"], outside
    assert outside["unapproved_still_there"], outside
    assert outside["listener_got"] == [], outside
    assert outside["no_shadow"] and outside["no_pth"] and outside["no_home_file"], outside


@needs_sandbox
def test_another_spelling_of_the_unapproved_file_is_refused(attacked):
    variants = [k for k in attacked if k.startswith("read_unapproved_variant_")]
    if not variants:
        pytest.skip("case and accent variants are the same file only on macOS volumes")
    for k in variants:
        assert attacked[k][0] == "refused", (k, attacked[k])


@needs_sandbox
def test_secrets_in_the_home_folder_are_refused(attacked):
    if "read_ssh" not in attacked:
        pytest.skip("no ~/.ssh on this machine")
    if "read_ssh_file" in attacked:
        assert attacked["read_ssh_file"][0] == "refused", attacked["read_ssh_file"]
    if sys.platform == "darwin":
        # On Linux the names in a denied folder can be listed (Landlock's
        # listing right is inherited from the folder above); never contents.
        assert attacked["read_ssh"][0] == "refused", attacked["read_ssh"]


@needs_sandbox
@pytest.mark.parametrize("what", WORKS)
def test_what_models_need_still_works(attacked, what):
    assert attacked[what][0] == "ok", f"{what} was refused: {attacked[what]}"


@needs_sandbox
def test_graphviz_still_runs(attacked):
    if "ok_graphviz" not in attacked:
        pytest.skip("Graphviz isn't installed here")
    assert attacked["ok_graphviz"][0] == "ok", attacked["ok_graphviz"]


# ── The policy itself ───────────────────────────────────────────────────────


def test_the_policy_protects_the_record_the_app_and_python(tmp_path, monkeypatch):
    monkeypatch.setenv(review.STATE_ENV, str(tmp_path / "st" / "review.json"))
    p = os_sandbox.policy()
    protected = set(p["write_deny"])
    assert os.path.realpath(tmp_path / "st") in protected
    assert os.path.realpath(sys.prefix) in protected
    assert str(Path(os_sandbox.__file__).resolve().parents[3]) in protected
    # Round 5: the interpreter's own library folders (a sitecustomize.py
    # there runs in every Python) and the app's settings file, which names
    # the PsyNeuLink the fork server's parent imports.
    import sysconfig

    from app.services import app_config

    assert os.path.realpath(sysconfig.get_paths()["stdlib"]) in protected
    assert os.path.realpath(sysconfig.get_paths()["platstdlib"]) in protected
    assert os.path.realpath(app_config.DEFAULT_CONFIG_FILE) in protected
    assert os.path.realpath(app_config.LEGACY_CONFIG_FILE) in protected
    assert p["network"] is False
    assert p["scratch"] in p["write_allow"]
    assert all(".ssh" not in w for w in p["write_allow"])
    assert any(r.endswith("/.ssh") for r in p["read_deny"])
    assert os.path.realpath(sys.executable) in p["exec_allow"]
    assert not any(e.endswith(("/sh", "/bash", "/zsh", "/cp", "/rm", "/ln")) for e in p["exec_allow"])


def test_an_unapproved_file_is_denied_and_an_approved_one_isnt(tmp_path, monkeypatch):
    monkeypatch.setenv(review.STATE_ENV, str(tmp_path / "st" / "review.json"))
    a, b = tmp_path / "a.py", tmp_path / "b.py"
    a.write_text("A = 1\n")
    b.write_text("B = 1\n")
    review.mark_unreviewed(str(a), a.read_text())
    review.mark_unreviewed(str(b), b.read_text())
    review.mark_reviewed(str(b), b.read_text())
    p1 = os_sandbox.policy()
    assert os.path.realpath(a) in p1["read_deny"]
    assert os.path.realpath(b) not in p1["read_deny"]
    # The approved file changes on disk: it isn't the approved text any more.
    b.write_text("B = 2\n")
    p2 = os_sandbox.policy()
    assert os.path.realpath(b) in p2["read_deny"]
    assert p1["key"] != p2["key"]


def test_an_unreadable_record_denies_every_assistant_folder(tmp_path, monkeypatch):
    from app.services.assistant import files

    monkeypatch.setenv(review.STATE_ENV, str(tmp_path / "st" / "review.json"))
    (tmp_path / "st").mkdir()
    (tmp_path / "st" / "review.json").write_text("{ not json")
    folder = tmp_path / "AssistantFolder"
    folder.mkdir()
    files.set_folders_provider(lambda: [{"path": str(folder), "access": "read_write"}])
    try:
        review._cache = None
        assert os.path.realpath(folder) in os_sandbox.policy()["read_deny"]
    finally:
        files.set_folders_provider(files._folders_from_settings)


def test_the_profile_denies_last(tmp_path):
    """Seatbelt applies the last matching rule: the unapproved files must
    come after every allow, so no allow can give them back."""
    p = {"version": 1, "read_deny": ["/x/secret.py"], "write_allow": ["/x"], "write_deny": [],
         "exec_allow": ["/usr/bin/python3"], "network": False, "home": "/Users/u", "other_users_root": "/Users"}
    sb = os_sandbox_apply.render_sbpl(p)
    last_allow = max(sb.rfind("(allow file-read*"), sb.rfind("(allow file-write*"))
    assert sb.rfind('(deny file-read-data file-read-xattr file-write* (subpath "/x/secret.py"))') > last_allow
    assert "(deny network*)" in sb
    assert '"/bin/sh"' not in sb


def test_a_path_with_quotes_cant_break_out_of_the_profile():
    p = {"version": 1, "read_deny": ['/x/a") (allow default) ("'], "write_allow": [], "write_deny": [],
         "exec_allow": [], "network": False}
    sb = os_sandbox_apply.render_sbpl(p)
    # The whole name stays one string: its quotes are escaped.
    assert '(subpath "/x/a\\") (allow default) (\\"")' in sb
    assert "\n(allow default)" not in sb


def test_a_policy_can_be_applied_only_once():
    code = textwrap.dedent(f"""
        import sys, json
        sys.path.insert(0, {str(SERVICES)!r})
        import os_sandbox_apply as a
        try:
            a.apply({{"version": 99}})
        except a.SandboxUnavailable as e:
            print("refused:", e)
    """)
    out = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True, timeout=30).stdout
    assert "unknown version" in out


def test_the_cover_allows_everything_but_the_excluded(tmp_path):
    (tmp_path / "a" / "b").mkdir(parents=True)
    (tmp_path / "a" / "b" / "secret.py").write_text("x")
    (tmp_path / "a" / "b" / "ok.py").write_text("x")
    (tmp_path / "a" / "c").mkdir()
    (tmp_path / "d").mkdir()
    (tmp_path / "link").symlink_to(tmp_path / "a" / "b")
    root = str(tmp_path.resolve())
    whole, ancestors = os_sandbox_apply.cover(root, [str((tmp_path / "a" / "b" / "secret.py").resolve())])
    assert str((tmp_path / "a" / "b" / "ok.py").resolve()) in whole
    assert str((tmp_path / "a" / "c").resolve()) in whole and str((tmp_path / "d").resolve()) in whole
    assert str((tmp_path / "a" / "b" / "secret.py").resolve()) not in whole
    assert root in ancestors and str((tmp_path / "a").resolve()) in ancestors
    assert not any("link" in w for w in whole)


def test_the_state_says_why_when_unavailable(monkeypatch):
    monkeypatch.setattr(os_sandbox, "_probe_result", {"ok": False, "reason": "no Landlock in this kernel", "_at": __import__("time").monotonic()})
    monkeypatch.setattr(os_sandbox, "_FORCED", "on")
    st = os_sandbox.status()
    assert st["state"] == "unavailable"
    assert "Landlock" in st["reason"]
    assert "NOT sandboxed" in os_sandbox.summary_line()


def test_the_assistant_wont_turn_on_without_a_sandbox_unless_allowed(tmp_path, monkeypatch):
    from app.services.assistant import settings as s

    monkeypatch.setattr(os_sandbox, "_probe_result", {"ok": False, "reason": "no Landlock in this kernel", "_at": __import__("time").monotonic()})
    cfg = tmp_path / "cfg.json"
    with pytest.raises(s.SandboxRequired, match="Landlock"):
        s.update_settings({"enabled": True}, confirm_raise=True, config_file=cfg)
    assert not s.get_settings(config_file=cfg)["enabled"]
    # Allowing it saves directly (#369); turning on is the one consent.
    s.update_settings({"sandbox": {"require": False}}, config_file=cfg)
    with pytest.raises(s.RaiseNeedsConfirmation):
        s.update_settings({"enabled": True}, config_file=cfg)
    assert s.update_settings({"enabled": True}, confirm_raise=True, config_file=cfg)["enabled"]


def test_the_assistant_turns_on_where_a_sandbox_holds(tmp_path, monkeypatch):
    from app.services.assistant import settings as s

    monkeypatch.setattr(os_sandbox, "_probe_result", {"ok": True, "mechanism": "test"})
    cfg = tmp_path / "cfg.json"
    assert s.update_settings({"enabled": True}, confirm_raise=True, config_file=cfg)["enabled"]


def test_sandboxing_only_while_tracked_saves_directly(tmp_path):
    """#369: only turning on asks; the page's summary shows the choice."""
    from app.services.assistant import settings as s

    cfg = tmp_path / "cfg.json"
    assert s.update_settings({"sandbox": {"all_runs": False}}, config_file=cfg)["sandbox"]["all_runs"] is False


def test_a_sweep_never_ends_a_task_that_started_during_it(monkeypatch):
    """A sweep goes on for rounds (up to ten seconds) after it begins. A task
    started in that time, such as the Learn job after one that just finished,
    is running, so no round may take it for a survivor. Each round asks which
    tasks are running then, not which were when the sweep began (#311; a
    Learn job was killed this way on a Linux CI run of PR #186)."""
    found_new_as_survivor = []

    def running_task_starts_between_rounds(find, time_limit=10.0, reap=False):
        find()
        with os_sandbox._live_lock:
            os_sandbox._live_ids.add("started-mid-sweep")
        found_new_as_survivor.extend(find())
        return 0

    def linux_marked(token, live_ids):
        return [] if "started-mid-sweep" in live_ids else ["started-mid-sweep"]

    def macos_marked(run, control, live_marks):
        mark = os_sandbox._task_mark_path("started-mid-sweep")
        return [] if mark in list(live_marks) else ["started-mid-sweep"]

    monkeypatch.setattr(os_sandbox._apply, "end_processes", running_task_starts_between_rounds)
    monkeypatch.setattr(os_sandbox._apply, "_linux_marked", linux_marked)
    monkeypatch.setattr(os_sandbox._apply, "_macos_marked", macos_marked)
    try:
        os_sandbox._sweep_now()
    finally:
        with os_sandbox._live_lock:
            os_sandbox._live_ids.discard("started-mid-sweep")
    assert found_new_as_survivor == []
