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

Each row names the test that must exist before the route ships. Test names
are the planned ones; the review for each phase checks they exist and pass.

### 4.1 Through the assistant's tools

| Route | Attacker | What could go wrong | Defence | Test |
|---|---|---|---|---|
| `read_open_model` | Rogue or misled agent | Sees more than the user allowed | Backend drops anything `visibility` doesn't allow before the agent sees it (contract: "context") | `test_visibility_filters_context` |
| `read_docs` | Misled agent | Docs text carries planted instructions | Docs are the app's own; results are data, not instructions. The agent is untrusted anyway | `test_read_docs_only_bundled_docs` |
| `propose_app_edit` | Rogue agent | Silent change to the model; a stale edit overwrites the user's work; a huge or malformed op | Proposal only; the page applies it through the user's own edit paths, as one History entry; `base_hash` check gives 409 when the user moved on; ops limited to a listed set | `test_app_edit_needs_accept`, `test_stale_proposal_409`, `test_app_edit_ops_allowlist` |
| `list_files` | Rogue agent | Enumerates the home folder | Only designated folders, real path after symlinks, no hidden files, PsyNeuLink-style files only, count limit | `test_list_files_outside_folders_refused`, `test_list_files_hidden_skipped` |
| `read_file` | Rogue agent; malicious file | Reads a credential file; a `.py` is executed to read it; a planted comment misleads the agent | Path rules as above; **reads text only, never imports or executes**; size limit | `test_read_file_never_executes`, `test_read_file_size_limit`, `test_paths_dotdot_symlink_hardlink_case` |
| `propose_file_write` | Rogue agent | Writes a program; overwrites the user's work; writes outside folders; writes a `.zshrc` | Proposal only; `read_write` folder; `base_hash`; previous version kept; file type by classifier and extension; written content is **marked unreviewed** so nothing runs it | `test_file_write_needs_accept`, `test_file_write_keeps_previous`, `test_file_write_marks_unreviewed` |
| `propose_open_file` | Rogue agent; malicious file | Opening runs it | Only the user can accept; `is_runnable` refuses unreviewed content; opening a file the assistant didn't write still asks, because the folder may hold anything | `test_open_proposal_user_only`, `test_unreviewed_not_runnable_via_load` |
| Any tool not on `TOOL_ALLOWLIST` | Rogue agent | Reaches the general API, settings, shell | Tools are dispatched by name from the allowlist; an unknown name is a `refused` event and a log line | `test_unknown_tool_refused` |
| Tool arguments | Rogue agent | Injection through arguments (paths, op names, huge strings) | Every argument validated by the backend; size limits; nothing passed to a shell | `test_tool_args_validated` |
| Session limits | Rogue agent | Loops; cost | `limits.tool_calls` and `limits.minutes` end the turn with `done: limit`; Stop ends it at once | `test_tool_call_limit`, `test_stop_ends_turn` |

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
| Agent text shown in the panel | Rogue agent | Rendered as text, never HTML; no remote images or any remote content; links need a click and show the full address | `assistant-panel-renders-text-only.spec.ts` |
| Data leaving through a URL in a reply | Rogue agent | No remote content loaded; link addresses shown in full | same |
| Agent text reaching the Mac bridges | Rogue agent | Text is never evaluated as script; bridges are called only by the app's own code | same, plus a bridge guard test |
| Applying a proposal | Page bug | Applied only after the user's accept, through existing edit paths, one History entry | `assistant-proposal-undo.spec.ts` |

### 4.4 Through the local server

| Route | Attacker | Defence | Test |
|---|---|---|---|
| Assistant routes | Another program, another account | **Assistant routes accept requests only from the app's own page**, with a per-session credential; off by default; off in `container` and `hosted` modes via the `assistant` capability | `test_assistant_off_by_default`, `test_assistant_off_in_remote_modes`, `test_assistant_routes_need_session_credential` |
| Settings routes | Rogue agent | There is no tool that reaches `PUT /api/assistant/settings`; raising a permission needs `confirm_raise`, which only the page sends after asking the user | `test_agent_cannot_change_settings`, `test_raise_needs_confirm` |
| Key routes | Rogue agent | `GET /api/assistant/key` returns `{"set": bool}` only; the key never appears in logs, reports or the runner's environment | `test_key_never_returned` |
| `/model/load`, watcher reload, autosave reload, undo, redo | Rogue agent via write-then-open; malicious file | Every route that executes a model consults `is_runnable`; unreviewed content is refused everywhere | `test_unreviewed_not_runnable_via_load`, `..._via_watcher`, `..._via_autosave`, `..._via_undo` |

### 4.5 Through files and folders

| Route | Attacker | Defence | Test |
|---|---|---|---|
| Designating a folder | User only, in Settings | Home, root, app and install folders, the PsyNeuLink install and hidden folders are refused | `test_designate_refused_folders` |
| `..`, symlinks, hard links, case | Rogue agent | Real path after resolution must be inside a designated folder; checked on every call; the file is opened by the resolved path, not re-resolved | `test_paths_dotdot_symlink_hardlink_case` |
| Path swapped between check and use | Another program | Open the file first, then check the opened file's real path (`fstat` plus `realpath` of `/dev/fd`), or open relative to a folder descriptor | `test_path_swap_mid_operation` |
| A malicious file already in a folder | Malicious file | It is only text until the user opens it; opening asks; a file the assistant proposes to open is treated the same as one it wrote | `test_open_proposal_user_only` |
| Bundle import | Malicious file | Bundles are handled so that they can't write outside their folder (requirement; covered by the import code's own tests) | existing bundle tests |
| Deleting | Rogue agent | No delete tool exists; removing means Trash with approval, in a later phase | `test_no_delete_tool` |

### 4.6 Through the agent connection

| Route | Attacker | Defence | Test |
|---|---|---|---|
| Custom `base_url` | Rogue agent; misled user | Only the user sets it, in Settings; the panel shows where data goes; the agent has no tool for it | `test_agent_cannot_change_settings` |
| The service itself | The service | Consent at first use; a cloud agent's first use of each folder asks; model contents are what's sent, nothing more | `test_consent_before_first_send` |
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
