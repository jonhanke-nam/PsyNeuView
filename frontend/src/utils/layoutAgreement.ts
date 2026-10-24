/**
 * How closely a drawn graph agrees with show_graph's picture of it (#34).
 *
 * Compares where PsyNeuView drew each node with where show_graph (Graphviz,
 * on show_graph's own description) puts the node of the same name. Only
 * relations are compared — which node is above, below or level with which,
 * and which is left of which in a row — so the two pictures' different sizes
 * and scales don't matter.
 *
 * Both inputs are node centers with y growing downward, in any units.
 */

export interface Center {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Agreement {
  /** Nodes drawn on the canvas. */
  nodes: number;
  /** Of those, how many show_graph also draws. */
  matched: number;
  /** Canvas nodes show_graph doesn't draw. */
  unmatched: string[];
  /** Pairs of matched nodes whose vertical relation (above, level, below) agrees. */
  rows: { agree: number; pairs: number };
  /** Pairs on one show_graph row whose left/right order agrees. */
  order: { agree: number; pairs: number };
  /** Pairs of canvas boxes that overlap. */
  overlaps: [string, string][];
}

// show_graph's ranks share a y exactly; PsyNeuView centers come from them by
// one scale, plus rounding to whole pixels.
const LEVEL_REF = 0.5;
const LEVEL_DRAWN = 2;

const relation = (a: number, b: number, tol: number) => (Math.abs(a - b) <= tol ? 0 : Math.sign(b - a));

/**
 * Compare `drawn` (canvas boxes, top-left + size) with `reference`
 * (show_graph's node centers), by name.
 */
export function measureAgreement(drawn: Map<string, Box>, reference: Map<string, Center>): Agreement {
  const names = [...drawn.keys()];
  const matched = names.filter((n) => reference.has(n));
  const center = (b: Box): Center => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

  const rows = { agree: 0, pairs: 0 };
  const order = { agree: 0, pairs: 0 };
  for (let i = 0; i < matched.length; i++) {
    for (let j = i + 1; j < matched.length; j++) {
      const [ra, rb] = [reference.get(matched[i])!, reference.get(matched[j])!];
      const [da, db] = [center(drawn.get(matched[i])!), center(drawn.get(matched[j])!)];
      const vRef = relation(ra.y, rb.y, LEVEL_REF);
      rows.pairs++;
      if (vRef === relation(da.y, db.y, LEVEL_DRAWN)) rows.agree++;
      if (vRef === 0) {
        order.pairs++;
        if (relation(ra.x, rb.x, LEVEL_REF) === relation(da.x, db.x, LEVEL_DRAWN)) order.agree++;
      }
    }
  }

  const overlaps: [string, string][] = [];
  const boxes = [...drawn.entries()];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i][1], boxes[j][1]];
      // A pixel of slack: boxes drawn edge to edge don't overlap.
      if (a.x + a.w > b.x + 1 && b.x + b.w > a.x + 1 && a.y + a.h > b.y + 1 && b.y + b.h > a.y + 1) {
        overlaps.push([boxes[i][0], boxes[j][0]]);
      }
    }
  }

  return {
    nodes: names.length,
    matched: matched.length,
    unmatched: names.filter((n) => !reference.has(n)),
    rows,
    order,
    overlaps,
  };
}

/** A fraction as a share, 1 when there was nothing to compare. */
export const share = ({ agree, pairs }: { agree: number; pairs: number }) => (pairs === 0 ? 1 : agree / pairs);
