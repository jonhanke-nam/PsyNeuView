/**
 * The guided walkthrough's reserved region (#1181), with its captions and
 * controls (#1310).
 *
 * The callout used to float in a window corner. That works for two steps and
 * stops working well before ten: every canvas corner is already claimed
 * (legend top-left, validation and breadcrumb top-centre, off-screen indicator
 * top-right, React Flow's controls bottom-left, trace controls bottom-centre),
 * and the window's corners belong to panels. A floating callout is always on
 * top of *something*.
 *
 * So the walkthrough gets space of its own instead. This is a normal flex item
 * at the bottom of the app's root column, which means the app **shrinks** to
 * make room rather than being covered — nothing is ever hidden behind the
 * instruction the learner is trying to follow.
 *
 * It costs nothing when no walkthrough is running: the component renders null,
 * the row has no height, and the layout is exactly as it was.
 *
 * The bar also owns **advancing**, because it is rendered at the root and the
 * overlay is not: the overlay lives inside the graph canvas, which a learner
 * can hide. A walkthrough that stopped progressing because someone collapsed
 * a pane would be a baffling bug.
 *
 * #1310 adds, for the orientation walkthroughs: a **caption** under the
 * instruction (always shown; read aloud when narration is on), **Pause**,
 * **Replay** and **Skip**, a **Next** button for a step that only explains,
 * and the docs page the walkthrough relies on. The bar sits above any dialog
 * (Settings is a walkthrough's subject, not an interruption), so its controls
 * stay usable while one is open.
 */

import { useEffect, useRef, useState } from "react";
import { useFitGraph } from "@/hooks/useFitGraph";

import { useTourProgress } from "@/hooks/useTourProgress";
import { useCatalogOpener } from "@/stores/catalogOpenerStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useModelStore } from "@/stores/modelStore";
import { useTourHighlightStore } from "@/stores/tourHighlightStore";
import { tourIdFromUrl, useTourStore } from "@/stores/tourStore";
import { useUIStore } from "@/stores/uiStore";
import { fillShortcutKeys } from "@/shortcuts/keyLabels";
import { useResolvedShortcuts } from "@/shortcuts/useAppShortcuts";
import { openSettings } from "./settings/sections";
import { narrationAvailable, narrationVoiceName, pauseSpeaking, resumeSpeaking, speakCaption, stopSpeaking, type SpeechEngine } from "@/utils/narration";
import { matchesNodeName, type TourStep } from "@/utils/tourStep";
import {
  isTutorialCopy,
  noteTutorialModel,
  returnToTutorialModel,
  startTutorialOver,
  undoStepEdits,
} from "@/utils/tutorialGuard";
import { clearProgress, progressFor, saveProgress, STALE_MESSAGE } from "@/utils/tutorialProgress";
import { requestSave } from "@/utils/saveRequest";
import { applyTutorialView, restoreTutorialView } from "@/utils/tutorialView";

/** Where a docs page is read: the repo's `docs/` folder on devel. */
export const DOCS_URL_BASE = "https://github.com/jonhanke-nam/PsyNeuView/blob/devel/docs/";

/** The caption narration reads: the step's own line, or its instruction. */
export function captionOf(step: TourStep): string {
  return step.say ?? step.instruct;
}

function speechEngine(): SpeechEngine | null {
  if (!narrationAvailable()) return null;
  // Chrome fills the voice list after the first ask; asking now means the
  // first caption already gets the chosen voice.
  window.speechSynthesis.getVoices?.();
  return window.speechSynthesis as SpeechEngine;
}

