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
    if sys.platform == "darwin" or how != "rename":
        # On Linux an unapproved file in a writable folder can be moved
        # (never read: it carries no read right wherever it goes).
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


# ── Writing in the model's own folder (the user's decision on #312) ────────


def _model_in(folder: Path, body: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    model = folder / "saves_results.py"
    model.write_text(body + PSY)
    return model


def _no_declared_folders(st):
    """Only the model's own folder and the task's own may be written here."""
    st["monkeypatch"].setenv(os_sandbox.WRITE_FOLDERS_ENV, "")


def test_a_model_saves_a_figure_and_a_csv_beside_itself_and_in_a_subfolder(st):
    _no_declared_folders(st)
    folder = Path(os.path.realpath(st["tmp"])) / "Beside"
    model = _model_in(folder, (
        "import os, csv, numpy as np\n"
        "here = os.path.dirname(os.path.abspath(__file__))\n"
        # The runner turns matplotlib's own saving off during a load (its
        # graphics patches), so the figure's bytes are written directly.
        "open(os.path.join(here, 'figure.png'), 'wb').write(bytes([0x89]) + b'PNG fake')\n"
        "with open(os.path.join(here, 'results.csv'), 'w', newline='') as f:\n    csv.writer(f).writerow([1, 2])\n"
        "os.makedirs(os.path.join(here, 'out', 'run1'), exist_ok=True)\n"
        "np.save(os.path.join(here, 'out', 'run1', 'w.npy'), np.zeros(3))\n"
        "open(os.path.join(here, 'out', 'notes.json'), 'w').write('{}')\n"
        "os.remove(os.path.join(here, 'out', 'notes.json'))\n"))
    r = load(model)
    assert r.status_code == 200, r.text[:300]
    assert not (r.json().get("model") or {}).get("skippedStatements"), r.json()["model"]["skippedStatements"]
    assert (folder / "figure.png").exists() and (folder / "results.csv").read_text().strip() == "1,2"
    assert (folder / "out" / "run1" / "w.npy").exists()
    assert not (folder / "out" / "notes.json").exists()


def test_a_model_cant_overwrite_an_unapproved_file_beside_it(st):
    _no_declared_folders(st)
    folder = Path(os.path.realpath(st["tmp"])) / "BesideU"
    folder.mkdir()
    helper = folder / "hx_beside.py"
    helper.write_text("X = 1\n")
    review.mark_unreviewed(str(helper), helper.read_text())
    model = _model_in(folder, f"try:\n    open({str(helper)!r}, 'w').write('X = 2\\n')\nexcept OSError:\n    pass\n")
    load(model)
    if sys.platform == "darwin":
        assert helper.read_text() == "X = 1\n"
    else:
        # On Linux an unapproved file in a writable folder can be overwritten
        # (Landlock allows only whole folders, and the folder must stay
        # writable); what is there then is the model's text, still unapproved.
        assert not review.is_runnable(str(helper), helper.read_text())


def test_a_model_cant_write_the_review_state_in_its_folder(st):
    _no_declared_folders(st)
    folder = Path(os.path.realpath(st["tmp"])) / "BesideS"
    folder.mkdir()
    state = folder / "review.json"
    st["monkeypatch"].setenv(review.STATE_ENV, str(state))
    review._cache = None
    helper = folder / "hx_state.py"
    helper.write_text("X = 1\n")
    review.mark_unreviewed(str(helper), helper.read_text())
    before = state.read_bytes()
    model = _model_in(folder, f"try:\n    open({str(state)!r}, 'w').write('{{}}')\nexcept OSError:\n    pass\n")
    load(model)
    assert state.read_bytes() == before


def test_a_model_cant_add_code_beside_itself(st):
    if sys.platform != "darwin":
        pytest.skip("refusing new code by its name needs Seatbelt's path rules (macOS); Landlock can't tell files apart by name")
    _no_declared_folders(st)
    folder = Path(os.path.realpath(st["tmp"])) / "BesideC"
    model = _model_in(folder, (
        "import os\nhere = os.path.dirname(os.path.abspath(__file__))\n"
        "for name in ('later.py', 'x.pth', 'sitecustomize.py', os.path.join('pkg', 'mod.py')):\n"
        "    os.makedirs(os.path.join(here, 'pkg'), exist_ok=True)\n"
        "    try:\n        open(os.path.join(here, name), 'w').write('X = 1\\n')\n    except OSError:\n        pass\n"
        "open(os.path.join(here, 'data.txt'), 'w').write('ok')\n"))
    load(model)
    assert (folder / "data.txt").read_text() == "ok"
    for name in ("later.py", "x.pth", "sitecustomize.py", "pkg/mod.py"):
        assert not (folder / name).exists(), name


def test_a_model_inside_psyneulink_writes_only_its_scratch_and_is_told(st):
    import psyneulink

    pnl_dir = Path(os.path.realpath(os.path.dirname(psyneulink.__file__)))
    folder, note = os_sandbox.model_folder(str(pnl_dir / "library" / "models" / "x.py"))
    assert folder is None and "PsyNeuLink" in note
    folder, note = os_sandbox.model_folder(str(Path(os_sandbox._own_home()) / "x.py"))
    assert folder is None and "too broad" in note
    p = os_sandbox.policy(model_path=str(pnl_dir / "x.py"))
    assert p["model_dir"] is None and p["model_dir_note"]
    assert not any(w.startswith(str(pnl_dir)) for w in p["write_allow"])


def test_the_notice_says_why_the_models_folder_wasnt_opened(st, monkeypatch):
    from app.services import sandbox

    result = {"model": {"notices": []}}
    sandbox._note_model_folder(result, {"model_dir_note": "the model's folder (/x) is or holds part of PsyNeuLink"})
    assert "PsyNeuLink" in result["model"]["notices"][0]
    assert "task folder" in result["os_sandbox_notice"]


# ── The independent review of #312 (S1–S6), with the guard switched off ────

#: The reviewer's guard-off preamble: every part of the in-process guard a
#: model can reach is switched off, so only the OS sandbox stands.
GUARD_OFF = (
    "import __main__, sys as _s, importlib.machinery as _im\n"
    "_g = getattr(__main__, '_guard', None)\n"
    "if _g is not None:\n"
    "    _g._State.refresh = lambda self, *a, **k: None\n"
    "    _g.TrackedIndex.find = lambda self, p: None\n"
    "    _g._state.tracked = {}\n"
    "    _g._state.index = _g._EMPTY_INDEX\n"
    "    _g._state.broken = False\n"
    "    _g._audit_local.busy = True\n"
    "    _g.vet = lambda p: None\n"
    "    _g._check = lambda *a, **k: None\n"
    "    _im.SourceFileLoader.get_code = _g._original_get_code\n"
    "    _s.meta_path[:] = [f for f in _s.meta_path if f is not getattr(_g, '_finder', None)]\n"
)


def _guard_off_model(folder: Path, body: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    model = folder / "attack.py"
    model.write_text(GUARD_OFF + "import os, sys\n" + body + "\n" + PSY)
    return model


def test_s1_an_earlier_version_the_assistant_kept_cant_be_read(st):
    from app.services.assistant import files as assistant_files

    marker = st["tmp"] / "ran_prev.txt"
    kept = assistant_files.previous_versions_dir() / "abcd1234" / "helper.py.20261123.bak"
    kept.parent.mkdir(parents=True, exist_ok=True)
    kept.write_text(_helper(marker))
    model = _guard_off_model(st["tmp"] / "S1", f"exec(open({str(kept)!r}).read())")
    load(model)
    assert not marker.exists()


@pytest.mark.parametrize("where", ["declared", "model_folder"])
@pytest.mark.parametrize("level", ["parent", "grandparent"])
def test_s2_moving_a_folder_that_holds_an_unapproved_file_doesnt_free_it(st, where, level):
    root = Path(os.path.realpath(st["tmp"])) / f"S2_{where}_{level}"
    held = root / "outer" / "inner"
    held.mkdir(parents=True)
    marker = st["tmp"] / f"ran_s2_{where}_{level}.txt"
    helper = held / "hx_held.py"
    helper.write_text(_helper(marker))
    review.mark_unreviewed(str(helper), helper.read_text())
    if where == "model_folder":
        _no_declared_folders(st)
        model_dir = root
    else:
        model_dir = st["tmp"] / f"S2m_{level}"
    moving = held if level == "parent" else held.parent
    moved = moving.parent / (moving.name + "_moved")
    new_helper = (moved / "hx_held.py") if level == "parent" else (moved / "inner" / "hx_held.py")
    model = _guard_off_model(model_dir, (
        f"try:\n    os.rename({str(moving)!r}, {str(moved)!r})\nexcept OSError:\n    pass\n"
        f"try:\n    exec(open({str(new_helper)!r}).read())\nexcept OSError:\n    pass\n"))
    load(model)
    assert not marker.exists()
    if sys.platform == "darwin":
        assert helper.exists(), "the folder was moved"


def test_s3_a_deep_chain_of_survivors_is_ended_and_cant_run_a_later_file(st):
    later = st["models"] / "later.py"
    marker = st["tmp"] / "ran_later.txt"
    pids = st["tmp"] / "chain_pids.txt"
    # A chain 12 deep, each in a session of its own; the deepest waits for
    # a file the assistant writes after the task, then tries to run it.
    chain = st["tmp"] / "chain.py"
    chain.write_text(
        "import os, subprocess, sys, time\n"
        "depth = int(sys.argv[1])\nos.setsid()\n"
        f"open({str(pids)!r}, 'a').write(str(os.getpid()) + chr(10))\n"
        "if depth:\n    subprocess.Popen([sys.executable, __file__, str(depth - 1)]).wait()\n"
        "else:\n    t = time.time()\n    while time.time() - t < 15:\n"
        f"        try:\n            exec(open({str(later)!r}).read()); break\n"
        "        except OSError:\n            time.sleep(0.2)\n")
    model = _guard_off_model(st["tmp"] / "S3", (
        "import subprocess, time\n"
        f"subprocess.Popen([sys.executable, {str(chain)!r}, '12'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\n"
        f"t = time.time()\nwhile time.time() - t < 20 and (len(open({str(pids)!r}).read().split()) if os.path.exists({str(pids)!r}) else 0) < 13:\n"
        "    time.sleep(0.1)\n"))
    load(model)
    # (The model may run twice: a load, then the resilient load after it.)
    assert pids.exists() and len(pids.read_text().split()) >= 13, "the chain didn't start"
    # The assistant writes later.py after the task.
    review.mark_unreviewed(str(later), _helper(marker))
    later.write_text(_helper(marker))
    deadline = time.time() + 6
    alive = []
    while time.time() < deadline:
        alive = []
        for pid in map(int, pids.read_text().split()):
            try:
                os.kill(pid, 0)
                alive.append(pid)
            except (ProcessLookupError, PermissionError):
                pass
        if not alive:
            break
        threading.Event().wait(0.2)
    for pid in alive:
        try:
            os.kill(pid, 9)
        except OSError:
            pass
    assert not alive, f"{len(alive)} of the chain outlived the task"
    assert not marker.exists()


def test_s4_a_run_that_must_be_sandboxed_is_refused_when_it_cant_be(st, monkeypatch):
    monkeypatch.setattr(os_sandbox, "_probe_result", {"ok": False, "reason": "probe failed for the test",
                                                      "_at": time.monotonic()})
    monkeypatch.setattr(os_sandbox, "_FORCED", "")
    out = st["tmp"] / "s4_ran.txt"
    model = _guard_off_model(st["tmp"] / "S4", f"open({str(out)!r}, 'w').write('ran')")
    r = load(model)
    assert r.status_code == 409 and r.json().get("reason") == "sandbox_required", r.text[:300]
    assert not out.exists()
    monkeypatch.setattr(os_sandbox, "_ALLOW_UNSANDBOXED", True)
    assert load(model).status_code == 200
    assert out.exists()


def test_s4_a_result_without_the_sandboxs_proof_is_refused():
    policy = {"key": "abc"}
    assert os_sandbox.check_applied({"model": {}}, policy).get("os_sandbox_refused")
    assert os_sandbox.check_applied({"model": {}, "os_sandbox_applied": None}, policy).get("os_sandbox_refused")
    assert not os_sandbox.check_applied({"model": {}, "os_sandbox_applied": "abc"}, policy).get("os_sandbox_refused")
    assert os_sandbox.check_applied({"model": {}}, None) == {"model": {}}


def test_s4_every_sandboxed_load_carries_its_proof(st):
    model = _guard_off_model(st["tmp"] / "S4p", "")
    r = load(model)
    assert r.status_code == 200, r.text[:300]


def test_s5_no_hidden_or_auto_run_files_in_writable_folders(st):
    if sys.platform != "darwin":
        pytest.skip("refusing files by name needs Seatbelt's path rules (macOS); Landlock can't tell files apart by name")
    _no_declared_folders(st)
    folder = Path(os.path.realpath(st["tmp"])) / "S5"
    names = [".git/hooks/pre-commit", ".envrc", ".vscode/settings.json", "Makefile", "conftest.py",
             "pyproject.toml", "package.json", "x.pth", "sub/.bashrc"]
    body = ("here = os.path.dirname(os.path.abspath(__file__))\n"
            f"for name in {names!r}:\n"
            "    try:\n        os.makedirs(os.path.dirname(os.path.join(here, name)), exist_ok=True)\n"
            "        open(os.path.join(here, name), 'w').write('x')\n    except OSError:\n        pass\n"
            "for name in ('a.csv', 'b.png', 'c.npy', 'd.pkl', 'e.json', 'f.txt', 'sub/g.csv'):\n"
            "    os.makedirs(os.path.dirname(os.path.join(here, name)), exist_ok=True)\n"
            "    open(os.path.join(here, name), 'w').write('ok')\n")
    model = _guard_off_model(folder, body)
    r = load(model)
    assert r.status_code == 200, r.text[:300]
    for name in names:
        assert not (folder / name).is_file(), name
    for name in ("a.csv", "b.png", "c.npy", "d.pkl", "e.json", "f.txt", "sub/g.csv"):
        assert (folder / name).read_text() == "ok", name


def test_s6_the_dynamic_loader_cant_start_another_program(st):
    if not sys.platform.startswith("linux"):
        pytest.skip("the loader trick is Linux's")
    import glob

    loader = next(iter(sorted(glob.glob("/lib*/ld-linux*") + glob.glob("/lib/*/ld-linux*"))), None)
    if not loader:
        pytest.skip("no dynamic loader found")
    out = st["tmp"] / "s6.txt"
    model = _guard_off_model(st["tmp"] / "S6", (
        "import subprocess\n"
        f"r = subprocess.run([{loader!r}, '/bin/sh', '-c', 'echo ran'], capture_output=True, text=True)\n"
        f"open({str(out)!r}, 'w').write(r.stdout)\n"))
    load(model)
    assert "ran" not in (out.read_text() if out.exists() else "")


# ── The second independent review of #312 (T1–T6), guard switched off ──────


def _held(st, name: str, base: Path | None = None) -> tuple[Path, Path]:
    """An unapproved helper two folders down, and its marker."""
    base = base or (st["models"] / name)
    sub = base / "outer" / "sub"
    sub.mkdir(parents=True)
    marker = st["tmp"] / f"ran_{name}.txt"
    helper = sub / f"hx_{name}.py"
    helper.write_text(_helper(marker))
    review.mark_unreviewed(str(helper), helper.read_text())
    return marker, helper


@pytest.mark.parametrize("level", ["parent", "grandparent"])
@pytest.mark.parametrize("call", ["clonefile", "fclonefileat"])
def test_t1_cloning_a_folder_that_holds_an_unapproved_file_is_refused(st, level, call):
    if sys.platform != "darwin":
        pytest.skip("clonefile is macOS's")
    marker, helper = _held(st, f"t1_{call}_{level}")
    src = helper.parent if level == "parent" else helper.parent.parent
    dst = Path(str(src) + "_c")
    inside = (dst / helper.name) if level == "parent" else (dst / "sub" / helper.name)
    if call == "clonefile":
        do = f"lc.clonefile({str(src).encode()!r}, {str(dst).encode()!r}, 0)"
    else:
        do = (f"fd = os.open({str(src)!r}, os.O_RDONLY)\n"
              f"lc.fclonefileat(fd, -2, {str(dst).encode()!r}, 0)")
    model = _guard_off_model(st["tmp"] / f"T1_{call}_{level}", (
        f"import ctypes\nlc = ctypes.CDLL(None, use_errno=True)\n{do}\n"
        f"try:\n    exec(open({str(inside)!r}).read())\nexcept OSError:\n    pass\n"))
    load(model)
    assert not marker.exists()


@pytest.mark.parametrize("variant", ["case", "nfd"])
def test_t2_a_case_or_accent_changed_model_path_keeps_the_folder_protections(st, variant):
    if sys.platform != "darwin":
        pytest.skip("case and accent variants are the same folder only on macOS volumes")
    import unicodedata

    _no_declared_folders(st)
    folder = Path(os.path.realpath(st["tmp"])) / unicodedata.normalize("NFC", "modèles_t2")
    marker, helper = _held(st, f"t2_{variant}", base=folder)
    model = folder / "m.py"
    model.write_text(GUARD_OFF + "import os\n"
                     f"try:\n    os.rename({str(helper.parent)!r}, {str(helper.parent) + '_m'!r})\nexcept OSError:\n    pass\n"
                     f"try:\n    exec(open({str(helper.parent) + '_m/' + helper.name!r}).read())\nexcept OSError:\n    pass\n" + PSY)
    spelled = (str(model).replace("modèles_t2", "MODÈLES_T2") if variant == "case"
               else str(model).replace("modèles_t2", unicodedata.normalize("NFD", "modèles_t2")))
    load(spelled)
    assert not marker.exists()
    assert helper.exists(), "the folder was moved"


def test_t3_a_fast_fork_racer_is_ended_and_never_runs_a_later_file(st):
    later = st["models"] / "later_racer.py"
    marker = st["tmp"] / "ran_racer.txt"
    beat = st["tmp"] / "racer_beat.txt"
    racer = ("import os, time\nos.setsid()\nend = time.time() + 40\nn = 0\n"
             "while time.time() < end:\n"
             f"    try:\n        exec(open({str(later)!r}).read()); break\n    except OSError:\n        pass\n"
             "    if os.fork():\n        os._exit(0)\n"
             "    n += 1\n"
             f"    if n % 50 == 0:\n        open({str(beat)!r}, 'w').write(str(n))\n"
             "    time.sleep(0.002)\n")
    model = _guard_off_model(st["tmp"] / "T3", (
        "import subprocess, time\n"
        f"subprocess.Popen([sys.executable, '-c', {racer!r}], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\n"
        f"t = time.time()\nwhile time.time() - t < 5 and not os.path.exists({str(beat)!r}):\n    time.sleep(0.05)\n"))
    load(model)
    assert beat.exists(), "the racer never started"
    # The assistant writes later.py through its own write, which sweeps first.
    from app.services.assistant import files as assistant_files
    st["monkeypatch"].setattr(assistant_files, "folders_provider", lambda: [{"path": str(st["models"]), "access": "read_write"}])
    assistant_files.write_model_file(str(later), _helper(marker), base_hash=None)
    stamp = beat.stat().st_mtime
    deadline = time.time() + 4
    while time.time() < deadline and not marker.exists():
        threading.Event().wait(0.2)
    assert not marker.exists()
    assert beat.stat().st_mtime == stamp, "the racer is still running"


def test_t4_a_deleted_review_record_fails_closed_when_its_backup_is_there(st):
    marker, helper = _mk(st, "t4")
    review.mark_reviewed(str(st["agent_file"]), st["agent_file"].read_text())  # a second save: a backup exists
    sp = review.state_path()
    sp.unlink()
    review._cache = None
    assert review.is_tracked(str(helper)), "the backup wasn't read"
    # The guard (not switched off here) still refuses by the backup...
    plain = st["tmp"] / "Own" / "t4_plain.py"
    plain.parent.mkdir(exist_ok=True)
    plain.write_text(_model_importing(f"exec(open({str(helper)!r}).read())"))
    r = load(plain)
    assert r.status_code == 409, r.text[:300]
    # ...and with it switched off, the sandbox's policy still denies the file.
    load(_model(st, "t4", f"exec(open({str(helper)!r}).read())"))
    assert not marker.exists()


def test_t4_the_test_records_survive_another_pytest_session(st, tmp_path_factory):
    sp = review.state_path()
    assert sp.exists()
    empty = tmp_path_factory.mktemp("empty_session") / "test_empty.py"
    empty.write_text("def test_nothing():\n    pass\n")
    import subprocess
    subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", str(empty)],
                   capture_output=True, timeout=120, cwd=str(empty.parent))
    assert sp.exists(), "another pytest session removed this test's review record"


def test_t5_no_new_code_in_any_writable_folder(st):
    if sys.platform != "darwin":
        pytest.skip("refusing files by name needs Seatbelt's path rules (macOS)")
    rw = Path(os.path.realpath(st["tmp"])) / "AssistantRW"
    rw.mkdir()
    st["monkeypatch"].setattr(files_mod(), "folders_provider", lambda: [{"path": str(rw), "access": "read_write"}])
    model = _guard_off_model(st["tmp"] / "T5", (
        f"for name in ('planted.py', 'pkg/__init__.py', 'x.so'):\n"
        f"    try:\n        os.makedirs(os.path.dirname(os.path.join({str(rw)!r}, name)), exist_ok=True)\n"
        f"        open(os.path.join({str(rw)!r}, name), 'w').write('X = 1')\n    except OSError:\n        pass\n"
        f"open(os.path.join({str(rw)!r}, 'data.csv'), 'w').write('1')\n"))
    load(model)
    assert (rw / "data.csv").exists()
    for name in ("planted.py", "pkg/__init__.py", "x.so"):
        assert not (rw / name).exists(), name


def files_mod():
    from app.services.assistant import files as assistant_files
    return assistant_files


def test_t6_runnable_files_are_refused_and_pickles_still_work(st):
    if sys.platform != "darwin":
        pytest.skip("refusing files by name needs Seatbelt's path rules (macOS)")
    _no_declared_folders(st)
    folder = Path(os.path.realpath(st["tmp"])) / "T6"
    names = ["run.command", "go.sh", "bundle.zip", "app.pyz", "CMakeLists.txt", "build.gradle", "RUN.COMMAND"]
    model = _guard_off_model(folder, (
        "here = os.path.dirname(os.path.abspath(__file__))\n"
        f"for name in {names!r}:\n"
        "    try:\n        open(os.path.join(here, name), 'w').write('x')\n    except OSError:\n        pass\n"
        "import pickle\npickle.dump({'a': 1}, open(os.path.join(here, 'out.pkl'), 'wb'))\n"))
    load(model)
    assert (folder / "out.pkl").exists()
    for name in names:
        assert not (folder / name).exists(), name
