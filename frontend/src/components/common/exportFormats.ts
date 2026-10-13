/**
 * Save-format registry — single source of truth for the formats offered by
 * the "Save a copy as…" dialog.
 *
 * Format and destination are **independent** (#1067). This registry describes
 * *what* a file is; the dialog separately asks *where* it goes. Before that
 * split, `.py` could only be written server-side and every other format could
 * only be downloaded, so choosing a format silently decided the destination —
 * which is invisible locally (the server is your machine) and actively
 * misleading in a container deployment, where "saved" meant "in a container
 * you cannot browse".
 *
 * To add a format, append an entry here; the dialog reads this list directly.
 */

export type SaveFormatId = "py" | "pnlproject" | "mdf-yaml" | "mdf-json";

export type SaveFormat = {
  /** Stable id — also the `fmt` the server-side save endpoint expects. */
  id: SaveFormatId;
  /** Human-readable label shown in the dropdown. */
  label: string;
  /** Optional helper text shown beneath the dropdown. */
  description?: string;
  /** File extension including the leading dot (e.g. ".pnlproject"). */
  extension: string;
  /**
   * Endpoint that streams this format for download. Omitted for `py`, which
   * needs no round trip: the editor buffer is already in the browser, and
   * downloading it matches what saving `.py` server-side writes.
   */
  downloadEndpoint?: string;
  /** Build a filename from the current source file path. */
  buildFilename: (sourcePath: string) => string;
  /**
   * Extra body fields merged into the download POST. Lets one endpoint serve
   * several entries that differ only in parameters (MDF YAML vs JSON).
   */
  extraBody?: Record<string, unknown>;
  /**
   * MDF-based formats fail when the model uses GraphStructureConditions
   * (BeforeNode, AfterNode, AddEdgeTo, RemoveEdgeFrom, WithNode). Tracked
   * upstream as PsyNeuLink#7. The dialog surfaces a pre-flight warning when
   * this is set and the loaded model has any GSCs.
   */
  mdfBased?: boolean;
};

function basenameWithoutPy(sourcePath: string): string {
  const basename = sourcePath.split("/").pop() || "model";
  return basename.replace(/\.py$/, "");
}

export const SAVE_FORMATS: SaveFormat[] = [
  {
    id: "py",
    label: "PsyNeuLink source (.py)",
    description:
      "The model as Python. Saves what is currently in the editor.",
    extension: ".py",
    buildFilename: (p) => `${basenameWithoutPy(p)}.py`,
  },
  {
    id: "pnlproject",
    label: "PsyNeuView Project (.pnlproject)",
    description:
      "Bundled model + layout + manifest. Round-trips in PsyNeuView.",
    extension: ".pnlproject",
    downloadEndpoint: "/api/model/export-project",
    buildFilename: (p) => `${basenameWithoutPy(p)}.pnlproject`,
  },
  {
    id: "mdf-yaml",
    label: "MDF (YAML) (.mdf.yaml)",
    description:
      "ModECI Model Description Format as YAML — human-readable. " +
      "Re-importable via Load Model → Import MDF…",
    extension: ".mdf.yaml",
    downloadEndpoint: "/api/model/export-mdf",
    buildFilename: (p) => `${basenameWithoutPy(p)}.mdf.yaml`,
    extraBody: { fmt: "yaml" },
    mdfBased: true,
  },
  {
    id: "mdf-json",
    label: "MDF (JSON) (.mdf.json)",
    description:
      "ModECI Model Description Format as JSON — for tools that " +
      "require JSON. Re-importable via Load Model → Import MDF…",
    extension: ".mdf.json",
    downloadEndpoint: "/api/model/export-mdf",
    buildFilename: (p) => `${basenameWithoutPy(p)}.mdf.json`,
    extraBody: { fmt: "json" },
    mdfBased: true,
  },
];

export function getFormatById(id: string): SaveFormat | undefined {
  return SAVE_FORMATS.find((f) => f.id === id);
}

export type SaveDestination = "download" | "server";

/**
 * How to describe the two destinations, given where the backend is running.
 *
 * In `local` / `mac_app` the backend *is* the user's machine, so both
 * destinations land on the same disk and the honest distinction is "a folder
 * you pick" versus "your downloads folder". In `container` / `hosted` they are
 * different computers, and saying so is the whole point of this dialog.
 */
export function describeDestinations(deploymentMode?: string) {
  const remote = deploymentMode === "container" || deploymentMode === "hosted";
  return {
    remote,
    server: {
      label: remote ? "On the server" : "In a folder on this computer",
      hint: remote
        ? "Stays in the PsyNeuView deployment — not on your computer. Anyone else using this instance can see it."
        : "Writes the file to a folder you choose.",
    },
    download: {
      label: "Download to my computer",
      hint: remote
        ? "Sends the file to your browser's downloads."
        : "Sends the file to your downloads folder.",
    },
  };
}
