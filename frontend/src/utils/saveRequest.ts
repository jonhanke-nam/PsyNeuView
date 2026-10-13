/**
 * Asking for a Save. (#1347)
 *
 * The code editor owns the one save routine (`saveAndRefresh` in
 * CodeEditor.tsx). The toolbar's Save button reaches it with this event; so
 * does autosave, so an automatic save is exactly a press of Save — the same
 * request, the same checks for a changed file, the same error messages.
 *
 * The detail is optional: the toolbar sends none. Autosave passes one to
 * learn whether anything heard the request (the editor may not be mounted)
 * and when the save has finished, and to have the save marked as automatic
 * in History (#1349). "Revert the file to this save" passes the text to
 * write, so a revert is this same Save too: the same check for a file that
 * changed on disk, the same errors.
 */

export const SAVE_EVENT = "psynewview:save";

export interface SaveRequestDetail {
  /** Set by the listener, synchronously, when it takes the request. */
  accepted?: boolean;
  /** Called by the listener when the save has finished, saved or not. */
  done?: () => void;
  /** An autosave, so History marks it as automatic (#1349). */
  automatic?: boolean;
  /** Write this text rather than the editor's (a revert, #1349). */
  source?: string;
  /** For a revert: when the save being gone back to was made. */
  revertedTo?: number;
}

/** What kind of save to ask for. */
export type SaveRequestOptions = Pick<SaveRequestDetail, "automatic" | "source" | "revertedTo">;

/** Press Save. Resolves false if nothing was listening, else when it finished. */
export function requestSave(opts: SaveRequestOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const detail: SaveRequestDetail = { ...opts, done: () => resolve(true) };
    window.dispatchEvent(new CustomEvent<SaveRequestDetail>(SAVE_EVENT, { detail }));
    if (!detail.accepted) resolve(false);
  });
}

/**
 * Open **Save a copy as…** (#1346). The dialog lives in the toolbar; the code
 * editor's banner for a permanently protected model points to it with this.
 */
export const SAVE_COPY_EVENT = "psynewview:save-copy";

export function requestSaveCopy(): void {
  window.dispatchEvent(new CustomEvent(SAVE_COPY_EVENT));
}
