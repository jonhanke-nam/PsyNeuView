/**
 * Applying an accepted `app_edit` proposal (#179).
 *
 * An `app_edit` carries only structured ops from a fixed allowlist, which the
 * backend checked as plain data before the proposal existed. Each op goes
 * through the same route the user's own edit takes (`/api/model/update-param`
 * as the Inspector's edit does, `/api/model/rename-node` as a rename does,
 * and so on). Nothing here ever applies the proposal's text as source: an op
 * the page has no route for is refused, whatever the proposal says, and
 * free-form Python only reaches a file through a `file_write` proposal, with
 * approval and review.
 *
 * The whole proposal is one History entry, "Assistant: <summary>", so one
 * undo reverses it: the entry is recorded at once, and the "Model updated"
 * push the model load schedules finds an identical snapshot and is skipped.
 */

import type { Proposal, ProposalOp } from "@/stores/assistantTypes";
import { useModelStore } from "@/stores/modelStore";
import { recordAction } from "./history";

type Applier = (filePath: string, args: Record<string, unknown>) => Promise<void>;

async function postEdit(route: string, body: Record<string, unknown>): Promise<void> {
  const resp = await fetch(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    let detail = "";
    try {
      const err = (await resp.json()) as { detail?: unknown };
      detail = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail ?? "");
    } catch {
      // no body
    }
    throw new Error(`${route.replace("/api/model/", "")}: HTTP ${resp.status}${detail ? ` (${detail})` : ""}`);
  }
  const data = (await resp.json()) as { source?: string; model?: unknown; layout?: unknown };
  const store = useModelStore.getState();
  if (data.source) store.setSource(data.source);
  if (data.model) store.loadModelFromServer(data.model, data.layout);
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string") throw new Error(`${key} must be a string`);
  return v;
}

/** The display names of every node, as the rename route wants them for collision checks. */
function nodeLabels(): string[] {
  return useModelStore
    .getState()
    .nodes.filter((n) => n.type === "mechanismNode" || n.type === "compositionNode")
    .map((n) => (n.data as { label?: string } | undefined)?.label)
    .filter((l): l is string => !!l);
}

function nodeByVar(varName: string) {
  return useModelStore.getState().nodes.find((n) => (n.data as { varName?: string } | undefined)?.varName === varName);
}

function portNames(varName: string, kind: string): string[] {
  const node = nodeByVar(varName);
  const data = node?.data as { inputPorts?: { name: string }[]; outputPorts?: { name: string }[] } | undefined;
  const ports = kind === "input" ? data?.inputPorts : data?.outputPorts;
  return (ports ?? []).map((p) => p.name);
}

/** One applier per op the backend allows. Nothing else is applied. */
export const APP_EDIT_APPLIERS: Readonly<Record<string, Applier>> = {
  update_param: async (filePath, a) => {
    await postEdit("/api/model/update-param", {
      file_path: filePath,
      var_name: str(a, "var_name"),
      param_name: str(a, "param_name"),
      // Already the text of a plain literal, as the backend rebuilt it.
      new_value: str(a, "new_value"),
      context: a.context === "function" ? "function" : "mechanism",
      is_default: a.is_default === true,
      function_class: typeof a.function_class === "string" ? a.function_class : undefined,
      skip_introspect: false,
    });
  },
  rename_node: async (filePath, a) => {
    const varName = str(a, "var_name");
    const current = (nodeByVar(varName)?.data as { label?: string } | undefined)?.label ?? null;
    await postEdit("/api/model/rename-node", {
      file_path: filePath,
      var_name: varName,
      new_name: str(a, "new_name"),
      existing_names: nodeLabels(),
      current_name: current,
    });
  },
  add_port: async (filePath, a) => {
    const varName = str(a, "var_name");
    const kind = str(a, "port_kind");
    await postEdit("/api/model/add-port", {
      file_path: filePath,
      var_name: varName,
      port_kind: kind,
      current_names: portNames(varName, kind),
      new_name: str(a, "new_name"),
    });
  },
  remove_port: async (filePath, a) => {
    const varName = str(a, "var_name");
    const kind = str(a, "port_kind");
    await postEdit("/api/model/remove-port", {
      file_path: filePath,
      var_name: varName,
      port_kind: kind,
      current_names: portNames(varName, kind),
      port_name: str(a, "port_name"),
    });
  },
  rename_port: async (filePath, a) => {
    const varName = str(a, "var_name");
    const kind = str(a, "port_kind");
    await postEdit("/api/model/rename-port", {
      file_path: filePath,
      var_name: varName,
      port_kind: kind,
      current_names: portNames(varName, kind),
      old_name: str(a, "old_name"),
      new_name: str(a, "new_name"),
    });
  },
};

/** The op is one the page has a route for. Checked before anything is applied. */
export function isKnownOp(op: ProposalOp): boolean {
  return Object.prototype.hasOwnProperty.call(APP_EDIT_APPLIERS, op.op) && typeof op.args === "object" && op.args !== null;
}

/**
 * Apply every op through its route, then record the one History entry.
 * Throws, applying nothing, when an op isn't on the list or no model is open;
 * throws when a route fails (the ops before it stand, and so does the entry).
 */
export async function applyAppEdit(proposal: Proposal): Promise<void> {
  if (proposal.kind !== "app_edit") throw new Error("not an app edit");
  const store = useModelStore.getState();
  const filePath = store.filePath;
  if (!filePath) throw new Error("no model is open");
  const unknown = proposal.ops.find((op) => !isKnownOp(op));
  if (unknown) throw new Error(`refused: "${unknown.op}" isn't a structured edit the page applies`);
  if (proposal.ops.length === 0) throw new Error("refused: the proposal has no ops");
  await store.flushBuffer();
  for (const op of proposal.ops) {
    await APP_EDIT_APPLIERS[op.op](filePath, op.args);
  }
  recordAction(`Assistant: ${proposal.summary}`);
}
