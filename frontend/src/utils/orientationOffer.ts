/**
 * The one-time offer of the new-user orientation (#1310).
 *
 * The first time PsyNeuView opens in a browser, it offers **PsyNeuView First
 * Steps**, the eight short walkthroughs of the app itself. The offer is
 * made once, and what the person chose is remembered per browser:
 *
 *  - **Start** begins part 1; the offer is over.
 *  - **Maybe later** closes it; the Tutorials menu then carries a reminder
 *    until a part is started or the reminder is dismissed.
 *  - **No thanks** closes it for good. The walkthroughs stay in the menu.
 *
 * It is never shown over a walkthrough that is already starting (`?tour=`),
 * and the e2e harness seeds the choice so no test meets it by surprise; a test
 * about the offer clears the key itself.
 *
 * Pure decisions here; the dialog is `components/common/OrientationOffer.tsx`.
 */

export const ORIENTATION_OFFER_KEY = "psyneuview.orientation.offer";

/** What was chosen, or null when the offer has not been made. */
export type OfferChoice = "started" | "later" | "never";

export function readOfferChoice(storage: Pick<Storage, "getItem"> | null = safeStorage()): OfferChoice | null {
  try {
    const v = storage?.getItem(ORIENTATION_OFFER_KEY);
    return v === "started" || v === "later" || v === "never" ? v : null;
  } catch {
    return null;
  }
}

export function writeOfferChoice(choice: OfferChoice, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(ORIENTATION_OFFER_KEY, choice);
  } catch {
    // Storage blocked: the offer may come back next time. Acceptable.
  }
}

/** Forget the choice, so the offer is made again (Settings ▸ Tutorials and Voice). */
export function clearOfferChoice(storage: Pick<Storage, "removeItem"> | null = safeStorage()): void {
  try {
    storage?.removeItem(ORIENTATION_OFFER_KEY);
  } catch {
    // Storage blocked: nothing was remembered either.
  }
}

/**
 * Whether to show the offer now.
 *
 * `search` is the page's query string: a link straight to a walkthrough
 * (`?tour=…`) already knows what it wants, so no offer. Storage that can't be
 * read counts as "never asked" — but see `writeOfferChoice`: the answer will
 * then be asked again, which beats never asking.
 */
export function shouldOfferOrientation(choice: OfferChoice | null, search: string): boolean {
  if (choice !== null) return false;
  if (new URLSearchParams(search).has("tour")) return false;
  return true;
}

/** Whether the Tutorials menu should carry the "maybe later" reminder. */
export function shouldRemindFromMenu(choice: OfferChoice | null): boolean {
  return choice === "later";
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
