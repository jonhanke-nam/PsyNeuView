/**
 * The model's file as it is on disk now, read fresh.
 *
 * Shared by the two dialogs that compare against the file: Changes since
 * save (#1348) and Revert the file to this save (#1349). Both read the disk
 * rather than trusting `savedSource`, because the file may have changed
 * outside PsyNeuView, and then that is worth saying.
 */

import { useEffect, useState } from "react";

export type Disk =
  | { state: "loading" }
  | { state: "read"; source: string }
  | { state: "missing" }
  | { state: "error"; message: string };

export async function readDisk(filePath: string): Promise<Disk> {
  try {
    const resp = await fetch("/api/model/disk-source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: filePath }),
    });
    if (!resp.ok) return { state: "error", message: `the server answered ${resp.status}` };
    const data = await resp.json();
    return data.exists ? { state: "read", source: data.source } : { state: "missing" };
  } catch (e) {
    return { state: "error", message: String(e) };
  }
}

/** Below this width the two columns of a side-by-side diff are too narrow to read. */
export const SPLIT_MIN_WIDTH = 900;

export function useWindowWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? SPLIT_MIN_WIDTH : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}
