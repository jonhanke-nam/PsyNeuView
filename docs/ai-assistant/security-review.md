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
| 7 | Medium-low | A reviewed model that puts its folder on `sys.path` imported an unreviewed sibling the assistant wrote | Before a model runs, a tracked, unreviewed `.py` in its folder refuses the run and is named, so the user reviews it (or moves it). Costs one dictionary lookup when nothing is tracked, so nothing changes for anyone not using the assistant |
| 8 | Medium-low | The agent connection followed redirects, resending the key to any host, https to http included | The opener's redirect handler raises; the user sees an error naming the redirect, without the key |
| 9 | Low | A `base_url` left over from `openai_compatible` applied to `anthropic` silently, and Settings still said "Anthropic's API" | Changing the type without giving an address clears it; a change of destination is a raise named with the real address; Settings show the real destination |
| 10 | Low | A corrupt state file failed open | A `.bak` is kept on each save and read when the state can't be parsed; if neither parses, every execution guard refuses (`assistant_review_state_unreadable`) until the file is repaired or removed. No state file at all is unaffected |
| 11 | Low | `propose_file_write` ignored `visibility.files` | It needs it |
| 12 | Low | The watcher's `reload_blocked` wasn't handled by the page | The page offers the review and reloads once approved |
| 13 | Low | The log kept the first 200 characters of file text | A hash and a length, never the text |
| 14 | Low | `plain_literal` turned `1e999` into the name `inf` | Non-finite numbers are refused |
| — | Suspected | Bidirectional and zero-width characters could make a reviewed file read differently from how it runs | Flagged in a proposal's warnings; shown as `<U+XXXX>` in Before, After and the review card, with a note |
| — | Suspected | `rename_node.new_name` accepted `<` and `>` | Letters, digits, spaces and `_ - . : ( ) [ ]` only |
| — | Suspected | "Accept all" could accept proposals that arrived after it was pressed | It accepts exactly what was on screen when pressed |

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
