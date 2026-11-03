# AI assistant: containment experiment (#179, Phase 0)

The question from the issue: is real containment workable with PsyNeuLink and
its libraries, on the Mac first? This is the answer from an experiment run on
this machine on 2026-11-03. The script and profile are in
[`containment/`](containment/); nothing in the real runner was changed.

**Short answer: yes, on macOS.** A model runner under `sandbox-exec` imports
PsyNeuLink (with torch), loads and runs every end-to-end fixture and five of
the six bundled library models tested (the sixth calls `show_graph`, which
needs a Graphviz child process), with no network, no reads outside a listed
set, writes only to one scratch folder, no child processes and a clean
environment. The cost in start-up time is within the run-to-run noise
(2.2 to 2.7 s either way). Every escape attempt the threat model lists was
refused. The main caveats are that `sandbox-exec` is deprecated by Apple,
that the allowed read set includes the whole Python install and virtualenv,
and that nothing here covers Linux.

## What was run

- **Machine:** Apple M4 Max, 36 GB, macOS 26.7.1. Python 3.13.7 (python.org
  framework build), PsyNeuLink 0.20.2.0 from the app's virtualenv.
- **Runner:** `sandbox-exec -f profile.sb /usr/bin/env -i PATH=... HOME=<out>
  TMPDIR=<out> MPLCONFIGDIR=<out> python -I probe.py <model> ...`
  (`containment/run_experiment.py`). `env -i` gives the clean environment;
  the profile gives the file, network and process limits.
- **Profile** (`containment/profile.sb.template`): deny everything, then
  allow reading the Python framework, the virtualenv, `/usr/lib`,
  `/System/Library`, the dyld caches, a few `/dev` and `/etc` entries, the
  experiment folder and the model's folder; allow writing only to the
  output folder; `(deny network*)`; `(deny process-fork)`; exec only
  `/usr/bin/env` and the Python binaries.
- **The probe** (`containment/probe.py`) does what `sandbox_worker.load_module`
  does: `exec(compile(source, path, "exec"), module.__dict__)`, then runs
  each Composition once with zero inputs, then tries twelve escapes against
  marker files the harness created in the scratch folder. Each model was run
  once sandboxed and once not, for comparison.

## Results: end-to-end fixtures (`frontend/e2e/fixtures`)

| Model | Sandboxed | Import (s) | Load (s) | Run (s) | Wall (s) | Loaded | Ran | Escapes blocked |
|---|---|---|---|---|---|---|---|---|
| deep_nested.py | yes | 1.86 | 0.34 | 0.06 | 2.66 | yes | 1/3 | 11/12 |
| deep_nested.py | no | 1.78 | 0.34 | 0.06 | 2.62 | yes | 1/3 | 1/12 |
| gsc_afternodes.py | yes | 1.78 | 0.29 | 0.02 | 2.47 | yes | 1/1 | 11/12 |
| gsc_afternodes.py | no | 1.81 | 0.28 | 0.02 | 2.53 | yes | 1/1 | 1/12 |
| nested_minimal.py | yes | 1.8 | 0.26 | 0.05 | 2.49 | yes | 1/2 | 11/12 |
| nested_minimal.py | no | 1.8 | 0.24 | 0.05 | 2.53 | yes | 1/2 | 1/12 |
| recurrent_self.py | yes | 1.85 | 0.09 | 0.03 | 2.32 | yes | 1/1 | 11/12 |
| recurrent_self.py | no | 1.81 | 0.1 | 0.04 | 2.36 | yes | 1/1 | 1/12 |
| single_transfer.py | yes | 1.81 | 0.07 | 0.04 | 2.24 | yes | 1/1 | 11/12 |
| single_transfer.py | no | 1.81 | 0.06 | 0.03 | 2.31 | yes | 1/1 | 1/12 |
| two_input_nodes.py | yes | 1.84 | 0.1 | 0.07 | 2.36 | yes | 1/1 | 11/12 |
| two_input_nodes.py | no | 1.82 | 0.09 | 0.07 | 2.42 | yes | 1/1 | 1/12 |
| two_mech_projection.py | yes | 1.89 | 0.11 | 0.04 | 2.44 | yes | 1/1 | 11/12 |
| two_mech_projection.py | no | 1.94 | 0.11 | 0.04 | 2.5 | yes | 1/1 | 1/12 |
| with_controller.py | yes | 1.91 | 0.15 | 0.01 | 2.46 | yes | 1/1 | 11/12 |
| with_controller.py | no | 1.96 | 0.14 | 0.01 | 2.54 | yes | 1/1 | 1/12 |

- All nine fixtures load and run identically with and without the sandbox.
- "Ran 1/3" and "1/2" for the nested fixtures are the probe's own fault: it
  feeds zero inputs to every Composition in the file, and the inner ones
  refuse inputs addressed to nodes that aren't their INPUT nodes. The same
  failure happens unsandboxed, so it says nothing about containment.
