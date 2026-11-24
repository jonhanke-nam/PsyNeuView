/**
 * The Learn panel's grids for nodes with several input ports (#358).
 *
 * The grid keeps one row of boxes per trial, one box per element. A node
 * with several input ports lays its ports' boxes side by side, each group
 * headed by its port's name, and a trial is sent as one array per port, as
 * `Composition.learn` takes it (the Run panel's per-port fields, #332).
 */

export interface PortLike {
  name: string;
  shape?: number[] | null;
}

/** How many elements each port the grid edits has: every input port of a
 *  multi-port input node, else the first port alone, as before. */
export function gridPortSizes(ports: PortLike[], fallbackShape: number[], allPorts: boolean): number[] {
  if (allPorts && ports.length > 1) return ports.map((p) => p.shape?.[0] || 1);
  return [fallbackShape[0] || ports[0]?.shape?.[0] || 1];
}

/** A trial's boxes, one per element across all ports, as what the backend
 *  takes: the flat vector for one port, one array per port for several. */
export function trialForPorts(flat: number[], sizes: number[]): number[] | number[][] {
  if (sizes.length <= 1) return flat;
  let k = 0;
  return sizes.map((n) => {
    const part = flat.slice(k, k + n);
    k += n;
    return part;
  });
}

/** A declared set's trial as one box per element: a multi-port trial
 *  `[[1, 0], [1]]` is laid out across the ports as `[1, 0, 1]`. */
export function flatTrial(row: unknown): unknown[] {
  if (!Array.isArray(row)) return [row];
  return row.every((v) => Array.isArray(v)) && row.length > 0 ? (row as unknown[][]).flat() : row;
}
