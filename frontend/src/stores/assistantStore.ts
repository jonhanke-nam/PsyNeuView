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
import { showGraphLoadRequest } from "@/utils/showGraphLoadRequest";
import { useModelStore } from "./modelStore";
import {
  DEFAULT_ASSISTANT_SETTINGS,
  settingsBody,
  type AssistantEvent,
  type AssistantSettings,
  type ConversationItem,
  type Proposal,
} from "./assistantTypes";

export type TurnState = "idle" | "running" | "stopping";

/** A settings change the backend asked the user to confirm (its 409). */
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

interface AssistantState {
  /** null until asked; false when the deployment lacks the capability (the section hides). */
  available: boolean | null;
  settings: AssistantSettings;
  keySet: boolean;
  loadError: string | null;
  saving: boolean;
  pendingRaise: PendingRaise | null;
  /** Shown the first time the assistant is turned on in this page, before anything is sent. */
  explanation: AssistantSettings | null;

  sessionId: string | null;
  items: ConversationItem[];
  proposals: Record<string, Proposal>;
  next: number;
  turn: TurnState;
  lastDone: AssistantEvent | null;
  /** Tokens the agent's service has reported for this session, against `limits.max_tokens`. */
  tokensUsed: number;
  reviewOffer: ReviewOffer | null;

  load: () => Promise<void>;
  /** Save `next`. A raise is confirmed through `pendingRaise` first, unless `confirmRaise`. */
  save: (next: AssistantSettings, confirmRaise?: boolean) => Promise<boolean>;
  confirmRaise: () => Promise<boolean>;
  cancelRaise: () => void;
  acknowledgeExplanation: () => void;
  setKey: (key: string) => Promise<boolean>;
  clearKey: () => Promise<boolean>;

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
  explanation: null,
  sessionId: null,
  items: [],
  proposals: {},
  next: 0,
  turn: "idle",
  lastDone: null,
  tokensUsed: 0,
  reviewOffer: null,

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
        set({ loadError: `Could not save: ${typeof err.detail === "string" ? err.detail : `HTTP ${resp.status}`}` });
        return false;
      }
      const saved = fromBackend((await readJson(resp)) as Partial<AssistantSettings>);
      const turnedOn = !get().settings.enabled && saved.enabled;
      set({ settings: saved, pendingRaise: null, loadError: null, explanation: turnedOn ? saved : get().explanation });
      record("assistant", turnedOn ? "Assistant turned on" : saved.enabled ? "Assistant settings changed" : "Assistant turned off");
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
  acknowledgeExplanation: () => set({ explanation: null }),

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
}));

/** The settings as the backend sent them, without what it adds to a GET (`available`). */
function fromBackend(body: Partial<AssistantSettings>): AssistantSettings {
  const merged = { ...DEFAULT_ASSISTANT_SETTINGS, ...body };
  return settingsBody({ ...merged, limits: { ...DEFAULT_ASSISTANT_SETTINGS.limits, ...(merged.limits ?? {}) } });
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
    body: JSON.stringify({ file_path: path, ...showGraphLoadRequest() }),
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
