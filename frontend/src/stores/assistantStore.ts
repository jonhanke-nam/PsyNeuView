/**
 * The assistant's state on the page (#179): the settings the backend holds,
 * the conversation, the proposals, and what the turn is doing.
 *
 * Everything the backend decides stays its decision. The page never stores a
 * setting itself, never applies a proposal the backend hasn't accepted, and
 * treats every string from the agent as hostile (utils/safeText.ts). Events
 * are polled as a background request, so the busy wheel never spins for them
 * (busyStore's BACKGROUND list).
 */

import { create } from "zustand";

import { record } from "@/utils/activityLog";
import { applyAppEdit } from "@/utils/assistantApply";
import { contextFor, setProposalState, sha256Hex, withProposal } from "@/utils/assistantProposals";
import { modelLoadOptions } from "@/utils/showGraphLoadRequest";
import { useModelStore } from "./modelStore";
import {
  DEFAULT_ASSISTANT_SETTINGS,
  settingsBody,
  type AssistantEvent,
  type AssistantSettings,
  type ConversationItem,
  type McpSetup,
  type McpStatus,
  type ModelListResponse,
  type Proposal,
  type SandboxStatus,
} from "./assistantTypes";

export type TurnState = "idle" | "running" | "stopping";

/** A settings change the backend asked the user to confirm (`needs_confirmation`). */
export interface PendingRaise {
  next: AssistantSettings;
  raised: string[];
}

/**
 * A model route refused unreviewed assistant-written code (its 409). The
 * page fetches the content, shows it, and approves the hash of what it
 * showed; the backend approves only if the file still hashes to that.
 */
export interface ReviewOffer {
  path: string;
  message: string;
  /** The file's text as fetched for review; null until fetched or when unreadable. */
  content: string | null;
  content_hash: string | null;
  /** Set when the file changed between being shown and being approved. */
  changed: boolean;
  /** Open the file once approved (an open or a reload was what got refused). */
  openAfter: boolean;
}

/** What Test connection answers (#368): `message` is plain English and never the key. */
export interface ConnectionTest {
  ok: boolean;
  agent: string;
  model: string;
  ms: number | null;
  message: string;
}

/**
 * The models the chosen service offers (#370). `forAgent` is the agent and
 * address the list was fetched for; a failed refresh keeps the last list for
 * the same agent and says why.
 */
export interface ModelsState {
  list: ModelListResponse["models"];
  default: string;
  /** null until asked. */
  ok: boolean | null;
  message: string;
  loading: boolean;
  forAgent: string;
}

const NO_MODELS: ModelsState = { list: [], default: "", ok: null, message: "", loading: false, forAgent: "" };

export function agentKey(agent: AssistantSettings["agent"]): string {
  return `${agent.type} ${agent.base_url}`;
}

interface AssistantState {
  /** null until asked; false when the deployment lacks the capability (the section hides). */
  available: boolean | null;
  settings: AssistantSettings;
  keySet: boolean;
  loadError: string | null;
  saving: boolean;
  /** A change that needs consent first (#369): turning on, or a new destination while on. */
  pendingRaise: PendingRaise | null;

  sessionId: string | null;
  items: ConversationItem[];
  proposals: Record<string, Proposal>;
  next: number;
  turn: TurnState;
  lastDone: AssistantEvent | null;
  /** Tokens the agent's service has reported for this session, against `limits.max_tokens`. */
  tokensUsed: number;
  reviewOffer: ReviewOffer | null;
  /** Whether model runs are sandboxed by the operating system (#311); null until asked. */
  sandbox: SandboxStatus | null;

  load: () => Promise<void>;
  loadSandbox: () => Promise<void>;
  /** Save `next`. Turning on, or a new destination while on, is confirmed through `pendingRaise` first, unless `confirmRaise` (#369). */
  save: (next: AssistantSettings, confirmRaise?: boolean) => Promise<boolean>;
  confirmRaise: () => Promise<boolean>;
  cancelRaise: () => void;
  setKey: (key: string) => Promise<boolean>;
  clearKey: () => Promise<boolean>;
  models: ModelsState;
  /** Ask the saved agent's service which models it offers (#370). */
  loadModels: () => Promise<void>;
  /** One small request to the saved agent with the saved key (#368). */
  testConnection: () => Promise<ConnectionTest>;