- The import of PsyNeuLink (which imports torch) takes 1.8 to 1.9 s both
  ways. Whole-process wall time differs by less than 0.1 s. **The sandbox
  adds no measurable start-up cost.** The real runner's warm worker would
  pay it once per worker start, as it does today.
- "Escapes blocked 11/12": the twelfth row is `env_var_count`, which is a
  measurement, not an escape (see below).

## Results: the escape attempts

Every attempt was made from inside the sandboxed runner after the model had
run. "Blocked" means the operation raised; the harness also checked on the
outside that no marker was written.

| Attempt | Sandboxed | Not sandboxed |
|---|---|---|
| Read a marker file one folder above the output folder | **Refused**, `PermissionError: Operation not permitted` | Read it |
| List that folder | **Refused** | Listed it |
| Read a hidden marker file (stands in for shell configuration) | **Refused** | Read it |
| Write a file next to the marker | **Refused**; nothing appeared on disk | Wrote it |
| Write a file into the model's own folder | **Refused** | Wrote it |
| Connect to a TCP listener the harness opened on localhost | **Refused**, `Operation not permitted` | Connected |
| Resolve `example.com` | **Refused**, `gaierror` | Resolved it |
| Read `AI_THREAT_SECRET`, set in the parent's environment | **Not present** | Not present either: `env -i` did this, not the sandbox |
| Count of environment variables seen | 7 (the five the harness sets plus what `env` and Python add) | 7 |
| Start `/bin/ls` with `subprocess` | **Refused**, `Operation not permitted` | Ran |
| Start a second Python with `subprocess` | **Refused** | Ran |
| `os.fork()` | **Refused** | Forked |

Two things the table makes plain:

1. The clean environment comes from `env -i`, not from the sandbox. The
   runner must be started that way by the server, with an explicit short
   list of variables, or it inherits whatever the server has, including
   tokens. The real `sandbox.py` passes the server's environment through
   today.
2. `(deny process-fork)` is what stops child processes, including a second
   Python. PsyNeuLink imported and ran with it in place for every model
   tested, so there is no sign that the library needs to fork.

## Results: bundled PsyNeuLink library models

Six of the models bundled in `psyneulink/library/models`, each run with a
240 s limit. These files run their whole experiment at module level, so
"Load" here is the experiment, not just construction.

| Model | Sandboxed | Import (s) | Load (s) | Run (s) | Wall (s) | Loaded | Ran | Escapes blocked |
|---|---|---|---|---|---|---|---|---|
| Cohen_Huston1994.py | yes | 2.01 | 57.06 | 0.03 | 59.61 | yes | 1/1 | 11/12 |
| Botvinick_conflict_monitoring_model.py | yes | 2.01 | 51.77 | 0.03 | 54.26 | yes | 1/1 | 11/12 |
| Nieuwenhuis2005Model.py | yes | 1.88 | 6.88 | 0.01 | 9.21 | yes | 1/1 | 11/12 |
| GilzenratModel.py | yes | 2.24 | 6.51 | - | 9.16 | error | - | 11/12 |
| MontagueDayanSejnowski96.py | yes | 1.84 | 3.42 | 0.03 | 5.77 | yes | 3/3 | 11/12 |
| Kalanthroff_PCTC_2018.py | yes | 1.86 | 26.54 | 0.03 | 28.98 | yes | 1/1 | 11/12 |

Two of them run again both ways, for the comparison:

| Model | Sandboxed | Import (s) | Load (s) | Run (s) | Wall (s) | Loaded | Ran | Escapes blocked |
|---|---|---|---|---|---|---|---|---|
| Nieuwenhuis2005Model.py | yes | 1.97 | 7.45 | 0.02 | 9.88 | yes | 1/1 | 11/12 |
| Nieuwenhuis2005Model.py | no | 1.9 | 6.91 | 0.01 | 9.27 | yes | 1/1 | 1/12 |
| MontagueDayanSejnowski96.py | yes | 1.84 | 3.45 | 0.03 | 5.83 | yes | 3/3 | 11/12 |
| MontagueDayanSejnowski96.py | no | 1.88 | 3.47 | 0.03 | 5.92 | yes | 3/3 | 1/12 |

- Five of six load, run their experiment and run once more under the
  sandbox, with every escape refused. The two long ones (Cohen-Huston at
  57 s, Botvinick at 52 s) are the experiments themselves, not sandbox
  overhead; the two-way comparison shows the sandbox within 0.6 s on a 9 s
  model and 0.1 s on a 6 s model.
- **GilzenratModel fails under the sandbox**, with
  `ShowGraphError: Problem displaying graph for Composition-0: [Errno 1]
  Operation not permitted`. It calls `show_graph()` at module level, which
  starts Graphviz's `dot` as a child process, and `(deny process-fork)`
  refuses that. This is the one PsyNeuLink feature found that needs a
  child process. The real worker already patches `show_graph` during
  loading (`_apply_graphics_patches`, `_suppress_show_graph_fallback` in
  `sandbox_worker.py`), and the app renders graphs itself from the
  introspected model, so Phase 4 can keep forking denied and treat
  `show_graph` inside a contained run as unavailable. If a contained run
  must render with Graphviz, the profile would need to allow forking plus
  exec of `dot`, which is a wider boundary and should be its own decision.
