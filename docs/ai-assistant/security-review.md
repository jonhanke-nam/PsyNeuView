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
| 2026-11-03 | 0 | Threat model, containment experiment, this checklist (`feature/ai-threat-model-179`) | Awaiting review | Open | Containment recommendation needs a second opinion before Phase 4 is planned |

## Reporting a problem

Security problems in the assistant are reported through the repository's
security policy (`SECURITY.md`). A release that ships the assistant carries
a switch that turns it off from Settings without a rebuild, and every
assistant release note says how.