  send: (text: string) => Promise<void>;
  poll: () => Promise<void>;
  stop: () => Promise<void>;
  acceptProposal: (id: string) => Promise<void>;
  /** Accept exactly `ids`, the proposals on screen when "Accept all" was pressed; one that arrives meanwhile waits. */
  acceptMany: (ids: string[]) => Promise<void>;
  rejectProposal: (id: string) => Promise<void>;
  /** Fetch the file's content for review and show the offer. */
  offerReview: (offer: { path: string; message: string; openAfter?: boolean }) => Promise<void>;
  approveReviewed: () => Promise<void>;
  dismissReview: () => void;

  /** Claude over MCP (#201): the setup text with the token; null until fetched. */
  mcpSetup: McpSetup | null;
  mcpSetupError: string | null;
  mcpStatus: McpStatus | null;
  loadMcpSetup: () => Promise<void>;
  /** A new connection token: clients set up with the old one are refused from now on. */
  replaceMcpToken: () => Promise<void>;
  loadMcpStatus: () => Promise<McpStatus | null>;
  /** Share the open model, as far as visibility allows, for Claude's read_open_model. */
  shareMcpContext: () => Promise<void>;
  /** While the agent is Claude over MCP: follow its session's tool calls and proposals. Returns a stop function. */
  watchMcp: () => () => void;
}

let itemSeq = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
/** One poll at a time: a second caller joins the one in flight. */
let pollInFlight: Promise<void> | null = null;

