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
| _Pending_ | 1, 2, 3 | Re-check of the runner guard follow-up (#187), branch `feature/runner-guard-187` | _Pending: independent reviewer (adversarial, not the author)_ | **PLACEHOLDER: to be filled in by the independent reviewer, not the author.** The changes are listed under "The runner guard follow-up (#187)" below | _Pending_ |
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
| — | Note | Deleting or truncating the state file reads as nothing tracked | Accepted and recorded in the threat model: only something already running as the user can do that; an unparseable file fails closed |
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
| F1 | Code run from a tracked, unapproved file without an import: `exec(open(p).read())` (also inside `try/except Exception`), `Path(p).read_text()`, `exec(compile(text, p, "exec"))`, `runpy.run_path`, `python p` in a subprocess or a shell (by path, or by name after `cd`), `os.system`, a copy, rename, hard link or symlink imported or read under a new name | An audit hook in the worker refuses the open, compile, exec, process start, rename or link of a tracked, unapproved file, with the 409 naming it. Added only once something is tracked | `test_a_tracked_file_run_without_an_import_is_refused` (13 ways); 11 of them fail with the hook taken out (`runpy.run_module` was already caught by the loader). `test_a_tracked_file_run_by_exec_runs_once_approved`; `test_a_model_that_opens_files_and_starts_processes_works_while_something_is_tracked` |
| F2 | The converter runs a model in the server's own process, where the worker's hook isn't | The same hook in the server, acting only on the thread inside `guard_imports()`, so the server still reads unapproved files to show them | `test_the_in_process_converter_refuses_a_tracked_file_run_any_way` through `/model/convert` (import, `exec(open(...))`, `runpy.run_path`, subprocess); `test_the_server_hook_acts_only_inside_an_in_process_load` |
| F3 | `/model/convert` turned the guard's refusal into a 400 "Conversion failed": closed, but the page couldn't offer the review | It answers the review 409 | The converter test asserts 409 and the path |
| F4 | A job the worker refused ended as a plain error | The job's result names the file and the reason (`unreviewed_import`, `reason`) | `test_a_job_started_without_the_route_is_refused_by_the_worker` (the job manager's worker with the route's check skipped, as the original hole did) |
| F5 | Only `introspect` was tested with a worker started directly with no review state | Every task the worker runs is | `test_every_worker_task_refuses_an_unreviewed_model_when_started_directly` (9 tasks); `test_the_worker_lists_exactly_these_tasks` fails when a task is added |
| F6 | The job payload's review state was not asserted | It is | `test_a_job_payload_carries_the_review_state` |
| F7 | The tripwire missed `exec_module` on its own line, `load_module`, `reload`, `compile`, the interactive interpreters, `posix_spawn`, `fork`, `pty`, asyncio's subprocesses, `getoutput` and process pools, and any of them imported under another name | Counted; and a second test fails on `from subprocess import run`, `import runpy as r`, `getattr(os, ...)` and the like | `test_every_spawn_and_exec_site_is_listed`, `test_no_spawn_or_load_name_is_imported_under_another_name` |
| F8 | The threat model listed only the model-execution sites | It lists every process start and code load in `backend/app` with its guard or why it isn't model code, and says exactly what isn't covered | `threat-model.md` section 7 |

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
