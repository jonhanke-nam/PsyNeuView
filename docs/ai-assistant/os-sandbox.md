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
| **Write** | The task's own folder (`TMPDIR`, matplotlib's and numba's caches, Python's bytecode cache and the XDG cache are pointed into it); the assistant's read-write folders; folders declared in `PSYNEUVIEW_OS_SANDBOX_WRITE_FOLDERS`; `/dev/null` and friends | Everything else, the home folder included, and always, even inside an allowed folder: the review record and its folder (`~/.psyneuview`, PsyNeuLink clones included), the app settings file, the PsyNeuView install (backend, frontend, the guard's own files), `sys.prefix`, `sys.base_prefix`, every `site-packages` (so no `.pth` file), the active PsyNeuLink checkout. The unapproved files can't be written, renamed or linked either |
| **Programs** | Python itself (the venv's interpreter, and on macOS the framework, which re-executes `Python.app`), Graphviz (`dot`, `neato` and the others found on `PATH`), the Linux dynamic loader | Every other program: no shell, no `cp`, `rm`, `ln`, `cat`, `curl`, `osascript`. Forking is allowed (the runner forks, `show_graph` starts `dot`) |
| **Network** | Nothing | Every socket to another machine, to this one, and to local services (on macOS `(deny network*)`, on Linux `socket()` itself fails) |
| **Other** | Signals within the sandbox | Mach services other than the logger, notifications and the security server (so no LaunchServices or Apple events, which could start a program outside); on Linux with Landlock ABI 6, signals to processes outside |

"Declared output folders" are the assistant's read-write folders plus
`PSYNEUVIEW_OS_SANDBOX_WRITE_FOLDERS`. A model that writes next to itself
(`open("results.csv", "w")` in the model's own folder) is refused unless
that folder is declared. See "Decisions for the user" below.

## Per platform

| Where | Mechanism | Enforced | Not enforced | How it's detected |
|---|---|---|---|---|
| Mac app, macOS with a browser | Seatbelt, through `sandbox_init` (the call `sandbox-exec` makes), from a profile rendered per task (`render_sbpl`) | Reads, writes, renames and links by path; programs; network; Mach services; signals | Time and memory (the task timeout applies); a hard link made *before* a file was tracked, under another name (Seatbelt matches paths, not files; the import guard matches the file) | `os_sandbox_apply.py --probe`: applies a small policy in a process of its own and checks that a denied read, a write outside and a connect are refused and the task folder is writable |
| Linux | Landlock (kernel 5.13+) for files and programs; a seccomp filter for sockets, `io_uring`, `memfd_create` and `execveat` | Reads and writes (by file, not path, so renames and links can't get round it), programs, network; with ABI 2+ links across folders are checked; with ABI 4+ TCP too; with ABI 6+ signals and abstract sockets | Time and memory; signals to the user's other processes below ABI 6 (Linux 6.12); the *names* in a folder above a denied file can be listed (Landlock's listing right is inherited by subfolders), not their contents | The probe, plus the Landlock ABI version from `landlock_create_ruleset` |
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
a default. Turning the requirement off asks first, as every other widening
does. Files already tracked when the assistant is off still run under the
sandbox where one exists, and are still guarded where none does.

## Graphviz and `show_graph`

`show_graph` starts Graphviz's `dot`. The policy allows exactly Graphviz's
programs, found on `PATH` when the policy is built, by their real paths,
and forking. Graphviz reads its plugins and fonts (reads are open) and
writes nothing but its output pipe. The containment experiment's one
failure (GilzenratModel, which calls `show_graph()` at module level) came
from denying `fork`; it is allowed here. No shell is allowed, so a library
that runs `dot` through `sh -c` would fail; none in use does.

## Timing

_Measured on macOS after the runner integration; see the PR for the table._

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

1. **Models that write next to themselves** are refused while sandboxed,
   unless the folder is one of the assistant's read-write folders or is
   declared. Allowing each model's own folder would keep such models
   working, at the cost of letting a hostile model write files beside
   itself (another model the user later opens, for one). Recommended:
   keep refusing, and add a "declared output folders" list to Settings if
   users hit it.
2. **The model converter** (`/model/convert`, the MDF import's tidy-up)
   runs model code in the server's own process, which isn't sandboxed.
   A model the user converts can do anything the server can. Moving the
   converter into the runner would close it; until then it is listed as
   not covered.
3. **`sandbox_init` on macOS** is deprecated. Acceptable now; the App
   Sandbox helper is the plan B for the Mac app.
