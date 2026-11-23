"""The operating-system sandbox through the real routes and runner (#311).

Each model here does what the security review's rounds 1 to 4 did to get
round the import guard: it first switches the guard off inside its own
task (which the guard documents it can't prevent), then reads the file the
assistant wrote that nobody approved, or changes the review record, the
app's code or the Python install, or reaches the network. With the sandbox,
the kernel refuses each one, so the helper's marker never appears and the
record and the app are unchanged. ``PSYNEUVIEW_OS_SANDBOX=off`` runs the
same models without it, which is how the "before" column of the PR's table
was made: there, each of them gets through.

Skipped where no sandbox can be applied. Runs under both isolation modes
(``PSYNEUVIEW_WORKER_ISOLATION=fork|pool``) like the guard's own tests.
"""

from __future__ import annotations

import hashlib
import os
import socket
import sys
import threading
import time
from pathlib import Path

import pytest

from app.services import os_sandbox
from tests.test_assistant_runner_guard import (  # noqa: F401  (st is a fixture)
    _helper,
    _job_body,
    _model_importing,
    _wait_job,
    client,
    load,
    review,
    st,
)

pytestmark = pytest.mark.skipif(
    not os_sandbox.available(), reason=f"no OS sandbox here: {os_sandbox.capability().get('reason')}")

SERVICES = Path(os_sandbox.__file__).resolve().parent
PSY = "import psyneulink as pnl\ncomp = pnl.Composition(name='c')\n"

# What a deliberate model does first: switch the in-process guard off for the
# rest of its own task (threat model section 7: not defended by the guard).
TAMPER = (
    "import __main__\n"
    "_g = getattr(__main__, '_guard', None)\n"
    "if _g is not None:\n"
    "    _g._state.tracked = {}\n"
    "    _g._state.index = _g._EMPTY_INDEX\n"
    "    _g._state.broken = False\n"
)


def _mk(st, how):
    marker = st["tmp"] / f"ran_{how}.txt"
    helper = st["models"] / f"hx_{how}.py"
    helper.write_text(_helper(marker))
    review.mark_unreviewed(str(helper), helper.read_text())
    return marker, helper


def _model(st, how, body):
    model = st["tmp"] / "Own" / f"m_{how}.py"
    model.parent.mkdir(exist_ok=True)
    model.write_text(_model_importing(TAMPER + body))
    return model


def _refused_by_the_os(r) -> bool:
    text = r.text
    return any(w in text for w in ("Operation not permitted", "Permission denied", "PermissionError"))


READS = {
    "exec_open": lambda h, t: f"exec(open({str(h)!r}).read())",
    "os_read": lambda h, t: f"exec(os.read(os.open({str(h)!r}, os.O_RDONLY), 1 << 20).decode())",
    "ctypes": lambda h, t: (
        "import ctypes\nlibc = ctypes.CDLL(None, use_errno=True)\n"
        f"fd = libc.open({str(h)!r}.encode(), 0)\n"
        "if fd < 0: raise PermissionError(ctypes.get_errno(), 'Operation not permitted')\n"
        "buf = ctypes.create_string_buffer(1 << 16)\nn = libc.read(fd, buf, 1 << 16)\n"
        "exec(buf.raw[:n].decode())"),
    "symlink_chain": lambda h, t: (
        f"os.symlink({str(t / 'dl' / h.name)!r}, {str(t / 'alias.py')!r})\n"
        f"os.symlink({str(h.parent)!r}, {str(t / 'dl')!r})\n"
        f"exec(open({str(t / 'alias.py')!r}).read())"),
    # Round 4, G5: the chain made by a child process.
    "ln_chain_by_child": lambda h, t: (
        "import subprocess\n"
        f"subprocess.run(['ln', '-s', {str(t / 'dl2' / h.name)!r}, {str(t / 'alias2.py')!r}], check=True)\n"
        f"subprocess.run(['ln', '-s', {str(h.parent)!r}, {str(t / 'dl2')!r}], check=True)\n"
        f"exec(open({str(t / 'alias2.py')!r}).read())"),
    "cat_child": lambda h, t: f"import subprocess\nexec(subprocess.run(['cat', {str(h)!r}], capture_output=True, text=True, check=True).stdout)",
    "python_child": lambda h, t: (
        "import subprocess\n"
        f"exec(subprocess.run([sys.executable, '-c', 'print(open({str(h)!r}).read())'], capture_output=True, text=True, check=True).stdout)"),
    "hard_link": lambda h, t: f"os.link({str(h)!r}, {str(t / 'innocent.py')!r})\nexec(open({str(t / 'innocent.py')!r}).read())",
    # Relative to a folder descriptor: the kernel sees the real path (round 5).
    "dir_fd": lambda h, t: (
        f"d = os.open({str(h.parent)!r}, os.O_RDONLY)\nos.chdir('/')\n"
        f"exec(os.read(os.open({h.name!r}, os.O_RDONLY, dir_fd=d), 1 << 20).decode())"),
    "rename": lambda h, t: f"os.rename({str(h)!r}, {str(t / 'moved.py')!r})\nexec(open({str(t / 'moved.py')!r}).read())",
}


