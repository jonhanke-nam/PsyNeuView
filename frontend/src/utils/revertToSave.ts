/**
 * Revert the file to a save (#1349): put a saved version back in the editor
 * and on disk.
 *
 * It is a Save, pressed with the saved text: `requestSave` with `source`, so
 * the save routine's check for a file that changed on disk applies, and its
 * errors are the ones Save shows. Before that, the saved version becomes a
 * new step in History ("Reverted to the save of 14:32"), so what the editor
 * held is one Undo away; the save then marks that step.
 */

import { useModelStore } from "@/stores/modelStore";
import { useNotificationStore } from "@/stores/notificationStore";
import type { RevertTarget } from "@/stores/revertToSaveStore";
import { recordAction } from "./history";
import { requestSave } from "./saveRequest";
import { formatSaveTime } from "./saveHistory";

/** True when the file now holds the saved version. */
export async function revertToSave({ snapshot, mark }: RevertTarget): Promise<boolean> {
  const notify = useNotificationStore.getState().addNotification;
  const store = useModelStore.getState();
  if (!store.filePath) return false;

  store.setSource(snapshot.source);
  // A compact step (#558) has no graph of its own; the save below reloads
  // the model from the file, which rebuilds it.
  if (!snapshot.compact) {
    store.setNodes(snapshot.nodes.map((n) => ({ ...n })));
    store.setEdges(snapshot.edges.map((e) => ({ ...e })));
  }
  recordAction(`Reverted to the save of ${formatSaveTime(mark.at, true)}`);

  const heard = await requestSave({ source: snapshot.source, revertedTo: mark.at });
  if (!heard) {
    notify("error", "Couldn't save: the code editor isn't open. The editor holds the saved version; press Save to write it.");
    return false;
  }
  const saved = useModelStore.getState().savedSource === snapshot.source;
  if (saved) notify("success", `Reverted the file to the save of ${formatSaveTime(mark.at, true)}`, 3000);
  return saved;
}
