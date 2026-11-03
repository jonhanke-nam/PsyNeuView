/**
 * The Assistant tab (#179): the conversation, a text box, Stop, and the
 * state of the turn. Shown only while the assistant is on.
 *
 * Everything from the agent goes through SafeText. Proposals are shown as a
 * before-and-after with Accept and Reject, each and all; free-form Python and
 * its warnings are called out, with what approving means. A stale proposal
 * says so and can only be rejected.
 */

import { useEffect, useRef, useState } from "react";

import { registerCommand } from "@/shortcuts/commands";
import { useAssistantStore } from "@/stores/assistantStore";
import type { AssistantEvent, Proposal } from "@/stores/assistantTypes";
import { pendingProposals } from "@/utils/assistantProposals";
import { Button } from "../common/Button";
import { SafeText } from "./SafeText";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export function AssistantPanel() {
  const items = useAssistantStore((s) => s.items);
  const proposals = useAssistantStore((s) => s.proposals);
  const turn = useAssistantStore((s) => s.turn);
  const lastDone = useAssistantStore((s) => s.lastDone);
  const loadError = useAssistantStore((s) => s.loadError);
  const send = useAssistantStore((s) => s.send);
  const stop = useAssistantStore((s) => s.stop);
  const acceptProposal = useAssistantStore((s) => s.acceptProposal);
  const rejectProposal = useAssistantStore((s) => s.rejectProposal);
  const reviewOffer = useAssistantStore((s) => s.reviewOffer);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // The Stop shortcut (Mod+.) reaches here; it declines when nothing runs.
  useEffect(
    () =>
      registerCommand("assistant.stop", () => {
        if (useAssistantStore.getState().turn === "idle") return;
        void stop();
      }),
    [stop],
  );

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  const submit = () => {
    const text = draft.trim();
    if (!text || turn !== "idle") return;
    setDraft("");
    void send(text);
  };

  const pending = pendingProposals(proposals);
  const state =
    turn === "running" ? "Working…" : turn === "stopping" ? "Stopping…" : lastDone ? doneText(lastDone) : "Ready";

  return (
    <div data-testid="assistant-panel" style={{ display: "flex", flexDirection: "column", height: "100%", fontSize: "var(--pnv-fs-13)" }}>
      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
        {items.length === 0 && (
          <div style={{ color: "var(--pnv-text-muted)", fontSize: "var(--pnv-fs-12)" }}>
            Ask about the open model, or for a change to it. Nothing is changed until you accept a proposal.
          </div>
        )}
        {items.map((item) =>
          item.kind === "user" ? (
            <div key={item.id} data-testid="assistant-user-message" style={{ margin: "6px 0", padding: "6px 10px", background: "var(--pnv-primary-tint)", borderRadius: 6, whiteSpace: "pre-wrap" }}>
              {item.text}
            </div>
          ) : (
            <EventLine key={item.id} event={item.event} proposal={item.event.type === "proposal" ? proposals[item.event.proposal.id] : undefined} onAccept={acceptProposal} onReject={rejectProposal} />
          ),
        )}
        {reviewOffer && <ReviewOfferCard />}
      </div>

      {pending.length > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 12px", borderTop: "1px solid var(--pnv-border-faint)", fontSize: "var(--pnv-fs-12)" }}>
          <span style={{ color: "var(--pnv-text-muted)" }}>{pending.length} proposals waiting</span>
          <Button kind="small" data-testid="assistant-accept-all" onClick={() => void (async () => { for (const p of pending) await acceptProposal(p.id); })()}>
            Accept all
          </Button>
          <Button kind="small" data-testid="assistant-reject-all" onClick={() => void (async () => { for (const p of pending) await rejectProposal(p.id); })()}>
            Reject all
          </Button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", padding: "8px 12px", borderTop: "1px solid var(--pnv-border-faint)", background: "var(--pnv-surface-muted)" }}>
        <textarea
          data-testid="assistant-input"
          value={draft}
          rows={2}
          placeholder="Message the assistant (Enter sends, Shift+Enter for a new line)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          style={{ flex: 1, minWidth: 0, resize: "vertical", padding: "5px 8px", fontSize: "var(--pnv-fs-13)", border: "1px solid var(--pnv-border)", borderRadius: 4, background: "var(--pnv-surface)", font: "inherit" }}
        />
        <Button kind="primary" size="compact" data-testid="assistant-send" disabled={turn !== "idle" || !draft.trim()} onClick={submit}>
          Send
        </Button>
        {/* Stop is always reachable: shown whatever the state, enabled while a turn runs. */}
        <Button kind="danger" data-testid="assistant-stop" disabled={turn === "idle"} onClick={() => void stop()} title="Stop the assistant (⌘.)">
          Stop
        </Button>
      </div>
      <div data-testid="assistant-turn-state" style={{ padding: "2px 12px 6px", fontSize: "var(--pnv-fs-11)", color: loadError ? "var(--pnv-danger)" : "var(--pnv-text-muted)", background: "var(--pnv-surface-muted)" }}>
        {loadError ?? state}
      </div>
    </div>
  );
}

function doneText(ev: AssistantEvent): string {
  if (ev.type !== "done") return "Ready";
  return ev.reason === "stopped" ? "Stopped." : ev.reason === "limit" ? "Stopped at the limit set in Settings." : "Done.";
}

function EventLine({
  event,
  proposal,
  onAccept,
  onReject,
}: {
  event: AssistantEvent;
  proposal?: Proposal;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const quiet = { margin: "4px 0", fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-muted)" } as const;
  switch (event.type) {
    case "text":
      return (
        <div data-testid="assistant-reply" style={{ margin: "6px 0", padding: "6px 10px", background: "var(--pnv-surface-sunken)", borderRadius: 6 }}>
          <SafeText text={event.text} />
        </div>
      );
    case "tool_call":
      return <div style={quiet}>Using {event.tool}…</div>;
    case "tool_result":
      return (
        <div style={quiet}>
          {event.tool}: {event.ok ? "done" : "failed"} — <SafeText text={event.summary} />
        </div>
      );
    case "refused":
      return (
        <div data-testid="assistant-refused" style={{ ...quiet, color: "var(--pnv-warning-text-on-tint)" }}>
          Refused {event.tool}: <SafeText text={event.reason} />
        </div>
      );
    case "proposal":
      return proposal ? <ProposalCard proposal={proposal} onAccept={onAccept} onReject={onReject} /> : null;
    case "error":
      return (
        <div data-testid="assistant-error" style={{ ...quiet, color: "var(--pnv-danger)" }}>
          <SafeText text={event.message} />
        </div>
      );
    case "done":
      return null;
    default:
      return null;
  }
}

function ProposalCard({ proposal, onAccept, onReject }: { proposal: Proposal; onAccept: (id: string) => void; onReject: (id: string) => void }) {
  const p = proposal;
  const pending = p.state === "pending";
  const border = p.state === "stale" ? "var(--pnv-warning-border)" : p.freeform_python ? "var(--pnv-danger-border)" : "var(--pnv-border)";
  return (
    <div data-testid="assistant-proposal" data-state={p.state} style={{ margin: "8px 0", border: `1px solid ${border}`, borderRadius: 6, overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", background: "var(--pnv-surface-muted)", borderBottom: "1px solid var(--pnv-border-faint)" }}>
        <span style={{ fontWeight: 600 }}>{p.kind === "file_write" ? "Write a file" : "Edit the open model"}:</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <SafeText text={p.summary} testId="assistant-proposal-summary" />
        </span>
        <span data-testid="assistant-proposal-state" style={{ fontSize: "var(--pnv-fs-11)", color: p.state === "stale" ? "var(--pnv-warning-text-on-tint)" : "var(--pnv-text-muted)" }}>
          {STATE_WORDS[p.state]}
        </span>
      </div>
      {p.path && (
        <div style={{ padding: "4px 10px", fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-muted)" }}>
          File: <code style={{ fontFamily: MONO }}>{p.path}</code>
        </div>
      )}
      {p.state === "stale" && (
        <div data-testid="assistant-proposal-stale" style={{ padding: "6px 10px", background: "var(--pnv-warning-tint)", color: "var(--pnv-warning-text-on-tint)", fontSize: "var(--pnv-fs-12)" }}>
          The model changed since the assistant read it, so this can't be applied as is. Ask it to look again.
        </div>
      )}
      {p.freeform_python && (
        <div data-testid="assistant-proposal-python-warning" style={{ padding: "6px 10px", background: "var(--pnv-danger-tint)", color: "var(--pnv-danger)", fontSize: "var(--pnv-fs-12)", lineHeight: 1.4 }}>
          <b>This is free-form Python, not a structured edit.</b> Opening or running a model runs its code: approving
          means it may run on this machine with your permissions. The warnings below are the checks that fired; they
          are not a guarantee that nothing else is in it.
          {p.warnings.length > 0 && (
            <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
              {p.warnings.map((w, i) => (
                <li key={i}>
                  <SafeText text={w} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        <Side label="Before" text={p.before} testId="assistant-proposal-before" />
        <Side label="After" text={p.after} testId="assistant-proposal-after" />
      </div>
      <div style={{ display: "flex", gap: 8, padding: "6px 10px", borderTop: "1px solid var(--pnv-border-faint)" }}>
        <Button kind="primary" size="compact" data-testid="assistant-proposal-accept" disabled={!pending} onClick={() => onAccept(p.id)}>
          {p.freeform_python ? "Approve and apply" : "Accept"}
        </Button>
        <Button kind="secondary" size="compact" data-testid="assistant-proposal-reject" disabled={p.state !== "pending" && p.state !== "stale"} onClick={() => onReject(p.id)}>
          Reject
        </Button>
      </div>
    </div>
  );
}

const STATE_WORDS: Record<Proposal["state"], string> = {
  pending: "Waiting for you",
  accepted: "Accepted",
  rejected: "Rejected",
  stale: "Out of date",
};

function Side({ label, text, testId }: { label: string; text: string; testId: string }) {
  return (
    <div style={{ minWidth: 0, borderRight: label === "Before" ? "1px solid var(--pnv-border-faint)" : undefined }}>
      <div style={{ padding: "2px 10px", fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-hint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <pre data-testid={testId} style={{ margin: 0, padding: "4px 10px 8px", fontFamily: MONO, fontSize: "var(--pnv-fs-12)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 220, overflowY: "auto" }}>
        {text}
      </pre>
    </div>
  );
}

/** A model route refused unreviewed assistant-written code: offer to review and approve it. */
function ReviewOfferCard() {
  const offer = useAssistantStore((s) => s.reviewOffer);
  const approve = useAssistantStore((s) => s.approveReviewed);
  const dismiss = useAssistantStore((s) => s.dismissReview);
  if (!offer) return null;
  return (
    <div data-testid="assistant-review-offer" style={{ margin: "8px 0", border: "1px solid var(--pnv-warning-border)", background: "var(--pnv-warning-tint)", borderRadius: 6, padding: "8px 10px", fontSize: "var(--pnv-fs-12)", lineHeight: 1.4 }}>
      <div style={{ fontWeight: 600 }}>This file won't run until you have reviewed it</div>
      <div style={{ marginTop: 4 }}>
        <SafeText text={offer.message} />
        {offer.path && (
          <>
            {" "}
            File: <code style={{ fontFamily: MONO }}>{offer.path}</code>
          </>
        )}
      </div>
      <div style={{ marginTop: 4 }}>
        Read it in the code editor first. Approving means it may run on this machine with your permissions.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <Button kind="primary" size="compact" data-testid="assistant-review-approve" onClick={() => void approve()}>
          I have reviewed it: approve
        </Button>
        <Button kind="secondary" size="compact" data-testid="assistant-review-dismiss" onClick={dismiss}>
          Not now
        </Button>
      </div>
    </div>
  );
}
