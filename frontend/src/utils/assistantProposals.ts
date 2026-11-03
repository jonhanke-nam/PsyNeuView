/**
 * Proposal logic with no React in it (#179): which permissions a settings
 * change raises, what the page sends as context, and the state changes a
 * proposal goes through.
 */

import type { AssistantContext, AssistantSettings, Proposal } from "@/stores/assistantTypes";

const AUTONOMY_RANK = { answer: 0, suggest: 1, app_edits: 2 } as const;

/**
 * The permissions `next` raises over `prev`, in plain words. The backend is
 * the judge (its 409 names them); this is the same list, so the page can
 * ask before sending and say the same thing the backend would.
 */
export function raisedPermissions(prev: AssistantSettings, next: AssistantSettings): string[] {
  const raised: string[] = [];
  if (!prev.enabled && next.enabled) raised.push("turn the assistant on");
  if (AUTONOMY_RANK[next.autonomy] > AUTONOMY_RANK[prev.autonomy]) {
    raised.push(next.autonomy === "app_edits" ? "let it propose edits to the open model" : "let it make suggestions");
  }
  if (prev.saving === "always_ask" && next.saving === "structured_without_asking") {
    raised.push("let it save structured edits without asking");
  }
  for (const key of ["model", "selection", "errors", "results", "files"] as const) {
    if (!prev.visibility[key] && next.visibility[key]) raised.push(`show it your ${VISIBILITY_WORDS[key]}`);
  }
  for (const f of next.folders) {
    const before = prev.folders.find((p) => p.path === f.path);
    if (!before) raised.push(`give it ${f.access === "read_write" ? "read and write" : "read"} access to ${f.path}`);
    else if (before.access === "read" && f.access === "read_write") raised.push(`let it write in ${f.path}`);
  }
  if (next.limits.tool_calls > prev.limits.tool_calls) raised.push("allow more tool calls per turn");
  if (next.limits.minutes > prev.limits.minutes) raised.push("allow longer turns");
  if (next.limits.max_tokens > prev.limits.max_tokens) raised.push("allow more spending (tokens) per session");
  return raised;
}

export const VISIBILITY_WORDS = {
  model: "open model",
  selection: "selection",
  errors: "errors",
  results: "run results",
  files: "model files in the allowed folders",
} as const;

/** Only what `visibility` allows leaves the page; the backend drops the rest again. */
export function contextFor(
  settings: AssistantSettings,
  page: { filePath: string | null; source: string; selection: string | null; errors: string[] },
): AssistantContext {
  const ctx: AssistantContext = {};
  if (settings.visibility.model) {
    ctx.file_path = page.filePath;
    ctx.source = page.source;
  }
  if (settings.visibility.selection) ctx.selection = page.selection;
  if (settings.visibility.errors) ctx.errors = page.errors;
  return ctx;
}

/** The proposals in `events`, newest state winning, by id. */
export function withProposal(proposals: Record<string, Proposal>, proposal: Proposal): Record<string, Proposal> {
  return { ...proposals, [proposal.id]: proposal };
}

export function setProposalState(
  proposals: Record<string, Proposal>,
  id: string,
  state: Proposal["state"],
): Record<string, Proposal> {
  const p = proposals[id];
  if (!p) return proposals;
  return { ...proposals, [id]: { ...p, state } };
}

/** Pending proposals, in the order they arrived. */
export function pendingProposals(proposals: Record<string, Proposal>): Proposal[] {
  return Object.values(proposals).filter((p) => p.state === "pending");
}

/** SHA-256 of `text`, hex, as the backend hashes the source it last read. */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Where a message goes, for the chosen agent: said in Settings, in plain words. */
export function whereDataGoes(agent: AssistantSettings["agent"]): string {
  switch (agent.type) {
    case "anthropic":
      return "Messages and the context you allow are sent to Anthropic's API over the internet, under your own API key and Anthropic's terms.";
    case "openai_compatible":
      return agent.base_url
        ? `Messages and the context you allow are sent to ${agent.base_url}. If that is on this machine, nothing leaves it; otherwise it goes wherever that server is.`
        : "Messages and the context you allow are sent to the server address you give below.";
    default:
      return "No agent is chosen, so nothing is sent anywhere.";
  }
}
