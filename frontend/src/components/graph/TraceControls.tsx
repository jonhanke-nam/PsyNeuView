/**
 * Step-through controls for execution trace visualization.
 *
 * Appears after a model run with execution trace data.
 * Allows stepping forward/backward through the execution,
 * highlighting active nodes at each step.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useModelStore } from "@/stores/modelStore";
import { record } from "@/utils/activityLog";

export function TraceControls() {
  const executionTrace = useModelStore((s) => s.executionTrace);
  const traceStep = useModelStore((s) => s.traceStep);
  const setTraceStep = useModelStore((s) => s.setTraceStep);
  const clearTrace = useModelStore((s) => s.clearTrace);
  const trialBoundaries = useModelStore((s) => s.executionTrialBoundaries);
  const debuggerHookAvailable = useModelStore((s) => s.debuggerHookAvailable);
  const autoPlayRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalSteps = executionTrace.length;
  // Trial nav is meaningful only when the backend gave us >1 trial boundary
  // (i.e. the _debugger hook fired BEGINNING_OF_TRIAL across multiple trials).
  // A single-element list means "no per-trial info available" — hide the
  // trial buttons rather than render dead controls.
  const hasTrialNav = trialBoundaries.length > 1;
  const totalTrials = trialBoundaries.length;
  // Index into trialBoundaries that contains the current step. Boundaries
  // are strictly increasing, so the trial is the largest boundary ≤ step.
  const currentTrial = (() => {
    if (traceStep === null || trialBoundaries.length === 0) return null;
    let t = 0;
    for (let i = 0; i < trialBoundaries.length; i++) {
      if (trialBoundaries[i] <= traceStep) t = i;
      else break;
    }
    return t;
  })();

  const stepForward = useCallback(() => {
    if (traceStep === null || traceStep >= totalSteps - 1) return;
    record("step", `Step ${traceStep + 2} of ${totalSteps}`, { step: traceStep + 2, of: totalSteps });
    setTraceStep(traceStep + 1);
  }, [traceStep, totalSteps, setTraceStep]);

  const stepBackward = useCallback(() => {
    if (traceStep === null || traceStep <= 0) return;
    record("step", `Step ${traceStep} of ${totalSteps}`, { step: traceStep, of: totalSteps });
    setTraceStep(traceStep - 1);
  }, [traceStep, totalSteps, setTraceStep]);

  // #378 Option B: ⏮/⏭ preserve the within-trial step offset so the user
  // can scrub across trials at the same execution moment ("how does node
  // X look at step 3 of every trial?"). If the target trial has fewer
  // steps than the current offset, clamp to the target's last step.
  const nextTrial = useCallback(() => {
    if (currentTrial === null || currentTrial >= trialBoundaries.length - 1) return;
    const offset = traceStep !== null
      ? traceStep - trialBoundaries[currentTrial]
      : 0;
    const targetStart = trialBoundaries[currentTrial + 1];
    const targetEnd = currentTrial + 2 < trialBoundaries.length
      ? trialBoundaries[currentTrial + 2]
      : totalSteps;
    record("step", `Trial ${currentTrial + 2} of ${totalTrials}`, { trial: currentTrial + 2, of: totalTrials });
    setTraceStep(Math.min(targetStart + offset, targetEnd - 1));
  }, [currentTrial, traceStep, trialBoundaries, totalSteps, setTraceStep]);

  const prevTrial = useCallback(() => {
    if (currentTrial === null || currentTrial <= 0) return;
    const offset = traceStep !== null
      ? traceStep - trialBoundaries[currentTrial]
      : 0;
    const targetStart = trialBoundaries[currentTrial - 1];
    const targetEnd = trialBoundaries[currentTrial];
    record("step", `Trial ${currentTrial} of ${totalTrials}`, { trial: currentTrial, of: totalTrials });
    setTraceStep(Math.min(targetStart + offset, targetEnd - 1));
  }, [currentTrial, traceStep, trialBoundaries, setTraceStep]);

  // #378: user-controllable autoplay speed. Multiplier on the base 400 ms
  // step interval — 2× is twice as fast, 0.5× is half. Persisted within
  // the component lifetime; rests at 1× on each panel mount.
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  // Track whether autoplay is currently running so the speed selector can
  // restart the interval at the new rate without the user having to pause
  // and resume manually.
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Single source of "start the autoplay interval at this speed." Returns
  // the interval handle so the caller can stash it.
  const startInterval = useCallback((speed: number) => {
    return setInterval(() => {
      const { traceStep: step, executionTrace: trace } = useModelStore.getState();
      if (step === null || step >= trace.length - 1) {
        if (autoPlayRef.current) clearInterval(autoPlayRef.current);
        autoPlayRef.current = null;
        setIsPlaying(false);
        return;
      }
      useModelStore.getState().setTraceStep(step + 1);
    }, 400 / speed);
  }, []);

  const toggleAutoPlay = useCallback(() => {
    if (autoPlayRef.current) {
      clearInterval(autoPlayRef.current);
      autoPlayRef.current = null;
      setIsPlaying(false);
      record("step", "Autoplay stopped");
      return;
    }
    record("step", `Autoplay started at ${playbackSpeed}×`, { speed: playbackSpeed });
    autoPlayRef.current = startInterval(playbackSpeed);
    setIsPlaying(true);
  }, [playbackSpeed, startInterval]);

  // When the user changes speed mid-playback, restart the interval at the
  // new rate. If autoplay isn't running, just stash the new speed for the
  // next press of ⏵⏵.
  useEffect(() => {
    if (!isPlaying) return;
    if (autoPlayRef.current) clearInterval(autoPlayRef.current);
    autoPlayRef.current = startInterval(playbackSpeed);
  }, [playbackSpeed, isPlaying, startInterval]);

  // Cleanup auto-play on unmount
  useEffect(() => {
    return () => {
      if (autoPlayRef.current) clearInterval(autoPlayRef.current);
    };
  }, []);

  // #340 view mode: 'run' shows step X / totalSteps (count across the whole
  // run); 'trial' shows step M / K relative to the current trial. The mode
  // is irrelevant when there's no trial boundary info — `hasTrialNav` false
  // forces 'run' regardless of the toggle.
  const [viewMode, setViewMode] = useState<"run" | "trial">("run");
  const effectiveMode = hasTrialNav ? viewMode : "run";

  // Step ↔ trial-window math. trialStart/trialEnd bracket the current trial
  // in `executionTrace`; `stepInTrial` is the within-trial step index.
  const trialStart = currentTrial !== null ? trialBoundaries[currentTrial] : 0;
  const trialEnd =
    currentTrial !== null && currentTrial < trialBoundaries.length - 1
      ? trialBoundaries[currentTrial + 1]
      : totalSteps;
  const stepInTrial = traceStep !== null ? traceStep - trialStart : null;
  const stepsThisTrial = trialEnd - trialStart;

  // Counter display values switch on mode. In 'trial' mode the user sees
  // (and edits) the within-trial step index; the store still holds the
  // absolute traceStep.
  const displayStep =
    effectiveMode === "trial" ? stepInTrial : traceStep;
  const displayTotal =
    effectiveMode === "trial" ? stepsThisTrial : totalSteps;

  // Click-to-edit on the step number. While `editValue` is a string, the
  // span swaps for an input; Enter commits, Escape cancels, blur commits.
  const [editValue, setEditValue] = useState<string | null>(null);

  const startEdit = useCallback(() => {
    if (displayStep === null) return;
    setEditValue(String(displayStep + 1));
  }, [displayStep]);

  const commitEdit = useCallback(() => {
    if (editValue === null) return;
    const n = parseInt(editValue, 10);
    if (!isNaN(n)) {
      if (effectiveMode === "trial") {
        // Interpret the input as a within-trial step index; jump to
        // trialStart + (n - 1), clamped to this trial's window.
        const clamped = Math.max(1, Math.min(stepsThisTrial, n));
        setTraceStep(trialStart + clamped - 1);
      } else {
        const clamped = Math.max(1, Math.min(totalSteps, n));
        setTraceStep(clamped - 1);
      }
    }
    setEditValue(null);
  }, [editValue, effectiveMode, stepsThisTrial, trialStart, totalSteps, setTraceStep]);

  const cancelEdit = useCallback(() => {
    setEditValue(null);
  }, []);

  if (totalSteps === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        background: "var(--pnv-surface)",
        border: "1px solid var(--pnv-border-light)",
        borderRadius: 8,
        boxShadow: "var(--pnv-shadow-node-raised)",
        padding: "6px 12px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        userSelect: "none",
      }}
    >
      {/* #340: hover on the TRACE label explains what a "step" indexes —
          one EXECUTION_SET firing in PsyNeuLink's scheduler. Helps the user
          interpret the step counter when they first encounter it. */}
      <span
        style={{ fontSize: 11, fontWeight: 700, color: "var(--pnv-node-text-strong)", letterSpacing: 0.5, cursor: "help" }}
        title={
          "One step = one EXECUTION_SET firing in PsyNeuLink's scheduler.\n" +
          "For a model with K execution sets per trial across N trials,\n" +
          "you'll see roughly K×N steps total."
        }
      >
        TRACE
      </span>

      {/* #475: on hook-less builds, mark the bar so the missing value pill and
          the estimated trial split are explained in-context rather than read
          as a bug. */}
      {debuggerHookAvailable === false && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "var(--pnv-warning-tag-text)",
            background: "var(--pnv-warning-tint)",
            border: "1px solid var(--pnv-warning-border)",
            borderRadius: 4,
            padding: "1px 5px",
            cursor: "help",
          }}
          title={
            "This PsyNeuLink build has no _debugger hook.\n" +
            "Per-node values are unavailable and trial boundaries are an\n" +
            "estimated even split. Switch to the jonhanke-nam fork\n" +
            "(Settings ▸ Developer ▸ PsyNeuLink details) for full support."
          }
        >
          basic
        </span>
      )}

      {hasTrialNav && (
        <button onClick={prevTrial}
          disabled={currentTrial === null || currentTrial <= 0}
          style={{ fontSize: 14, padding: "2px 8px", border: "1px solid var(--pnv-border)", borderRadius: 4, background: "var(--pnv-surface-muted)", cursor: "pointer", color: "var(--pnv-text-body)" }}
          title="Previous trial at the same step offset"
        >⏮</button>
      )}

      <button onClick={stepBackward} disabled={traceStep === null || traceStep <= 0}
        data-testid="trace-prev-step"
        style={{ fontSize: 14, padding: "2px 8px", border: "1px solid var(--pnv-border)", borderRadius: 4, background: "var(--pnv-surface-muted)", cursor: "pointer", color: "var(--pnv-text-body)" }}
        title="Previous step"
      >◀</button>

      {/* Fixed width (not minWidth) so the bar doesn't reflow when the step
          number changes width — keeps the centered bar's left edge stable.
          The left half is click-to-edit: click the number, type a target,
          press Enter to jump (Escape to cancel). */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
          width: 64,
          flexShrink: 0,
          fontSize: 12,
          fontFamily: "monospace",
          fontWeight: 600,
          color: "var(--pnv-text-body)",
        }}
      >
        {editValue !== null ? (
          <input
            type="number"
            value={editValue}
            autoFocus
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              else if (e.key === "Escape") cancelEdit();
            }}
            onBlur={commitEdit}
            onFocus={(e) => e.target.select()}
            min={1}
            max={displayTotal}
            style={{
              width: 30,
              fontSize: 12,
              fontFamily: "monospace",
              fontWeight: 600,
              textAlign: "center",
              padding: "0 2px",
              border: "1px solid var(--pnv-primary)",
              borderRadius: 3,
              outline: "none",
              background: "var(--pnv-surface)",
              color: "var(--pnv-text-body)",
            }}
          />
        ) : (
          <span
            onClick={startEdit}
            style={{
              cursor: displayStep !== null ? "pointer" : "default",
              textDecoration: displayStep !== null ? "underline dotted var(--pnv-node-text-dim)" : "none",
              textUnderlineOffset: 2,
            }}
            title={
              displayStep !== null
                ? effectiveMode === "trial"
                  ? "Click to jump to a specific step within this trial"
                  : "Click to jump to a specific step"
                : ""
            }
          >
            {displayStep !== null ? displayStep + 1 : "—"}
          </span>
        )}
        <span style={{ color: "var(--pnv-text-muted)" }}>/ {displayTotal}</span>
      </span>

      <button onClick={stepForward} disabled={traceStep === null || traceStep >= totalSteps - 1}
        data-testid="trace-next-step"
        style={{ fontSize: 14, padding: "2px 8px", border: "1px solid var(--pnv-border)", borderRadius: 4, background: "var(--pnv-surface-muted)", cursor: "pointer", color: "var(--pnv-text-body)" }}
        title="Next step"
      >▶</button>

      {hasTrialNav && (
        <button onClick={nextTrial}
          disabled={currentTrial === null || currentTrial >= trialBoundaries.length - 1}
          style={{ fontSize: 14, padding: "2px 8px", border: "1px solid var(--pnv-border)", borderRadius: 4, background: "var(--pnv-surface-muted)", cursor: "pointer", color: "var(--pnv-text-body)" }}
          title="Next trial at the same step offset"
        >⏭</button>
      )}

      {hasTrialNav && (
        <span style={{ fontSize: 11, color: "var(--pnv-text-muted)", fontFamily: "monospace", width: 64, flexShrink: 0, textAlign: "center" }}
          title={`Currently on trial ${currentTrial !== null ? currentTrial + 1 : "—"} of ${totalTrials}`}
        >
          Trial {currentTrial !== null ? currentTrial + 1 : "—"}/{totalTrials}
        </span>
      )}

      {/* #340: view mode toggle. 'run' counts steps across the whole run;
          'trial' counts steps within the current trial. Hidden on no-hook
          builds (no trial info to count within). */}
      {hasTrialNav && (
        <span style={{ display: "inline-flex", border: "1px solid var(--pnv-border)", borderRadius: 4, overflow: "hidden", fontSize: 10, fontFamily: "monospace" }}>
          <button
            onClick={() => setViewMode("run")}
            style={{
              padding: "2px 6px",
              border: "none",
              background: effectiveMode === "run" ? "var(--pnv-primary-tint)" : "var(--pnv-surface-muted)",
              color: effectiveMode === "run" ? "var(--pnv-primary)" : "var(--pnv-node-text-detail)",
              fontWeight: effectiveMode === "run" ? 700 : 400,
              cursor: "pointer",
            }}
            title="Count steps across the whole run"
          >
            run
          </button>
          <button
            onClick={() => setViewMode("trial")}
            style={{
              padding: "2px 6px",
              border: "none",
              borderLeft: "1px solid var(--pnv-border)",
              background: effectiveMode === "trial" ? "var(--pnv-primary-tint)" : "var(--pnv-surface-muted)",
              color: effectiveMode === "trial" ? "var(--pnv-primary)" : "var(--pnv-node-text-detail)",
              fontWeight: effectiveMode === "trial" ? 700 : 400,
              cursor: "pointer",
            }}
            title="Count steps within the current trial"
          >
            trial
          </button>
        </span>
      )}

      <button onClick={toggleAutoPlay}
        style={{
          fontSize: 11,
          padding: "2px 8px",
          border: "1px solid var(--pnv-border)",
          borderRadius: 4,
          // Highlight while playing so the button doubles as a status
          // indicator (#378). Clicking again pauses.
          background: isPlaying ? "var(--pnv-primary-tint)" : "var(--pnv-surface-muted)",
          color: isPlaying ? "var(--pnv-primary)" : "var(--pnv-text-body)",
          fontWeight: isPlaying ? 700 : 400,
          cursor: "pointer",
        }}
        title={isPlaying ? "Pause autoplay" : "Auto-play"}
      >{isPlaying ? "⏸" : "⏵⏵"}</button>

      {/* #378: playback speed multiplier. 1× is the default 400 ms/step;
          higher speeds shorten the interval (and lower speeds lengthen).
          Restarts the interval mid-playback via the useEffect above. */}
      <select
        value={playbackSpeed}
        onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
        title="Autoplay speed (relative to 400 ms/step)"
        style={{
          fontSize: 11,
          fontFamily: "monospace",
          padding: "2px 4px",
          border: "1px solid var(--pnv-border)",
          borderRadius: 4,
          background: "var(--pnv-surface-muted)",
          color: "var(--pnv-text-secondary)",
          cursor: "pointer",
        }}
      >
        <option value="0.25">0.25×</option>
        <option value="0.5">0.5×</option>
        <option value="1">1×</option>
        <option value="2">2×</option>
        <option value="4">4×</option>
      </select>

      {/* #336 gap 3: the active-nodes list used to live here as
          `word_hidden, color_hi…` — but the canvas green highlight already
          shows which nodes fired, and the Run State tab carries the same
          info in text form. Two sources of truth for the same thing made
          the bar wider without adding information, so dropped. */}

      <button onClick={() => { record("step", "Trace cleared"); clearTrace(); }}
        style={{ fontSize: 11, padding: "2px 6px", border: "1px solid var(--pnv-border-light)", borderRadius: 4, background: "var(--pnv-surface)", cursor: "pointer", color: "var(--pnv-text-faint)" }}
        title="Clear trace"
      >✕</button>
    </div>
  );
}
