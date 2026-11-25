# AI assistant: the operating-system sandbox for model runs (#311)

The assistant's rule is that Python it writes never runs until the user
approves it. The import guard (#187, `threat-model.md` section 7) enforces
that inside Python, which stops accidents and ordinary routes but not model
code that deliberately works against it: a model runs as the user, so it can
write files, start programs and call C through `ctypes`. This page is the
hard boundary behind the guard: the model runner asks the kernel to refuse
what a model has no business doing, before any model code runs.

The guard stays as the first, friendly layer. It gives the "review this
first" message that names the file. The sandbox is what still holds when
the guard has been switched off from inside.

## In one paragraph

Every task the runner does (load, preview, run, Learn, show graph, export)
runs in a process that has applied a policy the server built for that
task. The policy denies reading secrets and every file the assistant wrote
that isn't approved as it is now; allows writing only in the task's own
folder and the declared output folders, never in the review record, the
app, PsyNeuLink or the Python install; allows starting only Python and
Graphviz; and allows no network. On macOS the policy is a Seatbelt profile,
on Linux (WSL2, containers and CI included) Landlock plus a seccomp filter.
Where neither can be applied, PsyNeuView says so in Settings, in About and
in problem reports, and the assistant doesn't turn on unless the user
allows that. Applying the policy costs about 5 ms on macOS and about 1 ms
on Linux, once per task.

## The policy

Built by `backend/app/services/os_sandbox.py` (`policy()`), applied by
`backend/app/services/os_sandbox_apply.py` (`apply()`), which is standard
library only and loaded by path, like the import guard.

| | Allowed | Denied |
|---|---|---|
| **Read** | Everything not denied: the Python install and virtualenv, PsyNeuLink (installed or the active checkout), the model's folder, the assistant's folders, system libraries, Graphviz | Every tracked file whose text on disk isn't the approved text (by its real path and the file system's own spelling of it). Secrets in the home folder: `.ssh`, `.gnupg`, `.aws`, `.azure`, `.kube`, `.docker`, `.netrc`, `.git-credentials`, `.pypirc`, `.npmrc`, `.password-store`, `.config/gh`, `.config/gcloud`, the Keychains, cookies, Safari, Mail, Messages, browser profiles (Chrome, Firefox, Brave, Edge, Arc), the privacy database. System secrets (`/Library/Keychains`, `/etc/shadow`, `/etc/sudoers`). Other people's home folders. If the review record can't be read: all of the assistant's folders |
| **Write** | The task's own folder (`TMPDIR`, matplotlib's and numba's caches and the XDG cache are pointed into it; Python's bytecode cache is read where it is, and new entries simply aren't written); the assistant's read-write folders; folders declared in `PSYNEUVIEW_OS_SANDBOX_WRITE_FOLDERS`; `/dev/null` and friends | Everything else, the home folder included, and always, even inside an allowed folder: the review record and its folder (`~/.psyneuview`, PsyNeuLink clones included), the app settings file (`~/.psyneuview.json` and its old name, which choose the PsyNeuLink the fork server imports), the PsyNeuView install (backend, frontend, the guard's own files), `sys.prefix`, `sys.base_prefix`, the interpreter's stdlib and platstdlib folders (so no `sitecustomize.py`), every `site-packages` (so no `.pth` file), the active PsyNeuLink checkout. The unapproved files can't be written, renamed or linked either |
| **Programs** | Python itself (the venv's interpreter, and on macOS the framework, which re-executes `Python.app`), Graphviz (`dot`, `neato` and the others found on `PATH`), the Linux dynamic loader | Every other program: no shell, no `cp`, `rm`, `ln`, `cat`, `curl`, `osascript`. Forking is allowed (the runner forks, `show_graph` starts `dot`) |
| **Network** | Nothing | Every socket to another machine, to this one, and to local services (on macOS `(deny network*)`, on Linux `socket()` itself fails) |
| **Other** | Signals within the sandbox | Mach services other than the logger, notifications and the security server (so no LaunchServices or Apple events, which could start a program outside); on Linux with Landlock ABI 6, signals to processes outside |

On Linux, Landlock can only allow a whole folder and what is beneath it, so
a declared folder that holds a protected path (a checkout of PsyNeuView
inside an assistant folder, say) is allowed piece by piece around it: its
files and other subfolders can be written, but no new file can be made
directly in it. macOS has no such limit.

An unapproved file inside a writable folder: on macOS it can't be read,
written, renamed or linked. On Linux it can't be read, moved or linked
anywhere readable, but it can be overwritten or removed, which leaves the
model's own text there, still unapproved by its hash (denying that too
would leave no new file possible in the assistant's own folder).

**The model's own folder is writable** (the user's decision on #312), so
results and figures saved beside a model just work: create, change and
delete, in it and its subfolders. Inside it, still: no file the assistant
wrote can be changed (approved ones neither), the review record and the
settings file stay protected if they live there, and, on macOS, no new code
(`.py`, `.pyc`, `.pth`, compiled modules, `sitecustomize`, `usercustomize`)
can be made, since a later Python could run it without review. The same
holds in every writable folder, the assistant's read-write folders and the
declared output folders included, not only the model's own. A folder
that is, holds or sits inside the app, PsyNeuLink, the Python install or
the review record, or that is the home folder, isn't opened: the task
writes only in its own folder, and the result's notices say why. Pool
workers are started for the model the pool last ran.

**Never written in any writable folder (macOS):** hidden files and folders
(`.git/hooks`, `.vscode`, `.envrc`, `.bashrc`), `.pth` files, and files
other tools run by themselves (`Makefile`, `justfile`, `package.json`,
`conftest.py`, `setup.py`, `pyproject.toml`, `sitecustomize.py` and the
like). **On Linux these name rules don't exist** (Landlock can't tell files
apart by name); that is open.

**Folders holding a protected file can't be moved or cloned (macOS):** every
folder from an unapproved, tracked or protected file up to the writable
folder that holds it can't be renamed, removed, replaced or cloned
(`clonefile`), since Seatbelt's rules follow paths. Every path compared is
the file system's own spelling, so a model loaded by a case- or
accent-changed path gets the same rules. On Linux rules follow the file
itself.

**Never read:** besides the above, the assistant's earlier versions of
files it changed (`~/.psyneuview/assistant/previous`) and its log.

"Declared output folders" are the assistant's read-write folders plus
`PSYNEUVIEW_OS_SANDBOX_WRITE_FOLDERS`. A model that writes next to itself
(`open("results.csv", "w")` in the model's own folder) works without
declaring anything, since the model's own folder is writable (above); a
declared folder is needed only to write somewhere else.

## Per platform

| Where | Mechanism | Enforced | Not enforced | How it's detected |
|---|---|---|---|---|
| Mac app, macOS with a browser | Seatbelt, through `sandbox_init` (the call `sandbox-exec` makes), from a profile rendered per task (`render_sbpl`) | Reads, writes, renames and links by path; programs; network; Mach services; signals | Time and memory aren't limited by Seatbelt (the run limits are, below); a hard link made *before* a file was tracked, under another name (Seatbelt matches paths, not files; the import guard matches the file) | `os_sandbox_apply.py --probe`: applies a small policy in a process of its own and checks that a denied read, a write outside and a connect are refused and the task folder is writable |
| Linux | Landlock (kernel 5.13+) for files and programs; a seccomp filter for sockets, `io_uring`, `memfd_create` and `execveat` | Reads and writes (by file, not path, so renames and links can't get round it), programs, network; with ABI 2+ links across folders are checked; with ABI 4+ TCP too; with ABI 6+ signals and abstract sockets | Time and memory aren't limited by Landlock (the run limits are, below); signals to the user's other processes below ABI 6 (Linux 6.12); the *names* in a folder above a denied file can be listed (Landlock's listing right is inherited by subfolders), not their contents | The probe, plus the Landlock ABI version from `landlock_create_ruleset` |
| Windows via WSL2 | As Linux. WSL2's kernel is 5.15 or later, new enough; whether Landlock is enabled in its default build wasn't checked here (no Windows machine), so the probe decides | As Linux | As Linux | As Linux; the state says which ABI, or why not |
| Containers (Docker, Apptainer) and CI | As Linux, inside the container. A runtime whose own seccomp profile refuses the Landlock calls leaves it unavailable, and the state says so | As Linux | As Linux | As Linux. CI (ubuntu-latest) asserts the sandbox is available, so it can't skip silently |
| Native Windows | None. PsyNeuView isn't supported there (no `fork`, #187) | Nothing | Everything | The state is `unavailable` / `off_unavailable`: "PsyNeuView has no sandbox for native Windows; run it under WSL2 instead" |

### Why not a network namespace on Linux

`unshare(CLONE_NEWUSER | CLONE_NEWNET)` would give the process an empty
network, but it needs unprivileged user namespaces. Ubuntu 24.04 (and so
`ubuntu-latest`) restricts those by default through AppArmor, and some
container runtimes refuse them. A seccomp filter needs only
`no_new_privs`, which Landlock needs anyway, works in every one of those
places, and refuses local sockets too (a session bus, an SSH agent, a
Docker socket are all ways out). Landlock's own TCP rules (ABI 4+) are added
on top where the kernel has them.

### `sandbox-exec` is deprecated

Apple marks `sandbox-exec(1)` and `sandbox_init(3)` deprecated, and has
since macOS 10.8. They still work on macOS 26, and Apple's own services use
the same profile language. Treat it as the current mechanism with a plan B.
The plan B for the Mac app is a helper executable signed with the App
Sandbox entitlement (`com.apple.security.app-sandbox`) and temporary
exceptions for the folders above, launched by the app and running the
model runner. That needs the helper in the app bundle, code signing for it
and a bridge to hand it folders, and doesn't cover macOS with a browser
(there is no app bundle to carry entitlements). Not built here.

## Where it's applied, and why per task

The runner has four ways to get a process (#187): the warm worker (one
process for many tasks), the fork server (a clean parent that forks one
child per task), the pool (workers started ahead, one task each) and
one-shot processes (Learn jobs, the cold fallback).

**While the sandbox is in use, every task goes to the fork server (or the
pool where forking isn't usable), never the warm worker.** Each task then
runs in its own process, which applies its own policy before running
anything:

- **Fork server child:** the child reads its task, applies the policy the
  task carries, then runs it. The parent has imported PsyNeuLink, runs no
  model code, and is not itself sandboxed (see below).
- **Pool worker, Learn job, cold fallback:** started with the policy in
  `PSYNEUVIEW_OS_SANDBOX_POLICY` and applying it first thing, before
  PsyNeuLink is imported and before any thread starts. A pool worker kept
  ready under an older policy is ended unused when the policy changes.
- **A task that carries a policy runs only in a process that applied it.**
  If applying fails, the task is refused with the reason; it never runs
  unsandboxed because the sandbox broke.

### Options considered for per-task deny rules

The brief was to sandbox the fork server's parent at launch, so every
child inherits the profile at no cost per task. The catch is that the
deny list (the unapproved files) and the task's own folder change, and a
sandbox can't be widened or replaced afterwards. On macOS it can't even be
narrowed: `sandbox_init` in a process that is already sandboxed fails
("Operation not permitted"; checked). Three ways out were tried:

| Option | Cost | Verdict |
|---|---|---|
| A profile parameter naming a deny-list folder | — | Doesn't work: Seatbelt matches the real path of the file opened, so links in a deny folder don't deny their targets, and parameters are fixed when the profile is applied |
| Restart the fork server's parent when the set of unapproved files changes | PsyNeuLink's import, 1.7 to 2.5 s, on the next task after every assistant write or approval | Works, but every write the assistant makes and every approval costs a visible pause on the next load, and the task's own folder still can't be per task |
| **Each forked child applies its own profile, generated for that task, before reading any model file** | About 5 ms per task on macOS (`sandbox_init` compiling a profile of about 60 rules), about 1 ms on Linux | **Chosen.** The deny list is exactly the unapproved files as they are when the task starts, the task's folder is its own, nothing restarts, and it is the same design on both platforms (Landlock, too, is applied by a process to itself) |

What this gives up: the fork server's parent is not sandboxed. It doesn't
need to be: it runs no model code, reads nothing from the server but the
word `FORK`, and its children can't reach it (on macOS a sandboxed process
can't signal or inspect one outside its sandbox; on Linux Landlock forbids
`ptrace` of a process outside the domain). On Linux, where Landlock stacks,
a base policy could also be applied to the parent; that is a possible
hardening, not done, to keep one design.

### Every model run, or only while assistant code is tracked

Sandboxed **always while anything the assistant wrote is tracked** (or the
review record can't be read), and, with the assistant on, **for every run**
(the setting "Sandbox every model run while the assistant is on", default
on). Opening any model runs its code, so a model someone shared can be as
hostile as one the assistant wrote, and the cost is invisible (timing
below). With the assistant off and nothing tracked, nothing changes for
users who never use it: the warm worker runs as before.
`PSYNEUVIEW_OS_SANDBOX=on|off`, read once at start, overrides both (for
measuring and debugging; `off` is visible in Settings and About).

### Denying reads of unapproved files at the OS level

Built, as the strongest form of the rule: a file the assistant wrote that
nobody approved can't be opened at all by a model, through any route, by
the model's process or any process it starts. "Unapproved" is decided per
task from the text on disk: a tracked file whose content hash isn't the
approved one (an approved file edited afterwards is unapproved again).
Files written **during** a task (the assistant writing while a model is
loading) are covered by the import guard for that task and by the sandbox
from the next one.

### Proof, refusal and survivors

- **Every run meant to be sandboxed proves it was.** The worker puts the key
  of the policy it applied into its answer; the server refuses an answer
  without it. So a run that somehow went unsandboxed fails closed.
- **Refused, not run, when it can't be.** While the sandbox is wanted (the
  assistant on, or anything it wrote tracked) and can't be applied, runs
  answer 409 `sandbox_required` with the reason, unless "Require the
  sandbox" is off or the server was started with
  `PSYNEUVIEW_OS_SANDBOX_ALLOW_UNSANDBOXED=1`. A failed check is retried
  after a minute; a success holds for the server's life.
- **Survivors are ended, and only PsyNeuView's own.** A survivor is found
  only by its task's mark, never by its program, parent, process group or
  session, so a process that isn't PsyNeuView's is never touched:
  - **macOS:** every task's profile refuses reading two random files (one
    per server run, one per task) and allows a control file next to them.
    The sandbox is inherited through fork, exec and `setsid` and can't be
    removed or put on another process, so `sandbox_check` against those
    files names exactly this server's task processes. A process still
    refusing a running task's file is left alone.
  - **Linux:** the fork server's parent is a subreaper, so every orphan of
    its tasks, whatever session it moved to, becomes its child, and after
    each task it ends all its children. Workers the server starts (pool,
    Learn jobs, one-shot runs, conversions) carry
    `PSYNEUVIEW_TASK_MARK=<random run token>:<task id>` in the environment
    they start with, read from `/proc/<pid>/environ`; a model can't put it
    into another process's environment, and can't guess the token.
  - Every process found is stopped at once (it can't fork while stopped),
    then killed, **by pid only**. Rounds go on until three in a row find
    nothing, within ten seconds.
  - The fork server, the pool workers, Learn jobs, one-shot runs and
    conversions each start in a session of their own, so a model can't
    join one of the user's process groups.
  - Sweeps run in the background after and before tasks; the one before
    the assistant writes a file runs at once.
  - On Linux every worker the server starts is a subreaper too, and ends
    every child it has when its task is over, so a process that execs with
    its mark removed from the environment is still ended (as long as it is
    a descendant of the worker when the task ends). Per-task cgroups aren't
    used.
- **No executable files.** On macOS, mode changes are refused in every
  writable folder but the task's own, so a model can't set an execute bit;
  `shutil.copy` and `copy2` let their last step (copying the mode) go
  there, so ordinary copies work and the file keeps its default mode. That
  allowance is convenience, not part of the boundary. Archives that restore
  modes (`tarfile` extraction into such a folder) fail. After every task,
  the execute bits also come off regular files in its writable folders
  whose status changed during the task, every file however many: the
  backstop on macOS, and on Linux (where Landlock has no right for mode
  changes) the mechanism, so there a file can be executable until its task
  ends. Names ending in a dot are refused (macOS).
- **Pool mode is slower:** previews take about 2.5 s (fork mode about
  0.37 s). The pool is only the fallback where forking isn't usable. On
  Linux a pool worker's rules are set when it starts and don't open any
  model's folder for writing; and a model in a folder made after the ready
  workers started (next to a file the assistant wrote) needs a fresh
  worker, since Landlock's rules don't reach folders made later there. When
  a task needs a fresh worker, spares still starting that couldn't fit it
  are ended rather than waited for, so the task's own worker starts alone
  (a load in that case went from about 2.9 s to about 1.5 s on two CPUs).
- **Output is bounded.** Every worker's output is read with a 16 MB cap and
  no longer than a moment after the worker exits, so a leftover writing
  without end can't fill the server's memory or stall the next task.
- **No new file without an extension (macOS)** in writable folders other
  than the task's own: Finder runs such a file if it is executable. Link
  and launcher files (`.terminal`, `.fileloc`, `.webloc`, `.inetloc`,
  `.desktop`) are refused too.
- **The proof is defence in depth, not the barrier.** Model code can read
  the policy's key, so it could forge an answer; the barrier is the
  worker's own refusal to run a task whose policy it hasn't applied. The
  proof catches a run that went unsandboxed by mistake.
- **Linux program folders are unreadable.** The dynamic loader has to be
  allowed to run, since the kernel runs it for every program. Given a
  readable program it would start it, so `/bin`, `/usr/bin` and the like
  can't be read; the allowed programs can. **Not closed:** the loader can
  still start a program the model writes into a writable folder, or one
  under `/opt` or another readable folder; such a program runs inside the
  same sandbox (no network, the same reads and writes).

### When no sandbox can be applied

The state is one of:

- `on`: wanted and applied.
- `unavailable`: wanted, and can't be applied here. **Runs are not
  sandboxed**: Settings ▸ AI assistant shows it as a warning (and a second
  warning under the on switch), About shows "NOT sandboxed: <reason>", and
  problem reports carry it.
- `available`: could be applied, not wanted now (assistant off, nothing
  tracked).
- `off_unavailable`: not wanted, and couldn't be anyway.

**Recommendation, and the default:** the assistant refuses to turn on where
no sandbox can be applied ("Require the sandbox", on by default). The
guard alone is a speed bump against deliberate model code, so turning the
assistant on without the boundary should be a decision someone makes, not
a default. Turning the requirement off saves without a question since
#369 (turning the assistant on is the one consent); while it is off the
consent and the Settings summary say runs may be unsandboxed. Files already tracked when the assistant is off still run under the
sandbox where one exists, and are still guarded where none does.

## Graphviz and `show_graph`

`show_graph` starts Graphviz's `dot`. The policy allows exactly Graphviz's
programs, found on `PATH` when the policy is built, by their real paths,
and forking. Graphviz reads its plugins and fonts (reads are open) and
writes nothing but its output pipe. The containment experiment's one
failure (GilzenratModel, which calls `show_graph()` at module level) came
from denying `fork`; it is allowed here. No shell is allowed, so a library
that runs `dot` through `sh -c` would fail; none in use does.

## The environment and the run limits (every run, sandboxed or not)

**Environment** (`model_env.py`, review packet B2). Every process that runs
model code (the warm worker, the fork server and its children, pool
workers, the one-shot fallback, Learn jobs, the sandboxed converter) starts
with an allow-listed environment, never the server's: `PATH`, `HOME`, the
locale (`LANG`, `LC_*`), the temporary folders, Python's and the
virtual environment's variables, the native-library and thread-count
variables numpy and torch read, matplotlib's and numba's caches,
Graphviz's, PsyNeuLink's (`PNL_*`) and the runner's own `PSYNEUVIEW_*`.
Any name that looks like a secret is dropped whatever its prefix: a part
`TOKEN`, `KEY`, `SECRET`, `PASSWORD`, `CREDENTIALS`, `AUTH`, `SESSION` and
the like, or a credential prefix (`AWS_`, `GITHUB_`, `GH_`, `AZURE_`,
`GOOGLE_`, `ANTHROPIC_`, `OPENAI_`, `HF_`, `SSH_` and others). Tested by
planting secrets in the server's environment and reading `os.environ` from
a model (`test_model_env.py`).

**Limits** (`run_limits.py`, review packet B3). Each run is limited in
memory per process, processor time and number of processes, on every
platform, in two layers:

| Layer | Where | What |
|---|---|---|
| `setrlimit`, in the task's own process before any model code runs | `os_sandbox_apply.apply_run_limits`, called from `sandbox_worker._handle_one_task` | Processor seconds (`RLIMIT_CPU`; the model gets a `RunLimitExceeded` at the limit, the kernel ends it 5 s later) and processes (`RLIMIT_NPROC`, counted over all the user's processes, so the allowance is added to what the user has now) everywhere; memory (`RLIMIT_DATA`) on Linux. Hard limits in a process that runs one task (a fork server's child, a pool worker, the one-shot fallback, a Learn job); soft ones, reset per task, in the warm worker |
| The server's watch, from a thread, every 0.25 s | `run_limits.Watch`, in every way a task is sent, and the sandboxed converter | Each process's memory (macOS refuses any memory `setrlimit`; there the physical footprint, which counts compressed and swapped-out memory, so memory pressure can't hide a growing model), the number of processes the task started and their processor time together. Over a limit, it ends them all |

A run a limit stopped answers 422 with `reason: "run_limit"` and a
plain-English message naming the limit and the variable that raises it; it
is never retried in the one-shot fallback. Defaults are generous: memory,
half the computer's memory (at least 2 GB) per process,
`PSYNEUVIEW_RUN_MEMORY_MB`, 256 MB up to all of it; processor time, 7200 s,
`PSYNEUVIEW_RUN_CPU_SECONDS`, 2 to 86,400; processes, 256 more than the user
has, `PSYNEUVIEW_RUN_PROCESSES`, 8 to 4096 (on Linux the kernel counts
threads here). Limits apply to every run, whether or not the assistant is
on. Tested with models that allocate without end, spin and fork over and
over (`test_run_limits.py`), through the warm worker, the fork server, the
pool and the one-shot fallback, with and without the sandbox.

Known limits of the limits: the process count is approximate while other
programs start and end many processes (it is counted once per 10 s); memory
is per process, so many processes each under the limit can together use
more (the process limit bounds how many); the watch samples every 0.25 s,
so a fast allocation can overshoot the limit by what it allocates in that
time; Windows has no `setrlimit` (the watch still holds there).

## Timing

Measured 2026-11-24 on an Apple M4 Max (36 GB, macOS 26.7) at the branch's
head, through `POST /api/model/load` in the test client: the median of 10
loads after a warm-up, a small model (`stroop_reference_basic.py`) and EGO
(`Giallanza2024_ego_study2.py`). "Off" is the sandbox not in use; the fork
and pool rows have an assistant-written file tracked, so each task runs in
a fresh process. Other sessions were using the machine, so differences of
about 0.1 s are noise.

| Sandbox | Isolation | Small model | EGO |
|---|---|---|---|
| off | warm worker (nothing tracked) | 0.94 s | 2.96 s |
| off | fork server | 0.67 s | 2.28 s |
| off | pool | 0.68 s | 2.22 s |
| on | fork server | 0.66 s | 2.31 s |
| on | pool | 0.63 s | 2.20 s |

The sandbox adds nothing measurable to a load in either mode. The run
limits add nothing measurable either: loads with them on and off,
alternated one by one in the same process, had medians of 0.74 s and
0.76 s (warm worker, small model); in the table's runs fork and pool were
within 0.1 s with and without them. EGO's worker peaked at about 1.5 GB,
well inside the default memory limit (18 GB on this machine). The
independent review's rounds 4 and 5 measured the same order: about 0.37 s
per load or preview in fork mode, about 2.5 s for a pool-mode preview
and 2.7 s for a Learn job.

## Tests

- `backend/tests/test_os_sandbox.py`: a process applies the server's real
  policy and tries every disk, child-process, `ctypes` and network attack
  from the security review's rounds 1 to 4. All must be refused; reading
  approved files, the task folder, output folders, child Pythons, pipes and
  Graphviz must still work. Skipped, with the reason, where no sandbox can
  be applied.
- `backend/tests/test_os_sandbox_routes.py`: the same attacks through the
  real routes and the real runner (load, preview, Learn job), in both
  isolation modes.
- CI (Linux) asserts the sandbox is available on `ubuntu-latest`, so the
  tests can't pass by skipping, and runs the runner guard's tests with
  `PSYNEUVIEW_OS_SANDBOX=on`.

## Decisions for the user

1. **Models that write next to themselves**: decided on #312, the model's
   own folder is writable, so such models keep working. The cost is that a
   hostile model can leave data files beside itself (never code: the rules
   in "The model's own folder is writable" above still hold there).
2. **The model converter** (`/model/convert`, the MDF import's tidy-up):
   under the sandbox it runs the model in a sandboxed process of its own
   (`converter._standard_source_in_sandbox`), not in the server, so a model
   converted is held to the same boundary as one loaded. Only where the
   sandbox isn't in use does it run in the server's own process, as every
   run then runs unsandboxed. Its sandboxed process gets the allow-listed
   environment and is watched against the run limits by the server (the
   in-process `setrlimit` layer isn't applied there); its own timeout
   (300 s) applies.
3. **`sandbox_init` on macOS** is deprecated. Acceptable now; the App
   Sandbox helper is the plan B for the Mac app.
