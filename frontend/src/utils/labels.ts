/**
 * Semantic element-name labels resolver (#361 three-layer plan).
 *
 * Returns labels for the elements of a given node + port. The PsyNeuLink fork
 * carries `element_names` model-intrinsically (Layer 1, jonhanke-nam/PsyNeuLink#11)
 * and the propagation pass fills downstream identity-projection chains and
 * CIM boundaries automatically; the sidecar (Layer 3) is a per-model override.
 * Resolver precedence is always model-intrinsic first, sidecar second.
 *
 * The sidecar shape (per `backend/app/services/labels.py`):
 *
 *   word_hidden:
 *     element_names: [red_word, green_word]    # shorthand: default ports
 *
 *   output:
 *     output_ports:
 *       OutputPort-0:
 *         element_names: [response_red, response_green]
 *     input_ports:
 *       InputPort-0:
 *         element_names: [hidden_left, hidden_right]
 */

export type PortLabels = Record<
  string,
  {
    element_names?: string[];
    // #404: optional display label for the port itself — a render-time
    // override that doesn't affect PsyNeuLink's internal ``port.name``.
    display_name?: string;
  }
>;
export type NodeLabels = {
  element_names?: string[];
  input_ports?: PortLabels;
  output_ports?: PortLabels;
  // #564: label each component of a node's ``value`` by position, for the
  // Run panel / Run State rows. PsyNeuLink's ``value`` can have more
  // components than the mechanism has ``OutputPort`` objects (e.g. an
  // LCControlMechanism surfaces gain + the FitzHugh-Nagumo v/w/time as
  // value components but only one real ControlSignal port). Those extra
  // components have no stable port name to key on, so they're named by
  // index here instead.
  value_labels?: string[];
};
export type ModelLabels = Record<string, NodeLabels>;

const DEFAULT_OUTPUT_PORT = "OutputPort-0";

/**
 * Look up a node's labels, tolerating the per-run instance suffix that
 * run-trace keys carry (e.g. ``LC-7``) but the sidecar's clean keys
 * (``LC``) don't. Match the raw key first so a node legitimately named
 * ``foo-2`` still resolves, then fall back to the ``-\d+$``-stripped form —
 * the same normalization the Run panel already applies to display headers
 * and ``nodeMeta`` lookups. Without this, per-trial value rows in the Run /
 * Run State panels never resolve element_names or value_labels (#564 follow-up).
 */
function lookupNode(
  labels: ModelLabels | null | undefined,
  nodeName: string,
): NodeLabels | undefined {
  if (!labels) return undefined;
  return labels[nodeName] ?? labels[nodeName.replace(/-\d+$/, "")];
}

/**
 * Resolve a port's display name (#404 Layer 3 parallel for ports). Returns
 * the sidecar ``display_name`` when set, otherwise null — callers fall back
 * to PsyNeuLink's raw ``port.name``.
 *
 * ``kind`` distinguishes input vs output port lookups; element_names already
 * uses that split via ``input_ports`` / ``output_ports``.
 */
export function resolvePortDisplayName(
  labels: ModelLabels | null | undefined,
  nodeName: string,
  portName: string,
  kind: "input" | "output" = "output",
): string | null {
  if (!labels) return null;
  const node = lookupNode(labels, nodeName);
  if (!node) return null;
  const portsKey = kind === "input" ? "input_ports" : "output_ports";
  const display = node[portsKey]?.[portName]?.display_name;
  return display && display.length > 0 ? display : null;
}

/**
 * Resolve labels for one of a node's ports.
 *
 * Precedence (PsyNeuView #356 three-layer plan):
 *  1. **Model-intrinsic** (Layer 1, PsyNeuLink#11): if the port object
 *     itself carries ``element_names`` — passed through ``ports`` from
 *     the introspector — use those. Includes labels propagated by
 *     ``Composition._propagate_element_names`` (identity projections,
 *     CIM mirroring, nested Compositions).
 *  2. **Sidecar per-port** (Layer 3): explicit ``<kind>_ports.<portName>.
 *     element_names`` in ``labels.yaml``.
 *  3. **Sidecar shorthand** (Layer 3): node-level ``element_names`` in
 *     ``labels.yaml``.
 *
 * Returns ``null`` when nothing applies; callers fall back to the
 * indexed array rendering.
 */
