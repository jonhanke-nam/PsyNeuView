# AI assistant: threat model (#179, Phase 0)

What the assistant could be used to do to the user's machine and work, who
would do it, every way in, and what stops each one. Written against the code
as it is on the `feature/ai-assistant-179` branch and the rules in
[`contract.md`](contract.md). The security checklist each phase must pass is
in [`security-review.md`](security-review.md); the containment experiment is
in [`containment.md`](containment.md).

Scope note: this document is about the assistant. Requirements it places on
the local server are stated as requirements only; the server's own request
handling is reviewed separately.

## 1. What we protect

| Asset | Where it is | Why it matters |
|---|---|---|
| The user's files outside designated folders | Home folder, other projects, cloud-synced folders | The assistant must never read, change or delete them |
| The user's model files inside designated folders | The folders the user lists in Settings | Work must not be lost or silently changed |
| Credentials and tokens | The Keychain (assistant key), the server's environment, GitHub tokens the app holds for the PsyNeuLink source, `~/.ssh`-style folders | Theft gives an attacker the user's accounts |
| The machine's ability to act as the user | Shell, network, other programs, the Mac app's bridges | Running code with the user's permissions is the worst case |
| Model contents and conversation | Memory of the backend; the chosen agent's service | Leaving the machine without consent is a privacy failure |
| The app's own settings | Backend settings store | Raising the assistant's permissions is the way every other attack starts |
| Money and time | The user's service account; CPU and memory | A loop can run up a bill or exhaust the machine |

## 2. Who the attackers are

| Attacker | How it acts | What it can see |
|---|---|---|
| **Rogue agent** | A service or local model that is itself hostile or compromised. Calls any tool in any order, with any arguments, as fast as the limits allow. | Everything the tools return, plus whatever `context` shares |
| **Misled agent** (prompt injection) | A well-behaved agent that follows instructions planted in text it reads: a comment or docstring in a model file, an error message, a file from GitHub, a tool result, the docs it searches. Behaves like a rogue agent for the duration. | The same |
| **Malicious file** | A `.py` model already in a designated folder, placed by someone else (shared drive, cloned repo, downloaded bundle). Runs when opened. | Everything the user can, once run |
| **Another program on the machine** | Anything that can send HTTP requests to the local server or write to the designated folders. | Whatever the assistant routes return |
| **Another account on the machine** | A second macOS user on the same Mac. | Whatever file permissions and the local server allow |
| **The agent's service** | The provider the user chose. Receives model contents and prompts by design. | Everything sent in a session |

The agent is untrusted always, even when it is good: the misled-agent case
means the design can never rely on the agent's instructions.

## 3. How the app runs code today

The assistant's risk comes from the fact that opening a model runs it. The
relevant code, as of this branch:

- **`backend/app/services/sandbox.py`** runs every model task (`introspect`,
  `run`, `learn`, `show_graph`) in a worker process, `sandbox_worker.py`,
  started with `subprocess.Popen([sys.executable, WORKER_PATH, "--persistent"])`
  and no changes to the environment, working folder or permissions. The
  "cold" fallback (`_run_cold`) is `subprocess.run(...)` with
  `cwd=<model's folder>`. The worker inherits every environment variable the
  server has. **This "sandbox" protects the server from crashes and hangs.
  It is not a security boundary.** The containment experiment measures what
  a real one would cost.
- **`sandbox_worker.load_module`** reads the file and executes it with
  `exec(compile(source, file_path, "exec"), module.__dict__)`. Anything at
  module level runs.
- **`backend/app/api/ws.py` `_on_file_changed`** is the file watcher's
  callback. It calls `load_and_introspect(file_path)` on the server side
  before telling the page anything, so **a change on disk runs the file
  with no page involvement**. `_on_psyneulink_changed` does the same when the
  PsyNeuLink checkout changes.
- **Autosave** (`/settings/autosave`) is driven by the page: it saves through
  `/model/save-source`, which writes the file and reloads it. The watcher
  ignores writes the app made itself (`note_internal_write`), so the reload
  comes from the save route, not the watcher.
- **Undo and redo** on the page re-apply a previous source through the same
  save-and-reload route.
- **Bundle import** (`backend/app/services/bundle.py`, `/model/import-project`,
  `/model/open-project`) extracts a `.pnlproject` zip to a working folder and
  opens the model inside it, which runs it.
- **The Mac app's bridges** (`frontend/src/utils/fileBridge.ts`,
  `macAppSettings.ts`) are `window.webkit.messageHandlers.pnvFile` and
  `pnvSettings`: the page asks the native app to open file dialogs, reveal
  files and change native settings. They exist only inside the Mac app's web
  view, and anything that runs script in the page can reach them.

So "write a model file" and "open a model file" are both "run code", and so
are "change a file in the watched folder" and "import a bundle".

## 4. Every route in, and its defence

Each row names the test that must exist before the route ships. Each test named exists in `backend/tests/test_assistant_*.py` or
`frontend/e2e/`; the review for each phase checks they pass.

