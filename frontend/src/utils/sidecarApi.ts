// Client for the named layout/settings variant endpoints (#482/#483).
//
// A "variant" is one named layout (`.pnlview.json`) or settings profile
// (`.labels.yaml`) sitting next to the model's `.py`. The backend merges
// what's on disk with the optional `.psyneuview.json` index into an ordered
// list with one active entry per kind; this module is the thin typed wrapper
// the dropdown and modelStore drive.

import { recordSettingChanged } from "./activityLog";

export type SidecarKind = "layout" | "settings";

export type SidecarVariant = {
  name: string;
  file: string;
  active: boolean;
  // True when the index references a variant whose file is gone — surfaced
  // distinctly in the dropdown rather than silently dropped.
  missing?: boolean;
  order?: number;
};

// Where a model's sidecars physically live (#933). `perModel` is the explicit
// per-model override (null = inherit); `effective` is the concrete location new
// sidecars land in; `managed` is true for a managed clone, where placement is
// not user-selectable (companions are already redirected out of tree).
export type PlacementLocation = "lateral" | "dotfolder";
export type SidecarPlacement = {
  perModel: PlacementLocation | null;
  default: string; // "auto" | "lateral" | "dotfolder"
  effective: PlacementLocation;
  managed: boolean;
};

export type SidecarView = {
  layouts: SidecarVariant[];
  activeLayout: string | null;
  settings: SidecarVariant[];
  activeSetting: string | null;
  placement: SidecarPlacement;
};

// Result of moving a model's sidecars into a new placement (#933). `conflicts`
// are basenames that already existed at the destination (both-locations drift)
// and were left untouched rather than clobbered.
export type MigrationResult = { moved: string[]; conflicts: string[]; managed: boolean };

// Parsed active layout + labels, for re-applying a switched variant without
// re-introspecting the whole model. Shapes match /model/load's fields.
export type ResolvedSidecars = {
  layout: { positions?: Record<string, { x: number; y: number }>; [k: string]: unknown } | null;
  labels: Record<string, unknown> | null;
};

async function post<T>(url: string, body: unknown): Promise<T> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      detail = (await resp.json()).detail ?? detail;
    } catch {
      // non-JSON error body; keep statusText
    }
    throw new Error(detail);
  }
  return resp.json() as Promise<T>;
}

async function get<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      detail = (await resp.json()).detail ?? detail;
    } catch {
      // non-JSON error body; keep statusText
    }
    throw new Error(detail);
  }
  return resp.json() as Promise<T>;
}

export function listSidecars(filePath: string): Promise<SidecarView> {
  return post("/api/model/sidecars/list", { file_path: filePath });
}

// Set (or, with "inherit", clear) a model's per-model placement (#933). An
// explicit location also migrates the model's existing sidecars into it; the
// response is the refreshed view plus any migration result.
export function setPlacement(
  filePath: string,
  placement: PlacementLocation | "inherit",
): Promise<SidecarView & { migration?: MigrationResult }> {
  return post("/api/model/sidecars/placement", { file_path: filePath, placement });
}

// The global sidecar-placement default (#933). "auto" when unset.
export function getPlacementDefault(): Promise<{ placement: string }> {
  return get("/api/settings/sidecar-placement");
}

export function setPlacementDefault(
  placement: PlacementLocation | "auto" | null,
): Promise<{ placement: string }> {
  recordSettingChanged("sidecar-placement-default", placement ?? "auto");
  return post("/api/settings/sidecar-placement", { placement });
}

export function resolveSidecars(filePath: string): Promise<ResolvedSidecars> {
  return post("/api/model/sidecars/resolve", { file_path: filePath });
}

export function setActiveVariant(filePath: string, kind: SidecarKind, name: string) {
  return post("/api/model/sidecars/set-active", { file_path: filePath, kind, name });
}

export function createVariant(filePath: string, kind: SidecarKind, name: string) {
  return post("/api/model/sidecars/create", { file_path: filePath, kind, name });
}

export function deleteVariant(filePath: string, kind: SidecarKind, name: string) {
  return post("/api/model/sidecars/delete", { file_path: filePath, kind, name });
}

export function renameVariant(filePath: string, kind: SidecarKind, name: string, newName: string) {
  return post("/api/model/sidecars/rename", { file_path: filePath, kind, name, new_name: newName });
}

export function duplicateVariant(filePath: string, kind: SidecarKind, name: string, newName: string) {
  return post("/api/model/sidecars/duplicate", { file_path: filePath, kind, name, new_name: newName });
}

export function reorderVariants(filePath: string, kind: SidecarKind, names: string[]) {
  return post("/api/model/sidecars/reorder", { file_path: filePath, kind, names });
}

// Seed/overwrite a layout variant's positions (#477). `variant` undefined or
// "Default" addresses the unsuffixed default sidecar; a name addresses
// `<stem>.<name>.pnlview.json`. Used to create-on-demand and reset-to-defaults.
export function saveLayoutVariant(
  filePath: string,
  positions: Record<string, { x: number; y: number }>,
  variant?: string,
) {
  return post("/api/model/save-layout", { file_path: filePath, positions, variant: variant ?? null });
}

// Seed/overwrite a labels variant's content (#477). An empty dict deletes the
// file, so seeding only makes sense with a non-empty scaffold.
export function saveLabelsVariant(
  filePath: string,
  labels: Record<string, unknown>,
  variant?: string,
) {
  return post("/api/model/save-labels", { file_path: filePath, labels, variant: variant ?? null });
}