function resolvePortLabels(
  labels: ModelLabels | null | undefined,
  nodeName: string,
  portName: string,
  kind: "input" | "output",
  ports?: { name: string; element_names?: string[] | null }[],
): string[] | null {
  // Layer 1: model-intrinsic on the port object. The introspector
  // only includes ``element_names`` when set, so a missing key here
  // means the model didn't carry labels.
  if (ports) {
    const port = ports.find((p) => p.name === portName);
    if (port?.element_names && port.element_names.length > 0) {
      return port.element_names;
    }
  }
  if (!labels) return null;
  const node = lookupNode(labels, nodeName);
  if (!node) return null;
  const portsKey = kind === "input" ? "input_ports" : "output_ports";
  const portSpecific = node[portsKey]?.[portName]?.element_names;
  if (portSpecific && portSpecific.length > 0) return portSpecific;
  if (node.element_names && node.element_names.length > 0) return node.element_names;
  return null;
}

export function resolveOutputLabels(
  labels: ModelLabels | null | undefined,
  nodeName: string,
  portName: string = DEFAULT_OUTPUT_PORT,
  outputPorts?: { name: string; element_names?: string[] | null }[],
): string[] | null {
  return resolvePortLabels(labels, nodeName, portName, "output", outputPorts);
}

/**
 * Resolve the sidecar ``value_labels`` entry for a node's value component at
 * ``index`` (#564). Returns the positional label or ``null`` when none is set
 * (callers fall back to the port's display name / raw ``OutputPort-i``).
 */
export function resolveValueLabel(
  labels: ModelLabels | null | undefined,
  nodeName: string,
  index: number,
): string | null {
  const valueLabels = lookupNode(labels, nodeName)?.value_labels;
  if (!valueLabels || index < 0 || index >= valueLabels.length) return null;
  const name = valueLabels[index];
  return name && name.length > 0 ? name : null;
}

/**
 * Mirror of ``resolveOutputLabels`` for input ports. The precedence is
 * the same; the only difference is which ``<kind>_ports`` key in the
 * sidecar is consulted. With PsyNeuLink propagation now filling
 * ``InputPort.element_names`` on identity-projection receivers,
 * Layer 1 typically already has the answer for inner mechanisms.
 */
export function resolveInputLabels(
  labels: ModelLabels | null | undefined,
  nodeName: string,
  portName: string,
  inputPorts?: { name: string; element_names?: string[] | null }[],
): string[] | null {
  return resolvePortLabels(labels, nodeName, portName, "input", inputPorts);
}

/**
 * Format a 1-D value array against labels: `{red_word: 0.27, green_word: 0.00}`.
 * Falls back to the raw array string if labels are absent or don't match the
 * value length (labels mismatched length is a silent fail — the caller already
 * had the raw rendering as a fallback).
 *
 * Accepts the [[v0, v1, …]] outer-list wrapping PsyNeuLink uses for port values.
 */
export function formatLabeledValue(
  value: unknown,
  labels: string[] | null,
  opts: { maxLen?: number } = {},
): string {
  const { maxLen = 40 } = opts;
  if (!labels) return jsonRound(value, maxLen);

  const flat = flattenIfSingleOuter(value);
  if (!Array.isArray(flat) || flat.length !== labels.length) {
    return jsonRound(value, maxLen);
  }

  const parts = labels.map((name, i) => `${name}:${roundNum(flat[i])}`);
  const full = `{${parts.join(", ")}}`;
  return full.length > maxLen ? full.slice(0, maxLen - 1) + "…" : full;
}

/**
 * Per-element delta between two trials' values for the same node/port (#466).
 * Returns a compact string naming only the elements that moved by more than
 * ``eps`` — e.g. ``red_ink +0.04, green_ink -0.02`` — so a converged output
 * (every element steady) yields ``null`` and renders no diff scaffolding.
 * Elements present in ``curr`` but not ``prev`` are flagged ``(new)``.
 */
