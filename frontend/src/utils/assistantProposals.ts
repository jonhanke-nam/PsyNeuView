/**
 * Proposal logic with no React in it (#179): which settings changes need
 * consent (#369), what the page sends as context, and the state changes a
 * proposal goes through.
 */

import type { AssistantContext, AssistantSettings, Proposal } from "@/stores/assistantTypes";

/**
 * What in `next` needs the user's consent before it is saved (#369): turning
 * the assistant on, or, while it stays on, sending messages somewhere new.
 * Everything else saves directly. The backend is the judge (it answers
 * `needs_confirmation`); this is the same rule, so the page can say the same.
 */
export function needsConsent(prev: AssistantSettings, next: AssistantSettings): string[] {
  if (!prev.enabled && next.enabled) return ["turning the assistant on", `sending messages to ${destination(next.agent)}`];
  const moved = next.agent.type !== prev.agent.type || next.agent.base_url !== prev.agent.base_url;
  const sends = next.agent.type === "anthropic" || Boolean(next.agent.base_url);
  if (prev.enabled && next.enabled && moved && sends) {
    return [`sending messages to ${destination(next.agent)} instead of ${destination(prev.agent)}`];
  }
  return [];
}

/**
 * What to call the model in use (#370): the user's alias, else the service's
 * display name, else the id. A blank model is the service's default: for
 * Anthropic that is `defaultId`.
 */
export function modelLabel(
  settings: AssistantSettings,
  models: { id: string; display_name: string }[],
  defaultId = "",
): string {
  if (settings.agent.type === "none") return "";
  const id = settings.agent.model || (settings.agent.type === "anthropic" ? defaultId || ANTHROPIC_DEFAULT_MODEL : "");
  if (!id) return "the server's default model";
  const alias = settings.model_aliases[id];
  if (alias) return `${alias} (${id})`;
  return models.find((m) => m.id === id)?.display_name ?? id;
}

/** The backend's default Claude model when none is chosen (agents.DEFAULT_ANTHROPIC_MODEL). */
export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5";

/** The host messages go to, for a short summary: "api.anthropic.com", "localhost:11434". */
export function destinationHost(agent: AssistantSettings["agent"]): string | null {
  if (agent.type === "none") return null;
  const where = destination(agent);
  try {
    return new URL(where).host || where;
  } catch {
    return null;
  }
}

/** What leaves the page with each message, in plain words: typed text plus what `visibility` allows. */
export function sharedWords(settings: AssistantSettings): string {
  const sees = (Object.keys(VISIBILITY_WORDS) as (keyof typeof VISIBILITY_WORDS)[])
    .filter((k) => settings.visibility[k])
    .map((k) => VISIBILITY_WORDS[k]);
  return sees.length ? `what you type, and your ${sees.join(", ")}` : "what you type, and nothing else";
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

export const ANTHROPIC_URL = "https://api.anthropic.com";

/** The real address messages go to for `agent`, as the backend sees it. */
export function destination(agent: AssistantSettings["agent"]): string {
  if (agent.type === "anthropic") return agent.base_url || ANTHROPIC_URL;
  if (agent.type === "openai_compatible") return agent.base_url || "(no server address yet)";
  return "nowhere (no agent)";
}

/** Where a message goes, for the chosen agent: said in Settings, in plain words, with the real address. */
export function whereDataGoes(agent: AssistantSettings["agent"]): string {
  switch (agent.type) {
    case "anthropic":
      return agent.base_url
        ? `Messages and the context you allow are sent to ${agent.base_url}, not to Anthropic's own API, with your API key. Only use an address you trust with that key.`
        : `Messages and the context you allow are sent to Anthropic's API (${ANTHROPIC_URL}) over the internet, under your own API key and Anthropic's terms.`;
    case "openai_compatible":
      return agent.base_url
        ? `Messages and the context you allow are sent to ${agent.base_url}. If that is on this machine, nothing leaves it; otherwise it goes wherever that server is.`
        : "Messages and the context you allow are sent to the server address you give below.";
    default:
      return "No agent is chosen, so nothing is sent anywhere.";
  }
}