@pytest.mark.parametrize("how", list(READS))
def test_a_model_that_switches_the_guard_off_still_cant_read_the_unapproved_file(st, how):
    marker, helper = _mk(st, how)
    r = load(_model(st, how, READS[how](helper, st["tmp"])))
    assert not marker.exists(), f"{how}: the unapproved file ran: {r.text[:300]}"
    assert helper.exists()


def test_a_learn_job_that_switches_the_guard_off_cant_read_it_either(st):
    from tests.test_assistant_runner_guard import learnable_model

    marker, helper = _mk(st, "job")
    model = st["tmp"] / "Own" / "learn_tamper.py"
    model.parent.mkdir(exist_ok=True)
    body = learnable_model(st["tmp"] / "never.txt")
    model.write_text(TAMPER + f"try:\n    exec(open({str(helper)!r}).read())\nexcept PermissionError:\n    pass\n" + body)
    r = client.post("/api/jobs", json=_job_body(model))
    assert r.status_code in (200, 201, 202), r.text
    _wait_job(r.json()["job"]["id"] if "job" in r.json() else r.json()["id"])
    assert not marker.exists()


# ── The review record (round 3 F1, round 4 G2) ─────────────────────────────


STATE_ATTACKS = {
    "python_remove": lambda sp: f"for p in ({sp!r}, {sp + '.bak'!r}):\n    os.remove(p)",
    "python_overwrite": lambda sp: f"open({sp!r}, 'w').write('{{\"files\": {{}}}}')",
    "cp_by_child": lambda sp: f"import subprocess\nsubprocess.run(['cp', '/dev/null', {sp!r}], check=True)",
    "rm_by_child": lambda sp: f"import subprocess\nsubprocess.run(['rm', '-f', {sp!r}, {sp + '.bak'!r}], check=True)",
    "python_child_removes": lambda sp: f"import subprocess\nsubprocess.run([sys.executable, '-c', 'import os; os.remove({sp!r})'], check=True)",
}


@pytest.mark.parametrize("how", list(STATE_ATTACKS))
def test_a_model_cant_change_the_review_record_for_the_next_task(st, how):
    marker, helper = _mk(st, "state_" + how)
    sp = str(review.state_path())
    before = Path(sp).read_bytes()
    a = st["tmp"] / f"S_{how}"
    a.mkdir()
    (a / "first.py").write_text(TAMPER + "import os, sys\n" + STATE_ATTACKS[how](sp) + "\n" + PSY)
    (a / "second.py").write_text(_model_importing(f"exec(open({str(helper)!r}).read())"))
    load(a / "first.py")
    assert Path(sp).exists() and Path(sp).read_bytes() == before, f"{how} changed the review record"
    load(a / "second.py")
    assert not marker.exists()