async function readJson(resp: Response): Promise<Record<string, unknown>> {
  try {
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** What a 409 names as raised: `detail.raised`, `raised`, or the detail's text. */
function raisedFrom(body: Record<string, unknown>): string[] {
  const detail = body.detail;
  if (detail && typeof detail === "object" && Array.isArray((detail as { raised?: unknown }).raised)) {
    return ((detail as { raised: unknown[] }).raised).map(String);
  }
  if (Array.isArray(body.raised)) return body.raised.map(String);
  if (typeof detail === "string") return [detail];
  return ["a permission"];
}

export const useAssistantStore = create<AssistantState>((set, get) => ({
  available: null,
  settings: DEFAULT_ASSISTANT_SETTINGS,
  keySet: false,
  loadError: null,
  saving: false,
  pendingRaise: null,
  sessionId: null,
  items: [],
  proposals: {},
  next: 0,
  turn: "idle",
  lastDone: null,
  tokensUsed: 0,
  reviewOffer: null,
  sandbox: null,

  loadSandbox: async () => {
    try {
      const resp = await fetch("/api/assistant/sandbox");
      if (resp.ok) set({ sandbox: (await readJson(resp)) as unknown as SandboxStatus });
    } catch {
      // The section says nothing rather than something wrong.
    }
  },

  load: async () => {
    try {
      const resp = await fetch("/api/assistant/settings");
      if (!resp.ok) {
        // 403 and 404: the deployment lacks the capability, or the backend
        // predates the assistant. Either way there is nothing to show.
        set({ available: false, loadError: null });
        return;
      }
      const body = (await readJson(resp)) as Partial<AssistantSettings> & { available?: boolean };
      if (body.available === false) {
        // The backend answers, but this deployment has no assistant.
        set({ available: false, loadError: null });
        return;
      }
      set({ available: true, settings: fromBackend(body), loadError: null });
      void get().loadSandbox();
      const key = await fetch("/api/assistant/key");
      if (key.ok) set({ keySet: Boolean(((await readJson(key)) as { set?: boolean }).set) });
    } catch (e) {
      set({ available: false, loadError: String(e) });
    }
  },

  save: async (next, confirmRaise = false) => {
    set({ saving: true });
    try {
      const body = settingsBody(next);
      const resp = await fetch("/api/assistant/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmRaise ? { ...body, confirm_raise: true } : body),
      });
      if (resp.status === 409) {
        set({ pendingRaise: { next, raised: raisedFrom(await readJson(resp)) } });
        return false;
      }
      if (!resp.ok) {
        const err = await readJson(resp);
        const detail = err.detail as string | { message?: string } | undefined;
        const message = typeof detail === "string" ? detail : detail && typeof detail.message === "string" ? detail.message : `HTTP ${resp.status}`;
        set({ loadError: `Could not save: ${message}` });
        return false;
      }
      const data = await readJson(resp);
      // Nothing was saved: the change raises a permission and needs the user's OK (#367).
      if (data.needs_confirmation === true) {
        set({ pendingRaise: { next, raised: raisedFrom(data) } });
        return false;
      }
      const saved = fromBackend(data as Partial<AssistantSettings>);
      const turnedOn = !get().settings.enabled && saved.enabled;
      set({ settings: saved, pendingRaise: null, loadError: null });
      record("assistant", turnedOn ? "Assistant turned on" : saved.enabled ? "Assistant settings changed" : "Assistant turned off");
      void get().loadSandbox();
      return true;
    } catch (e) {
      set({ loadError: String(e) });
      return false;
    } finally {
      set({ saving: false });
    }
  },

  confirmRaise: async () => {
    const pending = get().pendingRaise;
    if (!pending) return false;
    return get().save(pending.next, true);
  },

  cancelRaise: () => set({ pendingRaise: null }),

  setKey: async (key) => {
    const resp = await fetch("/api/assistant/key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (resp.ok) {
      set({ keySet: true });
      record("assistant", "API key set");
    }
    return resp.ok;
  },

  models: NO_MODELS,

  loadModels: async () => {
    const agent = get().settings.agent;
    const key = agentKey(agent);
    if (agent.type === "none") {
      set({ models: NO_MODELS });
      return;
    }
    const before = get().models.forAgent === key ? get().models : { ...NO_MODELS, forAgent: key };
    set({ models: { ...before, loading: true } });
    let body: Partial<ModelListResponse> = {};
    try {
      const resp = await fetch("/api/assistant/models");
      body = (await readJson(resp)) as Partial<ModelListResponse>;
      if (!resp.ok) body = { ok: false, message: `The list couldn't be fetched (HTTP ${resp.status})` };
    } catch {
      body = { ok: false, message: "Couldn't reach PsyNeuView's backend" };
    }
    // The agent changed while this was in flight: its answer is for another one.
    if (agentKey(get().settings.agent) !== key) return;
    const ok = body.ok === true && Array.isArray(body.models);
    set({
      models: {
        list: ok ? body.models! : before.list,
        default: typeof body.default === "string" ? body.default : before.default,
        ok,
        message: typeof body.message === "string" ? body.message : "",
        loading: false,
        forAgent: key,
      },
    });
  },

  testConnection: async () => {
    const failed = (message: string): ConnectionTest => ({ ok: false, agent: get().settings.agent.type, model: get().settings.agent.model, ms: null, message });
    try {
      const resp = await fetch("/api/assistant/test-connection", { method: "POST" });
      const body = await readJson(resp);
      if (!resp.ok || typeof body.message !== "string") {
        const detail = body.detail;
        const why = detail && typeof detail === "object" ? String((detail as { message?: unknown }).message ?? "") : String(detail ?? "");
        return failed(why || `The test couldn't run (HTTP ${resp.status})`);
      }
      const result = body as unknown as ConnectionTest;
      record("assistant", result.ok ? "Test connection: connected" : "Test connection: failed");
      return result;
    } catch {
      return failed("Couldn't reach PsyNeuView's backend");
    }
  },

  clearKey: async () => {
    const resp = await fetch("/api/assistant/key", { method: "DELETE" });
    if (resp.ok) {
      set({ keySet: false });
      record("assistant", "API key removed");
    }
    return resp.ok;
  },

  send: async (text) => {
    const { settings } = get();
    let sessionId = get().sessionId;
    if (!sessionId) {
      const resp = await fetch("/api/assistant/sessions", { method: "POST" });
      if (!resp.ok) {
        set({ loadError: `Could not start a session: HTTP ${resp.status}` });
        return;
      }
      sessionId = String(((await readJson(resp)) as { id?: string }).id ?? "");
      set({ sessionId, next: 0, tokensUsed: 0 });
    }
    const model = useModelStore.getState();
    const context = contextFor(settings, {
      filePath: model.filePath,
      source: model.source,
      selection: model.selectedNodeId ?? null,
      errors: [],
    });
    set((s) => ({ items: [...s.items, { kind: "user", id: `u${itemSeq++}`, text }], turn: "running", lastDone: null }));
    record("assistant", "Message sent");
    const resp = await fetch(`/api/assistant/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, context }),
    });
    if (!resp.ok) {
      set({ turn: "idle", loadError: `The assistant did not take the message: HTTP ${resp.status}` });
      return;
    }
    void get().poll();
  },

  poll: () => {
    if (pollInFlight) return pollInFlight;
    pollInFlight = pollOnce().finally(() => {
      pollInFlight = null;
    });
    return pollInFlight;
  },
  stop: async () => {
    const { sessionId, turn } = get();
    if (!sessionId || turn === "idle") return;
    set({ turn: "stopping" });
    record("assistant", "Stop pressed");
    await fetch(`/api/assistant/sessions/${sessionId}/stop`, { method: "POST" }).catch(() => undefined);
    void get().poll();
  },

  acceptProposal: async (id) => {
    const proposal = get().proposals[id];
    if (!proposal || proposal.state !== "pending") return;
    // An app edit is checked against the source the agent read; a file write
    // against the file's text the agent read (its base_hash); an open has
    // nothing to check.
    const current_hash =
      proposal.kind === "app_edit" ? await sha256Hex(useModelStore.getState().source) : proposal.base_hash;
    const resp = await fetch(`/api/assistant/proposals/${id}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_hash }),
    });
    if (resp.status === 409) {
      // `detail.reason`: "stale" (the source or file changed since the agent
      // looked), or a file rule the write failed (the proposal is rejected).
      const body = await readJson(resp);
      const detail = (body.detail && typeof body.detail === "object" ? body.detail : {}) as { reason?: string; message?: string };
      const stale = !detail.reason || detail.reason === "stale";
      set((s) => ({
        proposals: setProposalState(s.proposals, id, stale ? "stale" : "rejected"),
        loadError: stale ? s.loadError : `The file write was refused: ${detail.message ?? detail.reason}`,
      }));
      record("assistant", `Proposal ${stale ? "stale" : "refused"}: ${id}`);
      return;
    }
    if (!resp.ok) {
      set({ loadError: `Could not accept the proposal: HTTP ${resp.status}` });
      return;
    }
    if (proposal.kind === "app_edit") {
      try {
        await applyAppEdit(proposal);
      } catch (e) {
        set({ loadError: `The edit was not applied: ${e instanceof Error ? e.message : String(e)}` });
        record("assistant", `Proposal accepted but not applied: ${id}`);
        return;
      }
    }
    set((s) => ({ proposals: setProposalState(s.proposals, id, "accepted") }));
    record("assistant", `Proposal accepted: ${id}`);
    if (proposal.kind === "open_file" && proposal.path) {
      // Opening runs the file, so the same guard every open has applies: an
      // unreviewed file answers 409 and the review offer appears instead.
      await openModelPath(proposal.path);
    }
  },

  acceptMany: async (ids) => {
    const snapshot = [...ids];
    record("assistant", `Accept all: ${snapshot.length} proposals`);
    for (const id of snapshot) await get().acceptProposal(id);
  },

  rejectProposal: async (id) => {
    await fetch(`/api/assistant/proposals/${id}/reject`, { method: "POST" }).catch(() => undefined);
    set((s) => ({ proposals: setProposalState(s.proposals, id, "rejected") }));
    record("assistant", `Proposal rejected: ${id}`);
  },

  offerReview: async ({ path, message, openAfter = true }) => {
    // Shown exactly what an approval covers: the content as it is on disk,
    // and the hash of that content is what approve sends.
    set({ reviewOffer: { path, message, content: null, content_hash: null, changed: false, openAfter } });
    const status = await fetchReviewStatus(path);
    set((s) => (s.reviewOffer?.path === path ? { reviewOffer: { ...s.reviewOffer, ...status } } : {}));
  },

  approveReviewed: async () => {
    const offer = get().reviewOffer;
    if (!offer || !offer.content_hash) return;
    const resp = await fetch("/api/assistant/review/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: offer.path, content_hash: offer.content_hash }),
    });
    if (resp.status === 409) {
      // `assistant_code_changed`: the file isn't what was shown. Show what it is now.
      const status = await fetchReviewStatus(offer.path);
      set({ reviewOffer: { ...offer, ...status, changed: true } });
      record("assistant", "Review: the file changed since it was shown");
      return;
    }
    if (!resp.ok) {
      set({ loadError: `Could not record the review: HTTP ${resp.status}` });
      return;
    }
    record("assistant", "Assistant-written file approved after review");
    set({ reviewOffer: null });
    if (offer.openAfter) await openModelPath(offer.path);
  },

  dismissReview: () => set({ reviewOffer: null }),

  mcpSetup: null,
  mcpSetupError: null,
  mcpStatus: null,

  loadMcpSetup: async () => {
    try {
      const resp = await fetch("/api/assistant/mcp/setup");
      const body = await readJson(resp);
      if (!resp.ok) {
        const detail = body.detail;
        set({ mcpSetupError: typeof detail === "string" ? detail : `The setup couldn't be fetched (HTTP ${resp.status})` });
        return;
      }
      set({ mcpSetup: body as unknown as McpSetup, mcpSetupError: null });
    } catch {
      set({ mcpSetupError: "Couldn't reach PsyNeuView's backend" });
    }
  },

  replaceMcpToken: async () => {
    const resp = await fetch("/api/assistant/mcp/token", { method: "POST" });
    if (resp.ok) {
      set({ mcpSetup: (await readJson(resp)) as unknown as McpSetup, mcpSetupError: null });
      record("assistant", "MCP connection token replaced");
    }
  },

  loadMcpStatus: async () => {
    try {
      const resp = await fetch("/api/assistant/mcp/status");
      if (!resp.ok) return null;
      const status = (await readJson(resp)) as unknown as McpStatus;
      set({ mcpStatus: status });
      return status;
    } catch {
      return null;
    }
  },

  shareMcpContext: async () => {
    const { settings } = get();
    if (!settings.enabled || settings.agent.type !== "claude_mcp") return;
    const model = useModelStore.getState();
    const context = contextFor(settings, {
      filePath: model.filePath,
      source: model.source,
      selection: model.selectedNodeId ?? null,
      errors: [],
    });
    await fetch("/api/assistant/mcp/context", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context }),
    }).catch(() => undefined);
  },

  watchMcp: () => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (stopped) return;
      const status = await get().loadMcpStatus();
      const sid = status?.session_id ?? null;
      if (sid && sid !== get().sessionId) {
        // A new MCP session (the backend restarted): start its conversation afresh.
        set({ sessionId: sid, next: 0, items: [], proposals: {}, lastDone: null, tokensUsed: 0 });
      }
      if (sid) await get().poll();
      if (!stopped) timer = setTimeout(() => void tick(), MCP_POLL_MS);
    };
    void get().shareMcpContext();
    void tick();
    // Share the open model again whenever it, or the selection, changes.
    let shareTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useModelStore.subscribe((m, prev) => {
      if (m.source === prev.source && m.filePath === prev.filePath && m.selectedNodeId === prev.selectedNodeId) return;
      if (shareTimer) clearTimeout(shareTimer);
      shareTimer = setTimeout(() => void get().shareMcpContext(), 300);
    });
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (shareTimer) clearTimeout(shareTimer);
      unsubscribe();
    };
  },
}));

