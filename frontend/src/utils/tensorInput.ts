/**
 * Trial inputs written as arrays (#330): `[0, 1]` for a two-element input,
 * nested brackets for a 2-D one, `[[0, 1], [1]]` for a node with several
 * input ports — the same notation as the values passed to PsyNeuLink's
 * `Composition.run(inputs={node: [trial, …]})`, and as the Results panel
 * prints its rows.
 *
 * The Run panel keeps one text per trial per input port (`string[]` per
 * trial, one entry per port). This module turns that text into numbers,
 * checks it against the port's shape, and writes numbers back as text.
 * Kept out of the panel so the rules can be unit-tested.
 *
 * Accepted, besides the standard `[0, 1]`:
 *   - numpy's printed form, with spaces for commas: `[0. 1.]`
 *   - one extra pair of brackets round a single port's value, `[[0, 1]]`,
 *     which PsyNeuLink also accepts for a one-port node
 *   - a bare number for a port of one element: `1`
 */

/** A number, or a (possibly nested) list of them. */
export type Tensor = number | Tensor[];

export type ParseResult = { ok: true; value: Tensor } | { ok: false; error: string };

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/;

/**
 * Parse one array in bracket notation. Elements are separated by commas or,
 * as numpy prints them, by spaces. Every number must be finite.
 */
export function parseTensor(text: string): ParseResult {
  let i = 0;
  const s = text;
  const skipSpace = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const fail = (error: string): ParseResult => ({ ok: false, error });

  const parseValue = (): ParseResult => {
    skipSpace();
    if (i >= s.length) return fail("Missing a number or [");
    if (s[i] === "[") {
      i++;
      const items: Tensor[] = [];
      skipSpace();
      if (s[i] === "]") {
        i++;
        return { ok: true, value: items };
      }
      for (;;) {
        const item = parseValue();
        if (!item.ok) return item;
        items.push(item.value);
        skipSpace();
        if (i >= s.length) return fail("Missing a closing ]");
        if (s[i] === "]") {
          i++;
          return { ok: true, value: items };
        }
        if (s[i] === ",") {
          i++;
          skipSpace();
          if (s[i] === "]") return fail("Missing a number after the last comma");
          continue;
        }
        // numpy-style: whitespace alone separates elements. skipSpace has
        // already consumed it, so the next value starts here, unless nothing
        // separated the two values at all.
        if (!/\s/.test(s[i - 1] ?? "")) return fail(`Unexpected "${s[i]}"`);
      }
    }
    if (s[i] === "]") return fail("Unexpected ]");
    const m = NUMBER.exec(s.slice(i));
    if (!m) {
      const word = /^[^\s,[\]]+/.exec(s.slice(i))?.[0] ?? s[i];
      return fail(`"${word}" isn't a number`);
    }
    // A number must end at a separator or bracket: "1x" is not 1.
    const after = s[i + m[0].length];
    if (after !== undefined && !/[\s,\]]/.test(after)) {
      const word = /^[^\s,[\]]+/.exec(s.slice(i))?.[0] ?? m[0];
      return fail(`"${word}" isn't a number`);
    }
    const n = Number(m[0]);
    if (!Number.isFinite(n)) return fail(`"${m[0]}" isn't a finite number`);
    i += m[0].length;
    return { ok: true, value: n };
  };

  const result = parseValue();
  if (!result.ok) return result;
  skipSpace();
  if (i < s.length) return fail("Unexpected text after the closing ]");
  return result;
}

/** The dimensions of a regular array (`[]` for a number), or null if rows differ in length. */
export function shapeOf(value: Tensor): number[] | null {
  if (!Array.isArray(value)) return [];
  if (value.length === 0) return [0];
  const inner = value.map(shapeOf);
  const first = inner[0];
  if (first === null) return null;
  for (const sh of inner) {
    if (sh === null || sh.length !== first.length || sh.some((d, k) => d !== first[k])) return null;
  }
  return [value.length, ...first];
}

/** The shape a port's value is checked against: a scalar port takes one number. */
export function portShape(declared: number[] | undefined): number[] {
  return declared && declared.length > 0 ? declared : [1];
}

/** A shape in words: "2 numbers", "2 lists of 3 numbers", or "a 2×3×4 array". */
export function describeShape(shape: number[]): string {
  if (shape.length === 0) return "a single number";
  if (shape.length === 1) return `${shape[0]} number${shape[0] === 1 ? "" : "s"}`;
  if (shape.length === 2) return `${shape[0]} list${shape[0] === 1 ? "" : "s"} of ${shape[1]} number${shape[1] === 1 ? "" : "s"}`;
  return `a ${shape.join("×")} array`;
}

function sameShape(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((d, k) => d === b[k]);
}

/**
 * Parse one port's text and check it against the port's shape. Returns the
 * value in exactly that shape: `[[0, 1]]` for a port of 2 comes back as
 * `[0, 1]`, and a bare `1` for a port of 1 as `[1]`.
 */
export function parsePortInput(text: string, declared: number[] | undefined): ParseResult {
  const shape = portShape(declared);
  const parsed = parseTensor(text);
  if (!parsed.ok) return parsed;
  let value = parsed.value;
  if (!Array.isArray(value) && sameShape(shape, [1])) value = [value];
  const got = shapeOf(value);
  if (got === null) return { ok: false, error: "Rows have different lengths" };
  if (sameShape(got, shape)) return { ok: true, value };
  // One extra pair of brackets round the port's value, as PsyNeuLink allows.
  if (got.length === shape.length + 1 && got[0] === 1 && sameShape(got.slice(1), shape)) {
    return { ok: true, value: (value as Tensor[])[0] };
  }
  if (shape.length === 1 && got.length === 1) {
    return { ok: false, error: `Needs ${describeShape(shape)}, got ${got[0]}` };
  }
  return { ok: false, error: `Needs ${describeShape(shape)}, got ${got.length === 0 ? "a single number" : describeShape(got)}` };
}