def test_an_approval_forged_by_a_child_process_doesnt_land(st):
    """Round 4 G2: a model writes a state approving its helper and copies it over the record with ``cp``."""
    marker, helper = _mk(st, "forge_cp")
    sp = str(review.state_path())
    h = hashlib.sha256(helper.read_text().encode()).hexdigest()
    forged = st["tmp"] / "forged.json"
    first = (TAMPER + f"import json, subprocess\ns = json.load(open({sp!r}))\n"
             f"for k, e in s['files'].items():\n    e['approved'] = {h!r}\n"
             f"json.dump(s, open({str(forged)!r}, 'w'))\n"
             f"subprocess.run(['cp', {str(forged)!r}, {sp!r}])\n")
    a = st["tmp"] / "FC"
    a.mkdir()
    (a / "first.py").write_text(first + PSY)
    (a / "second.py").write_text(_model_importing(f"exec(open({str(helper)!r}).read())"))
    load(a / "first.py")
    load(a / "second.py")
    assert not marker.exists()
    assert review.is_tracked(str(helper)) and not review.is_runnable(str(helper), helper.read_text())


# ── The app's own code and the Python install (round 4 G1, .pth) ───────────


@pytest.mark.parametrize("target", ["show_graph_guard.py", "assistant/import_guard.py", "zz_new_module.py"])
def test_a_model_cant_rewrite_or_add_a_module_later_processes_import(st, target):
    path = SERVICES / target
    existed = path.exists()
    before = path.read_bytes() if existed else None
    model = st["tmp"] / "Own" / f"g1_{path.stem}.py"
    model.parent.mkdir(exist_ok=True)
    model.write_text(TAMPER + f"open({str(path)!r}, 'a').write('\\nX_SHADOW = 1\\n')\n" + PSY)
    try:
        load(model)
        if existed:
            assert path.read_bytes() == before, f"{target} was changed"
        else:
            assert not path.exists(), f"{target} was created"
    finally:
        if existed and path.read_bytes() != before:
            path.write_bytes(before)
        if not existed and path.exists():
            path.unlink()


def test_a_model_cant_add_a_pth_file(st):
    import site

    pth = Path(site.getsitepackages()[0]) / "zz_psyneuview_attack.pth"
    model = st["tmp"] / "Own" / "pth.py"
    model.parent.mkdir(exist_ok=True)
    model.write_text(TAMPER + f"open({str(pth)!r}, 'w').write('import os\\n')\n" + PSY)
    try:
        load(model)
        assert not pth.exists()
    finally:
        if pth.exists():
            pth.unlink()


# ── Processes that leave the task (round 4 G3) and the network ─────────────


def test_a_grandchild_that_leaves_the_process_group_is_still_sandboxed(st):
    """Round 4 G3: a process that leaves the task's process group (``setsid``)
    can outlive the task. Under the sandbox it is still confined: it can't
    read the unapproved file, write outside the allowed folders, or reach
    the network."""
    marker, helper = _mk(st, "setsid")
    note = st["tmp"] / "gc_note.txt"
    outside = Path.home() / ".zz_psyneuview_survivor"
    gc = (
        "import os, socket, time\nos.setsid()\nres = [str(os.getpid())]\n"
        f"for name, fn in (('read', lambda: open({str(helper)!r}).read()),\n"
        f"                 ('write', lambda: open({str(outside)!r}, 'w').write('x')),\n"
        "                 ('net', lambda: socket.create_connection(('127.0.0.1', 9), timeout=2))):\n"
        "    try:\n        fn()\n        res.append(name + ':ok')\n"
        "    except PermissionError:\n        res.append(name + ':refused')\n"
        "    except OSError as e:\n        res.append(name + ':' + type(e).__name__)\n"
        f"open({str(note)!r}, 'w').write(' '.join(res))\ntime.sleep(60)\n")
    model = _model(st, "setsid", (
        "import subprocess, time\n"
        f"subprocess.Popen([sys.executable, '-c', {gc!r}], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\n"
        f"t = time.time()\nwhile time.time() - t < 15 and not os.path.exists({str(note)!r}):\n    time.sleep(0.1)\n"))
    try:
        load(model)
        words = note.read_text().split()
        assert words[1:] == ["read:refused", "write:refused", "net:refused"], words
        assert not outside.exists() and not marker.exists()
    finally:
        if outside.exists():
            outside.unlink()


