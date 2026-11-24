/**
 * The shapes the assistant's backend sends and takes (#179).
 *
 * Mirrors docs/ai-assistant/contract.md. Every field the agent can influence
 * (`text`, `summary`, `before`, `after`, `warnings`) is hostile text: it is
 * shown through SafeText and never as markup.
 */

/**
 * `claude_mcp` (#201): no agent is called from PsyNeuView. Claude Desktop or
 * Claude Code, signed in with the user's subscription, connects to
 * PsyNeuView's MCP server and uses the same tools; proposals still come here.
 */
export type AgentType = "none" | "anthropic" | "openai_compatible" | "claude_mcp";
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
  /**
   * The operating-system sandbox for model runs (#311). all_runs: every model
   * run while the assistant is on, not only while something it wrote is
   * tracked. require: the assistant won't turn on where no sandbox holds.
   */
  sandbox: { all_runs: boolean; require: boolean };
  /** A short name of the user's own per model id (#370); the real id is what is sent. */
  model_aliases: Record<string, string>;
}

/** One model the chosen service offers (#370). */
export interface ModelEntry {
  id: string;
  display_name: string;
}

/** GET /api/assistant/models (#370): never the key. */
export interface ModelListResponse {
  ok: boolean;
  agent: AgentType;
  models: ModelEntry[];
  /** The one to preselect when none is saved; "" for the server's own default. */
  default: string;
  message: string;
}

/**
 * GET /api/assistant/sandbox (#311). `state`: "on" (runs are sandboxed),
 * "unavailable" (wanted but can't be applied here: runs are NOT sandboxed),
 * "available" (could be, not needed now), "off_unavailable" (not needed,
 * and couldn't be).
 */
export interface SandboxStatus {
  state: "on" | "unavailable" | "available" | "off_unavailable";
  available: boolean;
  wanted: boolean;
  why: string;
  mechanism: string | null;
  platform: string;
  enforced: string[];
  not_enforced: string[];
  reason: string | null;
  forced: "on" | "off" | null;
}

/** GET /api/assistant/mcp/setup (#201): what to paste into Claude Code and Claude Desktop. */
export interface McpSetup {
  /** This backend's address, for information: the setup itself names none, since the command finds the backend through the discovery file. */
  url: string;
  command: string;
  args: string[];
  env_names: string[];
  /** Where this backend writes its discovery file. */
  discovery_file: string;
  /** The `claude mcp add …` line, token included. */
  claude_code: string;
  /** The `mcpServers` JSON for claude_desktop_config.json, token included. */
  claude_desktop: string;
  token: string;
}

/** GET /api/assistant/mcp/status (#201). */
export interface McpStatus {
  connected: boolean;
  /** Seconds since the epoch, or null when no client has been heard from. */
  last_seen: number | null;
  seconds_ago: number | null;
  client: string;
  /** The assistant is on with Claude over MCP chosen. */
  active: boolean;
  /** The MCP session the page polls for tool calls and proposals; null unless active. */
  session_id: string | null;
  /** Tool calls the client has made in the current limit window (`limits.minutes`), against `limits.tool_calls`. */
  tool_calls?: { used: number; limit: number; minutes: number };
}

/** The keys a PUT may carry: what the backend stores, and nothing it adds to a GET (`available`). */
export const ASSISTANT_SETTINGS_KEYS = ["enabled", "agent", "folders", "autonomy", "saving", "visibility", "limits", "keep_log", "sandbox", "model_aliases"] as const;

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
  sandbox: { all_runs: true, require: true },
  model_aliases: {},
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
