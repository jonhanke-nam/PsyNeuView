/**
 * Autosave's timer, wired to the stores (#1347). Mounted once, by the
 * toolbar's autosave status.
 *
 * Activity is an edit to the model: any change to the editor's text that
 * leaves it different from what is saved (graph and inspector edits are
 * written when made, so they leave nothing to autosave). Each one starts the
 * wait over; N
 * seconds after the last, if there are unsaved changes and nothing in
 * `autosaveBlock` stops it, it presses Save (`requestSave`). The rules are
 * in utils/autosave.ts.
 */

import { useEffect } from "react";
import { useAutosaveStore } from "@/stores/autosaveStore";
import { useEditLockStore } from "@/stores/editLockStore";
import { useExternalChangeStore } from "@/stores/externalChangeStore";
import { useModelStore } from "@/stores/modelStore";
import { isProtected, usePnlSourceStore } from "@/stores/pnlSourceStore";
import { record } from "@/utils/activityLog";
import { autosaveBlock, createAutosaveScheduler, type AutosaveInputs } from "@/utils/autosave";
import { requestSave } from "@/utils/saveRequest";

/** What the rules need, read from the stores now. */
export function currentAutosaveInputs(): AutosaveInputs {
  const m = useModelStore.getState();
  const a = useAutosaveStore.getState();
  const pending = useExternalChangeStore.getState().pending;
  return {
    filePath: m.filePath,
    bundleOrigin: m.bundleOrigin,
    pnlProtected: isProtected(usePnlSourceStore.getState().status),
    viewOnly: useEditLockStore.getState().mode === "viewOnly",
    externalChangePending: !!pending,
    diskChangedSinceSave: !!m.filePath && a.diskChangedPath === m.filePath,
    modelError: !!m.modelError || m.graphIsStale,
    sourceBuilt: m.lastGoodSource === m.source,
    saving: a.savesInFlight > 0,
  };
}

export function useAutosave() {
  useEffect(() => {
    void useAutosaveStore.getState().load();
  }, []);

  useEffect(() => {
    const autosave = useAutosaveStore;
    const setIfChanged = (patch: Partial<ReturnType<typeof autosave.getState>>) => {
      const s = autosave.getState() as unknown as Record<string, unknown>;
      if (Object.entries(patch).some(([k, v]) => s[k] !== v)) autosave.setState(patch);
    };

    const scheduler = createAutosaveScheduler({
      delayMs: () => autosave.getState().seconds * 1000,
      enabled: () => autosave.getState().enabled,
      dirty: () => {
        const m = useModelStore.getState();
        return !!m.filePath && m.source !== m.savedSource;
      },
      block: () => autosaveBlock(currentAutosaveInputs()),
      onChange: () => setIfChanged({ due: scheduler.isDue() }),
      save: async () => {
        const m = useModelStore.getState();
        const filePath = m.filePath!;
        const sent = m.source;
        setIfChanged({ autosaving: true });
        record("model", `Autosave: saving ${filePath}`, { path: filePath, autosave: true });
        const heard = await requestSave({ automatic: true });
        const after = useModelStore.getState();
        const saved = heard && after.filePath === filePath && after.savedSource === sent;
        autosave.setState({
          autosaving: false,
          ...(saved ? { lastAutosaved: { filePath, at: Date.now() }, lastFailedPath: null } : { lastFailedPath: filePath }),
        });
      },
    });

    const unsubModel = useModelStore.subscribe((s, prev) => {
      if (s.filePath !== prev.filePath) {
        // A different model: nothing carries over.
        setIfChanged({ diskChangedPath: null, lastFailedPath: null });
      } else if (s.savedSource !== prev.savedSource) {
        // Saved, or the disk version taken: the file and the editor agree again.
        setIfChanged({ diskChangedPath: null });
      }
      if (s.source !== prev.source && s.filePath && s.source !== s.savedSource) {
        if (autosave.getState().lastFailedPath === s.filePath) setIfChanged({ lastFailedPath: null });
        scheduler.activity();
      } else {
        scheduler.recheck();
      }
    });

    const unsubExternal = useExternalChangeStore.subscribe((s) => {
      // The file changed on disk under unsaved edits. Even after "Keep my
      // changes" the file holds the other editor's version, so autosave stays
      // paused until a Save (the user choosing) or a reload.
      const open = useModelStore.getState().filePath;
      if (s.pending && s.pending.filePath === open) setIfChanged({ diskChangedPath: open });
      scheduler.recheck();
    });

    const unsubLock = useEditLockStore.subscribe(() => scheduler.recheck());
    const unsubPnl = usePnlSourceStore.subscribe(() => scheduler.recheck());

    const unsubSetting = autosave.subscribe((s, prev) => {
      if (s.enabled !== prev.enabled || s.seconds !== prev.seconds) {
        // Turned on (or the delay changed): start the wait now, as if the last
        // edit had just happened. Turned off: this clears the timer.
        scheduler.activity();
        return;
      }
      if (s.savesInFlight !== prev.savesInFlight) scheduler.recheck();
    });

    return () => {
      scheduler.dispose();
      unsubModel();
      unsubExternal();
      unsubLock();
      unsubPnl();
      unsubSetting();
    };
  }, []);
}