- The remaining bundled models (the EGO study, the horse-race variant) were
  not run for lack of time; nothing suggests they differ, but they are
  untested.

## What it took to get PsyNeuLink running inside

Each of these was a refusal found in the system log (`log show` with the
`Sandbox` predicate) and then allowed; the list is the price of a real
boundary and is what Phase 4 would maintain.

- Exec: `/usr/bin/env`, the virtualenv's `python` symlink, and the whole
  `Python.framework/Versions/3.13` folder, because the framework
  `python3.13` re-executes `Python.app/Contents/MacOS/Python`.
- Reads: `/`, `/usr`, `/private`, `/usr/bin`, `/bin` (dyld reads them),
  `/System/Volumes/Preboot/Cryptexes/OS` (the dyld shared cache),
  `/dev/dtracehelper`, `/dev/null`, `/dev/urandom`, `/etc/localtime`.
- A temporary folder: `dill` (pulled in by torch) calls
  `tempfile.gettempdir()` at import and fails if no writable temp folder
  exists, so `TMPDIR` must point into the output folder.
- `HOME` and `MPLCONFIGDIR` into the output folder, or matplotlib tries to
  write a cache in the real home folder.
- `file-read-metadata` everywhere (stat of paths along the way) and
  `sysctl-read`. Neither reveals file contents.

What was *not* needed: any Mach service beyond the three listed in the
profile, any network, any write outside the output folder, any read of the
home folder.

## What isn't covered

- **`sandbox-exec` is deprecated.** It still works on macOS 26 and Apple's
  own tools use the same profile language, but there is no promise. Phase 4
  should treat it as the current mechanism with a plan B (App Sandbox
  entitlements for a helper, or a VM).
- **The allowed read set is broad.** The runner can read the whole Python
  install and virtualenv. That is code, not user data, but a model could
  read the virtualenv's own files, including any `.pth` or cached
  credentials a package left there. The experiment didn't try.
- **Time, memory and process limits** were not tested. `sandbox-exec` does
  not set them; `RLIMIT_AS` and `RLIMIT_CPU` through `resource` in the
  runner, plus the existing task timeouts, would.
- **The warm worker.** The experiment is a cold process per model. The real
  runner keeps one worker alive across tasks, so a model that runs in it
  could affect the next task in the same worker. That is a design point for
  Phase 4 (one worker per unreviewed run, or a worker restart after one).
- **Reading other models.** The runner can read its own model's folder,
  which may hold other models. Phase 4 should copy the one file into the
  output folder and allow only that.
- **Linux and the container mode.** Nothing here applies. The assistant is
  off in `container` and `hosted` modes until that is reviewed separately.
- **Older macOS and Intel Macs.** Tested on one Apple-silicon Mac on
  macOS 26.7.1 only.
- **`show_graph` and Graphviz.** Any model that renders with Graphviz at
  module level fails under `(deny process-fork)`; see GilzenratModel above.
- **Compiled execution modes.** PsyNeuLink's LLVM paths (`ExecutionMode.LLVM`
  and the PyTorch mode) weren't exercised; the models ran in Python mode.
  Those modes may need extra reads (for example `/private/var/folders` for
  JIT caches).
- **Escapes through the kernel or the profile language** were not sought.
  This is an experiment about feasibility and the listed attacks, not a
  penetration test. The outside review for Phase 4 should include that.

## Recommendation for Phase 4

1. **Go ahead on the Mac with `sandbox-exec` as the first mechanism.** It is
   workable: PsyNeuLink imports, models load and run, the cost is nil, and
   the refusals are the ones the threat model needs.
2. **Start the runner the way the experiment does:** `env -i` with an
   explicit list of variables, `HOME`, `TMPDIR` and `MPLCONFIGDIR` inside a
   per-run output folder, `python -I`, and a profile generated from a
   template with the real paths of the Python install and virtualenv.
3. **Narrow the file reads:** copy the single model file into the output
   folder and allow that folder only, not the model's original folder.
4. **Add resource limits in the runner** (`resource.setrlimit` for address
   space and CPU) and keep the existing per-task timeouts.
5. **One worker per unreviewed run.** Don't reuse a warm worker that has
   executed unreviewed code.
6. **Keep the approval requirement until the outside review passes.**
   Containment lets "run without asking" exist as a setting; it does not
   remove the need for the review the issue calls for.
7. **Keep Linux off.** The `assistant` capability stays false in `container`
   and `hosted` modes.

## Reproducing

```sh
cd <repo>
backend/.venv/bin/python docs/ai-assistant/containment/run_experiment.py \
    --scratch /path/to/scratch --library
```

It writes `results.json` and prints the Markdown tables above. The marker
files it creates are its own; it never reads real user files.