### 4.1 Through the assistant's tools

| Route | Attacker | What could go wrong | Defence | Test |
|---|---|---|---|---|
| `read_open_model` | Rogue or misled agent | Sees more than the user allowed | Backend drops anything `visibility` doesn't allow before the agent sees it (contract: "context") | `test_visibility_filter` |
| `read_docs` | Misled agent | Docs text carries planted instructions | Docs are the app's own; results are data, not instructions. The agent is untrusted anyway | `test_read_docs_only_bundled_docs` |
| `propose_app_edit` | Rogue agent | Silent change to the model; a stale edit overwrites the user's work; a huge or malformed op | Proposal only; the page applies it through the user's own edit paths, as one History entry; `base_hash` check gives 409 when the user moved on; ops limited to a listed set | `test_app_edit_needs_accept`, `test_stale_app_edit_proposal`, `test_hole_a_unknown_op_with_source_is_refused` |
| `list_files` | Rogue agent | Enumerates the home folder | Only designated folders, real path after symlinks, no hidden files, PsyNeuLink-style files only, count limit | `test_files_outside_folders_and_without_visibility`, `test_hidden_and_wrong_type_refused` |
| `read_file` | Rogue agent; malicious file | Reads a credential file; a `.py` is executed to read it; a planted comment misleads the agent | Path rules as above; **reads text only, never imports or executes**; size limit | `test_reading_never_runs`, `test_oversized_refused`, `test_dot_dot_refused`, `test_symlink_to_file_outside_refused`, `test_symlinked_parent_refused`, `test_hard_link_refused_for_write_but_readable`, `test_case_variant_refused` |
| `propose_file_write` | Rogue agent | Writes a program; overwrites the user's work; writes outside folders; writes a `.zshrc` | Proposal only; `read_write` folder; `base_hash`; previous version kept; file type by classifier and extension; written content is **marked unreviewed** so nothing runs it | `test_file_write_accept_keeps_previous_and_marks_unreviewed`, `test_write_keeps_previous_and_marks_unreviewed`, `test_write_keeps_previous_and_marks_unreviewed` |
| `propose_open_file` | Rogue agent; malicious file | Opening runs it | Only the user can accept; `is_runnable` refuses unreviewed content; opening a file the assistant didn't write still asks, because the folder may hold anything | `test_open_proposal_user_only`, `test_route_refuses_unreviewed` |
| Any tool not on `TOOL_ALLOWLIST` | Rogue agent | Reaches the general API, settings, shell | Tools are dispatched by name from the allowlist; an unknown name is a `refused` event and a log line | `test_non_allowlisted_tools_are_refused` |
| Tool arguments | Rogue agent | Injection through arguments (paths, op names, huge strings) | Every argument validated by the backend; size limits; nothing passed to a shell | `test_hole_b_hostile_update_param_is_refused`, `test_hole_b_hostile_names_are_refused` |
| Session limits | Rogue agent | Loops; cost | `limits.tool_calls` and `limits.minutes` end the turn with `done: limit`; Stop ends it at once | `test_tool_call_limit`, `test_stop_ends_the_turn_at_once` |

### 4.2 Through what the agent reads (prompt injection)

| Route | Defence | Test |
|---|---|---|
| Comments and docstrings in a model file | The file is text to the agent; whatever it decides, it has only the tools above and the limits are enforced by the backend | `test_injection_in_model_file_cannot_write_outside` |
| Error messages and run output | Same; `visibility.errors` can be off | same |
| Tool results, docs | Same | same |

Prompt injection has no separate defence and needs none: the design assumes
the agent is already hostile. Each injection test plants an instruction and
checks that following it is refused by the backend.

### 4.3 Through the page

| Route | Attacker | Defence | Test |
|---|---|---|---|
| Agent text shown in the panel | Rogue agent | Rendered as text, never HTML; no remote images or any remote content; links need a click and show the full address | `ai-assistant.spec.ts` ("hostile text is inert") |
| Data leaving through a URL in a reply | Rogue agent | No remote content loaded; link addresses shown in full | same |
| Agent text reaching the Mac bridges | Rogue agent | Text is never evaluated as script; bridges are called only by the app's own code | same, plus a bridge guard test |
| Applying a proposal | Page bug | Applied only after the user's accept, through existing edit paths, one History entry | `ai-assistant-real.spec.ts` ("one undo reverses it") |

### 4.4 Through the local server

