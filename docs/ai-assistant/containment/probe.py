"""Runs INSIDE the sandbox. Imports PsyNeuLink, loads a model file the way the
real runner does (compile + exec into a fresh module), runs each Composition
once, then tries to escape in the ways the threat model cares about. Prints one
JSON object on stdout.

Every escape attempt here touches only marker files that run_experiment.py
created in the scratch folder for this purpose. It never reads real user files.

Usage: python -I probe.py <model.py> <marker-file> <out-dir> [listener-port] [--no-run]
"""
import json
import os
import sys
import time
import types
import warnings

warnings.filterwarnings("ignore")

model_path, marker, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
listener_port = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4].isdigit() else 9
do_run = "--no-run" not in sys.argv
result = {"model": os.path.basename(model_path)}

t0 = time.time()
try:
    import psyneulink as pnl
    result["import_s"] = round(time.time() - t0, 2)
    result["pnl_version"] = pnl.__version__
except Exception as exc:
    result["import_s"] = round(time.time() - t0, 2)
    result["import_error"] = f"{type(exc).__name__}: {exc}"
    print(json.dumps(result))
    sys.exit(0)

# ---- load the model as the worker does (sandbox_worker.load_module) ----------
t1 = time.time()
module = types.ModuleType("__pnl_model__")
module.__file__ = model_path
try:
    with open(model_path) as fh:
        src = fh.read()
    os.chdir(out_dir)  # models that write files write here or fail
    sys.argv = [model_path]  # library models parse argv at module level
    import matplotlib
    matplotlib.use("Agg")
    exec(compile(src, model_path, "exec"), module.__dict__)
    comps = [v for v in vars(module).values() if isinstance(v, pnl.Composition)]
    result["load_s"] = round(time.time() - t1, 2)
    result["compositions"] = len(comps)
except BaseException as exc:
    result["load_s"] = round(time.time() - t1, 2)
    result["load_error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
    comps = []

# ---- run each composition once with zero inputs -------------------------------
if do_run and comps:
    t2 = time.time()
    runs = []
    for comp in comps:
        try:
            inputs = {}
            for node in comp.get_nodes_by_role(pnl.NodeRole.INPUT):
                inputs[node] = [node.defaults.variable]
            comp.run(inputs=inputs or None, num_trials=1)
            runs.append({"name": comp.name, "ok": True})
        except BaseException as exc:
            runs.append({"name": comp.name, "ok": False,
                         "error": f"{type(exc).__name__}: {str(exc)[:160]}"})
    result["run_s"] = round(time.time() - t2, 2)
    result["runs"] = runs


# ---- escape attempts ------------------------------------------------------------
def attempt(name, fn):
    try:
        value = fn()
        result.setdefault("escapes", {})[name] = {"blocked": False, "got": str(value)[:80]}
    except BaseException as exc:
        result.setdefault("escapes", {})[name] = {
            "blocked": True, "error": f"{type(exc).__name__}: {str(exc)[:100]}"}


marker_dir = os.path.dirname(marker)


def read_marker():
    # A marker file one folder above the allowed output folder.
    with open(marker) as fh:
        return fh.read()


def list_marker_folder():
    # Directory listing of the folder that holds the marker.
    return os.listdir(marker_dir)


def read_hidden_marker():
    # A dotfile marker, standing in for shell configuration files.
    with open(os.path.join(marker_dir, ".marker-dotfile")) as fh:
        return fh.read(40)


def write_outside():
    p = os.path.join(marker_dir, "escaped-write.txt")
    with open(p, "w") as fh:
        fh.write("escaped")
    return p


def write_model_folder():
    p = os.path.join(os.path.dirname(model_path), ".escaped-write.txt")
    with open(p, "w") as fh:
        fh.write("escaped")
    os.unlink(p)
    return p


def tcp_connect():
    import socket
    s = socket.create_connection(("127.0.0.1", listener_port), timeout=2)
    s.close()
    return "connected"


def dns_lookup():
    import socket
    return socket.getaddrinfo("example.com", 80)[0][4]


def env_secret():
    v = os.environ.get("AI_THREAT_SECRET")
    if v is None:
        raise KeyError("AI_THREAT_SECRET not in environment")
    return v


def env_count():
    return len(os.environ)


def start_subprocess():
    import subprocess
    return subprocess.run(["/bin/ls", "/"], capture_output=True, timeout=5).returncode


def spawn_python():
    import subprocess
    return subprocess.run([sys.executable, "-c", "print(1)"], capture_output=True,
                          timeout=5).returncode


def fork():
    pid = os.fork()
    if pid == 0:
        os._exit(0)
    os.waitpid(pid, 0)
    return pid


attempt("read_marker_file", read_marker)
attempt("list_marker_folder", list_marker_folder)
attempt("read_hidden_marker", read_hidden_marker)
attempt("write_outside_out_dir", write_outside)
attempt("write_into_model_folder", write_model_folder)
attempt("tcp_connect_localhost", tcp_connect)
attempt("dns_lookup", dns_lookup)
attempt("read_env_secret", env_secret)
attempt("env_var_count", env_count)
attempt("subprocess_ls", start_subprocess)
attempt("subprocess_python", spawn_python)
attempt("fork", fork)

result["total_s"] = round(time.time() - t0, 2)
print(json.dumps(result))
