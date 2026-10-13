/**
 * Open a catalog model by its menu label, from outside the Open menu (#1224).
 *
 * A walkthrough names the model it was written for ("Stroop — Basic"), but the
 * code that opens reference and demo models lives in the toolbar's Open menu.
 * The toolbar registers these two functions here, so a walkthrough can open its
 * model through the same path a click would take, including the "discard
 * unsaved changes?" prompt.
 */

import { create } from "zustand";

interface CatalogOpenerState {
  /** Opens the model; false if no catalog model has that label, or it was declined. */
  open: ((label: string) => Promise<boolean>) | null;
  /** Whether the model with that label is the one open now. */
  isOpen: ((label: string) => boolean) | null;
  /**
   * The Open menu section that lists it ("references", "demos"), so a
   * walkthrough can ring the section while it is folded (#1392).
   */
  sectionOf: ((label: string) => string | null) | null;
  /**
   * The catalog lists have loaded. A walkthrough started from `?tour=` begins
   * before they have, and asking earlier would find nothing to open.
   */
  ready: boolean;
  register: (fns: {
    open: (label: string) => Promise<boolean>;
    isOpen: (label: string) => boolean;
    sectionOf: (label: string) => string | null;
    ready: boolean;
  }) => void;
}

export const useCatalogOpener = create<CatalogOpenerState>((set) => ({
  open: null,
  isOpen: null,
  sectionOf: null,
  ready: false,
  register: ({ open, isOpen, sectionOf, ready }) => set({ open, isOpen, sectionOf, ready }),
}));
