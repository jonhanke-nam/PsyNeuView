/**
 * The shapes the assistant's backend sends and takes (#179).
 *
 * Mirrors docs/ai-assistant/contract.md. Every field the agent can influence
 * (`text`, `summary`, `before`, `after`, `warnings`) is hostile text: it is
 * shown through SafeText and never as markup.
 */

export type AgentType = "none" | "anthropic" | "openai_compatible";
export type Autonomy = "answer" | "suggest" | "app_edits";
export type Saving = "always_ask" | "structured_without_asking";
export type FolderAccess = "read" | "read_write";

export interface AssistantFolder {
  path: string;
  access: FolderAccess;
}

export interface AssistantVisibility {
  model: boolean;
  selection: boolean;
  errors: boolean;
  results: boolean;
  files: boolean;
}

export interface AssistantSettings {
  enabled: boolean;
  agent: { type: AgentType; model: string; base_url: string };
  folders: AssistantFolder[];
  autonomy: Autonomy;
  saving: Saving;
  visibility: AssistantVisibility;
  /** max_tokens: the tokens the agent's service reports, summed over the session. */
  limits: { tool_calls: number; minutes: number; max_tokens: number };
  keep_log: boolean;
}

/** The keys a PUT may carry: what the backend stores, and nothing it adds to a GET (`available`). */
export const ASSISTANT_SETTINGS_KEYS = ["enabled", "agent", "folders", "autonomy", "saving", "visibility", "limits", "keep_log"] as const;

/** `settings` reduced to the keys the backend takes. */
export function settingsBody(settings: AssistantSettings): AssistantSettings {
  const out = {} as Record<string, unknown>;
  for (const key of ASSISTANT_SETTINGS_KEYS) out[key] = settings[key];
  return out as unknown as AssistantSettings;
}

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  enabled: false,
  agent: { type: "none", model: "", base_url: "" },
  folders: [],
  autonomy: "suggest",
  saving: "always_ask",
  visibility: { model: true, selection: true, errors: true, results: false, files: false },
  limits: { tool_calls: 25, minutes: 10, max_tokens: 100000 },
  keep_log: true,
};

/**
 * `app_edit`: structured ops the page applies through the user's own edit
 * routes; `after` is a description, never source. `file_write`: the backend
 * writes `after` to `path` on accept, and a `.py` stays unreviewed until
 * approved. `open_file`: the agent asks; only the user opens it.
 */
export type ProposalKind = "app_edit" | "file_write" | "open_file";
export type ProposalState = "pending" | "accepted" | "rejected" | "stale";

export interface ProposalOp {
  op: string;
  args: Record<string, unknown>;
}

export interface Proposal {
  id: string;
  kind: ProposalKind;
  summary: string;
  state: ProposalState;
  base_hash: string | null;
  ops: ProposalOp[];
  path: string | null;
  before: string | null;
  after: string | null;
  freeform_python: boolean;
  warnings: string[];
}

export type AssistantEvent = { seq: number; t: string } & (
  | { type: "text"; text: string }
  | { type: "tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; tool: string; ok: boolean; summary: string }
  | { type: "refused"; tool: string; reason: string }
  | { type: "proposal"; proposal: Proposal }
  | { type: "error"; message: string }
  | { type: "done"; reason: "finished" | "stopped" | "limit" }
);

/** What the page sends with a message; the backend drops what visibility forbids. */
export interface AssistantContext {
  file_path?: string | null;
  source?: string;
  selection?: string | null;
  errors?: string[];
  results?: unknown;
}

/** One line of the conversation as the panel shows it. */
export type ConversationItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "event"; id: string; event: AssistantEvent };
