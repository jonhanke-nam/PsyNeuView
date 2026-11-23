# AI assistant: security review (#179)

The review is a gate. A phase ships only when every item on its checklist is
ticked by someone other than the author, and the record below is filled in.
Re-run the review whenever a tool, an agent type or the containment changes.

The threat model is [`threat-model.md`](threat-model.md); test names there
are the ones the checklist refers to.

## Checklist: every phase

- [ ] The threat model was re-read and updated for what this phase adds; every
      new route in has a row with a defence and a test.
- [ ] Every new tool has a row in the per-tool review (threat model, section
      5), alone and in combination with the existing tools.
- [ ] With the setting off, every assistant route only reports that it's off
      and nothing is sent anywhere (`test_off_by_default`).
- [ ] Off in `container` and `hosted` modes (`test_capability_off_in_container_and_hosted`).
- [ ] No tool reaches settings, the key, the general API or a tool outside
      `TOOL_ALLOWLIST` (`test_non_allowlisted_tools_are_refused`,
      `test_non_allowlisted_tools_are_refused`, `test_key_never_in_responses_logs_settings_or_environment`).
- [ ] Every new setting is in `docs/settings-inventory.yaml` with one control.
- [ ] Every tool call is logged with its arguments, result, allowed or refused,
      and who approved it; prompts, replies and source stay out of problem
      reports.
- [ ] New dependencies for the agent connection were listed and reviewed.
- [ ] Attack tests for this phase run in CI and pass.
- [ ] Reviewed by someone other than the author; recorded below.

## Checklist: Phase 1 (settings, connection, read-only answers)

- [ ] `context` is filtered by `visibility` on the backend before the agent
      sees it (`test_visibility_filter`).
- [ ] The key is kept in the Keychain or system equivalent, never in
      `localStorage`, logs, reports or the runner's environment.
- [ ] Only the user can set `base_url`; the panel shows where data goes.
- [ ] First use explains what is shared and with whom; nothing is sent before.
- [ ] Agent text is rendered as text: no HTML, no remote content, links need a
      click and show the full address (`ai-assistant.spec.ts` ("hostile text is inert")).
- [ ] Limits on tool calls and minutes end the turn; Stop ends it at once.

## Checklist: Phase 2 (app edits with History and undo)

- [ ] An `app_edit` proposal does nothing until accepted
      (`test_app_edit_needs_accept`).
- [ ] Accept with a stale `current_hash` returns 409 and the proposal goes
      `stale` (`test_stale_app_edit_proposal`).
- [ ] Ops are limited to a listed set (`test_hole_a_unknown_op_with_source_is_refused`).
- [ ] One accepted proposal is one History entry labelled `Assistant: ...` and
      one undo reverses it (`ai-assistant-real.spec.ts` ("one undo reverses it")).
- [ ] Edit locks and protected files refuse the assistant as they do the user.

## Checklist: Phase 3 (files in designated folders)

- [ ] Path attack tests: `..`, symlinks, hard links, case changes, a path
      swapped mid-operation, refused folders
      (`test_dot_dot_refused`, `test_symlink_to_file_outside_refused`, `test_symlinked_parent_refused`, `test_hard_link_refused_for_write_but_readable`, `test_case_variant_refused`, `test_swap_between_check_and_use_refused`,
      `test_refused_folders`).
- [ ] `read_file` never imports or executes (`test_reading_never_runs`).
- [ ] Every accepted write is marked unreviewed; `is_runnable` is consulted by
      `/model/load`, the watcher callback, autosave's reload, undo and redo
      (`test_route_refuses_unreviewed`, `test_watchers_refuse_unreviewed`, `test_inprocess_and_sandbox_entry_points_refuse`).
- [ ] `propose_open_file` is accepted only by the user, with no "don't ask
      again", whoever wrote the file (`test_open_proposal_user_only`).
- [ ] The previous version is kept before every write; nothing is deleted
      (`test_write_keeps_previous_and_marks_unreviewed`, `test_no_delete_tool`).
- [ ] File types by classifier and extension, no hidden files, size and count
      limits.
- [ ] A cloud agent's first use of each folder asks for consent.
- [ ] The MDF path was checked: the converter never evaluates strings from
      the file.
- [ ] Prompt-injection tests plant instructions in a model file, an error
      message and a tool result, and the backend refuses what they ask for.

## Checklist: Phase 4 (running models with containment)

- [ ] Containment tests from inside the runner: read a file outside the
      allowed area, write outside the output folder, open a socket, resolve a
      name, read an environment variable, start a process, fork. All refused.
- [ ] Time, memory and process limits enforced and tested.
- [ ] A clean environment: no server variables, no tokens, no key.
- [ ] The runner's allowed read set is listed and justified
      (`containment.md`, profile).
- [ ] Outside review completed and recorded below.
- [ ] A release switch exists that turns the assistant off without a rebuild.

## Record of reviews

One entry per review. Add the newest at the top.

