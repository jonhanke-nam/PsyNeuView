/**
 * The Components panel's icons (#283): one SVG per palette item and per
 * top-level category, listed in assets/component-icons/icons.yaml with where
 * each drawing came from. docs/icon-ontology.md says how they are drawn.
 *
 * The SVGs draw in currentColor, so an icon takes the colour of the element
 * it sits in: the item's type colour, or the manifest's `tint` (the input and
 * output ports use show_graph's green and red).
 */
import yaml from "js-yaml";
import manifestText from "@/assets/component-icons/icons.yaml?raw";

export type IconSource = "metacell" | "original";

export interface IconEntry {
  file: string;
  source: IconSource;
  /** The file in MetaCell's PsyNeuLinkView this was adapted from. */
  metacell_path?: string;
  /** A MetaCell drawing an original icon reuses part of. */
  based_on?: string;
  /** A colour token used instead of the item's type colour. */
  tint?: string;
  meaning: string;
}

export interface IconManifest {
  categories: Record<string, IconEntry>;
  items: Record<string, IconEntry>;
}

export const ICON_MANIFEST = yaml.load(manifestText) as IconManifest;

// Every SVG in the folder, as text, keyed by file name.
const RAW = import.meta.glob("../assets/component-icons/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

export const ICON_SVGS: Record<string, string> = Object.fromEntries(
  Object.entries(RAW).map(([p, text]) => [
    p.slice(p.lastIndexOf("/") + 1),
    // Fill whatever box the icon is put in.
    text.replace("<svg ", '<svg width="100%" height="100%" focusable="false" '),
  ]),
);

export interface ResolvedIcon extends IconEntry {
  svg: string;
}

function resolve(entry: IconEntry | undefined): ResolvedIcon | null {
  if (!entry) return null;
  const svg = ICON_SVGS[entry.file];
  return svg ? { ...entry, svg } : null;
}

/** The icon for a palette item's type (e.g. "TransferMechanism"), if it has one. */
export function iconForType(type: string): ResolvedIcon | null {
  return resolve(ICON_MANIFEST.items[type]);
}

/** The icon for a top-level palette category ("mechanisms", "projections", …). */
export function iconForCategory(id: string): ResolvedIcon | null {
  return resolve(ICON_MANIFEST.categories[id]);
}
