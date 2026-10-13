/** What `/api/settings/info` and `/api/settings/install/capabilities` answer. */

import type { PsyNeuLinkInfo } from "@/utils/pnlSources";

export interface PsyNeuViewInfo {
  version: string;
  commit: string;
}

export interface ModeciMdfInfo {
  version: string | null;
}

export interface GithubAuthInfo {
  source: string;
  user: string | null;
  scopes: string[];
  has_repo_scope: boolean;
}

export interface PnlFeaturesInfo {
  debugger_hook: boolean;
  level: "full" | "basic";
}

export type DeploymentMode = "local" | "mac_app" | "container" | "hosted";

export interface SettingsInfo {
  psyneulink: PsyNeuLinkInfo;
  psyneuview: PsyNeuViewInfo;
  modeci_mdf: ModeciMdfInfo;
  github_auth: GithubAuthInfo;
  features: PnlFeaturesInfo;
  // The backend has always sent this (#1062); it was simply not declared here.
  deployment?: { mode: DeploymentMode };
  /** Whether PsyNeuLink actually imports and runs (#1143). Passed through to diagnostics (#1287). */
  health?: unknown;
  /** The update state in short (#1304): status, last check, a ready update, the last automatic install. */
  updates?: Record<string, unknown>;
}

export interface InstallCapabilities {
  enabled: boolean;
  // "running_in_mac_app" retired in #132: the Mac app drives this endpoint
  // like any other client now, rather than being sent to its own Preferences.
  reason: "unavailable_in_deployment" | "non_local" | null;
  in_mac_app: boolean;
  mode: DeploymentMode;
}

export interface PnlFreshness {
  status: "current" | "behind" | "unknown" | "not_applicable";
  behind_by: number | null;
  installed_commit: string | null;
  head_commit: string | null;
  head_date: string | null;
  detail: string;
}

// ─── Where things live: `/api/locations` (#1295) ──────────────────────────

export interface PsyNeuViewLocation {
  path: string;
  /** A git checkout (yours to edit), or a copy without history (the Mac app's included PsyNeuView). */
  kind: "checkout" | "included";
  editable: boolean;
  version: string;
  commit: string;
}

export interface PsyNeuLinkLocation extends PsyNeuLinkInfo {
  editable: boolean;
  /** GitHub and PyPI installs: PsyNeuView keeps them, read-only. */
  managed: boolean;
}

export interface ManagedCopy {
  name: string;
  path: string;
  repo: string | null;
  size_bytes: number;
  /** False when the size walk hit its time cap: a lower bound. */
  size_complete: boolean;
  /** Seconds since the epoch, or null when never recorded. */
  last_used: number | null;
  in_use: boolean;
}

/** One row of `/api/settings/pnl-releases` (#1295 round 5). */
export interface PnlRelease {
  version: string;
  /** YYYY-MM-DD, or null when unknown (a kept file PyPI doesn't list). */
  released: string | null;
  requires_python: string | null;
  yanked: boolean;
  /** False when it can't install on the running Python, with `reason`. */
  compatible: boolean;
  reason: string | null;
  /** Too old for run stepping (before the _debugger hook), with `limited_reason`. */
  limited: boolean;
  limited_reason: string | null;
  /** A copy is kept locally: switching to it downloads nothing. */
  kept: boolean;
}

export interface PnlReleases {
  releases: PnlRelease[];
  /** PyPI couldn't be reached: the list is the last copy, or the kept files alone. */
  offline: boolean;
  python_version: string;
  in_use: string | null;
  releases_dir: string;
}

export interface KeptRelease {
  version: string;
  path: string;
  size_bytes: number;
  last_used: number | null;
  in_use: boolean;
}

export interface KnownCheckout {
  path: string;
  label: string | null;
  exists: boolean;
  in_use: boolean;
}

export interface Locations {
  psyneuview: PsyNeuViewLocation;
  psyneulink: PsyNeuLinkLocation;
  projectFolder: { path: string; exists: boolean; fixed: boolean; fixedBy?: string | null };
  catalogs: { id: string; name: string; path: string; exists: boolean }[];
  appData: {
    root: string;
    sources: string;
    configFile: string;
    /** Where edits to included models are kept (#1319); absent on an older backend. */
    workingCopies?: string;
    /** The environment variable fixing that folder, when one does. */
    workingCopiesFixedBy?: string | null;
    /** Where layouts and labels for read-only PsyNeuLink files are kept (#1321); absent on an older backend. */
    layouts?: string;
    /** The environment variable fixing that folder, when one does. */
    layoutsFixedBy?: string | null;
  };
  /** Where kept official releases live; absent on an older backend. */
  releasesDir?: string;
  managedCopies: ManagedCopy[];
  /** Absent on a backend from before #1295 round 5. */
  keptReleases?: KeptRelease[];
  checkouts: KnownCheckout[];
}
