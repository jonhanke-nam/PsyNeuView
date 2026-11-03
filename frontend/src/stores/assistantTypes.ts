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
  limits: { tool_calls: number; minutes: number };
  keep_log: boolean;
}

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  enabled: false,
  agent: { type: "none", model: "", base_url: "" },
  folders: [],
  autonomy: "suggest",
  saving: "always_ask",
  visibility: { model: true, selection: true, errors: true, results: false, files: false },
  limits: { tool_calls: 25, minutes: 10 },
  keep_log: true,
};

export type ProposalKind = "app_edit" | "file_write";
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
  base_hash: string;
  ops: ProposalOp[];
  path: string | null;
  before: string;
  after: string;
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
