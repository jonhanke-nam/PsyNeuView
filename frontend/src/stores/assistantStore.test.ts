/**
 * The assistant store against a stubbed backend (#179): availability, the
 * 409 raise flow, the first-time explanation, the write-only key, sending
 * with only the allowed context, polling, Stop, and a stale proposal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_ASSISTANT_SETTINGS } from "./assistantTypes";
import { noteUnreviewedResponse, useAssistantStore } from "./assistantStore";
import { useModelStore } from "./modelStore";

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let answers: Record<string, (init?: RequestInit) => Response> = {};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  calls = [];
  answers = {};
  useAssistantStore.setState({
    available: null, settings: DEFAULT_ASSISTANT_SETTINGS, keySet: false, loadError: null, saving: false,
    pendingRaise: null, explanation: null, sessionId: null, items: [], proposals: {}, next: 0, turn: "idle",
    lastDone: null, reviewOffer: null,
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = `${(init?.method ?? "GET").toUpperCase()} ${url.split("?")[0]}`;
    const answer = answers[key];
    return answer ? answer(init) : json({ detail: "not stubbed" }, 404);
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe("assistantStore (#179)", () => {
  it("is unavailable when the backend has no assistant", async () => {
    await useAssistantStore.getState().load();
    expect(useAssistantStore.getState().available).toBe(false);
  });

  it("loads settings and whether a key is set, never the key", async () => {
    answers["GET /api/assistant/settings"] = () => json({ ...DEFAULT_ASSISTANT_SETTINGS, enabled: true });
    answers["GET /api/assistant/key"] = () => json({ set: true });
    await useAssistantStore.getState().load();
    const s = useAssistantStore.getState();
    expect(s.available).toBe(true);
    expect(s.settings.enabled).toBe(true);
    expect(s.keySet).toBe(true);
  });

  it("asks before a raise, then sends confirm_raise, and explains the first time it is on", async () => {
    answers["PUT /api/assistant/settings"] = (init) => {
      const body = JSON.parse(String(init?.body));
      if (body.enabled && !body.confirm_raise) return json({ detail: { raised: ["turn the assistant on"] } }, 409);
      return json({ ...DEFAULT_ASSISTANT_SETTINGS, enabled: body.enabled });
    };
    const ok = await useAssistantStore.getState().save({ ...DEFAULT_ASSISTANT_SETTINGS, enabled: true });
    expect(ok).toBe(false);
    expect(useAssistantStore.getState().pendingRaise?.raised).toEqual(["turn the assistant on"]);
    expect(useAssistantStore.getState().settings.enabled).toBe(false);

    expect(await useAssistantStore.getState().confirmRaise()).toBe(true);
    const sent = JSON.parse(String(calls[calls.length - 1].init?.body));
    expect(sent.confirm_raise).toBe(true);
    const s = useAssistantStore.getState();
    expect(s.settings.enabled).toBe(true);
    expect(s.pendingRaise).toBeNull();
    expect(s.explanation?.enabled).toBe(true);
    s.acknowledgeExplanation();
    expect(useAssistantStore.getState().explanation).toBeNull();
  });

  it("keeps the old settings when the raise is cancelled", async () => {
    answers["PUT /api/assistant/settings"] = () => json({ detail: { raised: ["x"] } }, 409);
    await useAssistantStore.getState().save({ ...DEFAULT_ASSISTANT_SETTINGS, autonomy: "app_edits" });
    useAssistantStore.getState().cancelRaise();
    expect(useAssistantStore.getState().settings.autonomy).toBe("suggest");
    expect(useAssistantStore.getState().pendingRaise).toBeNull();
  });

  it("sends only the context visibility allows, polls, and stops", async () => {
    useAssistantStore.setState({
      settings: { ...DEFAULT_ASSISTANT_SETTINGS, enabled: true, visibility: { ...DEFAULT_ASSISTANT_SETTINGS.visibility, model: false } },
    });
    useModelStore.setState({ filePath: "/m.py", source: "secret = 1" });
    answers["POST /api/assistant/sessions"] = () => json({ id: "s1" });
    answers["POST /api/assistant/sessions/s1/messages"] = () => json({ turn_id: "t1" });
    let stopped = false;
    answers["GET /api/assistant/sessions/s1/events"] = (init) => {
      const after = Number(new URL(calls[calls.length - 1].url, "http://x").searchParams.get("after"));
      void init;
      if (!stopped) return json({ events: after < 1 ? [{ seq: 1, t: "", type: "text", text: "hi" }] : [], next: 1, running: true });
      return json({ events: after < 2 ? [{ seq: 2, t: "", type: "done", reason: "stopped" }] : [], next: 2, running: false });
    };
    answers["POST /api/assistant/sessions/s1/stop"] = () => {
      stopped = true;
      return json({});
    };

    await useAssistantStore.getState().send("hello");
    await useAssistantStore.getState().poll();
    const msg = calls.find((c) => c.url.endsWith("/messages"));
    const body = JSON.parse(String(msg?.init?.body));
    expect(body.text).toBe("hello");
    expect(body.context.source).toBeUndefined();
    expect(body.context.file_path).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("secret");

    let s = useAssistantStore.getState();
    expect(s.turn).toBe("running");
    expect(s.items.map((i) => i.kind)).toEqual(["user", "event"]);

    await s.stop();
    await useAssistantStore.getState().poll();
    s = useAssistantStore.getState();
    expect(calls.some((c) => c.url.endsWith("/stop"))).toBe(true);
    expect(s.turn).toBe("idle");
    expect(s.lastDone?.type).toBe("done");
  });

  it("marks a proposal stale on the accept 409 and never applies it", async () => {
    useModelStore.setState({ source: "x = 1" });
    useAssistantStore.setState({
      proposals: {
        p1: { id: "p1", kind: "app_edit", summary: "s", state: "pending", base_hash: "old", ops: [], path: null, before: "x = 1", after: "x = 2", freeform_python: false, warnings: [] },
      },
    });
    answers["POST /api/assistant/proposals/p1/accept"] = () => json({ detail: "stale" }, 409);
    await useAssistantStore.getState().acceptProposal("p1");
    expect(useAssistantStore.getState().proposals.p1.state).toBe("stale");
    expect(useModelStore.getState().source).toBe("x = 1");
    const accept = calls.find((c) => c.url.endsWith("/accept"));
    expect(JSON.parse(String(accept?.init?.body)).current_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("offers a review on a model route's unreviewed-code 409, and nothing else", async () => {
    expect(await noteUnreviewedResponse("/api/model/load", json({ detail: { reason: "other" } }, 409))).toBe(false);
    expect(await noteUnreviewedResponse("/api/other", json({ detail: { reason: "assistant_code_unreviewed" } }, 409))).toBe(false);
    expect(
      await noteUnreviewedResponse("/api/model/load", json({ detail: { reason: "assistant_code_unreviewed", path: "/m.py" } }, 409)),
    ).toBe(true);
    expect(useAssistantStore.getState().reviewOffer?.path).toBe("/m.py");
    useAssistantStore.getState().dismissReview();
    expect(useAssistantStore.getState().reviewOffer).toBeNull();
  });
});