export function TourBar() {
  const { walkthrough, step, stepIndex, complete, finished, offModel } = useTourProgress();
  const modelPath = useTourStore((s) => s.modelPath);
  const notice = useTourStore((s) => s.notice);
  const stepStart = useTourStore((s) => s.stepStart);
  // #409: an instruction naming a shortcut, as `{key:history.undo}`, shows
  // this platform's key as rebound.
  const shortcuts = useResolvedShortcuts();
  const filePath = useModelStore((s) => s.filePath);
  const source = useModelStore((s) => s.source);
  const anchorOffScreen = useTourStore((s) => s.anchorOffScreen);
  const advance = useTourStore((s) => s.advance);
  const stopTour = useTourStore((s) => s.stopTour);
  const paused = useTourStore((s) => s.paused);
  const setPaused = useTourStore((s) => s.setPaused);
  const pressNext = useTourStore((s) => s.pressNext);
  const replay = useTourStore((s) => s.replay);
  const replayCount = useTourStore((s) => s.replayCount);
  const pointerArrived = useTourStore((s) => s.pointerArrived);
  const narration = useTourStore((s) => s.narration);
  const setNarration = useTourStore((s) => s.setNarration);
  const fitGraph = useFitGraph();
  const startCount = useTourStore((s) => s.startCount);
  const nodes = useModelStore((s) => s.nodes);
  const openCatalogModel = useCatalogOpener((s) => s.open);
  const catalogReady = useCatalogOpener((s) => s.ready);
  const [opening, setOpening] = useState(false);
  // The last try at opening the walkthrough's model came back without it.
  const [openFailed, setOpenFailed] = useState(false);
  // The start this walkthrough last tried opening its model for: once per start.
  const triedFor = useRef<string | null>(null);
  const canNarrate = narrationAvailable();

  // Open the model, and remember when it didn't come up. With no server the
  // catalog is empty and nothing opens; the button used to do nothing, silently.
  function tryOpen(open: (label: string) => Promise<boolean>, label: string) {
    setOpening(true);
    setOpenFailed(false);
    void open(label)
      .then((ok) => setOpenFailed(!ok))
      .catch(() => setOpenFailed(true))
      .finally(() => setOpening(false));
  }

  // #1224: a walkthrough runs against the model it was written for. Started
  // from the menu with another model open, its rings had nothing to attach to
  // and the learner was left with nothing to do. So open it on start, unless
  // it's open already.
  //
  // #1392: the course walkthroughs *teach* opening it, in a step of their own,
  // so they don't open it on start. But a learner who skipped that step was
  // stranded on the next one, ringing a node that wasn't there. So once past
  // the teaching step, open it for them if it still isn't open.
  //
  // #172: every start opens a fresh copy of its own, even when the model is
  // open already, so earlier edits can't break the steps.
  const teachesOpening = walkthrough?.model
    ? walkthrough.steps.findIndex((s) => s.opens === walkthrough.model)
    : -1;
  const pastTeaching = teachesOpening < 0 || stepIndex > teachesOpening;
  useEffect(() => {
    if (!walkthrough?.model || !pastTeaching) return;
    const key = `${walkthrough.id}#${startCount}`;
    if (!catalogReady || triedFor.current === key) return;
    triedFor.current = key;
    const { open } = useCatalogOpener.getState();
    // Already has its model: the teaching step opened it.
    if (!open || useTourStore.getState().modelPath) return;
    tryOpen(open, walkthrough.model);
    // Keyed on the start, and waits for the catalog lists and the teaching step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkthrough?.id, startCount, catalogReady, pastTeaching]);

  // #1318: the developer track turns developer mode on for its duration and
  // puts it back as it was — whether the walkthrough finished or was ended.
  const wantsDeveloperMode = walkthrough?.developerMode === true;
  const tourKey = walkthrough ? `${walkthrough.id}#${startCount}` : null;
  useEffect(() => {
    if (!wantsDeveloperMode || !tourKey) return;
    const was = useUIStore.getState().developerMode;
    if (!was) useUIStore.getState().setDeveloperMode(true);
    return () => {
      if (!was) useUIStore.getState().setDeveloperMode(false);
    };
  }, [wantsDeveloperMode, tourKey]);

  // #189: the window opens with the graph alone, but a walkthrough points at
  // the code editor, the bottom panel's tabs and the Components panel. So every
  // panel shows while one runs, and the learner's own layout comes back when
  // it ends — finished or stopped — the same way as developer mode above.
  useEffect(() => {
    if (!tourKey) return;
    const layout = useLayoutStore.getState();
    layout.showEverythingForWalkthrough();
    return () => useLayoutStore.getState().restoreLayoutAfterWalkthrough();
  }, [tourKey]);
  // #172: and the graph's view as a fresh window has it, with the learner's
  // choices back afterwards (utils/tutorialView.ts). Restarting, or starting
  // another, goes through the cleanup too: the view is put back, then set again.
  useEffect(() => {
    if (!tourKey) return;
    applyTutorialView();
    // A selection left from before would finish a "select this node" step on
    // its own: starting over with color_hidden still selected went straight
    // to step 2. Every start begins with nothing selected (#172, #173).
    useModelStore.getState().setSelectedNodeId(null);
    return () => restoreTutorialView({ anotherStarting: !!useTourStore.getState().activeTourId });
  }, [tourKey]);
  // A reload mid-walkthrough never ran that cleanup. Unless the page is about
  // to start one again from its `?tour=` link, put the layout back now.
  useEffect(() => {
    if (tourIdFromUrl(window.location.search)) return;
    useLayoutStore.getState().restoreLayoutAfterWalkthrough();
  }, []);

  // The node this step points at, when the open model doesn't have it. The
  // instruction alone would point at nothing; say what's missing instead.
  // Matched the way the ring and the done-check match, so a suffixed id
  // ("color_hidden-7") counts as present.
  const anchorNode = step?.anchor.node;
  const missingNode =
    step && !complete && anchorNode && !nodes.some((n) => matchesNodeName(n.id, anchorNode))
      ? anchorNode
      : null;

  // #172: the code as this step began, so the learner can undo their edits
  // since. Taken when the step starts on the walkthrough's model, or when that
  // model opens during the step (the step that teaches opening it).
  const stepKey0 = step ? `${tourKey}/${step.id}` : null;
  useEffect(() => {
    if (!stepKey0 || !filePath || filePath !== modelPath) return;
    const taken = useTourStore.getState().stepStart;
    if (taken && taken.key === stepKey0 && taken.filePath === filePath) return;
    useTourStore.getState().setStepStart({ key: stepKey0, filePath, source: useModelStore.getState().source });
  }, [stepKey0, filePath, modelPath]);
  const onStepCode = !!stepStart && !!stepKey0 && stepStart.key === stepKey0 && stepStart.filePath === filePath;
  const codeChanged = onStepCode && source !== stepStart!.source;
  // The ways back, when a step's node is missing or its code was changed.
  const offerWayBack = !!step && !complete && !offModel && onStepCode && (codeChanged || !!missingNode);
  const [undoing, setUndoing] = useState(false);

  // #173: remember where the learner is, per tutorial, so starting it again
  // can offer to resume here: the step, and the code as it began. Only the
  // walkthrough's own copy's code is kept; a model the learner created is
  // kept by its path. Finishing forgets it. Step 1 needs nothing remembered,
  // and a fresh start there leaves an earlier place alone until it moves on.
  const resuming = useTourStore((s) => s.resuming);
  const modelFresh = useTourStore((s) => s.modelFresh);
  useEffect(() => {
    if (!walkthrough || !tourKey) return;
    if (finished) {
      clearProgress(walkthrough.id);
      return;
    }
    if (resuming || stepIndex === 0) return;
    const code = stepStart && stepStart.key === stepKey0 && isTutorialCopy(stepStart.filePath) ? stepStart.source : null;
    const file = modelPath && !isTutorialCopy(modelPath) ? modelPath : null;
    saveProgress(walkthrough.id, progressFor(walkthrough, stepIndex, code, modelFresh, file));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkthrough?.id, tourKey, stepIndex, stepStart, modelPath, modelFresh, finished, resuming]);

  // #173: resuming a saved place. The step is already set; its code goes into
  // the walkthrough's own fresh copy once that has opened, unless the bundled
  // model changed since (then it starts over, and says why). A model the
  // learner created opens as it is: resuming never writes to their files.
  const resumeTried = useRef<string | null>(null);
  const resumeOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!resuming || !walkthrough || !tourKey) return;
    const { doneResuming } = useTourStore.getState();
    const stale = () => {
      clearProgress(walkthrough.id);
      useTourStore.getState().startTour(walkthrough.id);
      useTourStore.getState().setNotice(STALE_MESSAGE(walkthrough.title));
    };
    if (resuming.file) {
      const file = resuming.file;
      if (resumeTried.current === tourKey) return;
      const openPath = useCatalogOpener.getState().openPath;
      if (!openPath) return;
      resumeTried.current = tourKey;
      // Its model first, so opening it is staying, not leaving.
      noteTutorialModel(file);
      void openPath(file).then(() => {
        if (useModelStore.getState().filePath === file) doneResuming();
        else stale();
      });
      return;
    }
    if (resuming.code === null) {
      doneResuming();
      return;
    }
    // Left before the step that teaches opening the model, with it open
    // already: nothing else opens it on a resume, so open it here.
    if (!modelPath && walkthrough.model && !pastTeaching && catalogReady && resumeOpened.current !== tourKey) {
      const { open } = useCatalogOpener.getState();
      resumeOpened.current = tourKey;
      if (open) tryOpen(open, walkthrough.model);
      return;
    }
    if (!modelPath || filePath !== modelPath || !modelFresh || !stepKey0) return;
    if (resumeTried.current === tourKey) return;
    resumeTried.current = tourKey;
    if ((resuming.fresh && resuming.fresh !== modelFresh) || !isTutorialCopy(modelPath)) {
      stale();
      return;
    }
    const code = resuming.code;
    const key = stepKey0;
    const path = modelPath;
    useModelStore.getState().setSource(code);
    void requestSave({ source: code }).finally(() => {
      useTourStore.getState().setStepStart({ key, filePath: path, source: code });
      doneResuming();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resuming, modelPath, filePath, modelFresh, tourKey, stepKey0, catalogReady, pastTeaching]);

  // Once the node turns up, a past failure no longer applies.
  useEffect(() => {
    if (!missingNode) setOpenFailed(false);
  }, [missingNode]);

  // Advance once the learner has done the thing, after a beat so the tick is
  // visible rather than the step vanishing the instant they act. Not while
  // paused: the tick shows, and the step waits for Resume.
  useEffect(() => {
    if (!step || !complete || paused) return;
    const t = setTimeout(advance, 1200);
    return () => clearTimeout(t);
  }, [step, complete, paused, advance]);

  // A finished walkthrough closes itself rather than leaving an empty bar.
  useEffect(() => {
    if (!finished) return;
    const t = setTimeout(stopTour, 900);
    return () => clearTimeout(t);
  }, [finished, stopTour]);

  // A pointer step holds its words until the pointer has arrived. The step's
  // ring is drawn at once; the overlay reports the arrival.
  // Only while the arrow is shown (#100); without it the ring is drawn at once.
  const showArrow = useTourHighlightStore((h) => h.showArrow);
  const holdForPointer = Boolean(step?.pointer) && showArrow && !pointerArrived && !complete;

  // Narration (#1310): read the caption when a step shows, when it's replayed,
  // and when narration is switched on mid-step. Stop when the step is done,
  // the walkthrough ends, or narration is switched off.
  const caption = step ? captionOf(step) : "";
  const stepKey = step ? `${tourKey}/${step.id}` : null;
  // True while the voice is reading the caption, so the bar can light it (#86).
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    const engine = speechEngine();
    setSpeaking(false);
    if (!engine) return;
    if (!narration || !stepKey || complete || holdForPointer) {
      stopSpeaking(engine);
      return;
    }
    speakCaption(caption, engine, undefined, undefined, undefined, {
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
    });
    return () => {
      stopSpeaking(engine);
      setSpeaking(false);
    };
    // replayCount is a trigger, not data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narration, stepKey, caption, complete, holdForPointer, replayCount]);

  // Pause and resume the voice with the walkthrough.
  useEffect(() => {
    const engine = speechEngine();
    if (!engine) return;
    if (paused) pauseSpeaking(engine);
    else resumeSpeaking(engine);
  }, [paused]);

  // Dialogs stop just above the bar (DIALOG_SCRIM_BOTTOM), which is drawn
  // above them: it never covers a dialog's last rows, Settings' included.
  const [barEl, setBarEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!barEl) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--pnv-tour-bar-height", `${barEl.offsetHeight}px`);
    publish();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(publish) : null;
    ro?.observe(barEl);
    return () => {
      ro?.disconnect();
      root.style.removeProperty("--pnv-tour-bar-height");
    };
  }, [barEl]);

  // Whatever happens to the walkthrough, no voice outlives it.
  useEffect(() => () => stopSpeaking(speechEngine()), []);

  if (!walkthrough) return null;

  const docs = walkthrough.docs ?? [];
  // Narration on and a caption to read: the caption leads the bar (#86).
  const leads = narration && Boolean(step?.say) && !finished && !complete && !holdForPointer;
  const voice = narration ? narrationVoiceName(speechEngine()?.getVoices?.() ?? []) : null;
  const instruction = finished
    ? "✓ Walkthrough complete."
    : complete
      ? "✓ Done."
      : holdForPointer
        ? "…"
        : step && fillShortcutKeys(step.instruct, shortcuts);

  return (
    <div
      ref={setBarEl}
      data-testid="tour-bar"
      data-paused={paused ? "true" : "false"}
      style={{
        flexShrink: 0,
        display: "flex",
        // The step's text takes a full row of its own above the title, dots
        // and buttons; sharing one row squeezed it into a column a word wide.
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: "8px 12px",
        borderTop: "1px solid var(--pnv-walkthrough-border)",
        background: "var(--pnv-walkthrough-bg)",
        // Reading size (#5): the instruction is the text a learner reads, at
        // the app's body size; the caption one step below it.
        fontSize: "var(--pnv-fs-15)",
        color: "var(--pnv-walkthrough-text)",
        // Above Settings and the other dialogs (zIndex 10000): a walkthrough
        // about Settings needs its bar while Settings is open.
        position: "relative",
        zIndex: 10001,
      }}
    >
      {/* The title may wrap (#84): kept on one line, a long one pushed the
          buttons onto a row of their own in a narrow window. */}
      <span data-testid="tour-title" style={{ flex: "0 1 auto", minWidth: 0, maxWidth: "40ch", fontSize: "var(--pnv-fs-13)", fontWeight: 600, color: "var(--pnv-walkthrough-label)" }}>
        {walkthrough.title}
      </span>

      {/* One dot per step: where the learner is, and how much is left. */}
      <span style={{ display: "flex", gap: 4, flexShrink: 0 }} aria-hidden="true">
        {walkthrough.steps.map((s, i) => (
          <span
            key={s.id}
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: i < stepIndex ? "var(--pnv-walkthrough-done)" : i === stepIndex ? "var(--pnv-walkthrough-current)" : "var(--pnv-walkthrough-todo)",
            }}
          />
        ))}
      </span>

      <span style={{ fontSize: "var(--pnv-fs-13)", color: "var(--pnv-walkthrough-label)", whiteSpace: "nowrap" }}>
        {finished ? "complete" : `step ${stepIndex + 1} of ${walkthrough.steps.length}`}
      </span>

      {/* A long instruction scrolls inside the bar rather than pushing the canvas away (#5). */}
      <span data-testid="tour-text" style={{ order: -1, flexBasis: "100%", minWidth: 0, display: "flex", flexDirection: "column", maxHeight: "30vh", overflowY: "auto" }}>
        {/* With narration on, the instruction is the details line under the
            spoken caption: smaller, and never read aloud (#86). */}
        <span
          data-testid="tour-instruction"
          data-role={leads ? "details" : "lead"}
          style={{ display: "block", ...(leads ? { fontSize: "var(--pnv-fs-13)", color: "var(--pnv-walkthrough-caption)", marginTop: 2 } : {}) }}
        >
          {instruction}
          {/* #1393: a boxed, red warning with a sign, so it doesn't read as
              part of the instruction. Both messages share the one box. */}
          {/* #173: a word from the app, such as why it started over. */}
          {notice && !finished && (
            <span
              data-testid="tour-notice"
              role="status"
              style={{ display: "block", marginTop: 3, fontSize: "var(--pnv-fs-14)", fontWeight: 600, color: "var(--pnv-walkthrough-label)" }}
            >
              {notice}
            </span>
          )}
          {/* #172: the model changed by a route nothing asked about. */}
          {offModel && !finished && (
            <span
              data-testid="tour-off-model"
              role="alert"
              style={{
                display: "flex",
                gap: 6,
                alignItems: "flex-start",
                marginTop: 3,
                padding: "2px 8px",
                fontSize: "var(--pnv-fs-14)",
                color: "var(--pnv-danger)",
                background: "var(--pnv-danger-tint)",
                border: "1px solid var(--pnv-danger)",
                borderRadius: 5,
              }}
            >
              <span aria-hidden="true" style={{ fontWeight: 700 }}>
                ⚠
              </span>
              <span>
                The model open here isn't this tutorial's. The steps wait until you go back to it, or end the tutorial.
              </span>
            </span>
          )}
          {missingNode && !opening && !offModel && (
            <span
              data-testid="tour-warning"
              role="alert"
              style={{
                display: "flex",
                gap: 6,
                alignItems: "flex-start",
                marginTop: 3,
                padding: "2px 8px",
                fontSize: "var(--pnv-fs-14)",
                color: "var(--pnv-danger)",
                background: "var(--pnv-danger-tint)",
                border: "1px solid var(--pnv-danger)",
                borderRadius: 5,
              }}
            >
              <span data-testid="tour-warning-icon" aria-hidden="true" style={{ fontWeight: 700 }}>
                ⚠
              </span>
              <span>
                <span data-testid="tour-missing-anchor" style={{ display: "block" }}>
                  This step looks for <code>{missingNode}</code>, which isn't in the model you have open.
                  {walkthrough.model && !modelPath ? ` Open ${walkthrough.model} to continue.` : ""}
                </span>
                {openFailed && (
                  <span data-testid="tour-open-failed" style={{ display: "block", fontWeight: 600 }}>
                    {walkthrough.model} didn't open.
                    {catalogReady
                      ? " If you kept unsaved changes, save them first, or open it from the Open menu."
                      : " The model list hasn't loaded — check that the PsyNeuView server is running."}
                  </span>
                )}
              </span>
            </span>
          )}
        </span>
        {/* The caption: always shown for a step that has one (#1310). */}
        {step && step.say && !finished && !complete && !holdForPointer && (
          <span
            data-testid="tour-caption-line"
            data-spoken={narration ? "true" : "false"}
            title={narration ? "Narration reads this line" : undefined}
            data-speaking={speaking ? "true" : "false"}
            style={
              leads
                ? {
                    // Narration on (#86): the caption leads the bar, still in
                    // italics (the cue testers found, #93), lit while read.
                    order: -1,
                    display: "block",
                    fontSize: "var(--pnv-fs-15)",
                    fontStyle: "italic",
                    color: "var(--pnv-walkthrough-text)",
                    padding: "1px 6px",
                    marginLeft: -6,
                    borderRadius: 4,
                    background: speaking ? "var(--pnv-primary-tint)" : "transparent",
                    transition: "background 150ms ease",
                  }
                : { display: "block", fontSize: "var(--pnv-fs-14)", color: "var(--pnv-walkthrough-caption)", marginTop: 2, fontStyle: "italic" }
            }
          >
            {/* With narration on, the line is headed "Narration" (#93): a
                word at full size, not a small icon, and not a voice's name,
                which read as a person. The voice follows in small type, and a
                click opens the one place it's chosen (Settings ▸ Tutorials and
                Voice). */}
            {narration && (
              <button
                type="button"
                data-testid="tour-caption-label"
                onClick={() => openSettings("tutorials-voice")}
                title="Narration reads this line. Click to choose the voice."
                style={{ border: "none", background: "none", padding: 0, marginRight: 6, cursor: "pointer", font: "inherit", fontStyle: "normal", color: "inherit" }}
              >
                <span style={{ fontWeight: 700 }}>Narration</span>
                {voice && (
                  <span data-testid="tour-caption-voice" style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-walkthrough-caption)" }}>
                    {" "}({voice})
                  </span>
                )}
                <span style={{ fontWeight: 700 }}>:</span>
              </button>
            )}
            <span data-testid="tour-caption">{step.say}</span>
          </span>
        )}
        {docs.length > 0 && (
          <span data-testid="tour-docs" style={{ display: "block", fontSize: "var(--pnv-fs-12)", color: "var(--pnv-walkthrough-docs)", marginTop: 2 }}>
            Based on:{" "}
            {docs.map((d, i) => (
              <span key={d}>
                {i > 0 ? ", " : ""}
                <a href={DOCS_URL_BASE + d} target="_blank" rel="noreferrer" style={{ color: "var(--pnv-walkthrough-label)" }}>
                  {d}
                </a>
              </span>
            ))}
          </span>
        )}
      </span>

      {offModel && !finished && (
        <>
          <button
            type="button"
            data-testid="tour-back-to-model"
            onClick={() => void returnToTutorialModel()}
            title="Open the tutorial's model here again, as you left it"
            style={{ ...barButton, fontWeight: 600 }}
          >
            Go back to the tutorial's model
          </button>
          <button type="button" data-testid="tour-end-off-model" onClick={stopTour} title="End this tutorial" style={barButton}>
            End tutorial
          </button>
        </>
      )}

      {offerWayBack && (
        <>
          {codeChanged && (
            <button
              type="button"
              data-testid="tour-undo-step"
              disabled={undoing}
              onClick={() => {
                setUndoing(true);
                void undoStepEdits().finally(() => setUndoing(false));
              }}
              title="Put the code back as it was when this step began. Your edits stay one Undo away."
              style={barButton}
            >
              Undo my edits since this step began
            </button>
          )}
          <button
            type="button"
            data-testid="tour-start-over"
            onClick={startTutorialOver}
            title="Go back to step 1, with a fresh copy of the tutorial's model"
            style={barButton}
          >
            Start the tutorial over
          </button>
        </>
      )}

      {missingNode && !opening && !offModel && !modelPath && walkthrough.model && openCatalogModel && (
        <button
          type="button"
          data-testid="tour-open-model"
          onClick={() => tryOpen(openCatalogModel, walkthrough.model!)}
          style={barButton}
        >
          Open {walkthrough.model}
        </button>
      )}

      {!complete && !finished && anchorOffScreen && (
        <button
          type="button"
          data-testid="tour-fit"
          onClick={fitGraph}
          style={barButton}
        >
          That node is off-screen — fit the graph
        </button>
      )}

      {/* Next: for a step that only explains. Shown only when the step says so. */}
      {step && !complete && !finished && step.done.next && !holdForPointer && (
        <button type="button" data-testid="tour-next" onClick={pressNext} title="Go on to the next step" style={{ ...barButton, fontWeight: 600, color: "var(--pnv-walkthrough-current)" }}>
          Next ▸
        </button>
      )}

      {/* Playback (#1310): pause the walkthrough, replay this step, skip it. */}
      {!finished && (
        <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button
            type="button"
            data-testid="tour-pause"
            onClick={() => setPaused(!paused)}
            title={paused ? "Resume: the walkthrough moves on again" : "Pause: nothing moves on until you resume"}
            style={{ ...barButton, background: paused ? "var(--pnv-warning-tint)" : "var(--pnv-surface)" }}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            data-testid="tour-replay"
            onClick={replay}
            title="Replay this step: the pointer and the caption again"
            style={barButton}
          >
            Replay
          </button>
          <button
            type="button"
            data-testid="tour-skip"
            onClick={advance}
            title="Skip this step"
            style={barButton}
          >
            Skip
          </button>
          <button
            type="button"
            data-testid="tour-narration"
            onClick={() => setNarration(!narration)}
            disabled={!canNarrate}
            aria-pressed={narration}
            title={
              canNarrate
                ? narration
                  ? "Narration is on: captions are read aloud. Click to turn it off."
                  : "Narration is off. Click to have captions read aloud (uses your browser's voice)."
                : "This browser can't read captions aloud"
            }
            style={{ ...barButton, background: narration ? "var(--pnv-primary-tint)" : "var(--pnv-surface)", color: canNarrate ? "var(--pnv-walkthrough-text)" : "var(--pnv-text-faint)" }}
          >
            {narration ? "🔊 Narration on" : "🔇 Narration off"}
          </button>
        </span>
      )}

      <button
        type="button"
        data-testid="tour-dismiss"
        onClick={stopTour}
        title="End this walkthrough"
        style={barButton}
      >
        End
      </button>
    </div>
  );
}

const barButton: React.CSSProperties = {
  flexShrink: 0,
  padding: "3px 10px",
  borderRadius: 5,
  border: "1px solid var(--pnv-walkthrough-border)",
  background: "var(--pnv-surface)",
  cursor: "pointer",
  fontSize: "var(--pnv-fs-13)",
  color: "var(--pnv-walkthrough-text)",
};