/** How often the Assistant tab asks for Claude's tool calls and proposals while Claude over MCP is the agent. */
const MCP_POLL_MS = 1500;

/** The settings as the backend sent them, without what it adds to a GET (`available`). */
function fromBackend(body: Partial<AssistantSettings>): AssistantSettings {
  const merged = { ...DEFAULT_ASSISTANT_SETTINGS, ...body };
  return settingsBody({
    ...merged,
    limits: { ...DEFAULT_ASSISTANT_SETTINGS.limits, ...(merged.limits ?? {}) },
    sandbox: { ...DEFAULT_ASSISTANT_SETTINGS.sandbox, ...(merged.sandbox ?? {}) },
  });
}

async function fetchReviewStatus(path: string): Promise<Pick<ReviewOffer, "content" | "content_hash">> {
  try {
    const resp = await fetch("/api/assistant/review/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const body = (await readJson(resp)) as { content?: string; content_hash?: string };
    if (!resp.ok) return { content: null, content_hash: null };
    return { content: typeof body.content === "string" ? body.content : null, content_hash: body.content_hash ?? null };
  } catch {
    return { content: null, content_hash: null };
  }
}

/**
 * Open a model file the way the Open menu does, from the assistant: an
 * accepted `open_file`, or a file just approved. The 409 an unreviewed file
 * answers is turned into the review offer by `noteUnreviewedResponse`.
 */
export async function openModelPath(path: string): Promise<boolean> {
  const resp = await fetch("/api/model/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The view on screen, nested or not (#257), as the Open menu sends it.
    body: JSON.stringify({ file_path: path, ...modelLoadOptions() }),
  });
  if (!resp.ok) {
    if (resp.status !== 409) {
      useAssistantStore.setState({ loadError: `Could not open ${path.split("/").pop()}: HTTP ${resp.status}` });
    }
    return false;
  }
  // The same fields the Open menu reads from this route.
  const data = (await readJson(resp)) as { source?: string; model?: any; layout?: any; labels?: any; bundle?: any; sidecars?: any };
  const store = useModelStore.getState();
  store.markFreshOpen();
  store.setFilePath(path);
  store.setSource(data.source ?? "");
  store.loadModelFromServer(data.model, data.layout, data.labels, data.bundle, data.sidecars);
  record("assistant", `Opened ${path}`);
  return true;
}