def test_a_grandchild_that_leaves_the_process_group_is_ended_with_its_task(st):
    """The fork server's parent ends what a sandboxed task left running."""
    from app.services import sandbox

    if sandbox.isolation_mode() != "fork":
        pytest.skip("the pool ends a worker's process group only; a setsid survivor is confined, not ended")
    note = st["tmp"] / "gc_pid.txt"
    gc = f"import os, time\nos.setsid()\nopen({str(note)!r}, 'w').write(str(os.getpid()))\ntime.sleep(60)\n"
    model = _model(st, "setsid_end", (
        "import subprocess, time\n"
        f"subprocess.Popen([sys.executable, '-c', {gc!r}], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\n"
        f"t = time.time()\nwhile time.time() - t < 15 and not os.path.exists({str(note)!r}):\n    time.sleep(0.1)\n"))
    load(model)
    pid = int(note.read_text())
    deadline = time.time() + 5
    alive = True
    while time.time() < deadline and alive:
        try:
            os.kill(pid, 0)
            threading.Event().wait(0.1)
        except ProcessLookupError:
            alive = False
        except PermissionError:
            break
    if alive:
        os.kill(pid, 9)
    assert not alive, "the setsid grandchild outlived its task"


def test_a_model_cant_reach_the_network(st):
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    listener.settimeout(8)
    port = listener.getsockname()[1]
    got: list = []

    def accept():
        try:
            conn, _ = listener.accept()
            got.append(conn.recv(10))
            conn.close()
        except OSError:
            pass

    th = threading.Thread(target=accept, daemon=True)
    th.start()
    model = st["tmp"] / "Own" / "net.py"
    model.parent.mkdir(exist_ok=True)
    model.write_text(f"import socket\ntry:\n    socket.create_connection(('127.0.0.1', {port}), timeout=3).sendall(b'leak')\nexcept OSError:\n    pass\n" + PSY)
    r = load(model)
    th.join(10)
    listener.close()
    assert got == [], "the model reached a socket on this machine"
    assert r.status_code == 200


# ── What ordinary models need ──────────────────────────────────────────────


def test_an_ordinary_model_loads_and_its_output_folder_is_writable(st):
    out = st["tmp"] / "results.txt"
    model = st["tmp"] / "Own" / "ordinary.py"
    model.parent.mkdir(exist_ok=True)
    model.write_text(f"import tempfile\ntempfile.NamedTemporaryFile().close()\nopen({str(out)!r}, 'w').write('ok')\n" + PSY)
    r = load(model)
    assert r.status_code == 200, r.text
    assert out.read_text() == "ok"


def test_an_approved_helper_still_runs(st):
    from tests.test_assistant_runner_guard import approve

    marker, helper = _mk(st, "approved")
    approve(helper)
    r = load(_model(st, "approved", f"exec(open({str(helper)!r}).read())"))
    assert r.status_code == 200, r.text
    assert marker.exists()


def test_the_sandbox_is_in_use_while_something_is_tracked(st):
    assert os_sandbox.status()["state"] == "on"


# ── A model that kills its parent, so the task is retried elsewhere ────────


