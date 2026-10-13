// Build default sidecar payloads from the current model/canvas state (#477).
//
// Layout: node positions keyed by PsyNeuLink varName (the same key
// save-layout writes and applyLayoutPositions reads). "Add" seeds from the
// positions on screen; "reset" re-snaps via the active auto-layout engine.
//
// Labels: a per-node element_names scaffold sized to each port, pre-filled
// with the model-intrinsic names where present so the user starts from what
// the canvas already shows and edits from there.

import type { Node, Edge } from "@xyflow/react";
import { applyLayout } from "./layout";
import { useGraphSettings } from "@/stores/graphSettingsStore";

type Positions = Record<string, { x: number; y: number }>;
type Port = { name: string; shape?: number[]; element_names?: string[] | null };

export function layoutPositionsFromNodes(nodes: Node[]): Positions {
  const positions: Positions = {};
  for (const n of nodes) {
    const vn = (n.data as any)?.varName || n.id;
    positions[vn] = { x: n.position.x, y: n.position.y };
  }
  return positions;
}

export function autoLayoutPositions(nodes: Node[], edges: Edge[]): Positions {
  const { layoutStyle, direction } = useGraphSettings.getState();
  return layoutPositionsFromNodes(applyLayout(layoutStyle, nodes, edges, { direction }));
}

function elementCount(port: Port): number {
  if (port.element_names && port.element_names.length) return port.element_names.length;
  if (Array.isArray(port.shape) && port.shape.length) {
    return port.shape.reduce((a, b) => a * b, 1);
  }
  return 0;
}

function elementNames(port: Port): string[] {
  const n = elementCount(port);
  if (port.element_names && port.element_names.length === n) return [...port.element_names];
  return Array.from({ length: n }, (_, i) => `dim_${i}`);
}

export function labelsSeedFromNodes(nodes: Node[]): Record<string, unknown> {
  const labels: Record<string, unknown> = {};
  for (const n of nodes) {
    const data = n.data as any;
    const vn = data?.varName;
    if (!vn) continue;
    const inP: Port[] = data.inputPorts ?? [];
    const outP: Port[] = data.outputPorts ?? [];
    const hasIn = inP.some((p) => elementCount(p) > 0);
    const hasOut = outP.some((p) => elementCount(p) > 0);
    if (!hasIn && !hasOut) continue;

    // Shape-preserving single-port mechanisms (the TransferMechanism common
    // case) collapse to the `element_names` shorthand that applies to both
    // the default input and output port.
    if (
      inP.length === 1 &&
      outP.length === 1 &&
      elementCount(inP[0]) > 0 &&
      elementCount(inP[0]) === elementCount(outP[0])
    ) {
      labels[vn] = { element_names: elementNames(inP[0]) };
      continue;
    }

    const entry: Record<string, unknown> = {};
    const inEntries: Record<string, unknown> = {};
    for (const p of inP) {
      if (elementCount(p) > 0) inEntries[p.name] = { element_names: elementNames(p) };
    }
    const outEntries: Record<string, unknown> = {};
    for (const p of outP) {
      if (elementCount(p) > 0) outEntries[p.name] = { element_names: elementNames(p) };
    }
    if (Object.keys(inEntries).length) entry.input_ports = inEntries;
    if (Object.keys(outEntries).length) entry.output_ports = outEntries;
    if (Object.keys(entry).length) labels[vn] = entry;
  }
  return labels;
}