async function pollOnce(): Promise<void> {
  const get = useAssistantStore.getState;
  const set = useAssistantStore.setState;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  const { sessionId, next } = get();
  if (!sessionId) return;
  let running = false;
  try {
    const resp = await fetch(`/api/assistant/sessions/${sessionId}/events?after=${next}`);
    if (!resp.ok) {
      set({ turn: "idle", loadError: `Lost the conversation: HTTP ${resp.status}` });
      return;
    }
    const body = (await readJson(resp)) as { events?: AssistantEvent[]; next?: number; running?: boolean; tokens_used?: number };
    // Only what is new: an answer that overlaps (a retry, a slow one) is not shown twice.
    const events = (body.events ?? []).filter((ev) => ev.seq > next);
    running = Boolean(body.running);
    set((s) => {
      let proposals = s.proposals;
      let lastDone = s.lastDone;
      for (const ev of events) {
        if (ev.type === "proposal") {
          proposals = withProposal(proposals, ev.proposal);
          record("assistant", `Proposal ${ev.proposal.kind}: ${ev.proposal.id}`);
        } else if (ev.type === "tool_call") record("assistant", `Tool call: ${ev.tool}`);
        else if (ev.type === "refused") record("assistant", `Tool refused: ${ev.tool}`);
        else if (ev.type === "done") {
          lastDone = ev;
          record("assistant", `Turn ${ev.reason}`);
        }
      }
      return {
        items: [...s.items, ...events.map((event) => ({ kind: "event" as const, id: `e${event.seq}`, event }))],
        proposals,
        next: body.next ?? s.next,
        turn: running ? (s.turn === "stopping" ? "stopping" : "running") : "idle",
        lastDone,
        tokensUsed: typeof body.tokens_used === "number" ? body.tokens_used : s.tokensUsed,
      };
    });
  } catch (e) {
    set({ turn: "idle", loadError: String(e) });
    return;
  }
  if (running) pollTimer = setTimeout(() => void get().poll(), 500);
}

/**
 * The 409 every model route may answer with (#179): unreviewed
 * assistant-written code. Installed once over fetch by busyStore's wrapper,
 * so no route has to remember to check. Returns true when it was one.
 */
export async function noteUnreviewedResponse(path: string, resp: Response): Promise<boolean> {
  if (resp.status !== 409 || !path.startsWith("/api/model/")) return false;
  const body = await readJson(resp.clone());
  const detail: Record<string, unknown> =
    body.detail && typeof body.detail === "object" ? (body.detail as Record<string, unknown>) : body;
  if (detail.reason !== "assistant_code_unreviewed") return false;
  void useAssistantStore.getState().offerReview({
    path: String(detail.path ?? ""),
    message: String(detail.message ?? detail.detail ?? "This file holds code the assistant wrote that nobody has reviewed yet."),
    // A save answers 409 after writing: the file is on disk and the model
    // wasn't rebuilt. Approving then reloads it, as any other refused open.
    openAfter: true,
  });
  return true;
}
