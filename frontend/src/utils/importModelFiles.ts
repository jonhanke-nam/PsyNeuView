/**
 * Importing a model file, from anywhere (#1068).
 *
 * Drag-and-drop was the only way to import a `.py` or `.pnlproject`, and it had
 * no UI affordance at all — so the feature was undiscoverable. That matters
 * more in a container deployment (#1063), where *Open from path…* browses the
 * **container's** filesystem and drag-and-drop becomes the primary way to bring
 * in a model of your own.
 *
 * The logic lives here rather than in the drop handler so the Open menu can
 * offer the same thing without a second implementation drifting from the first.
 */

import { useModelStore } from "@/stores/modelStore";
import { useNotificationStore } from "@/stores/notificationStore";

/** Extensions the importer understands — also the file picker's `accept`. */
export const IMPORTABLE_EXTENSIONS = [".py", ".pnlproject"] as const;

export const IMPORT_ACCEPT_ATTR = IMPORTABLE_EXTENSIONS.join(",");

// Module-level rather than per-caller: one drop gesture fires several times
// (overlay + parent + CodeMirror forwarding), and the menu path must not race
// a drop already in flight.
let importing = false;

/** True while an import is running, so callers can skip duplicate triggers. */
export function isImporting(): boolean {
  return importing;
}

async function importProject(file: File): Promise<void> {
  const store = useModelStore.getState();
  const notify = useNotificationStore.getState();
  try {
    const formData = new FormData();
    formData.append("file", file);
    const resp = await fetch("/api/model/import-project", {
      method: "POST",
      body: formData,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      notify.addNotification("error", `Project import failed: ${err.detail}`);
      return;
    }
    const data = await resp.json();
    store.setFilePath(data.file_path);
    store.setSource(data.source);
    store.markFreshOpen(); // #906: re-pick layout mode from the sidecar
    store.loadModelFromServer(data.model, data.layout);
    notify.addNotification(
      "success",
      `Imported project: ${data.projectName || file.name}`,
    );
  } catch (e) {
    notify.addNotification("error", `Project import failed: ${e}`);
  }
}

async function importPython(file: File): Promise<void> {
  const store = useModelStore.getState();
  const notify = useNotificationStore.getState();
  // Read here rather than sending a path: the browser has the contents, and
  // the server may be a different machine entirely.
  const source = await file.text();
  const fileName = file.name;

  try {
    const dirsResp = await fetch("/api/models/dirs");
    const dirsData = await dirsResp.json();
    const dir = dirsData.default_save_dir || "";
    const fullPath = `${dir}/${fileName}`;

    // Ensure directory exists and write file directly (no conflict check)
    await fetch("/api/model/save-source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: fullPath, source }),
    }).catch(() => {
      // If save-source fails (file doesn't exist yet), create via save-as
      return fetch("/api/models/save-as", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, file_name: fileName }),
      });
    });

    // Load the file (handles star import conversion)
    const loadResp = await fetch("/api/model/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: fullPath }),
    });
    if (!loadResp.ok) {
      const err = await loadResp.json().catch(() => ({ detail: "Load failed" }));
      notify.addNotification("error", `Import failed: ${err.detail}`);
      return;
    }
    const data = await loadResp.json();
    store.setFilePath(fullPath);
    store.setSource(data.source);
    store.markFreshOpen(); // #906: re-pick layout mode from the sidecar
    store.loadModelFromServer(
      data.model,
      data.layout,
      data.labels,
      data.bundle,
      data.sidecars,
    );
    if (data.starImportConverted) {
      notify.addNotification(
        "info",
        "Auto-converted: from psyneulink import * → import psyneulink as pnl",
      );
    }
    notify.addNotification("success", `Imported ${fileName}`);
  } catch (e) {
    notify.addNotification("error", `Import failed: ${e}`);
  }
}

/**
 * Import the first supported file in `files`.
 *
 * Prompts before discarding unsaved edits (#345). Returns true if an import was
 * attempted, false if there was nothing to do or the user backed out.
 *
 * `verb` only shapes the "unsupported file" message, so a drop says "Drop a …"
 * and the menu says "Choose a …".
 */
export async function importModelFiles(
  files: File[],
  verb: "drop" | "choose" = "choose",
): Promise<boolean> {
  if (importing) return false;

  const notify = useNotificationStore.getState();
  const projectFile = files.find((f) => f.name.endsWith(".pnlproject"));
  const pyFile = files.find((f) => f.name.endsWith(".py"));

  if (!projectFile && !pyFile) {
    const action = verb === "drop" ? "Drop" : "Choose";
    notify.addNotification(
      "warning",
      files.length > 0
        ? `"${files[0].name}" is not supported. ${action} a .py or .pnlproject file.`
        : `No file detected. ${action} a .py or .pnlproject file to load it.`,
    );
    return false;
  }

  // Warn before discarding unsaved edits (#345)
  {
    const s = useModelStore.getState();
    if (
      s.filePath &&
      s.source !== s.savedSource &&
      !window.confirm("You have unsaved changes that will be lost. Import anyway?")
    ) {
      return false;
    }
  }

  importing = true;
  try {
    // A bundle carries its own layout and sidecars, so it wins when both are
    // present rather than importing the loose .py beside it.
    if (projectFile) {
      await importProject(projectFile);
    } else {
      await importPython(pyFile!);
    }
  } finally {
    importing = false;
  }
  return true;
}
