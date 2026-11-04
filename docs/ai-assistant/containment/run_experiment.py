"""Containment experiment for the AI assistant (#179, Phase 0).

Runs probe.py on a set of model files, once under macOS sandbox-exec with
profile.sb.template and once without, and prints a Markdown table of the
results plus the raw JSON. Does not touch the real runner.

    python run_experiment.py --scratch <folder> [--models a.py b.py ...] [--timeout 300]

The scratch folder gets:
    marker/secret-marker.txt   a marker file OUTSIDE the allowed area
    marker/.marker-dotfile     a hidden marker (stands in for shell config)
    out/                       the only folder the runner may write to
    profile.sb                 the filled-in profile
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
VENV = REPO / "backend" / ".venv"
DEFAULT_MODELS = sorted((REPO / "frontend" / "e2e" / "fixtures").glob("*.py"))
LIBRARY_MODELS = [
    "Cohen_Huston1994.py",
    "Botvinick_conflict_monitoring_model.py",
    "Nieuwenhuis2005Model.py",
    "GilzenratModel.py",
    "MontagueDayanSejnowski96.py",
    "Kalanthroff_PCTC_2018.py",
]


def python_exe():
    # The venv symlink, not its target: Python finds pyvenv.cfg next to the
    # path it was started from, and -I makes that the only way site-packages
    # gets onto sys.path.
    return str(VENV / "bin" / "python")


def library_models():
    site = next((VENV / "lib").glob("python3.*")) / "site-packages" / "psyneulink" / "library" / "models"
    return [site / m for m in LIBRARY_MODELS if (site / m).exists()]


def fill_profile(scratch: Path, model: Path) -> Path:
    text = (HERE / "profile.sb.template").read_text()
    subs = {
        "@PYTHON@": python_exe(),
        "@PYTHON_FRAMEWORK@": str(Path(os.path.realpath(python_exe())).parents[1]),
        "@VENV@": str(VENV),
        "@VENV_REAL@": os.path.realpath(str(VENV)),
        "@PROBE_DIR@": str(HERE),
        "@MODEL_DIR@": str(model.parent),
        "@OUT@": str(scratch / "out"),
        "@HOME@": os.path.expanduser("~"),
        "@MARKER@": str(scratch / "marker" / "secret-marker.txt"),
    }
    for k, v in subs.items():
        text = text.replace(k, v)
    profile = scratch / "profile.sb"
    profile.write_text(text)
    return profile


def run_one(scratch: Path, model: Path, sandboxed: bool, timeout: int, no_run: bool) -> dict:
    out = scratch / "out"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    marker = scratch / "marker" / "secret-marker.txt"
    # A real listener on localhost, so "connect" tests the sandbox and not an
    # empty port. The runner is told the port on its command line.
    import socket
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    port = listener.getsockname()[1]
    probe_cmd = [python_exe(), "-I", str(HERE / "probe.py"), str(model), str(marker), str(out), str(port)]
    if no_run:
        probe_cmd.append("--no-run")
    # A clean environment: env -i drops everything, including the secret set
    # below, so the runner never sees the server's variables. PATH is the
    # minimum Python needs; HOME points INTO the output folder so nothing
    # Python or matplotlib caches lands in the real home folder.
    env_cmd = ["/usr/bin/env", "-i", "PATH=/usr/bin:/bin", f"HOME={out}",
               f"MPLCONFIGDIR={out}", f"TMPDIR={out}", "PYTHONDONTWRITEBYTECODE=1"]
    if sandboxed:
        cmd = ["/usr/bin/sandbox-exec", "-f", str(fill_profile(scratch, model))] + env_cmd + probe_cmd
    else:
        cmd = env_cmd + probe_cmd
    parent_env = dict(os.environ, AI_THREAT_SECRET="marker-token-should-not-leak")
    t0 = time.time()
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                              env=parent_env, cwd=str(out))
    except subprocess.TimeoutExpired:
        return {"model": model.name, "sandboxed": sandboxed, "timeout": True,
                "wall_s": round(time.time() - t0, 1)}
    finally:
        listener.close()
    wall = round(time.time() - t0, 2)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else ""
    try:
        data = json.loads(line)
    except ValueError:
        data = {"model": model.name, "harness_error": (proc.stderr or proc.stdout)[-600:],
                "returncode": proc.returncode}
    data["sandboxed"] = sandboxed
    data["wall_s"] = wall
    data["escaped_write_exists"] = (scratch / "marker" / "escaped-write.txt").exists()
    (scratch / "marker" / "escaped-write.txt").unlink(missing_ok=True)
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scratch", required=True)
    ap.add_argument("--models", nargs="*")
    ap.add_argument("--library", action="store_true", help="also run bundled PsyNeuLink library models")
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--no-run", action="store_true")
    ap.add_argument("--no-baseline", action="store_true", help="skip the unsandboxed comparison run")
    args = ap.parse_args()

    scratch = Path(args.scratch).resolve()
    (scratch / "marker").mkdir(parents=True, exist_ok=True)
    (scratch / "marker" / "secret-marker.txt").write_text("MARKER: this must not be readable from inside\n")
    (scratch / "marker" / ".marker-dotfile").write_text("MARKER dotfile\n")

    models = [Path(m).resolve() for m in args.models] if args.models else list(DEFAULT_MODELS)
    if args.library:
        models += library_models()

    results = []
    for model in models:
        for sandboxed in ([True] if args.no_baseline else [True, False]):
            print(f"... {model.name} sandboxed={sandboxed}", file=sys.stderr, flush=True)
            results.append(run_one(scratch, model, sandboxed, args.timeout, args.no_run))

    (scratch / "results.json").write_text(json.dumps(results, indent=1))
    print("| Model | Sandboxed | Import (s) | Load (s) | Run (s) | Wall (s) | Loaded | Ran | Escapes blocked |")
    print("|---|---|---|---|---|---|---|---|---|")
    for r in results:
        esc = r.get("escapes", {})
        blocked = sum(1 for v in esc.values() if v["blocked"])
        runs = r.get("runs", [])
        ran = f"{sum(1 for x in runs if x['ok'])}/{len(runs)}" if runs else "-"
        loaded = "timeout" if r.get("timeout") else ("error" if r.get("load_error") or r.get("harness_error") else "yes")
        print(f"| {r['model']} | {'yes' if r['sandboxed'] else 'no'} | {r.get('import_s', '-')} | "
              f"{r.get('load_s', '-')} | {r.get('run_s', '-')} | {r.get('wall_s', '-')} | {loaded} | {ran} | "
              f"{blocked}/{len(esc) if esc else '-'} |")
    print()
    for r in results:
        if r.get("load_error") or r.get("harness_error") or r.get("import_error"):
            print(f"- {r['model']} (sandboxed={r['sandboxed']}): "
                  f"{r.get('import_error') or r.get('load_error') or r.get('harness_error')}")
        for x in r.get("runs", []):
            if not x["ok"]:
                print(f"- {r['model']} run {x['name']} (sandboxed={r['sandboxed']}): {x['error']}")


if __name__ == "__main__":
    main()
