/**
 * The first-launch offer of **PsyNeuView First Steps** (#1310).
 *
 * Shown once, the first time PsyNeuView opens in this browser, a moment after
 * the page is up so it never lands over a model still loading. Three answers,
 * all remembered per browser (`utils/orientationOffer.ts` decides; this only
 * draws): Start part 1; Maybe later, which leaves a reminder in the Tutorials
 * menu; No thanks. Escape and the × mean Maybe later: nothing is lost, and the
 * reminder stays. Clicking outside also closes it the same way.
 *
 * Deliberately not a native window and not a second settings surface: the
 * walkthroughs stay in the Tutorials menu either way, and nothing here is a
 * setting (docs/settings-and-mac-app.md).
 */

import { useEffect, useState } from "react";

import { DialogHeader } from "@/components/common/dialog/DialogHeader";
import { useDismiss } from "@/components/common/dialog/useDismiss";
import { useTourStore } from "@/stores/tourStore";
import { readOfferChoice, shouldOfferOrientation, writeOfferChoice } from "@/utils/orientationOffer";
import { orientationWalkthroughs } from "@/utils/tourStep";
import { Button } from "@/components/common/Button";

/** How long after the page is up before the offer shows. */
const OFFER_DELAY_MS = 1500;

export function OrientationOffer() {
  const [show, setShow] = useState(false);
  const activeTourId = useTourStore((s) => s.activeTourId);
  const startTour = useTourStore((s) => s.startTour);
  const parts = orientationWalkthroughs();

  useEffect(() => {
    if (!shouldOfferOrientation(readOfferChoice(), window.location.search)) return;
    const t = setTimeout(() => {
      // A walkthrough that started meanwhile (the menu, a link) wins.
      if (useTourStore.getState().activeTourId === null) setShow(true);
    }, OFFER_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  const later = () => {
    writeOfferChoice("later");
    setShow(false);
  };
  const never = () => {
    writeOfferChoice("never");
    setShow(false);
  };
  const start = () => {
    writeOfferChoice("started");
    setShow(false);
    if (parts[0]) startTour(parts[0].id);
  };

  useDismiss(show, later);

  if (!show || activeTourId !== null || parts.length === 0) return null;

  const minutes = parts.reduce((sum, w) => sum + (w.minutes ?? 3), 0);

  return (
    <div
      onClick={later}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--pnv-scrim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="orientation-offer-title"
        data-testid="orientation-offer"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--pnv-surface)",
          borderRadius: 12,
          width: "92%",
          maxWidth: 640,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "var(--pnv-shadow-dialog)",
        }}
      >
        <DialogHeader title="New to PsyNeuView?" titleId="orientation-offer-title" onClose={later} />
        <div style={{ padding: "20px 28px", fontSize: 14, color: "var(--pnv-text-body)", lineHeight: 1.55 }}>
          <p style={{ margin: "0 0 10px" }}>
            <strong>PsyNeuView First Steps</strong> is {parts.length} short walkthroughs, about {minutes}{" "}
            minutes in all, inside the app: what you're looking at, where your work lives, what it runs on,
            and what happens when you edit, save and run a model.
          </p>
          <p style={{ margin: "0 0 10px" }}>
            Each one takes two to four minutes, and you can stop at any point. Captions are always shown;
            narration can be turned on from the walkthrough bar.
          </p>
          <ol data-testid="orientation-offer-parts" style={partList}>
            {parts.map((w, i) => (
              <li key={w.id} style={partRow}>
                <span aria-hidden="true" style={partNumber}>
                  {w.orientation ?? i + 1}
                </span>
                <span style={{ flex: 1 }}>{w.title}</span>
                {w.minutes != null && <span style={partMinutes}>~{w.minutes} min</span>}
              </li>
            ))}
          </ol>
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--pnv-text-muted)" }}>
            They're always in the <strong>Tutorials ▾</strong> menu, so there's no need to take them now.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "12px 20px 16px", borderTop: "1px solid var(--pnv-border-faint)" }}>
          <Button data-testid="orientation-offer-never" onClick={never} kind="secondary" size="compact">
            No thanks
          </Button>
          <Button data-testid="orientation-offer-later" onClick={later} kind="secondary" size="compact">
            Maybe later
          </Button>
          <Button data-testid="orientation-offer-start" onClick={start} kind="primary" size="compact">
            Start part 1
          </Button>
        </div>
      </div>
    </div>
  );
}

// The eight parts: an indented list with a numbered badge per part, so the
// sequence reads at a glance.
const partList: React.CSSProperties = {
  listStyle: "none",
  margin: "6px 0 4px",
  padding: "4px 0 4px 12px",
  borderLeft: "3px solid var(--pnv-primary-tint)",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const partRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  color: "var(--pnv-text-body)",
};

const partNumber: React.CSSProperties = {
  flexShrink: 0,
  width: 22,
  height: 22,
  borderRadius: "50%",
  background: "var(--pnv-primary-tint)",
  color: "var(--pnv-primary-deep)",
  fontSize: 12,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const partMinutes: React.CSSProperties = {
  flexShrink: 0,
  fontSize: 12,
  color: "var(--pnv-text-hint)",
};
