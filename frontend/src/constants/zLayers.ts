/**
 * Stacking layers that must agree across the app.
 *
 * A walkthrough's ring and pointer (TourOverlay) sit above Settings and the
 * other dialogs (10000), so a step can ring something inside them; the
 * walkthrough bar is just under it. Menus and popovers someone opens are the
 * highest priority of all: they sit above the ring, so its pulse never covers
 * the item being chosen (in 0.6.6 the Tutorials menu hid behind it).
 */
export const Z_DIALOG = 10000;
export const Z_TOUR_BAR = 10001;
export const Z_TOUR_OVERLAY = 10002;
export const Z_MENU = 10003;

/**
 * Where a dialog's backdrop ends at the bottom: just above the walkthrough
 * bar while one is running, so the bar (drawn above dialogs, for the
 * walkthroughs about Settings) never covers a dialog's last rows. TourBar
 * keeps the variable at its height, and clears it when it closes.
 */
export const DIALOG_SCRIM_BOTTOM = "var(--pnv-tour-bar-height, 0px)";