| Date | Phase | What was reviewed (branch, commit) | Reviewer (role) | Result | Follow-ups |
|---|---|---|---|---|---|
| 2026-11-23 | 1, 2, 3 | Round 5 of the independent review of the OS sandbox (#311), PR #312 at `7a80be6e`, on macOS | Independent reviewer (adversarial, not the author) | **PASS WITH FINDINGS.** With the in-process guard switched off inside every model, all earlier attacks (rounds 1–5 of #310, rounds 1–4 of #312) are refused in fork and pool mode. No false kills: an orphan under `sandbox-exec`, a plain orphan and the user's terminal job group all survive, and a model can't join a user's process group. Output floods no longer hang or crash the server: a no-newline flood, a forged answer marker at the end of a line and a slow drip each cost only their own task, and the next task answers normally. Hard links and symlinks can't extend a chmod outside the writable folders. A pool spare started before the assistant wrote a file doesn't run a task that reads it. Speed: fork mode about 0.37 s per load or preview and 2.7 s for Learn; pool-mode previews about 2.5 s. Open: (W1, medium) the execute-bit sweep stops after 50,000 files, so a model that first writes that many decoy files at the top of a writable folder can leave an existing extensionless file in a subfolder executable, and Finder would run it outside the sandbox. Denying mode changes in writable folders is recommended; otherwise this must be documented. (W2, low) until the sweep runs after the task, a file the model made executable stays so for the whole task. With W1 either fixed or documented, #312 can merge into `feature/ai-integrated-179` from a security-review standpoint. | W1 open (fix or document); W2 low; W3 speed note |
| 2026-11-23 | 1, 2, 3 | Round 4 of the independent review of the OS sandbox (#311), PR #312 at `b8d28e64`, on macOS (Linux by reading the code) | Independent reviewer (adversarial, not the author) | **PASS WITH FINDINGS.** With the in-process guard switched off inside every model, all earlier attacks are refused in fork and pool mode. No false kills: an orphan under `sandbox-exec`, a plain orphan, the user's terminal job group (a model can no longer join it), a Jupyter-like child, and a second PsyNeuView server's live task all survived this server's sweeps; only PsyNeuView's own task processes, identified by a per-run mark in their sandbox profile, are ended. The setsid racer was swept 10 of 10 times in each mode, a sleeper outlasting the sweep window was killed, exec could not shed the macOS mark, a deleted record with its marker fails closed, and output floods no longer bring the server down in fork mode or on the Learn and convert paths. Open: (V1, high, denial of service) in pool mode, a leftover writing without newlines blocks the server in `readline` with the pool lock held, so later runs hang (observed for more than 9 minutes); read raw bytes with the deadline checked. (V2, medium) an existing extensionless file can be made executable, and names with a trailing dot and some types (`.ksh`, `.tcsh`, `.jar`, `.action`, `.osax`) are still allowed; denying mode changes in writable folders is recommended. (V3, medium, Linux, by reading) a survivor from a pool, Learn, cold or convert worker can shed its environment mark by exec with an empty environment. Speed: fork mode 0.36–0.38 s per load or preview; pool-mode previews take about 2.5 s. | V1–V3 open; V4 by design |
| 2026-11-23 | 1, 2, 3 | Round 3 of the independent review of the OS sandbox (#311), PR #312 at `4828abb3`, on macOS | Independent reviewer (adversarial, not the author) | **FAIL.** With the in-process guard switched off inside every model, all earlier attacks (rounds 1–5 of #310 and rounds 1–2 of #312) are refused in fork and pool mode. Folder clones (T1), case-changed, firmlink and symlinked model paths (T2), code planted in any writable folder (T5) and runnable file types (T6) are refused. Plain and double-fork racers are swept, and a copy of Python in scratch can't be run. Open: (U1, critical) a model can join a process group in the server's session and orphan itself, and the sweep then stops and kills that whole group: the user's terminal job was killed in the test. (U2, high) the sweep kills any of the user's orphaned framework Pythons running under any sandbox (shown with `sandbox-exec`); on Linux, by reading the code, any user process with no_new_privs, seccomp and a binary under `/usr`, such as hardened user services. (U3, high) a racer that calls `setsid()` on every fork still outlives the sweep and runs a file written later. (U4, high, denial of service) a noisy leftover during a cold retry fills the server's memory until macOS kills it. (U5, medium) when the assistant has only written new files, a deleted record and backup again read as nothing tracked. (U6, medium) the execute bit can be set on allowed names, and Finder runs an extensionless executable outside the sandbox on double-click. Pool-mode previews take about 1.5 s each (U7). | U1–U7 open |
| 2026-11-23 | 1, 2, 3 | Round 2 of the independent review of the OS sandbox (#311), PR #312 at `ef481722`, on macOS | Independent reviewer (adversarial, not the author) | **FAIL.** With the in-process guard switched off inside every model, all round 1–5 attacks and the first #312 round's attacks are refused by the OS layer alone. The previous-versions copy can't be read (S1); parent and grandparent folder moves are refused (S2); the 12-deep survivor chain is ended (S3); a sandbox that can't be applied now gives 409 `sandbox_required` (S4); and hidden and auto-run files are refused, case variants included (S5). The new model-folder write rule allows ordinary outputs (csv, png, npy, json, txt, subfolders, torch, pickle, tempfile) and refuses code (`.py` in any case, `.pth`, `.so`, packages, sitecustomize), overwrites of tracked files, and writes through symlinks out. Open: (T1, critical) `clonefile` of the folder holding an unapproved file copies it to a readable path. (T2, high) loading a model by a case-changed path removes the folder-move protection, so the S2 move works again. (T3, high) a fast fork-and-exit process outlives the sweep and later runs a file the assistant writes. (T4, high, test setup) the conftest's `pytest-N-assistant-state` and `-prefs` folders are deleted by any other pytest session the same user starts, so the record vanishes and both the guard and the sandbox stand down mid-test; this is the cause of the random runner-guard failures (reproduced deterministically: the record vanished and the file ran). (T5, medium) a model can plant `.py` files in the assistant's read-write folders for a later model there to import. (T6, low) `.command` with an execute bit, `.sh`, `.zip`/`.pyz`, `.pkl` and build files can be written beside a model. (T7, low) the proof-of-sandbox key is readable by model code, though the worker's own check before running holds. | T1–T7 open |
| 2026-11-23 | 1, 2, 3 | Independent review of the OS sandbox for model runs (#311), PR #312 at `8c8dfdcb`, on macOS | Independent reviewer (adversarial, not the author) | **FAIL.** Every round 1–5 attack was re-run through the real routes and workers with the in-process guard switched off inside each model, so the OS layer stood alone. All were refused, as were: starting shells and other programs, TCP and unix-socket connections to the server, signals to other processes, LaunchServices, Apple-event and other Mach lookups, hard links and clones of an unapproved file, and writes to `~/Library/LaunchAgents`, `~`, Desktop, Documents and `/tmp`. Paths in the generated profile can't be injected. Bundled models and ordinary numpy, torch and matplotlib models work, and timings match the PR. Open: (S1, critical) the assistant's saved previous versions (`~/.psyneuview/assistant/previous`) are readable, so a model can run an unapproved earlier version of a file. (S2, critical) on macOS, moving the folder that holds an unapproved file defeats the read deny, which is per path. (S3, high) a chain of processes more than about six deep outlives the five-pass sweep, keeps its old profile, and runs files the assistant writes later. (S4, high) when the sandbox can't be applied, runs go ahead unsandboxed even with "require the sandbox" on; two test sessions ran unsandboxed for a reason not yet found. (S5, medium) hidden folders inside writable folders (`.git/hooks` and the like) can be written, which gives persistence outside the sandbox. (S6, low) on Linux the allowed dynamic loader can start any program. The model-folder write rule added after this head is not covered by this review. | S1–S6 open |
| 2026-11-22 | 1, 2, 3 | Round 5: re-check of the round-4 fixes (#187), PR #310 at `5835146a` | Independent reviewer (adversarial, not the author) | **PASS WITH FINDINGS.** In both modes (forced fork and forced pool), through the real routes and workers: the six G4 spellings and the plain `cd … && cat` forms are refused; the ten false-positive cases a–j and a normal model that runs and plots all run normally; the per-task token held, so no forged result was accepted; and a task retried after its fork parent was killed runs in a fresh, guarded one-shot worker (the unapproved helper was refused there too). Open: (H1, medium, integrity and denial of service, no code runs) a `setsid` grandchild that keeps writing into its relay keeps the fork parent relaying; its forged child-start line is then taken by the server for the next task, whose timeout kills the forged pid's process group, and later tasks keep timing out; the claims that a survivor can't write into a later answer and that a timeout kills only the parent-reported pid should be corrected, and the relay bounded and its control lines separated from child output. (H2, low) the in-process G1 write guard is bypassed with `dir_fd` (append to `app/services/show_graph_guard.py`, then the next task runs an unapproved file). (H3, low) the base interpreter's stdlib folder and the app's config file aren't among the protected roots. Both H2 and H3 fall under the documented "in-process protection covers memory only" and should be added to the #311 list. Everything that still lets an unapproved file run is through file writes or child processes, which are documented for #311. From a security-review standpoint #310 can merge into `feature/ai-integrated-179` once the G3 wording is corrected; the H1 relay fix is recommended before or as the first follow-up. | H1–H3 open; H2 and H3 for #311 |
| 2026-11-22 | 1, 2, 3 | Round 4: re-check of the fork server, the pool fallback and the fixes for round-3 F1–F6 (#187), PR #310 at `8482a0a6` | Independent reviewer (adversarial, not the author) | **FAIL.** Every round 1–3 attack was re-run in both modes (forced fork and forced pool) through the real routes and workers. Everything previously blocked stays blocked, except split names in `sh -c` (G4), and the false positives a–j run normally. Fork mode costs about 0.05 s per task, as claimed. Open: (G1, high) a model can rewrite a module that every later process imports before the model runs (e.g. `app/services/show_graph_guard.py`), switching the guard off for all later tasks in both modes; F1 protects only the guard's and worker's own files. (G2, medium) F1 is bypassed by a child process: `cp` of a forged review record, or `rm` of it and its backup, lets the next task run an unapproved file, in both modes. (G3, medium) a `setsid` grandchild outlives the process-group kill. In fork mode it inherits the shared output pipe and can make the server return a forged result for the next task (200 instead of the 409), and point a timeout's kill at any process group. (G4, low) quoting-split names in `sh -c` are no longer refused. (G5, low) a symlink chain made with `ln -s` in a child process reads an unapproved file. Documented gaps reproduce as described. The PR's claims that a model's processes don't outlive the task and that rewriting the guard is refused are overstated. | G1–G5 open |
| 2026-11-22 | 1, 2, 3 | Round 3: re-check of the fixes for R1 to R4 (#187), PR #310 at `dadca2c5` | Independent reviewer (adversarial, not the author) | **PASS WITH FINDINGS.** Through the real routes and the real worker, all seven round-2 cross-task tampers, the symlink chain, `perl -E` and `awk` program text are refused, and the five round-2 false positives (a to e) now run. The spare worker could not be poisoned, and a helper the assistant writes while a model is loading is refused. Open: (F1, medium) model code can still reach later tasks through disk: approving its helper in, or deleting, the review state file (and `.bak`) makes the next task, in a fresh process, run the unapproved file; the docs' "later tasks are protected by a fresh process" and the "only something already running as the user" acceptance should be corrected, and writes to the state file refused in the worker. (F2, medium) a model run by the in-process converter can turn fresh-per-task off by replacing `worker_must_be_fresh` in the server, after which a later task's tampering carries over; the docs say the worker's protection doesn't depend on the server, which is not true of fresh mode. (F3, medium, speed) fresh mode applies whenever the state has any entry, approved ones included, and the live preview goes through it: a small model's back-to-back preview went from 0.19 s to about 2.0 s, and from 0.20 s to 0.45 s at the default 1.5 s delay. (F4, low to medium) new false positives: a symlink to a folder holding a tracked file at any depth, a symlink to the user's own same-named file, `python gen.py --out report.py`, writing a new same-named file relatively, and `grep -E 'name'`. (F5, low) a same-named decoy in the working folder defeats the `dir_fd` check. (F6, low) an interpreter behind `env` (`env awk …`) and interpreters not on the list aren't scanned. The documented gaps (a module name alone, stdin, script files, built names, `ctypes`, tampering within the model's own task) reproduce as described. | F1–F6 open |
| 2026-11-22 | 1, 2, 3 | Re-check of the runner guard follow-up (#187), PR #310 at `5149e0da` | Independent reviewer (adversarial, not the author) | **PASS WITH FINDINGS.** Every round-1 attack (S1–S8) was re-run through the real routes and the real worker and is now refused: case variants and decomposed accents by load, job and convert; the record-before-write order; cross-task flag and tracked-set resets; `dir_fd`; globs, redirects, env and `python -c`; a missing named state; and converter threads. The new identity matched the file system on every case-fold and normalisation pair tried (Turkish İ/ı, ß/ẞ, final sigma, ligatures, Kelvin, Ångström and Ohm signs, combining-mark order). Open findings: (R1, medium) a model can still switch the guard off for **later** tasks in ways the fingerprint misses (replacing a method of `_State` or `TrackedIndex`, patching `json.load` or `threading.local`, forging `_GUARD_FINGERPRINT`, or swapping `__main__._guard`), so "across tasks … restarts the worker" is overstated; restarting the worker after each task while something is tracked would close it. (R2, medium) false positives refuse legitimate models while an unapproved file is tracked: a relative open of the user's own same-named file, a module name appearing as a word in shell, `-c` or environment text, and a bare `*` glob. (R3, low–medium) a symlink chain made during the task (a link made while its target is missing, then a folder link) reads an unapproved file. (R4, low) `perl -E`, `awk` and `find -regex` program text, and names built with shell escapes, variables, `printf`, `base64`, brace expansion or a script file, are not checked, beyond what the threat model lists. The documented gaps (ctypes, stdin, `multiprocessing` and child Pythons, same-task tampering, raw `_thread` in the server) reproduce as described. | R1–R4 open |
| 2026-11-03 | 1, 2, 3 | Re-check of the runner enforcement at `7ec8aa79` (#187) | Independent reviewer (adversarial, not the author) | **Phases 1, 2 and 3 safe to ship off by default**, subject to the outside review required before a release that lets the assistant write files. Residuals carried below | Widen the spawn tripwire (done); outside review |
| 2026-11-03 | 1, 2, 3 | Narrow re-check at `9fb29e6a` (#187) | Independent reviewer (adversarial, not the author) | **A High everyone missed**: `POST /api/jobs` started the worker outside `run_in_sandbox`, so an unreviewed model ran through a queued Learn job. Plus: a tracked path under a `site-packages` name was exempt; a helper loaded by path wasn't caught though the docs said `importlib` was; a finder a model adds could get ahead of the guard; the in-process path served a stale helper; a PsyNeuLink checkout would be purged every task. All fixed below; **Phase 3 pending** the reviewer's re-check | The findings below |
| 2026-11-03 | 1, 2, 3 | Re-check of the fixes at `f90f6499` | Independent reviewer (adversarial, not the author) | 13 of 14 findings closed. **Phases 1 and 2 safe to ship, off by default. Phase 3 pending**: finding 7's whole-folder rule missed a subfolder (`pkg/helper.py` imported through `sys.path`); replaced by the import-time guard below | The reviewer's check of the import guard |
| 2026-11-03 | 1, 2, 3 | The joined feature, PR #186 (`feature/ai-integrated-179`) | Independent reviewer (adversarial, not the author) | Phases 1 and 2 safe after the fixes below; **Phase 3 not safe as reviewed**: three routes ran unreviewed code. Fixed on the same branch; needs the reviewer's re-check | The findings below; the open items in the threat model |
| 2026-11-03 | 0 | Threat model, containment experiment, this checklist (`feature/ai-threat-model-179`) | Awaiting review | Open | Containment recommendation needs a second opinion before Phase 4 is planned |

## The Phase 3 review of 2026-11-03: findings and fixes

The reviewer proved each finding with a test that made a model write a
marker file through the route named. Each is kept in
`backend/tests/test_assistant_review_findings.py`, asserting the attack now
fails: the marker never appears.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | `/model/preview` ran any text, and Run, Learn and show-graph then targeted the untracked preview copy. Reachable from an accepted `file_write` to the open file: the next save answered a stale-buffer 409 whose `disk_source` was the unreviewed text, which the page offered to adopt into the editor; one keystroke later preview ran it | Preview refuses unreviewed text before writing any copy, and a tracked, unreviewed file can't be previewed until approved (the review offer is the way forward). The stale branch meets the guard first, so it answers the review 409 and never hands the text over. `/model/disk-source` says when the text it returns is unreviewed |
| 2 | High | `/models/save-as` wrote and ran with no check | Written, not run: unreviewed text is tracked under the new name and the 409 names the review |
| 3 | High | `/model/save-copy` (`py`) wrote the body verbatim; (`pnlproject`) bundled a blocked file, the MDF mirror swallowing the 409; `/model/open-project` ran the extracted copy with no check | The `.py` copy is tracked like a save; a bundle or MDF copy of a blocked file is refused; `open-project` tracks and refuses unreviewed content as `import-project` does. Tests redirect the bundles root (`PSYNEUVIEW_BUNDLES_ROOT`) |
| 4 | Medium | The byte-exact content index was defeated by one trailing newline | The index also holds a normalised form (line endings, trailing whitespace, blank and comment-only lines dropped); approval stays exact. **What still gets through, by design:** a copy the user edits by hand is the user's and runs as the user's own file. The index is a convenience against accidents and the obvious trick, not a boundary |
| 5 | Medium | The star-import conversion on open wrote `X.star_import_original.py` before the guard ran, an untracked runnable copy | The guard comes before the conversion |
| 6 | Medium | `validate_folder` accepted other Python installs (`~/miniconda3`); `.py` names such as `numpy.py`, `psyneulink.py`, `__init__.py`, `sitecustomize.py` were writable; a new file skipped the classifier | A folder that is, holds or sits inside a Python install or environment (`pyvenv.cfg`, `conda-meta`, `site-packages`, `lib/pythonX.Y`) is refused, with a bounded scan (4000 entries, depth 5; hidden folders are skipped because the assistant can't enter them anyway); `.py` stems in the standard library, Python's start-up hooks, packaging and the app's dependencies, and any `_`-prefixed stem, are refused; a new `.py` must classify as a model and import `psyneulink` |
| 7 | Medium-low | A reviewed model that puts its folder on `sys.path` imported an unreviewed sibling the assistant wrote. First fix (a whole-folder block) missed a subfolder: `Models/pkg/helper.py` imported as `pkg.helper` still ran | Fixed at import time: `import_guard.py`, a finder first on `sys.meta_path` in the server and in the sandbox worker (loaded by path, refreshed from the state file named in every task, tracked modules dropped from the worker's cache). A tracked, unapproved `.py` about to be imported, from a subfolder, a package, `importlib` or a folder on `sys.path`, fails with the 409 naming that file. Fails closed when the state is unreadable. Nothing tracked: one check per import; the standard library and site-packages are never vetted. The whole-folder block is gone: a model beside an unapproved file runs unless it imports it. Not covered, and said in the threat model: a reviewed model that runs code by other means (`exec`, `runpy`) |
| 8 | Medium-low | The agent connection followed redirects, resending the key to any host, https to http included | The opener's redirect handler raises; the user sees an error naming the redirect, without the key |
| 9 | Low | A `base_url` left over from `openai_compatible` applied to `anthropic` silently, and Settings still said "Anthropic's API" | Changing the type without giving an address clears it; a change of destination is a raise named with the real address; Settings show the real destination |
| 10 | Low | A corrupt state file failed open | A `.bak` is kept on each save and read when the state can't be parsed; if neither parses, every execution guard refuses (`assistant_review_state_unreadable`) until the file is repaired or removed. No state file at all is unaffected |
| 11 | Low | `propose_file_write` ignored `visibility.files` | It needs it |
| 12 | Low | The watcher's `reload_blocked` wasn't handled by the page | The page offers the review and reloads once approved |
| 13 | Low | The log kept the first 200 characters of file text | A hash and a length, never the text |
| 14 | Low | `plain_literal` turned `1e999` into the name `inf` | Non-finite numbers are refused |
| 6b | Note | The "is a model" check for a new file was fooled by `import psyneulink` inside a string | A real import statement, found with `ast` |
| — | Note | Deleting or truncating the state file reads as nothing tracked | Accepted at the time on the grounds that only something already running as the user can do that. **Corrected in round 3 of PR #310 (F1):** model code is exactly that. While something is tracked, a model in the worker can't write, move or remove the record; elsewhere it is outside what the guard is for (threat model, section 7). An unparseable file fails closed |
| — | Suspected | Bidirectional and zero-width characters could make a reviewed file read differently from how it runs | Flagged in a proposal's warnings; shown as `<U+XXXX>` in Before, After and the review card, with a note |
| — | Suspected | `rename_node.new_name` accepted `<` and `>` | Letters, digits, spaces and `_ - . : ( ) [ ]` only |
| — | Suspected | "Accept all" could accept proposals that arrived after it was pressed | It accepts exactly what was on screen when pressed |

### The second re-check (#187)

| # | Severity | Finding | Fix |
|---|---|---|---|
| R1 | High | `POST /api/jobs` → `jobs.py` spawned `sandbox_worker` outside `run_in_sandbox`: no `require_runnable`, no `review_state`; an unreviewed model ran through a queued Learn job | Three layers, so the class is closed, not the route: `create_job` calls `require_runnable` (the 409 at once, no job started); every worker payload (warm, cold, job) carries `review_state` and the exempt roots through one helper; the worker checks the model's path itself in its loaders, finding the default state path when a caller names none, and fails closed when the state is unreadable. The threat model lists every spawn and by-path load with its guard, and `test_every_spawn_and_exec_site_is_listed` fails on a new one |
| R2 | Medium | A tracked path under a folder named `site-packages` was exempt from vetting; past the scan bound a write into `Big/zz/site-packages/vend2.py` was accepted | The tracked lookup comes before any library shortcut; a path inside an allowed folder with a part that looks like a Python install (`site-packages`, `dist-packages`, `conda-meta`, `pythonX.Y`) is refused |
| R3 | Medium | A helper loaded by path (`spec_from_file_location` + `exec_module`, `SourceFileLoader.load_module`) ran, and the docs claimed `importlib` was covered | `SourceFileLoader.get_code` is wrapped (one check for every source module Python loads, by name or by path); PsyNeuView's own loading passes approved files. The docs say exactly what is and isn't covered |
| R4 | Low | A finder a model added stays ahead of the guard in the warm worker | `refresh()` puts the finder back at `sys.meta_path[0]` before every task |
| R5 | Low | In-process (`use_sandbox=False`): a helper approved, then edited, was served stale from `sys.modules` | The purge runs in the server too; the app's own modules are under the repo root, which is never purged |
| R6 | Low | A PsyNeuLink checkout (`~/.psyneuview/sources/...` or a user's own) counted as user-land: once anything was tracked, every task would purge and re-import all of `psyneulink.*` | The active checkout travels with every task as an exempt root and is never purged; a tracked file under it is still checked, since tracked is looked up first |

### The runner guard follow-up (#187)

Built on the branch after the second re-check, to the issue's "Done when".
Each attack is a test through the real route and the real worker in
`backend/tests/test_assistant_runner_guard.py`, asserting a marker file the
attack tries to create never appears. **Not yet re-checked by the
independent reviewer** (placeholder row above).

| # | What | Change | Proof |
|---|---|---|---|
| F1 | Code run from a tracked, unapproved file without an import: `exec(open(p).read())` (also inside `try/except Exception`), `Path(p).read_text()`, `exec(compile(text, p, "exec"))`, `runpy.run_path`, `python p` in a subprocess or a shell (by path, or by name after `cd`), `os.system`, a copy, rename, hard link or symlink imported or read under a new name | An audit hook in the worker refuses the open, compile, exec, process start, rename or link of a tracked, unapproved file, with the 409 naming it. Added only once something is tracked. **As first built, it matched only the path's exact spelling**: the independent review of this PR showed a case variant ran through all of these (S1 below) | `test_a_tracked_file_run_without_an_import_is_refused` (13 ways, exact spelling); 11 of them fail with the hook taken out (`runpy.run_module` was already caught by the loader). `test_a_tracked_file_run_by_exec_runs_once_approved`; `test_a_model_that_opens_files_and_starts_processes_works_while_something_is_tracked`. Variants: S1, S2, S5 |
| F2 | The converter runs a model in the server's own process, where the worker's hook isn't | The same hook in the server, acting only on the thread inside `guard_imports()` (and, since S9, the threads it starts), so the server still reads unapproved files to show them | `test_the_in_process_converter_refuses_a_tracked_file_run_any_way` through `/model/convert` (import, `exec(open(...))`, `runpy.run_path`, subprocess); `test_the_server_hook_acts_only_inside_an_in_process_load` |
| F3 | `/model/convert` turned the guard's refusal into a 400 "Conversion failed": closed, but the page couldn't offer the review | It answers the review 409 | The converter test asserts 409 and the path |
| F4 | A job the worker refused ended as a plain error | The job's result names the file and the reason (`unreviewed_import`, `reason`) | `test_a_job_started_without_the_route_is_refused_by_the_worker` (the job manager's worker with the route's check skipped, as the original hole did) |
| F5 | Only `introspect` was tested with a worker started directly with no review state | Every task the worker runs is | `test_every_worker_task_refuses_an_unreviewed_model_when_started_directly` (9 tasks); `test_the_worker_lists_exactly_these_tasks` fails when a task is added |
| F6 | The job payload's review state was not asserted | It is | `test_a_job_payload_carries_the_review_state` |
| F7 | The tripwire missed `exec_module` on its own line, `load_module`, `reload`, `compile`, the interactive interpreters, `posix_spawn`, `fork`, `pty`, asyncio's subprocesses, `getoutput` and process pools, and any of them imported under another name | Counted; and a second test fails on `from subprocess import run`, `import runpy as r`, `getattr(os, ...)` and the like | `test_every_spawn_and_exec_site_is_listed`, `test_no_spawn_or_load_name_is_imported_under_another_name` |
| F8 | The threat model listed only the model-execution sites | It lists every process start and code load in `backend/app` with its guard or why it isn't model code, and says exactly what isn't covered | `threat-model.md` section 7 |

### The independent review of PR #310, and the fixes (#187)

The first independent review of this follow-up found the following; each
is now a test in `test_assistant_runner_guard.py` (sections 9 to 14) that
fails on the branch before the fix. **Not yet re-checked** (placeholder
row above).

| # | Severity | Finding | Fix | Proof |
|---|---|---|---|---|
| S1 | High | macOS volumes ignore case and `realpath` keeps the spelling given, so `HX.py` for a tracked `hx.py` passed every layer: the route check, the worker's own check, the loader wrapper and the audit hook; it ran through load, jobs, convert, `exec(open(...))`, `runpy`, a load by path, and a link, rename, symlink or copy | One identity for a file in every layer and the review lookups: real path with accents composed and case folded, or device and inode | `test_a_case_variant_of_an_unreviewed_model_is_refused_by_every_route`, `test_a_case_variant_of_an_unreviewed_helper_is_refused` (7 ways), `test_approving_through_a_case_variant_approves_the_same_entry`, `test_a_case_variant_on_a_case_sensitive_volume_is_still_treated_as_tracked`. The macOS-only ones skip on a volume that tells case apart |
| S2 | High | The assistant's write stored a composed-accent key while the disk and `listdir` give decomposed names, so a plain `import` of an assistant helper from a user's model in such a folder ran, with no attacker | The same identity | `test_an_assistant_model_in_a_decomposed_folder_is_refused_by_its_listed_path`, `test_a_plain_import_of_an_assistant_helper_in_a_decomposed_folder_is_refused`, `test_a_decomposed_file_name_is_the_same_tracked_file`, `test_a_hard_link_made_beforehand_is_the_same_tracked_file` |
| S3 | Medium | The write renamed the text into place before recording it as unreviewed; a failed save (a read-only state folder) left the assistant's text on disk untracked, and the first edit of a user's file had a window where it ran untracked | Recorded first; a failed record refuses the write (`cannot_record`) and nothing is written; a failed rename puts the entry back | `test_a_write_is_refused_when_the_review_state_cant_be_saved`, `test_a_write_whose_rename_fails_leaves_the_entry_as_it_was` |
| S4 | Low to medium | The guard's state is reachable from model code (`__main__._guard`) and persisted across warm-worker tasks: setting its busy flag or clearing its tracked set switched it off for later tasks of other models | First fixed by putting the guard's state back before every task and restarting the worker when its functions were replaced; **the second round (R1) showed that was not enough**. Later tasks now run in a process no earlier model touched: while anything is tracked, each task runs in a child forked from a parent that has run no model code (round 3), and a model can't change the review record on disk (F1). Tampering within a model's own task is not defended | `test_a_model_cannot_switch_the_guard_off_for_later_tasks` (5 ways); R1's tests below (7 more) |
| S5 | Low | The process check was by word: a shell glob, a redirect, a name in the environment, a name on stdin and `python -c "exec(open(...))"` ran | The text of a shell or interpreter (`-c`, `-e`, `os.system`, `shell=True`) and the environment (`env=`, `os.environ`) are checked for a tracked name, its module name and shell patterns matching it. Stdin and names built inside the child remain, documented | `test_a_process_whose_text_mentions_an_unreviewed_file_is_refused` (7 ways) |
| S6 | Low | `os.open(name, dir_fd=d)` was resolved against the working folder; `ctypes` raises no audit event | A relative open with a tracked file's name that isn't that file from the working folder is checked as that file. `ctypes` documented as not covered | `test_an_open_relative_to_another_folder_is_refused_by_name` |
| S7 | Low | A task naming a state file that doesn't exist read as nothing tracked | The worker reads the named state and the default one | `test_a_task_naming_a_missing_state_file_still_sees_the_tracked_files` |
| S8 | Note | With the in-process step skipped, the guard's refusal surfaced as a failed request, not the 409 | Answered as the review 409 by the app | `test_the_guards_refusal_is_a_409_even_when_the_servers_step_is_skipped` |
| S9 | Note | No test started a thread; the converter's hook didn't follow a thread the model started | Threads started from an in-process load carry the hook | `test_a_thread_in_the_worker_is_refused`, `test_a_thread_in_the_in_process_converter_is_refused` |

Still not covered after these fixes, and listed in the threat model's
section 7: text not read from the tracked file; a child process beyond its
command, text and environment (a child Python, `multiprocessing` included;
names on stdin or built in the child); `ctypes` and C extensions; a model
tampering with the guard during its own task (later tasks: see R1); raw `_thread` threads in the server's in-process load; links
under another name made beforehand and then read as text; sourceless
`.pyc` files and zip imports.

### The second round of review of PR #310, and the fixes (#187)

Each finding is a test in `test_assistant_runner_guard.py` (section 15)
that fails at `5149e0da`. **Not yet re-checked** (round 3 placeholder above).

| # | Severity | Finding | Fix | Proof | What remains |
|---|---|---|---|---|---|
| R1 | Medium | A model could still switch the guard off for later tasks in ways the fingerprint missed (seven, from a method of `_State` or `TrackedIndex` to `json.load`, `threading.local` and a swapped `__main__._guard`) | While anything the assistant wrote is tracked, or the state can't be read, the server sends each task to a worker process that has run no other and ends it afterwards, starting a spare ahead (replaced in round 3 by the fork server, which gives the same guarantee in milliseconds). Decided from the state the server reads, never from the worker. The reset and fingerprint stay as cheap extras | `test_tampering_in_one_task_never_reaches_the_next` (all 7), `test_each_task_runs_in_a_new_process_only_while_something_is_tracked` | Tampering within a model's own task. Cost: see the timing in PR #310 |
| R2 | Medium | False positives refused ordinary models while an unapproved file was tracked: the user's own same-named file opened relatively, a module name as a word in shell, `-c` or environment text, a bare `*` glob | The name-only check for a relative open applies only when no such file is in the working folder; a module name alone no longer counts (the full name and path do); a glob counts only when anchored in a tracked file's folder and matching its name. A refusal that isn't an import now says the file was "named in a file, process or setting the model used" | Five ordinary models that must run: `test_a_relative_open_of_the_users_own_same_named_file_runs`, `test_a_module_name_as_a_word_in_shell_text_runs`, `..._in_the_environment_runs`, `test_a_module_name_in_python_c_text_runs`, `test_a_bare_glob_elsewhere_runs`; `test_a_refusal_that_isnt_an_import_says_so` | A module name alone in program text (`python -c "import helper"`) is no longer refused; a relative glob after a `cd` isn't anchored |
| R3 | Low to medium | A symlink chain made during the task (a link made while its target is missing, then a folder link) read an unapproved file | A symlink is refused when its target's own name is a tracked file's, existing or not, or its target is a folder holding a tracked file, at any depth | `test_a_symlink_chain_made_during_the_task_is_refused` (the chain, and a copy through a folder link); `test_a_symlink_to_an_unrelated_folder_runs` | Links made beforehand and then read as text |
| R4 | Low | `perl -E` and positional program text (`awk`) weren't read | `-c`, `-e` and `-E` in any case mark program text, and every argument of a known interpreter is read for the full file name or path | `test_interpreter_program_text_naming_the_file_is_refused` (`perl -E`, `awk`, `ruby -e`, `bash -c`) | Names built with escapes, variables, `printf`, `base64`, brace expansion, in a script file, or matched by a regular expression (`find -regex`). `cat h''x.py` is refused: quotes and backslashes are taken out before the check |

### The third round of review of PR #310, the fork server, and the fixes (#187)

Each finding is a test in `test_assistant_runner_guard.py` (sections 16
and 17); those for F1, F4 and F6 fail at `dadca2c5`. **Not yet re-checked**
(round 4 placeholder above).

| # | Severity | Finding | Fix | Proof | What remains |
|---|---|---|---|---|---|
| Speed | — | A new worker per task cost about 1.5 s on loads in quick succession, and the live preview paid it on every pause | **The fork server**: a parent that imported PsyNeuLink and the guard, runs no model code, reads only `FORK`, and forks one child per task, ending the child's process group afterwards. Tracked loads and previews are now faster than before the assistant existed (no cache to purge) | `test_tasks_run_in_children_of_one_clean_parent_while_something_is_tracked`, `test_a_child_that_kills_its_parent_doesnt_reach_the_next_task`, `test_a_process_a_model_starts_doesnt_outlive_its_task`, `test_nothing_tracked_keeps_the_warm_worker`; the seven R1 tamperings | — |
| F3 | Medium (speed) | Fresh mode applied whenever anything was tracked, approved or not, and paid the worker's start each time | Fresh mode still applies whenever anything is tracked (the stricter side), but through the fork server it costs nothing | Timing in PR #310 | Two resident processes while something is tracked (the idle warm worker and the fork server's parent) |
| F1 | Medium | Model code could approve its helper in, or delete, the review record on disk, and the next fresh task ran it | In the worker, while something is tracked, the model's own Python code writing, moving or removing the record, its `.bak` and `.tmp`, or the guard's and the worker's source and compiled files is refused. **Round 4 (G1, G2) showed this is partial:** a process the model starts isn't held to it, and other modules later tasks import weren't covered. The docs no longer say "only something already running as the user" | `test_a_model_cannot_change_the_review_record_or_the_guard` (5 ways), each followed by the next task's refusal | A process the model starts, anything outside the worker, or anything with nothing tracked can change the record (#311) |
| F2 | Medium | A model run by the in-process converter can change the server's own decisions | Documented: the converter runs model code in the server, so the server's decisions aren't protected against it | Threat model, section 7 | As documented |
| F4 | Low to medium | Five more false positives (cases f to j) | One rule: only a path that leads to an existing tracked, unapproved file counts, read rather than written; symlinks are refused only when their target is such a file, and after a symlink every path in the task is resolved, so links are caught when opened; `-c`/`-e`/`-E` count only for interpreters. The refusal names the path the model used | Five tests that must run (f to j); the R3 chain still refused at open; `test_the_refusal_names_the_path_the_model_used` | Relative names that don't lead to the file (after a `cd` outside shell text, `dir_fd`) |
| F5 | Low | A decoy defeated the `dir_fd` check | Moot after F4: `dir_fd` relative opens are documented as not covered | `test_an_open_relative_to_another_folder_is_not_covered` records it | As documented |
| F6 | Low | An interpreter behind `env`, and interpreters not on the list | Wrappers (`env`, `nice`, `xargs`, `sudo`, `time`, `nohup`, `command`, `exec`, `timeout`, `stdbuf`) are skipped when finding the interpreter; the list's limits are documented | `test_an_interpreter_behind_env_is_read` | Interpreters not on the list |
| — | Note | Making the hook resolve only existing files briefly let a helper written mid-load through | The review record is read again during a task when it changes on disk | `test_a_helper_the_assistant_writes_while_a_model_loads_is_refused` (warm worker and forked child) | — |

### The fourth round of review of PR #310, and the fixes (#187)

**In-process protection covers memory only. A model that writes files (directly or through a child process) can affect later tasks; only the OS sandbox (#311) closes this. Until #311, don't turn the assistant on for untrusted use.**

This was the last in-process round: what is left needs the operating-system
sandbox (#311; the threat model's section 7 lists what it must close).
Tests are in `test_assistant_runner_guard.py`, section 18; G3's, G4's and
G1's fail at `8482a0a6`. **Not yet re-checked** (round 5 placeholder above).

| # | Severity | Finding | Fix | Proof | What remains |
|---|---|---|---|---|---|
| G1 | High | A model can rewrite a module later processes import | Partial: while something is tracked, the model's own Python code in the worker can't write, move or remove the app's code (`backend/app`), PsyNeuLink's, or an installed package's; the worker writes no compiled files | `test_a_model_cannot_write_code_that_later_tasks_import` | A process the model starts can (#311) |
| G2 | Medium | A child process can copy a forged record over the real one, or remove it | Documented | Threat model, section 7 | #311 |
| G3 | Medium | A `setsid` process outlives the task and, holding the shared output pipe, forged a later task's answer | Each forked child gets its own output pipe, which the parent copies to the server; an answer must carry a random token made for that task. **As built in round 4 this was incomplete (round 5, H1):** a survivor that kept writing kept the parent copying, and its fake child-start line, on the same stream as the parent's messages, aimed the next timeout at another process group. Fixed in round 5 (below) | `test_a_leftover_process_cannot_forge_a_later_tasks_answer` (the next task's 409, and three more tasks in step) | The process itself outlives the task (#311) |
| G4 | Low | Quote- and escape-split names in `sh -c`, and `find -name 'hx_*'`, got through | Shell text is read as the shell reads it, quotes and escapes taken out, then checked by name against tracked, unapproved files; a pattern with a literal start that matches one counts | `test_shell_text_spellings_of_an_unreviewed_file_are_refused` (6 spellings); the round-3 false positives a to j still run | Names built in the shell (variables, `printf`, `base64`, brace expansion) |
| G5 | Low | A symlink chain made by a child process (`ln -s`) | Documented | Threat model, section 7 | #311 |

### The operating-system sandbox (#311)

The hard boundary behind the guard, designed in `os-sandbox.md`. **Not yet
reviewed** (placeholder row above). Built by the author; each claim is a
test that runs in CI on Linux (Landlock and seccomp) and was run locally on
macOS (Seatbelt).

| Attack (round) | Without the sandbox | With it | Proof |
|---|---|---|---|
| Read the unapproved file after switching the guard off: `open`, `os.open`, `ctypes`, a symlink chain, an `ln -s` chain by a child (G5), `cat`, a child Python, a hard link, rename, `dir_fd` (F5) | Runs | Refused by the kernel | `test_os_sandbox_routes.py::test_a_model_that_switches_the_guard_off_still_cant_read_the_unapproved_file` (10 ways); `test_os_sandbox.py` (17 ways at the process) |
| Change the review record: Python write, remove, `cp`, `rm`, a child Python (F1, G2) | `cp`, `rm` and child Pythons get through | Refused | `test_a_model_cant_change_the_review_record_for_the_next_task`, `test_an_approval_forged_by_a_child_process_doesnt_land` |
| Rewrite `show_graph_guard.py` or `import_guard.py`, add a module beside them (G1), a `.pth` file, the stdlib, PsyNeuLink | Through a child process, gets through | Refused | `test_a_model_cant_rewrite_or_add_a_module_later_processes_import`, `test_a_model_cant_add_a_pth_file`, `test_os_sandbox.py` |
| A `setsid` grandchild that outlives its task (G3) | Keeps the user's files and network | Confined, then ended with its task | `test_a_grandchild_that_leaves_the_process_group_is_still_sandboxed`, `..._is_ended_with_its_task` |
| Kill the fork server's parent so the task is retried outside | The retry ran unsandboxed | The retry is sandboxed; the kill is refused on macOS | `test_a_model_that_kills_its_parent_is_still_sandboxed_when_the_task_is_retried`, `test_a_sandboxed_model_cant_kill_the_fork_servers_parent` |
| A model run by the converter | Runs in the server | Runs in a sandboxed process | `test_a_model_converted_to_the_standard_format_is_sandboxed_too` |
| A Learn job that switches the guard off and reads the file | Runs | Refused | `test_a_learn_job_that_switches_the_guard_off_cant_read_it_either` |
| TCP, UDP, DNS, local sockets | Reach | Refused | `test_a_model_cant_reach_the_network`, `test_os_sandbox.py` |

#### The first independent review of #312, and the fixes

Each fix has a test in `test_os_sandbox_routes.py` that switches the whole
in-process guard off first (the reviewer's preamble), so the OS layer is
tested alone.

| # | Severity | Finding | Fix | Proof | What remains |
|---|---|---|---|---|---|
| S1 | Critical | Earlier versions the assistant kept were readable | The previous-versions folder and the assistant's log are denied to every model | `test_s1_an_earlier_version_the_assistant_kept_cant_be_read` | — |
| S2 | Critical (macOS) | Moving a folder that holds an unapproved file freed it | Every folder from a protected file up to the writable folder holding it can't be renamed, removed or replaced; on Linux rules follow the file, not its path | `test_s2_moving_a_folder_that_holds_an_unapproved_file_doesnt_free_it` (parent and grandparent, declared folder and model folder) | — |
| S3 | High | A process chain deeper than five outlived the sweep and ran later files | The sweep repeats until none is left (within 5 s), ends survivors of any earlier task, not only the last, and also runs after Learn jobs, pool and one-shot tasks and conversions; on Linux orphans are found by their seccomp and no_new_privs state | `test_s3_a_deep_chain_of_survivors_is_ended_and_cant_run_a_later_file` (12 deep) | A survivor lives until the next sweep, at most the length of its own task |
| S4 | High | Runs went ahead unsandboxed when the sandbox failed | While the sandbox is wanted and can't be applied, runs are refused (409 `sandbox_required`) unless "Require the sandbox" is off or the server was started with `PSYNEUVIEW_OS_SANDBOX_ALLOW_UNSANDBOXED=1`; a failed check is retried after a minute; every result of a run meant to be sandboxed must carry the applied policy's key, or it is refused | `test_s4_a_run_that_must_be_sandboxed_is_refused_when_it_cant_be`, `test_s4_a_result_without_the_sandboxs_proof_is_refused` | The two unsandboxed sessions weren't reproduced; the proof check makes any such run fail closed |
| S5 | Medium | Hidden folders and auto-run files in writable folders could be written | On macOS, writes to any dot-file or dot-folder, `.pth`, and names tools run by themselves (Makefile, justfile, package.json, conftest.py, setup.py, pyproject.toml, sitecustomize.py and others) are refused in every writable folder but the task's own | `test_s5_no_hidden_or_auto_run_files_in_writable_folders` (with csv, png, npy, pkl, json, txt still written) | **Linux: open.** Landlock can't tell files apart by name |
| S6 | Low (Linux) | The allowed dynamic loader could start any program | The loader must stay (the kernel runs it for every program), so the folders of programs (`/bin`, `/usr/bin`, `/sbin`, `/usr/local/bin`, `/usr/libexec` and others) aren't readable; the allowed programs are | `test_s6_the_dynamic_loader_cant_start_another_program` (Linux) | — |
| S7 | — | The PR's diff showed unrelated changes | The base was merged in | `git diff origin/feature/ai-integrated-179...HEAD` touches only #311's files | — |

#### The second independent review of #312, and the fixes

Each has a guard-off test in `test_os_sandbox_routes.py` (`test_t1_…` to `test_t6_…`).

| # | Severity | Finding | Fix | What remains |
|---|---|---|---|---|
| T1 | Critical (macOS) | `clonefile` of a folder holding an unapproved file copied it out | Cloning is refused for every folder from a protected file up to its writable folder (`file-clone`); tested for `clonefile` and `fclonefileat`, parent and grandparent | — |
| T2 | High (macOS) | A case-changed model path lost the folder-move rules | Every path a policy compares is the file system's own spelling (`F_GETPATH`): the model's folder, the writable folders, the folders above protected files; tested for case and accent variants | — |
| T3 | High | A fast fork-and-exit process outlived the sweep | A survivor is any sandboxed Python or Graphviz of this user whose parents lead to init or the fork server's parent rather than a running worker, however deep or fast; each round stops and kills whole process groups (recorded when seen, so a process that has already gone still names its group), until three rounds in a row find nothing (10 s bound). Sweeps also run before every task and before every file the assistant writes | A process that makes a new session at every fork may still slip between rounds; on Linux desktops an orphan adopted by `systemd --user` rather than init is ended only by the fork server's own sweep |
| T4 | High | Another pytest session deleted the tests' review records | Test records live inside the session's temporary root; and in the product, a missing record whose backup is there is read from the backup, and a missing record and backup fail closed once the assistant has written files (the marker of U5) | — |
| T5 | Medium | `.py` could be planted in the assistant's folders | No new code in any writable folder but the task's own (macOS) | Linux: no rules by name |
| T6 | Low | Runnable files beside a model | `.command`, `.sh` and other shells, `.zip`, `.pyz`, `.egg`, `.whl`, `.app`, AppleScript, CMakeLists.txt, build.gradle and similar are refused in writable folders (macOS). Setting an execute bit isn't refused: `shutil.copy` sets modes, and ordinary copies would break. `.pkl` stays allowed (ordinary output); loading an untrusted pickle runs code, as it always does | Linux: no rules by name |
| T7 | Low | The proof key is readable by model code | Documented as defence in depth: the barrier is the worker's own refusal before anything runs (it won't run a task whose policy it hasn't applied); the key only catches a run that went unsandboxed by mistake | — |

#### The third independent review of #312, and the fixes

Tests: `test_u1_…` to `test_u6_…` in `test_os_sandbox_routes.py`.

| # | Finding | Fix | What remains |
|---|---|---|---|
| U1 | The sweep killed a whole process group a model had joined | Survivors are killed by pid only; the fork server, pool workers, Learn jobs, one-shot runs and conversions start in their own sessions, so a model can't join a group of the user's | — |
| U2 | "Ours" matched other sandboxed Pythons and hardened services | Survivors are identified only by their task's mark: on macOS a per-run and per-task random file their profile refuses (checked with `sandbox_check`), on Linux the fork server's adopted children and a random run token in the environment the server's workers start with | Linux: a process a model starts outside the fork server can exec with its mark removed |
| U3 | A racer that calls `setsid` at every fork outlived the sweep | The mark survives `setsid`; each process is stopped the moment the scan finds it, then killed; on Linux the fork server's subreaper adopts every generation | See the success rates in the PR |
| U4 | A flooding leftover filled the server's memory on a cold retry | Every worker's output is read with a 16 MB cap and not past a moment after the worker exits: one-shot runs, Learn jobs, conversions; the persistent workers' kept lines are capped | — |
| U5 | With only new files written, a deleted record and backup read as nothing tracked | A marker beside the record (`assistant-review.json.written`, protected like the record) says the assistant has written files; with it, a missing record and backup fail closed | — |
| U6 | Extensionless executables and link files | New extensionless files, and `.terminal`, `.fileloc`, `.webloc`, `.inetloc`, `.desktop` files, are refused in writable folders (macOS) | Changing modes stays allowed (`shutil.copy` needs it) |
| U7 | Pool-mode previews about 1.5 s | Pool workers on macOS take any task's policy, so a ready worker always fits; back-to-back tasks still wait for a refill when both are used. The pool is the fallback where forking isn't usable | As stated |

#### The fourth independent review of #312, and the fixes

| # | Finding | Fix | Test |
|---|---|---|---|
| V1 | A leftover writing without newlines held the server in `readline`, with the pool's lock | The warm and pool workers' output is read as raw bytes after `select`, lines built here, the deadline and the process checked on every pass, a line longer than 64 MB dropped; the answer is found at the end of a line, since what a leftover wrote may sit in front of it. Learn jobs, conversions, one-shot runs and the fork relay already read raw bytes | `test_v1_…`: the flooded task ends in about 4 to 7 s, the next in under 3 s, in both modes |
| V2 | Execute bits on existing files; trailing-dot names; more runnable types | (b): after every task (in the sweep, after its survivors are ended) the execute bits are taken off every regular file in the task's writable folders whose status changed during the task (at most 50,000 files a check); ordinary copies keep working. Names ending in `.` or `. ` and `.ksh`, `.tcsh`, `.jar`, `.action`, `.osax` are refused (macOS) | `test_v2_…` |
| V3 | Linux: a survivor of a server-started worker could shed its mark by exec | Every server-started worker on Linux is a subreaper, so every orphan of its task becomes its child whatever its environment, and it ends them all when the task is over, before answering | Covered by the pool and one-shot runs of the survivor tests on Linux |
| T4 (Linux pool) | Stale cache keys; an unlocked cache; spares from an earlier test | The review record's cache key includes the file's inode and change time (every save replaces the file); the cache is read under a lock; tracked files' hashes aren't cached; the record's path is part of a policy's key, so a spare started for another record isn't used | The Linux pool runs |

#### The fifth independent review of #312, and the fixes

| # | Finding | Fix | Test |
|---|---|---|---|
| W1 | The execute-bit sweep stopped after 50,000 files | **Fixed.** On macOS, mode changes (`chmod`, `fchmod`, `chmodat`) are refused in every writable folder but the task's own, so a model can't set an execute bit at all; `shutil.copy` and `copy2` let their mode step go there (the data is copied; convenience, not a boundary). The sweep has no cap and stays as the backstop on macOS and the mechanism on Linux | `test_w1_an_execute_bit_cant_be_set_behind_many_decoys` (50,050 decoys), `test_w1_mode_changes_are_refused_and_copies_still_work` |
| W2 | Linux: until the sweep runs after the task, a file made executable stays so during it | Accepted on Linux (Landlock has no right for mode changes); closed on macOS by W1 | — |
| W3 | Pool-mode previews take about 2.5 s | A note: the pool is only the fallback where forking isn't usable; fork mode takes about 0.37 s | — |

Not done: per-task cgroups on Linux (`systemd-run --user --scope` or a delegated cgroup with `cgroup.kill`). The subreaper covers the same processes while the worker lives.

For the reviewer, in particular: the generated Seatbelt profile
(`os_sandbox_apply.render_sbpl`; the last matching rule wins, so the denies
come last), the Mach services allowed, the Landlock cover of `/` minus
denied paths (`cover`), the seccomp filter (`_seccomp_no_sockets`), the
decision to apply the policy per task in each forked child rather than to
the fork server's parent, the survivor sweep (`end_survivors`), and the
residuals listed in the threat model's section 7 ("What the sandbox
closes").

### The fifth round of review of PR #310, and the fixes (#187)

Tests are in `test_assistant_runner_guard.py`, section 19; H1's, H2's and
H3's fail at `5835146a`. Not re-checked by the reviewer since.

| # | Severity | Finding | Fix | Proof | What remains |
|---|---|---|---|---|---|
| H1 | Medium | A survivor that kept writing kept the fork parent copying, and its fake child-start line steered the next timeout's kill | The parent's own messages go on a separate control pipe that every child closes before its task; once the child has exited, the parent copies for a fixed 0.2 s however much is coming, then closes the pipe; the server reads both pipes without text buffering, kills only a pid from the control pipe, restarts a stuck parent, and uses the pool after three failures in a row | `test_a_noisy_leftover_process_doesnt_stall_or_steer_later_tasks`: the next three tasks answer promptly, an unapproved helper is still refused, and the victim is untouched | The survivor itself (#311) |
| H2 | Low | The in-process write guard was bypassed with `dir_fd` | `os.open`, `remove`, `unlink`, `rename` and `replace` with a `dir_fd` are checked by the folder the fd names (refused if it can't be told) | `test_a_write_through_dir_fd_into_the_apps_code_is_refused`; `test_a_dir_fd_write_elsewhere_runs` | A process the model starts (#311) |
| H3 | Low | The standard library and the app's settings weren't protected | Both join the protected places | `test_the_standard_library_and_the_apps_settings_are_protected` (against a stand-in standard library) | A process the model starts (#311) |

### Verdict and residuals, 2026-11-03

Phases 1, 2 and 3 are safe to ship off by default, per the independent
review of `7ec8aa79`. An outside review is still required before a release
that lets the assistant write files (issue #179, review step 4). What is
accepted and carried, not fixed:

- **Stale bytecode:** a `__pycache__` entry compiled from an earlier text
  with the same size and whole-second mtime is what Python runs; it reaches
  only text that was approved at the time.
- **`exec`, `runpy` and subprocesses** aren't covered by the import guard: a
  reviewed model that runs code by those means is trusted as the user's
  own. Approving a model means trusting what it does. *Narrowed by the
  follow-up above (F1, F2): a tracked, unapproved file's own text is now
  refused through each of them; what remains is in the threat model's
  section 7.*
- **No per-session credential** for the assistant routes yet; `same_site`
  is what there is.
- **`saving: structured_without_asking`** is stored and shown but not acted
  on; the page asks for every proposal.
- **Phase 4** (running models with containment) is not built; there is no
  run tool.

Still open after this review (also in the threat model's open items): a
per-session credential for the assistant routes; per-folder consent at a
cloud agent's first use; the `structured_without_asking` setting isn't acted
on; running and containment (Phase 4); the review of Phases 1 to 3 by the
reviewer after these fixes.

## Reporting a problem

Security problems in the assistant are reported through the repository's
security policy (`SECURITY.md`). A release that ships the assistant carries
a switch that turns it off from Settings without a rebuild, and every
assistant release note says how.