def _tamper_after_killing_parent(st, note: Path) -> Path:
    sp = str(review.state_path())
    guard = str(SERVICES / "show_graph_guard.py")
    model = st["tmp"] / "Own" / "killer.py"
    model.parent.mkdir(exist_ok=True)
    model.write_text(
        "import os, signal\n"
        "try:\n    os.kill(os.getppid(), signal.SIGKILL)\n    k = 'killed'\nexcept OSError as e:\n    k = 'refused'\n"
        f"open({str(note)!r}, 'a').write(k + '\\n')\n"
        f"for p, how in (({sp!r}, 'w'), ({guard!r}, 'a')):\n"
        "    try:\n        open(p, how).write('\\nX_TAMPERED = 1\\n')\n    except OSError:\n        pass\n" + PSY)
    return model


def test_a_model_that_kills_its_parent_is_still_sandboxed_when_the_task_is_retried(st):
    """If the fork server's parent (or the warm worker) dies mid-task, the
    server retries the task in a one-shot worker, or a pool worker. Every
    one of those is sandboxed too, so killing the parent is no way out: the
    retried run can't change the review record or the app's code."""
    sp = review.state_path()
    guard = SERVICES / "show_graph_guard.py"
    state_before, guard_before = sp.read_bytes(), guard.read_bytes()
    note = st["tmp"] / "kill_note.txt"
    model = _tamper_after_killing_parent(st, note)
    try:
        load(model)
        # The retry path itself, directly: the cold one-shot worker.
        from app.services import sandbox

        sandbox._run_cold("introspect", {"file_path": str(model)}, 60)
        assert sp.read_bytes() == state_before, "the review record was changed"
        assert guard.read_bytes() == guard_before, "show_graph_guard.py was changed"
        assert note.exists()
    finally:
        if guard.read_bytes() != guard_before:
            guard.write_bytes(guard_before)


def test_a_sandboxed_model_cant_kill_the_fork_servers_parent(st):
    """On macOS a sandboxed process can't signal one outside its sandbox;
    on Linux the same holds from Landlock ABI 6 (Linux 6.12)."""
    from app.services import sandbox

    if sandbox.isolation_mode() != "fork":
        pytest.skip("the fork server isn't in use")
    if sys.platform.startswith("linux") and (os_sandbox.capability().get("landlock_abi") or 0) < 6:
        pytest.skip("signals out of the sandbox are refused only from Landlock ABI 6")
    note = st["tmp"] / "kill_note2.txt"
    load(_tamper_after_killing_parent(st, note))
    assert note.read_text().splitlines()[0] == "refused"


def test_a_model_converted_to_the_standard_format_is_sandboxed_too(st):
    """Converting runs the model. Under the sandbox it runs in a sandboxed
    process, not in the server: it can't read the unapproved file, change
    the review record or rewrite the app's code."""
    marker, helper = _mk(st, "convert")
    sp = review.state_path()
    guard = SERVICES / "show_graph_guard.py"
    state_before, guard_before = sp.read_bytes(), guard.read_bytes()
    model = st["tmp"] / "Own" / "convert_me.py"
    model.parent.mkdir(exist_ok=True)
    model.write_text(
        "import ctypes\n"
        f"fd = ctypes.CDLL(None).open({str(helper)!r}.encode(), 0)\n"
        f"open({str(st['tmp'] / 'convert_fd.txt')!r}, 'w').write(str(fd))\n"
        f"for p, how in (({str(sp)!r}, 'w'), ({str(guard)!r}, 'a')):\n"
        "    try:\n        open(p, how).write('\\nX_TAMPERED = 1\\n')\n    except OSError:\n        pass\n"
        "import psyneulink as pnl\na = pnl.TransferMechanism(name='a')\ncomp = pnl.Composition(name='c', pathways=[a])\n")
    try:
        r = client.post("/api/model/convert", json={"file_path": str(model), "backup": False})
        assert r.status_code == 200, r.text[:400]
        assert (st["tmp"] / "convert_fd.txt").read_text() == "-1", "the converted model opened the unapproved file"
        assert sp.read_bytes() == state_before
        assert guard.read_bytes() == guard_before
        assert not marker.exists()
    finally:
        if guard.read_bytes() != guard_before:
            guard.write_bytes(guard_before)
