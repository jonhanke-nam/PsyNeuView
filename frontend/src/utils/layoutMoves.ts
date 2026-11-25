/**
 * A count of the user's moves on the canvas: a node dragged, an arrow
 * reshaped, the inputs and outputs tidied (#444).
 *
 * Switching Layout: Auto / Custom reloads the model to pick up the saved
 * layout, which takes from half a second to a few seconds. A node dragged
 * while that reload is out used to be put back when it landed, so the drag
 * was lost. The switch reads the count when it sends the reload and drops the
 * reply if the count has moved: what the user did since wins, and it has
 * been saved as the custom layout.
 *
 * A plain counter, not store state: it changes on every pointer move during
 * a drag and nothing needs to re-render when it does.
 */

let moves = 0;

/** The user moved something on the canvas. */
export function noteLayoutMove(): void {
  moves += 1;
}

/** How many moves so far; compare two readings to see if any came between. */
export function layoutMoveCount(): number {
  return moves;
}
