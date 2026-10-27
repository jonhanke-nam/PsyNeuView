# Dialog inventory

Every dialog, panel and pop-up menu in PsyNeuView closes the same ways
([#1289](https://github.com/jonhanke-nam/PsyNeuView/issues/1289); the first
case was Settings, [#1288](https://github.com/jonhanke-nam/PsyNeuView/issues/1288)):

1. **A × that is always visible**, in the fixed header (`DialogHeader`),
   never inside the scrolling content, so it cannot scroll out of view.
2. **Escape**, which closes the innermost open thing: a menu inside a dialog
   closes first, then the dialog. `useDismiss` keeps the stack; no overlay
   handles Escape on its own. Where Escape already means something — the
   shortcut recorder in Settings, cancelling a canvas gesture — that handler
   runs first and stops the event, and the dialog stays open.
3. **A click outside**, where that was already the behaviour.

Both pieces live in `frontend/src/components/common/dialog/`. A new dialog
uses them and is added to the table below;
`frontend/src/dialogInventory.test.ts` fails when a component draws an
overlay (a fixed layer, a `role="dialog"`/`menu`/`listbox`, an absolutely
positioned box with a shadow and a z-index) that is listed in neither table,
when a listed dialog or menu does not use the shared pieces or still handles
Escape itself, or when a listed test id is not in its file. The end-to-end
sweep (`frontend/e2e/dialog-sweep.spec.ts`) opens each one, checks the × is
in view and that Escape closes it and nothing else.

**Kinds.** A *dialog* has the shared header with the ×. A *menu* is a pop-up
anchored to the button that opens it: that button toggles it, Escape and a
click outside close it, and there is no × (a × inside a menu would be odd;
the button is in view by construction). A *notice* has the shared × and takes
no Escape: it asks nothing, and it must never take the key from whatever
dialog is open.

**Size of the ×.** A dialog's × is the full-size one in its header. A small
box that is one line of text — a toast, the graph legend, the Open menu's
note — uses the `inline` ×, the small one those boxes always had, so it stays
centred on the line. Where a box already had a × that looked right, keep its
size; the full-size × is for places that had none.

## Dialogs and menus

Paths are under `frontend/src/components/`. "Closes by" lists the ways beyond
Escape, which every row has.

| Name | Kind | File | Test id | Opens from | Closes by |
|---|---|---|---|---|---|
| Settings | dialog | `common/SettingsPanel.tsx` | `settings-panel` | the gear; Layout ▸ Settings…; ⌘, in the Mac app | ×, click outside, Close |
| Move My Project Folder | dialog | `common/settings/FoldersSection.tsx` | `project-folder-move-dialog` | Settings ▸ Folders ▸ Move… | ×, click outside, Cancel (Settings stays open) |
| Switch to (the PsyNeuLink list) | menu | `common/settings/SwitchListbox.tsx` | `pnl-switch-listbox` | Settings ▸ Developer ▸ Which PsyNeuLink is installed ▸ Switch to | click outside, a pick (Settings stays open) |
| New to PsyNeuView? (the orientation offer) | dialog | `common/OrientationOffer.tsx` | `orientation-offer` | the first launch in a browser | ×, click outside, any of its three answers |
| Open menu | menu | `layout/Toolbar.tsx` | `open-menu-list` | Open ▾ | the Open button, click outside |
| New model | dialog | `common/PromptModal.tsx` | `prompt-modal` | Open ▾ New Model | ×, click outside, Cancel, OK |
| Open a model | dialog | `common/FileBrowserModal.tsx` | `file-browser-modal` | Open ▾ Open from path… (in a browser) | ×, click outside, Cancel, a pick |
| Open file from GitHub | dialog | `common/GithubFileLoaderModal.tsx` | `github-file-loader-modal` | Open ▾ From GitHub… | ×, click outside, Cancel, Open |
| A combobox's list (repo, branch) | menu | `common/Combobox.tsx` | `combobox-list` | the ▼ in a combobox, or typing | click outside, a pick, Tab (the dialog around it stays open) |
| Open PsyNeuLink test as model | dialog | `common/DeveloperTestsModal.tsx` | `developer-tests-modal` | Open ▾ Developer / Tests… (developer mode) | ×, click outside, Cancel, Open |
| Save a copy as… | dialog | `layout/Toolbar.tsx` | `save-copy-dialog` | the toolbar's Save a copy as… | ×, click outside, Cancel, Save (not while saving) |
| Layout menu | menu | `layout/Toolbar.tsx` | `layout-menu-list` | Layout ▾ | the Layout button, click outside, a pick |
| Tutorials menu | menu | `layout/Toolbar.tsx` | `walkthrough-menu-list` | Tutorials ▾ | the Tutorials button, click outside, a pick |
| Developer-mode menu | menu | `layout/DeveloperModeIndicator.tsx` | `developer-mode-menu` | the Developer badge (developer mode) | the badge, click outside, a pick |
| History | dialog | `common/HistoryPanel.tsx` | `history-panel` | the History button | ×, click outside, the History button |
| Graph toolbar's More menu | menu | `graph/GraphToolbar.tsx` | `graph-more-menu` | More ▾ in the graph toolbar | the More button, click outside |
| Node context menu | menu | `graph/NodeContextMenu.tsx` | `node-context-menu` | right-click on a node | click outside, a pick |
| Palette's compact flyout | menu | `graph/PaletteSidebar.tsx` | `palette-compact-flyout` | a category in the compact palette | click outside, the category again, its ‹ |
| Watching for changes (the file-watch status) | dialog | `common/SyncIndicator.tsx` | `sync-popover` | the ● status at the right end of the diagnostics bar (#103) | ×, click outside, the status again |
| Changes since the last version that built | dialog | `graph/LastGoodDiff.tsx` | `last-good-diff` | Compare with that version, on the stale-graph banner | ×, click outside |
| Changes since save | dialog | `common/ChangesSinceSaveDialog.tsx` | `changes-since-save` | the orange unsaved dot beside the model name; History ▸ Changes since save… | ×, click outside, Close |
| Revert the file to this save | dialog | `common/RevertToSaveDialog.tsx` | `revert-to-save` | History ▸ a save marker ▸ Revert the file to this save…; History's "You've undone to" line | ×, click outside, Cancel, Revert the file (not while reverting) |
| Convert to Standard Format? | dialog | `common/DiagnosticPanel.tsx` | `convert-confirm-dialog` | Convert to Standard Format, in the diagnostics panel | ×, click outside, Cancel, Convert |
| Snippet menu | menu | `editor/CodeEditor.tsx` | `snippet-menu` | + Snippet in the editor header | the Snippet button, click outside, a pick |
| Sidecar placement | menu | `editor/SidecarPlacementPicker.tsx` | `sidecar-placement-menu` | Files: in the editor header | the button, click outside, a pick |
| Sidecar variant | menu | `editor/SidecarVariantPicker.tsx` | `sidecar-variant-menu` | Layout: / Labels: in the editor header | the button, click outside, a pick |
| The file changed on disk | dialog | `common/ExternalChangeModal.tsx` | `external-change-modal` | an external editor saves the open file while there are unsaved edits here | × (Keep my changes), either answer; no click outside — a stray click is not an answer |
| Toasts | notice | `common/NotificationBar.tsx` | `notification-dismiss` | an error, warning or message; one with a `key` replaces the last with that key in place, so a burst (undo, #1377) is one notice | the × on each; no Escape, on purpose |

## Drawn on top, but not a dialog

These draw a fixed or floating layer and are listed so the guard test knows
they were looked at. None of them asks anything, so none closes with Escape or
needs a ×.

| What | File | Why it is not one |
|---|---|---|
| The drop target while a file is dragged over the window | `App.tsx` | goes away with the drag |
| The walkthrough's spotlight and pointer | `graph/TourOverlay.tsx` | pointer-events none; the walkthrough bar (a real row, not an overlay) has Stop |
| The canvas gesture hints and the stale-graph banner | `graph/GraphCanvas.tsx` | status; Escape there cancels the gesture, which runs before the stack |
| The GSC legend | `graph/GSCLegend.tsx` | canvas furniture with its own hide button and a remembered position |
| The trace step strip | `graph/TraceControls.tsx` | a control strip; Escape inside its step field cancels the edit |
| The dangling-projection notice | `graph/ValidationPanel.tsx` | folds, never closes: the problems are still there |
| The busy wheel over the graph | `common/BusyIndicator.tsx` | status (#38); pointer-events none, and it goes when the work is done |
| The focus breadcrumb and the off-screen nodes button | `graph/FocusBreadcrumb.tsx`, `graph/OffscreenNodesIndicator.tsx` | canvas furniture |
| Port and value tooltips on a node | `graph/MechanismNode.tsx` | hover tooltips, pointer-events none |
| Edge bend handles | `graph/ProjectionEdge.tsx` | parts of the edge |
| The palette sidebar itself | `graph/PaletteSidebar.tsx` | a layout panel (Layout ▸ Object palette); its compact flyout is the menu above |
