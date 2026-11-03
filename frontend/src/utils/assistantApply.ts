/**
 * Applying an accepted `app_edit` proposal (#179).
 *
 * Through the same paths the user's own edits take: an `update_param` op goes
 * to `/api/model/update-param` as the Inspector's edit does; anything the
 * page has no edit path for is applied as the proposal's `after` text, as a
 * code edit in the editor would be. The whole proposal is one History entry,
 * "Assistant: <summary>", so one undo reverses it: the entry is recorded at
 * once, and the "Model updated" push the model load schedules finds an
 * identical snapshot and is skipped.
 */

import type { Proposal, ProposalOp } from "@/stores/assistantTypes";
import { useModelStore } from "@/stores/modelStore";
import { recordAction } from "./history";

async function updateParam(filePath: string, op: ProposalOp): Promise<void> {
  const a = op.args as { var_name?: string; param_name?: string; new_value?: unknown; context?: string };
  await useModelStore.getState().flushBuffer();
  const resp = await fetch("/api/model/update-param", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_path: filePath,
      var_name: a.var_name,
      param_name: a.param_name,
      new_value: typeof a.new_value === "string" ? a.new_value : JSON.stringify(a.new_value),
      context: a.context ?? "mechanism",
      is_default: false,
      skip_introspect: false,
    }),
  });
  if (!resp.ok) throw new Error(`update-param: HTTP ${resp.status}`);
  const data = (await resp.json()) as { source?: string; model?: unknown; layout?: unknown };
  const store = useModelStore.getState();
  if (data.source) store.setSource(data.source);
  if (data.model) store.loadModelFromServer(data.model, data.layout);
}

/** Apply every op, then record the one History entry. Throws when an op fails. */
export async function applyAppEdit(proposal: Proposal): Promise<void> {
  const store = useModelStore.getState();
  const filePath = store.filePath;
  const known = proposal.ops.filter((op) => op.op === "update_param");
  if (filePath && known.length && known.length === proposal.ops.length) {
    for (const op of known) await updateParam(filePath, op);
  } else {
    // No structured path for these ops: the proposal's text, as a code edit.
    store.setSource(proposal.after);
  }
  recordAction(`Assistant: ${proposal.summary}`);
}