/**
 * The value a trial sends for a node, from its ports' values: a one-port
 * node sends that port's array (`[0, 1]`); a node with several ports sends
 * one array per port (`[[0, 1], [1]]`), as `Composition.run` takes them.
 */
export function trialValue(ports: Tensor[]): Tensor {
  return ports.length === 1 ? ports[0] : ports;
}

/**
 * Split a trial's value back into one value per port: the inverse of
 * `trialValue`, for loading saved runs and declared input sets.
 */
export function portValues(value: unknown, nPorts: number): unknown[] {
  if (nPorts <= 1) return [value];
  return Array.isArray(value) ? value.slice(0, nPorts) : [value];
}

function formatNumber(n: number, digits?: number): string {
  if (digits === undefined) return String(n);
  const f = 10 ** digits;
  return String(Math.round(n * f) / f);
}

/**
 * Write a value in bracket notation: `[0, 1]`, `[[0, 1], [1, 0]]`. Numbers
 * keep their own digits unless `digits` rounds them (the Results panel's 4).
 * Anything that isn't a number or list is written as JSON would.
 */
export function formatTensor(value: unknown, digits?: number): string {
  if (typeof value === "number") return formatNumber(value, digits);
  if (Array.isArray(value)) return `[${value.map((v) => formatTensor(v, digits)).join(", ")}]`;
  return JSON.stringify(value) ?? "";
}

/** An array of zeros of `shape`. */
export function zeros(shape: number[]): Tensor {
  if (shape.length === 0) return 0;
  return Array.from({ length: shape[0] }, () => zeros(shape.slice(1)));
}

/**
 * The default input for trial `t` of a port: a one-hot vector stepping
 * through the elements (1 in element t mod n), zeros for deeper shapes.
 */
export function defaultPortText(declared: number[] | undefined, t: number): string {
  const shape = portShape(declared);
  if (shape.length !== 1) return formatTensor(zeros(shape));
  return formatTensor(Array.from({ length: shape[0] }, (_, i) => (i === t % shape[0] ? 1 : 0)));
}

/**
 * The element cells of a one-dimensional port's text, for the per-element
 * grid (Settings ▸ General ▸ Run inputs). Tolerant on purpose: a cell being
 * edited may be empty or not yet a number, and must survive the round trip
 * through the text. `[0, ]` gives ["0", ""].
 */
export function splitElements(text: string): string[] {
  const inner = text.replace(/[[\]]/g, "").trim();
  if (inner === "") return [];
  return inner.includes(",") ? inner.split(",").map((c) => c.trim()) : inner.split(/\s+/);
}

/** Cells back into a port's text: `["0", "1"]` gives `[0, 1]`. */
export function joinElements(cells: string[]): string {
  return `[${cells.map((c) => c.replace(/[,[\]]/g, "").trim()).join(", ")}]`;
}

/** True if a grid cell holds a finite number. */
export function isNumberCell(s: string): boolean {
  const t = s.trim();
  return t !== "" && Number.isFinite(Number(t));
}

/**
 * Pasted rows for one port (Paste CSV): each non-empty line is a trial.
 * A line in bracket notation is kept as written; a comma-separated line is
 * padded with zeros or cut to `width` elements, as the grid always did.
 */
export function pastedRows(text: string, width: number): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      if (line.startsWith("[")) return line;
      const cells = line.split(",").map((v) => v.trim());
      return joinElements(Array.from({ length: width }, (_, i) => cells[i] ?? "0"));
    });
}

/**
 * A multi-port node's whole trial input, as `Composition.run` takes it
 * (#332): `[[1, 0], [0]]` from the ports' texts. Valid ports are written from
 * their parsed values, so `[[0, 1]]` typed for a port shows as `[0, 1]`; a
 * port that doesn't parse shows its text as typed.
 */
export function wholeTrialText(texts: string[], parsed: ParseResult[]): string {
  const parts = texts.map((text, p) => {
    const r = parsed[p];
    return r && r.ok ? formatTensor(r.value) : text.trim() || "?";
  });
  return parts.length === 1 ? parts[0] : `[${parts.join(", ")}]`;
}

/**
 * Pasted rows for a node (Paste CSV), one text per port per trial. A node
 * with one port is `pastedRows`. With several ports (#332), a line in
 * bracket notation is the trial's whole input, `[[1, 0], [0]]`, split into
 * its ports; a comma-separated line is dealt out across the ports in order,
 * `widths[p]` numbers each, padded with zeros.
 */
export function pastedPortRows(text: string, widths: number[]): string[][] {
  if (widths.length <= 1) return pastedRows(text, widths[0] ?? 1).map((row) => [row]);
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      if (line.startsWith("[")) {
        const parsed = parseTensor(line);
        if (parsed.ok && Array.isArray(parsed.value) && parsed.value.length === widths.length) {
          return parsed.value.map((v) => formatTensor(v));
        }
        // Not one array per port: keep the line in the first port, where it
        // is flagged, rather than dropping it.
        return widths.map((w, p) => (p === 0 ? line : formatTensor(zeros([w]))));
      }
      const cells = line.split(",").map((v) => v.trim());
      let k = 0;
      return widths.map((w) => joinElements(Array.from({ length: w }, () => cells[k++] ?? "0")));
    });
}