export function formatDelta(
  prev: unknown,
  curr: unknown,
  labels: string[] | null,
  opts: { eps?: number } = {},
): string | null {
  // Below 1e-4 the rounded display can't even show a difference, so treat it
  // as noise. roundNum rounds to 4 decimals — keep the floor in step with it.
  const { eps = 1e-4 } = opts;
  const prevFlat = flattenIfSingleOuter(prev);
  const currFlat = flattenIfSingleOuter(curr);
  // No previous trial at all (e.g. the first card) → nothing to diff. The
  // ``(new)`` branch below is reserved for the rare case where a predecessor
  // exists but this element appeared since (shape grew).
  if (!Array.isArray(currFlat) || !Array.isArray(prevFlat)) return null;

  const nameFor = (i: number) =>
    labels && labels.length === currFlat.length ? labels[i] : `[${i}]`;

  const parts: string[] = [];
  for (let i = 0; i < currFlat.length; i++) {
    const c = currFlat[i];
    if (typeof c !== "number") continue;
    const p = Array.isArray(prevFlat) ? prevFlat[i] : undefined;
    if (typeof p !== "number") {
      parts.push(`${nameFor(i)} (new) ${roundNum(c)}`);
      continue;
    }
    const d = c - p;
    if (Math.abs(d) > eps) parts.push(`${nameFor(i)} ${d >= 0 ? "+" : ""}${roundNum(d)}`);
  }
  return parts.length ? parts.join(", ") : null;
}

/**
 * Multi-line rendering for tooltips: one ``label: value`` per row. Returns
 * lines rather than a joined string so the caller can style them.
 */
export function labeledValueLines(
  value: unknown,
  labels: string[] | null,
): string[] | null {
  if (!labels) return null;
  const flat = flattenIfSingleOuter(value);
  if (!Array.isArray(flat) || flat.length !== labels.length) return null;
  return labels.map((name, i) => `${name}: ${roundNum(flat[i])}`);
}

/**
 * One port's worth of state, after splitting a multi-port mechanism value
 * into per-port pieces. Used by Run State + Inspector to render each port
 * on its own row so multi-port mechanisms (controllers, modulators) don't
 * get smashed into one ellipsized string. See #401.
 */
export type PortEntry = {
  portName: string;
  // #404: optional display override from the sidecar. When non-null,
  // surfaces in the UI in place of ``portName``; ``portName`` itself is
  // kept around for hover-tooltip use (so a debugger can still see the
  // technical PNL identifier).
  displayName: string | null;
  value: unknown;
  labels: string[] | null;
};

/**
 * Split a multi-port mechanism value into per-port entries. PsyNeuLink
 * serializes a node's full value as ``[port0_value, port1_value, …]`` where
 * each port value is itself usually ``[[v_0, v_1, …]]`` (1-D wrapped). When
 * the outer length is > 1 *and* every element is itself an array, treat the
 * outer axis as the port axis.
 *
 * Returns ``null`` for single-port values (the existing single-line render
 * is fine), so callers can branch on the return.
 */
export function expandMultiPort(
  value: unknown,
  outputPorts:
    | { name: string; shape: number[]; element_names?: string[] | null }[]
    | undefined,
  nodeName: string,
  modelLabels: ModelLabels | null | undefined,
): PortEntry[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length <= 1) return null;
  if (!value.every((p) => Array.isArray(p))) return null;
  return value.map((portValue, i) => {
    const portName = outputPorts?.[i]?.name ?? `OutputPort-${i}`;
    // #564: a positional ``value_labels`` entry names the run-panel row
    // directly — it takes precedence over the port's ``display_name`` so
    // value components without a real OutputPort (LC's v/w/time) are still
    // named, and the row stays stable regardless of port metadata.
    const valueLabel = resolveValueLabel(modelLabels, nodeName, i);
    return {
      portName,
      displayName: valueLabel ?? resolvePortDisplayName(modelLabels, nodeName, portName, "output"),
      value: portValue,
      // Pass the outputPorts through so the resolver can use Layer 1
      // (model-intrinsic ``element_names`` on the port object) before
      // falling through to the sidecar.
      labels: resolveOutputLabels(modelLabels, nodeName, portName, outputPorts),
    };
  });
}

// --- helpers ---------------------------------------------------------------

function flattenIfSingleOuter(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  // PsyNeuLink wraps port values as [[v0, v1, …]] (outer = port axis with
  // length 1). Unwrap the single-element outer list so labels can match.
  if (value.length === 1 && Array.isArray(value[0])) return value[0] as unknown[];
  return value as unknown[];
}

function roundNum(v: unknown): string {
  if (typeof v !== "number") return String(v);
  return String(Math.round(v * 10000) / 10000);
}

function jsonRound(v: unknown, maxLen: number): string {
  const roundDeep = (x: unknown): unknown =>
    typeof x === "number"
      ? Math.round(x * 10000) / 10000
      : Array.isArray(x)
      ? x.map(roundDeep)
      : x;
  const full = JSON.stringify(roundDeep(v));
  if (full === undefined) return "";
  return full.length > maxLen ? full.slice(0, maxLen - 1) + "…" : full;
}
