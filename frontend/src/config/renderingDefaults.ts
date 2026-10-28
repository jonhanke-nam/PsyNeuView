/**
 * Rendering defaults (#912).
 *
 * A single source of truth for the graph's visual defaults, tuned for
 * **`show_graph` parity** (thicker node-adjacent edges, larger arrowheads).
 * These seed `graphSettingsStore`; users can still change them per-session via
 * the toolbar.
 *
 * **Tweakable without a rebuild:** a deployer (or a modeler tuning the look)
 * can serve a `rendering-defaults.json` at the app root with any subset of
 * these keys to override the built-ins at startup — no code change, no rebuild.
 * See `public/rendering-defaults.example.json`. The app ships an empty one
 * (`{}`), so a plain install finds the file instead of logging a 404 at
 * every start; overriding means replacing it. This is the first slice of the
 * broader "parameterize every visual choice" goal; more constants (node border
 * widths, spacing, colors) migrate here over time.
 */

export interface RenderingDefaults {
  /**
   * The default width of an ordinary (Mapping) projection line, px. Since #107
   * it seeds Settings ▸ Appearance ▸ Lines between nodes (stores/edgeLineStore.ts);
   * other projection types scale from it. The name predates the setting and is
   * kept so existing override files still work.
   */
  arrowLineThickness: number;
  /** Arrowhead chevron half-length, px. */
  arrowheadSize: number;
  /** Fractional arrowhead position along the path (0 = source … 1 = target). */
  arrowheadPosition: number;
  /** Node oval border width for ordinary (non-emphasis) roles, px. */
  nodeBorderWidth: number;
  /**
   * Node oval border width for emphasis roles (INPUT/OUTPUT/CONTROL…), px.
   * Since #42 nodes draw this as nodeBorderWidth + 2 (stores/nodeOutlineStore.ts).
   */
  nodeBorderWidthEmphasis: number;
}

// show_graph-parity values. Prior defaults were 2 / 5 / 0.5.
export const RENDERING_DEFAULTS: RenderingDefaults = {
  arrowLineThickness: 3, // ordinary lines 3 px (#107: the Line width default)
  arrowheadSize: 7, // larger, more show_graph-like chevron
  arrowheadPosition: 1, // at the target, where show_graph draws it (was 0.5, mid-line)
  nodeBorderWidth: 4, // ordinary roles (#42: was 1, too light to read; 4 since rc testing)
  nodeBorderWidthEmphasis: 6, // INPUT/OUTPUT/CONTROL…: the outline + 2 px since #42; not read for nodes
};

/**
 * Fetch an optional runtime override (`/rendering-defaults.json`). Returns a
 * (possibly empty) partial; never throws — a missing file or parse error just
 * yields the built-in defaults.
 */
export async function loadRuntimeRenderingDefaults(): Promise<Partial<RenderingDefaults>> {
  try {
    const resp = await fetch("/rendering-defaults.json", { cache: "no-store" });
    if (!resp.ok) return {};
    const json = await resp.json();
    return json && typeof json === "object" ? (json as Partial<RenderingDefaults>) : {};
  } catch {
    return {};
  }
}