| Route | Attacker | Defence | Test |
|---|---|---|---|
| Assistant routes | Another program, another account | **Assistant routes accept requests only from the app's own page** (`same_site`); a per-session credential is not built yet (open item below); off by default; off in `container` and `hosted` modes via the `assistant` capability | `test_off_by_default`, `test_capability_off_in_container_and_hosted`, `test_same_site_check`, `test_review_routes_accept_only_the_apps_own_page` |
| Settings routes | Rogue agent; another site | There is no tool that reaches `PUT /api/assistant/settings`, and it accepts requests only from the app's own page (`same_site`). Turning the assistant on, and a new destination while on, need `confirm_raise`, which only the page sends after the user's consent (#369) | `test_non_allowlisted_tools_are_refused`, `test_only_turning_on_and_a_new_destination_while_on_need_consent`, `test_settings_from_another_site_are_refused` |
| Key routes | Rogue agent | `GET /api/assistant/key` returns `{"set": bool}` only; the key never appears in logs, reports or the runner's environment | `test_key_never_in_responses_logs_settings_or_environment` |
| `/model/load`, watcher reload, autosave reload, undo, redo | Rogue agent via write-then-open; malicious file | Every route that executes a model consults `is_runnable`; unreviewed content is refused everywhere | `test_route_refuses_unreviewed`, `test_watchers_refuse_unreviewed`, `test_inprocess_and_sandbox_entry_points_refuse` |

**Decision: one clear consent (#369, 2026-11-24).** Asking before every
widening (each folder, autonomy, visibility, limit) was dropped: the owner's
trial found the repeated "more than it has now" prompt unhelpful, and a
prompt shown for every change trains people to click Allow. What stays: the
user consents once, to turning the assistant on, with a clear statement of
what is shared, with whom and what it can do; a new destination while it is
on asks again, since that changes who receives the data; and Settings always
shows what is shared and with whom. What does not change: only the app's own
page can change settings (`same_site`); the agent has no route to them; the
sandbox requirement (`sandbox.require`, the 400 `sandbox_required` when
turning on), review before anything the assistant wrote runs, and accepting
each proposal are all as before. The trade: a widening made later in
Settings is the user's own action in the app's own page, shown in the
summary, rather than a confirmed one.

### 4.5 Through files and folders

| Route | Attacker | Defence | Test |
|---|---|---|---|
| Designating a folder | User only, in Settings | Home, root, app and install folders, the PsyNeuLink install and hidden folders are refused | `test_refused_folders` |
| `..`, symlinks, hard links, case | Rogue agent | Real path after resolution must be inside a designated folder; checked on every call; the file is opened by the resolved path, not re-resolved | `test_dot_dot_refused`, `test_symlink_to_file_outside_refused`, `test_symlinked_parent_refused`, `test_hard_link_refused_for_write_but_readable`, `test_case_variant_refused` |
| Path swapped between check and use | Another program | Open the file first, then check the opened file's real path (`fstat` plus `realpath` of `/dev/fd`), or open relative to a folder descriptor | `test_swap_between_check_and_use_refused` |
| A malicious file already in a folder | Malicious file | It is only text until the user opens it; opening asks; a file the assistant proposes to open is treated the same as one it wrote | `test_open_proposal_user_only` |
| Bundle import | Malicious file | Bundles are handled so that they can't write outside their folder (requirement; covered by the import code's own tests) | existing bundle tests |
| Deleting | Rogue agent | No delete tool exists; removing means Trash with approval, in a later phase | `test_no_delete_tool` |

### 4.6 Through the agent connection

| Route | Attacker | Defence | Test |
|---|---|---|---|
| Custom `base_url` | Rogue agent; misled user | Only the user sets it, in Settings; the panel shows where data goes; the agent has no tool for it | `test_non_allowlisted_tools_are_refused` |
| The service itself | The service | One consent before anything is sent (#369): turning it on shows what is shared, with whom (the service's host, and that PsyNeuView can't limit what it does with the data), what it can do and the folders; a new destination while on asks again. Settings always shows a summary of what is shared and with whom. A per-folder consent at a cloud agent's first use of it is not built (open item below); model contents are what's sent, nothing more | `ai-assistant.spec.ts` ("turning it on is the one consent", "once on, widening a permission saves without asking") |
| New dependencies for the connection | Supply chain | Reviewed in the phase review | checklist item |

## 5. The tools, one by one, and in combination

Review of `TOOL_ALLOWLIST` as the contract defines it. Each tool is rated for
what it can do alone and what it adds to the others.

| Tool | Alone | Adds to the others | Verdict |
|---|---|---|---|
| `read_open_model` | Reads what the page already shows | Gives the agent `file_path` and source, which is also what it needs for `base_hash` | Allowed from Phase 1 |
| `read_docs` | Reads bundled docs | Nothing | Allowed from Phase 1 |
| `propose_app_edit` | Nothing until accepted; applied through existing paths; one undo | With `read_open_model`, an edit that looks right but isn't: that is a review problem, not a security one, since the user sees before and after | Allowed from Phase 2 |
| `list_files` | Enumerates designated folders | Tells `read_file` and `propose_open_file` what exists | Allowed from Phase 3 with `visibility.files` |
| `read_file` | Reads model text without running it | With `list_files`: can read every model in a folder. With a cloud agent: those contents leave the machine, hence consent per folder | Allowed from Phase 3; must never import or execute |
| `propose_file_write` | Nothing until accepted; previous version kept | **With `propose_open_file`: write-then-open, which is "run code".** With `read_file`: can rewrite a file it has read, keeping the user's work only through the previous version | Allowed from Phase 3 only with `mark_unreviewed` on every accepted write and `is_runnable` on every execution route |
| `propose_open_file` | Opening runs the file | With `list_files`: can pick any file already there, including a malicious one | Allowed from Phase 3; only the user accepts; unreviewed content refused; no "don't ask again" |

### Write-then-open, in full

1. The agent calls `propose_file_write` with a `.py` that does something
   harmful at module level.
2. The user accepts (it looked like a model; the approval view highlights
   imports, file access, network and `subprocess`, but those checks are easy
   to evade and are not a boundary).
3. `write_model_file` writes it and `mark_unreviewed(path, text)` records the
   content hash as unreviewed.
4. The agent calls `propose_open_file`. Only the user can accept. If they do,
   `/model/load` consults `is_runnable(path, text)`, which is `False`, so the
   load is refused until the user reviews and marks it, and this holds for
   the watcher, autosave, undo and redo too.
5. A later edit to the file changes the content, so it is unreviewed again.

The same chain without step 1, using a file that was already in the folder,
is why `propose_open_file` always asks, whoever wrote the file.

What this does not cover: the user approving code they didn't understand.
That is the residual risk of Phase 3 and the reason Phase 4 needs real
containment rather than a better approval view.

### Combinations with the rest of the app

- **Assistant write, then the user's own open.** The user opens the file
  through File > Open. `is_runnable` is consulted by `/model/load` whoever
  asks, so the result is the same.
- **Assistant write to the file that is open.** The watcher sees a change the
  app didn't make and calls `load_and_introspect` on the server side today.
  `is_runnable` must be checked inside that callback, before any execution.
  The watcher recognises the app's own writes by content hash
  (`file_writer.write_model_source` calls `note_internal_write`), so if
  `files.write_model_file` reuses that path the watcher stays quiet and the
  page sees the new text only when it next loads; either way the load route
  is the gate.
- **Assistant write, then autosave.** Autosave saves the page's text, which
  the user may have edited; `is_runnable` runs on the content being saved.
- **Structured edits through `file_writer`.** These write code the app
  generated, so `saving: structured_without_asking` may skip the file
  approval, but the written content still goes through `mark_reviewed` only
  if it was produced by `file_writer` from reviewed source. Free-form Python
  always asks.
- **MDF.** Data, loaded by the converter into PsyNeuLink objects without
  `exec`. The review for Phase 3 must confirm the converter path never
  evaluates strings from the file.

## 6. What is out of scope for the assistant's defences

- An external agent (for example a coding agent over MCP) running on the
  same machine has its own file and command access. PsyNeuView limits what it
  does through PsyNeuView's tools and says so in the app.
- A model the user wrote and chose to run has always been able to do anything
  the user can. The assistant doesn't change that; it adds a second author.
- Containment (Phase 4) is a separate decision; see `containment.md`.

## 7. What the execution guard does and doesn't cover

**In-process protection covers memory only. A model that writes files (directly or through a child process) can affect later tasks; the OS sandbox (#311, `os-sandbox.md`) closes this where it can be applied. Where it can't, Settings and About say "NOT sandboxed", and the assistant doesn't turn on unless the user allows it.**

**What the guard is, and what it isn't.** The guard stops
assistant-written code running by accident or through ordinary paths: an
import, a load by path, a file read and run, a script handed to a process.
It is not a sandbox against model code that deliberately acts as the user:
a model can write files, start processes and use `ctypes`, as any program
the user runs can. Containment against deliberate model code is the
operating-system sandbox (#311, `os-sandbox.md`), described below under
"What the sandbox closes".

The guard has four layers. Each is checked against the same review state,
and each refuses a tracked file whose text isn't the approved text with the
same 409 naming that file.

**One identity for a file.** Every layer, and the server's review lookups,
match a path to a tracked file the same way: by its real path with accents
composed (NFC) and case folded, or by the file it is on disk (device and
inode). macOS volumes ignore case and hand back decomposed accents (NFD)
where the app wrote composed ones, and `realpath` changes neither, so
without this `HX.py` for a tracked `hx.py`, or a folder name as `listdir`
spells it, passed every layer (#187, second review). The inode also makes
a hard link the same file. Folding case on a case-sensitive volume can
only refuse more: there, `HX.py` is still taken for `hx.py`.

1. **The routes** (`require_runnable`): every route that executes a model
   asks before anything runs, including `create_job` for a queued Learn
   job, which answers the 409 at once and starts nothing. If the
   in-process step that turns the guard's own refusal into this 409 is
   skipped, the app still answers the same 409.
2. **The runner itself** (`sandbox_worker.py`): `load_module` and
   `load_module_resilient` check the model's own path, whatever started
   the worker. The worker reads the state file the task names **and** the
   default one (or the one the environment names), so a task naming a file
   that doesn't exist can't make tracked files untracked. A state file
   that can't be parsed (nor its `.bak`) fails closed: nothing outside the
   standard library loads.
   **Later tasks run in a process no earlier model touched.** Everything
   in a worker, the guard included, is reachable from the model code it
   runs, so a model can switch the guard off; nothing inside a worker can
   stop that carrying over to the next task in the same process. So while
   anything the assistant wrote is tracked (or the state can't be read),
   the server sends each task to the **fork server**: a parent process
   that imported PsyNeuLink and the guard once, has run no model code and
   reads nothing from the server but the word `FORK`. For each task it
   forks a child on a pipe of its own, which reads its task, runs it,
   answers with a token the server made for that task, and exits. The
   parent copies the child's output to the server while the child runs and
   for a fixed 0.2 s after it exits, however much is still coming, then
   closes the pipe and ends the child's process group. The parent's own
   messages (ready, the child's pid, the child's end) go on a separate
   control pipe that every child closes before its task, so nothing a
   child or a process it started writes can be read as one, and a timeout
   ends only a pid that came on that pipe. A process the model started
   inside the group ends with it. One that left the group (`setsid`, a
   double fork) outlives the task: until its task's pipe is closed it can
   write into that task's copy (which the server reads only for the
   task's token, so it can't supply the answer), and afterwards it keeps
   whatever else it holds, the user's files among them. A fork takes
   milliseconds, so this is
   as fast as the warm worker (faster, since a fresh child has nothing
   cached to purge). Where forking isn't usable (no `fork` in the os
   module, as on native Windows, which PsyNeuView doesn't support; or a
   fork server that can't start a child), the server uses a **pool** of
   workers started ahead instead (two by default,
   `PSYNEUVIEW_WORKER_POOL_SIZE`), each used for one task and then ended
   with its process group: the same guarantee, at the cost of a worker's
   start when tasks come faster than the pool refills.
   `PSYNEUVIEW_WORKER_ISOLATION=fork|pool` forces either (CI runs the
   guard's tests under both), and the mode in use is logged. With nothing
   tracked the warm worker runs task after task as before. The server
   decides which from the state it reads itself.
   While something is tracked, the model's own Python code in the worker
   also may not write, move or remove the review record (the state file,
   its `.bak` and `.tmp`), the guard's and the worker's own files, or code
   that later processes import (the app's `backend/app`, PsyNeuLink's, the
   installed packages'). **A process the model starts isn't held to any of
   this** (`cp`, `rm`, `ln -s`): see below. During a task the record is read
   again when it changes on disk, so a file the assistant writes while a
   model runs is checked like any other.
   **Tampering within a model's own task is not defended.**
3. **Imports and loads** (`import_guard.py`): a finder first on
   `sys.meta_path` (put back first before every task, so a finder a model
   adds can't get ahead of it) for `import`, `importlib.import_module`,
   `runpy.run_module`, packages, subfolders and folders on `sys.path`; and
   a wrapper on `SourceFileLoader.get_code` for a file loaded by path
   (`spec_from_file_location` + `exec_module`,
   `SourceFileLoader(...).load_module()`). A tracked path is tracked
   wherever it sits, a folder named `site-packages` included.
4. **What else the runner can see** (an audit hook, #187). One rule: a
   path that leads to an existing tracked file (by identity, under any
   spelling) that isn't approved as it is now is refused. A path that leads
   nowhere or to another file is left alone: the user's own same-named
   file, a new file being written, a word that only looks like a name. The
   hook applies it when model code:
   - opens a file to read it (`exec(open(p).read())`, `Path(p).read_text()`,
     `shutil.copy`); writing is not running;
   - compiles a file under its own name (`runpy.run_path`,
     `exec(compile(text, p, "exec"))`) or executes code compiled from it;
   - renames, moves or hard-links a file;
   - makes a symlink: refused if its target is such a file now; and from
     then on in that task every path is resolved, so a link made ahead of
     its target, or a link to a folder, is caught when the file is opened
     through it;
   - starts a process: every word of the command; for an interpreter
     (`python`, `perl`, `ruby`, `node`, `sh`, `bash`, `zsh`, `awk` and the
     like, found past wrappers such as `env`, `nice`, `xargs`, `sudo`,
     `time`, `nohup`, `timeout`), every argument and the text after `-c`,
     `-e` or `-E` in any case, path by path, following a `cd` in shell
     text; `os.system` and `shell=True` text; the environment (`env=`,
     `os.environ[...] =`); and a shell pattern anchored in a tracked file's
     folder that matches its name (`cat models/hx_*`, not `rm -f outdir/*`).
     Another command's options are its own: `grep -E notes.py` is a
     pattern.

   In the worker the hook acts on every thread of every task. In the
   server it acts only on the thread of an in-process load (the converter)
   and on `threading.Thread`s started from it, since the server reads
   unapproved files to show them for review. It is added the first time a
   refresh finds something tracked, so with nothing tracked nothing
   changes. To stay cheap it resolves only paths whose folded file name is
   a tracked file's.

**Not covered**, said exactly:

- **Text that doesn't come from the tracked file**: a model that runs code
  written into itself, built from pieces, or fetched from the network.
  That is the model's own code, which the user reviewed if the assistant
  wrote the model.
- **What a child process does**, beyond the paths its command, program
  text and environment lead to. A child Python has no guard of its own,
  `multiprocessing` included: a `spawn` child handed `runpy.run_path` and a
  path through its pipe runs it. A name that doesn't lead to the file from
  where the process starts gets through: a module name (`python -c "import
  helper"`), a name relative to another folder, a name on stdin (`xargs
  cat`), in a script file the model wrote, or built with shell escapes
  (`$'\x68x.py'`), variables, `printf`, `base64` or brace expansion, or
  matched by a regular expression (`find -regex`). Quotes and backslashes
  inside a name, as in `cat h''x.py`, are taken out first, so those are
  refused. Interpreters not on the list (`tclsh`, `osascript`, `lua` and
  others) aren't read as interpreters. Starting processes isn't blocked,
  since PsyNeuLink's own `show_graph` runs Graphviz.
- **An open relative to another folder** (`os.open(name, dir_fd=d)`): the
  audit event doesn't give the folder, and a name that doesn't lead to the
  file from the working folder is left alone (checking every tracked file
  of that name refused ordinary models, and a same-named decoy defeated it
  anyway).
- **Reading a file without Python's audit events**: `ctypes` calling the C
  library's `open` and `read`, or a C extension doing the same.
- **A model that tampers with the guard during its own task**: everything
  in the worker is reachable from model code (`__main__._guard`), so a
  model can switch the guard off for the rest of its own task. Later tasks
  run in a fresh child of the fork server while anything is tracked
  (above). Changes a model makes on disk beyond the review record and the
  guard's files (the app's other code, the user's files) are the user's
  program acting as the user, outside what the guard is for.
- **The server's in-process converter runs model code in the server.** A
  model converted to the standard format (`/model/convert`, the MDF
  import's tidy-up) runs in the server's own process, so it can change the
  server, including its decision to send tasks to the fork server. The
  server's own decisions aren't protected against a model run there; the
  converter runs only a model that passed the guard, and the audit hook is
  active on its thread.
- **In the server's in-process load**: a thread started with `_thread`
  directly rather than `threading.Thread`, or by C code. The worker covers
  every thread, and only the converter loads in-process.
- **Links and caches set up beforehand**, by the user or by any program
  they ran (a model included, outside a tracked period): a symlink or hard
  link under another name, then opened and read as text (an import or load
  of it is caught by its identity; the hook resolves a differently named
  path only after a symlink is made in the same task); a
  sourceless `.pyc`; a zip import. A `__pycache__` entry compiled from an
  earlier approved text with the same size and whole-second mtime is what
  Python runs, as it would for any file; it reaches only text that was
  approved at the time.
- **A stale copy of an approved file cached under the active PsyNeuLink
  checkout**, if a user designates an assistant folder inside it: modules
  under the checkout aren't purged between tasks, so an approved helper
  edited afterwards is served as approved. It is never the unapproved text.

Approving a model means trusting what it does; the review card says so.

### What #311 must close

The operating-system sandbox (#311) is what turns the guard into a
boundary. It must close, at least:

- **G1:** a model rewriting a module that later processes import
  (`app/services/show_graph_guard.py`, any app, PsyNeuLink or installed
  package module imported after the fork, a `.pth` file or `sitecustomize`
  that pool workers would run). The guard refuses this from the model's
  own Python code while something is tracked, but not from a process it
  starts.
- **G2:** a child process changing the review record (`cp` a forged one,
  `rm` it and its `.bak`), so the next task runs an unapproved file.
- **G3's survivors:** a process that leaves the process group (`setsid`,
  a double fork) outlives its task and keeps the files and network the
  user has, and can stall or write into any pipe it still holds.
- **Writes through `dir_fd`** from a process the model starts (the
  model's own Python calls are checked by the folder the fd names).
- **The standard library folder** (a `sitecustomize.py` runs in every new
  Python) and **the app's settings file** (`~/.psyneuview.json`): refused
  to the model's own Python code while something is tracked, not to a
  process it starts.
- **G5:** a symlink chain made by a child process (`ln -s`), then read.
- **F5:** `os.open(name, dir_fd=d)` relative to another folder.
- **`ctypes`** and C extensions reading files without audit events.
- **Child Pythons** (`multiprocessing` included), which have no guard.
- **The converter's in-process run**, which runs model code in the server.

### What the sandbox closes (#311), and what remains

With the sandbox in use (always while anything is tracked; for every run
while the assistant is on), each task's process applies a policy before
any model code runs (`os-sandbox.md`): no reading the contents of any
tracked file that isn't approved as it is now, or of secrets; writing only
in the task's own folder and the declared output folders, never in the
review record, the app, PsyNeuLink, the settings file or the Python install
(stdlib and `site-packages` included); starting only Python and Graphviz;
no network. The kernel enforces it in the model's process and every
process it starts. Against the list above:

| Gap | With the sandbox | Test |
|---|---|---|
| G1: rewriting or adding a module later processes import, a `.pth`, `sitecustomize` | **Closed**: writes to the app, PsyNeuLink, `site-packages` and the stdlib are refused, from any process | `test_os_sandbox.py` (`rewrite_*`, `new_module_in_services`, `write_pth`), `test_os_sandbox_routes.py::test_a_model_cant_rewrite_or_add_a_module_later_processes_import`, `::test_a_model_cant_add_a_pth_file` |
| G2: a child process changing the review record | **Closed**: the record's folder is unwritable, and `cp`, `rm` and shells can't be started | `test_a_model_cant_change_the_review_record_for_the_next_task` (5 ways), `test_an_approval_forged_by_a_child_process_doesnt_land` |
| G3's survivors | **Confined, and ended**: a survivor is inside the same sandbox (no unapproved file, no writes outside, no network), and the fork server's parent ends it when its task finishes | `test_a_grandchild_that_leaves_the_process_group_is_still_sandboxed`, `..._is_ended_with_its_task` |
| G5: a symlink chain by a child process | **Closed**: `ln` can't be started, and a chain made in Python still reaches the file's real path, which is denied | `READS[ln_chain_by_child]`, `READS[symlink_chain]` |
| F5: `os.open(name, dir_fd=d)` | **Closed**: the kernel checks the file, not the name | `READS[dir_fd]`; the guard's own test now expects it refused under the sandbox |
| `ctypes` and C extensions | **Closed** | `READS[ctypes]`, `read_unapproved_ctypes` |
| Child Pythons, `multiprocessing` | **Closed**: they inherit the sandbox | `READS[python_child]`, `read_unapproved_child_python`, `read_unapproved_child_ctypes` |
| Tampering with the guard within the task | **Contained**: the model can switch the Python guard off, and the kernel still refuses; every route test switches it off first | `test_os_sandbox_routes.py` |
| Killing the fork server's parent to be retried outside | **Closed**: the retry (a one-shot worker), the pool and Learn jobs start under the policy; on macOS (and Linux from Landlock ABI 6) the model can't signal the parent at all | `test_a_model_that_kills_its_parent_is_still_sandboxed_when_the_task_is_retried`, `test_a_sandboxed_model_cant_kill_the_fork_servers_parent` |
| The converter's in-process run | **Closed under the sandbox**: converting runs the model in a sandboxed process of its own, which hands back the new source | `test_a_model_converted_to_the_standard_format_is_sandboxed_too` |
| Links set up beforehand | **Closed on Linux** (Landlock checks files, not names); **on macOS**, a hard link made before the file was tracked, under another name, is still readable (Seatbelt matches paths) | — |

| Earlier versions the assistant kept (S1, first review of #312) | **Closed**: not readable by any model | `test_s1_…` |
| Moving the folder that holds an unapproved file (S2) | **Closed**: on macOS those folders can't be moved; on Linux the rules follow the file | `test_s2_…` |
| A deep chain of survivors running a file written later (S3) | **Closed**: the sweep repeats until none is left and covers every earlier task and every kind of run | `test_s3_…` (12 deep) |
| Runs going ahead unsandboxed when the sandbox fails (S4) | **Closed**: refused with `sandbox_required`; every sandboxed result must prove its policy | `test_s4_…` |
| Hidden folders and auto-run files in writable folders (S5) | **Closed on macOS; open on Linux** (no rules by name) | `test_s5_…` |
| The Linux loader starting other programs (S6) | **Closed**: program folders aren't readable | `test_s6_…` |

The model's own folder is writable (the user's decision): results and
figures beside the model, with the assistant's files, the review record,
settings and (on macOS) new code still refused there, and folders that are
or hold protected places, or the home folder, not opened.

What remains with the sandbox in use:

- **Where no sandbox can be applied** (native Windows, a Linux kernel
  without Landlock, a container runtime that refuses it), none of the above
  is closed: the guard is all there is, and the state says so.
- **The task's own folder, the model's own folder and the declared output
  folders** are writable, so a model can leave data files there (not in
  the record, the app or Python). On Linux, also hidden files, auto-run
  names and new `.py` files there (no rules by name).
- **The warm worker** isn't sandboxed: it runs only while the sandbox
  isn't wanted (assistant off, nothing tracked).
- **The fork server's parent** isn't sandboxed (it runs no model code).
- **Time and memory** aren't limited by the sandbox; the task timeout is.
- **On Linux below Landlock ABI 6** a model can signal the user's other
  processes, and the names (not contents) in a folder above a denied file
  can be listed.
- **A file the assistant writes while a model is running** is caught by
  the guard during that task and by the sandbox from the next one.
- **`sandbox_init` is deprecated by Apple** (it works on macOS 26).

### Every way code runs in the backend, and its guard

Everything in `backend/app` that starts a process or loads or executes
code. `test_assistant_runner_guard.py::test_every_spawn_and_exec_site_is_listed`
counts these per file and fails when a count changes, and
`test_no_spawn_or_load_name_is_imported_under_another_name` fails when one
of those names is brought in under another name. Both are tripwires for
reviewers, not boundaries.

**Model code:**

| Where | What runs | Reached from | Guard |
|---|---|---|---|
| `sandbox.py` warm worker (`--persistent`) | `sandbox_worker.py`, every task | `run_in_sandbox`: `/model/load`, open, preview, save and reload, undo and redo, `/model/run`, `/model/learn`, show graph, input nodes, MDF export and gaps, connection options and targets, the file watcher's reload (`ws.py`), the bundled-examples check | `require_runnable` in `run_in_sandbox`; the task carries `review_state` and the exempt roots; layers 2 to 4 in the worker; while anything is tracked, one task per process |
| `sandbox.py` cold fallback (`_run_cold`) | `sandbox_worker.py`, one task | The warm worker or the fork server failing (a model can kill its parent to get here) | The same; under the OS sandbox it starts with the policy and applies it first (#311) |
| `jobs.py` | `sandbox_worker.py`, one Learn job | `POST /api/jobs` | `create_job` → `require_runnable` (409 at once, no job); the payload carries the same; layers 2 to 4 in the worker. A job the worker refuses ends in an error naming the file (`result.unreviewed_import`) |
| `sandbox_worker.py` tasks: `introspect`, `run`, `learn`, `get_input_nodes`, `show_graph`, `export_mdf`, `mdf_gaps`, `connection_options`, `connection_targets` | The model, through `load_module` (and `load_module_resilient` after a failed load) | The three above | Layers 2 to 4, with the guard reset before each task; each task is tested started directly with no review state |
| `converter.py` | The model, in the server's own process; under the OS sandbox, in a sandboxed process of its own (`_standard_source_in_sandbox`, #311) | `/model/convert`, the MDF import's tidy-up | `require_runnable` + `guard_imports()`: layer 3 with the server's view of the state, and layer 4 on that thread and the threads it starts; the guard's refusal is the review 409 even if `guard_imports()` is skipped. Under the sandbox, the same inside a process that applied the policy first |
| `introspector.py`, `executor.py` (run, learn, input nodes) in-process | The model, in the server's own process | No route: only with `use_sandbox=False`, which tests use | `require_runnable` + `guard_imports()`, as the converter |
| `sandbox_worker.py`, `introspector.py`, `executor.py`: a keyword's `compile` + `eval` | A keyword expression already in the loaded model | The loaders above | Only after the model passed the guard |

**Not model code** (none of these runs a file the assistant can write):

| Where | What runs |
|---|---|
| `sandbox_worker.py` start | `import_guard.py` itself, loaded by path |
| `sandbox_worker.py` `task_introspect` | `compile` of the model's text to report a syntax error; never executed |
| `quick_check.py` | Parse and `compile` of the text before a preview (#256); never executed. Its other match is the list of names it looks for |
| `file_writer.py` | `compile` of a parameter value in `eval` mode, to check its syntax; never executed |
| `locations.py` | `__import__` of an app module; `git` for a checkout's origin |
| `os_sandbox.py` | `os_sandbox_apply.py --probe`, once per server, to check a sandbox holds here (#311) |
| `api/routes.py`, `checkout_updates.py`, `clone_manager.py`, `settings_info.py` | `git` |
| `github_auth.py` | `git`'s credential helper |
| `install_manager.py` | `pip` or `uv`, and whether `uv` runs (#259) |
| `running_from.py` | Which process runs the app |
| `working_copies.py` | Which files are open |
| `assistant/keys.py` | The Keychain's `security` tool |

- **The state file** (`~/.psyneuview/assistant-review.json`) is the record
  of what is tracked. Deleting or truncating it reads as nothing tracked
  (fail open); a file that can't be parsed fails closed instead (its
  `.bak` is read first). The agent's tools can't reach it (hidden folder,
  app folder). Model code can: while something is tracked, the model's
  own Python code in the worker can't write, move or remove it (layer 2),
  but a process the model starts can (`cp` a forged record, `rm` it and
  its backup), and so can any program outside the worker. The
  operating-system sandbox (#311) closes that for model runs; programs the
  user runs outside PsyNeuView can still change it.

## 8. Open items after the parts were joined

Named by the rows above as "not built yet". Each is tracked under #179 until
it has its own issue.

- **A per-session credential for the assistant routes.** The routes refuse a
  request that isn't the app's own page (`same_site`); a credential the page
  gets at startup and sends with each request is not built yet.
- **Per-folder consent at a cloud agent's first use of it.** Turning the
  assistant on names the folders it may use, and the summary shows them;
  since #369 adding a folder later saves without a question, and a further
  question the first time a cloud agent reads each folder is not built.
- **`saving: structured_without_asking`** is stored and shown, but the page
  still asks for every proposal. Nothing is saved without
  an accept today, which is the safer side.
- **Running models** (`limits` on run time, containment) is Phase 4; there
  is no run tool.
- **Removing a file** (Trash, with approval) is a later phase; there is no
  delete tool.
