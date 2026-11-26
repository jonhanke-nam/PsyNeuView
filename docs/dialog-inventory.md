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
dialog is open. The one exception is the failed-open strip (#401), which
closes on its × and on Escape (through `useDismiss`, so a dialog opened after
it still gets Escape first). It is a strip in the layout rather than a layer
on top, so nothing on the graph is hidden under it; the guard test lets a
notice be either.

**Size of the ×.** A dialog's × is the full-size one in its header. A small
box that is one line of text — a toast, the graph legend, the Open menu's
note — uses the `inline` ×, the small one those boxes always had, so it stays
centred on the line. Where a box already had a × that looked right, keep its
size; the full-size × is for places that had none.

**Keyboard focus** ([#415](https://github.com/jonhanke-nam/PsyNeuView/issues/415)).
`DialogHeader` looks after it for the dialog around it
(`dialog/dialogFocus.ts`), so no dialog needs focus code of its own. When a
dialog opens, the focus moves in: to a control the dialog focused itself (a
search box), else one marked `data-autofocus`, else its first text field,
else the dialog itself — a dialog of buttons starts on itself, labelled by
its title, so Enter never answers it by accident. When it closes, the focus
goes back to the control that opened it, or, if that has gone (a menu item),
to what was focused before it (the menu's button); a click outside that put
the focus somewhere else leaves it there. The Focus column says what else
each one does:

- **trap** — a modal dialog (`role="dialog"`, `aria-modal="true"`, over a
  scrim): Tab and Shift+Tab go round its controls and never reach the page
  behind. Only the one opened last traps; a dialog over Settings has the keys
  until it closes, then Settings has them again.
- **no trap** — a panel anchored to its button (`role="dialog"`, not modal):
  it takes the focus and gives it back, but Tab may leave it, because the page
  beside it stays usable.
- **takes focus** — a menu that moves the focus into itself when it opens and
  moves with the arrow keys (the PsyNeuLink list; the variant list's search,
  when it has more than five).
- **leaves focus** — a menu that leaves the focus on its button or field.
- **none** — a notice: it never takes the focus.

`dialogInventory.test.ts` fails when a row has no Focus, when a **trap**
dialog is not `aria-modal="true"`, when a **no trap** one is, or when a
dialog has no `aria-labelledby`. `e2e/dialog-focus.spec.ts` opens the modal
dialogs by keyboard and checks the focus goes in, stays in, and comes back.

## Dialogs and menus

Paths are under `frontend/src/components/`. "Closes by" lists the ways beyond
Escape, which every row has.

| Name | Kind | File | Test id | Opens from | Closes by | Focus |
|---|---|---|---|---|---|---|
| Settings | dialog | `common/SettingsPanel.tsx` | `settings-panel` | the gear; ⌘, in the Mac app | ×, click outside, Close | trap |
| Move My Project Folder | dialog | `common/settings/FoldersSection.tsx` | `project-folder-move-dialog` | Settings ▸ Folders ▸ Move… | ×, click outside, Cancel (Settings stays open) | trap |
| Switch to (the PsyNeuLink list) | menu | `common/settings/SwitchListbox.tsx` | `pnl-switch-listbox` | Settings ▸ Developer ▸ Which PsyNeuLink is installed ▸ Switch to | click outside, a pick (Settings stays open) | takes focus |
| New to PsyNeuView? (the orientation offer) | dialog | `common/OrientationOffer.tsx` | `orientation-offer` | the first launch in a browser | ×, click outside, any of its three answers | trap |
| Install updates automatically? (the one-time offer) | dialog | `common/AutoInstallOffer.tsx` | `auto-install-offer` | the first launch of the Mac app after PsyNeuView-MacApp#79, until answered | ×, click outside (both: asked again next launch), either answer | trap |
| Open menu | menu | `layout/Toolbar.tsx` | `open-menu-list` | Open ▾ | the Open button, click outside | leaves focus |
| New model | dialog | `common/PromptModal.tsx` | `prompt-modal` | Open ▾ New Model | ×, click outside, Cancel, OK | trap |
| Open a model | dialog | `common/FileBrowserModal.tsx` | `file-browser-modal` | Open ▾ Open from path… (in a browser) | ×, click outside, Cancel, a pick | trap |
| Open file from GitHub | dialog | `common/GithubFileLoaderModal.tsx` | `github-file-loader-modal` | Open ▾ From GitHub… | ×, click outside, Cancel, Open | trap |
| A combobox's list (repo, branch) | menu | `common/Combobox.tsx` | `combobox-list` | the ▼ in a combobox, or typing | click outside, a pick, Tab (the dialog around it stays open) | leaves focus |
| Open PsyNeuLink test as model | dialog | `common/DeveloperTestsModal.tsx` | `developer-tests-modal` | Open ▾ Developer / Tests… (developer mode) | ×, click outside, Cancel, Open | trap |
| Save a copy as… | dialog | `layout/Toolbar.tsx` | `save-copy-dialog` | the toolbar's Save a copy as… | ×, click outside, Cancel, Save (not while saving) | trap |
| Why this file is read only | dialog | `layout/Toolbar.tsx` | `pnl-read-only-note` | the "PsyNeuLink from … · read only" tag beside the model name (a managed PsyNeuLink) | ×, click outside, the tag again, Save a copy as… | no trap |
| This model (the model card) | dialog | `layout/ModelTitle.tsx` | `model-card` | the model title in the toolbar (#422) | ×, click outside, the title again | no trap |
| Layout menu | menu | `layout/Toolbar.tsx` | `layout-menu-list` | Layout ▾ | the Layout button, click outside, a pick | leaves focus |
| Tutorials menu | menu | `layout/Toolbar.tsx` | `walkthrough-menu-list` | Tutorials ▾; Help ▸ Tutorials and walkthroughs | the Tutorials button, click outside, a pick | leaves focus |
| Help menu | menu | `layout/HelpMenu.tsx` | `help-menu-list` | Help ▾ | the Help button, click outside, a pick | leaves focus |
| Keyboard Shortcuts | dialog | `common/KeyboardShortcutsReference.tsx` | `shortcuts-reference` | Help ▸ Keyboard Shortcuts; ⌘/ (Ctrl+/); ? away from typing; Settings ▸ Keyboard shortcuts; the Mac app's Help ▸ Keyboard Shortcuts | ×, click outside, Close, Change shortcuts… | trap |
| Developer-mode menu | menu | `layout/DeveloperModeIndicator.tsx` | `developer-mode-menu` | the Developer badge (developer mode) | the badge, click outside, a pick | leaves focus |
| History | dialog | `common/HistoryPanel.tsx` | `history-panel` | the History button | ×, click outside, the History button | no trap |
| Advanced Graph View Options | dialog | `graph/GraphViewOptionsMenu.tsx` | `graph-view-options-menu` | Advanced Graph View Options ▾ in the graph toolbar (it took in the More menu, #123) | ×, its button, click outside; stays open while you change options | no trap |
| Node context menu | menu | `graph/NodeContextMenu.tsx` | `node-context-menu` | a secondary click (Control-click, right-click) on a node | click outside, a pick | leaves focus |
| Port chooser | menu | `graph/PortChooser.tsx` | `port-chooser` | dragging a connection onto a node with several input ports; from a control mechanism, which parameter; from a gating mechanism, which port (#253) | click outside, a pick | leaves focus |
| Arrow context menu | menu | `graph/GraphMenus.tsx` | `edge-context-menu` | a secondary click on an arrow (#261) | click outside, a pick | leaves focus |
| Canvas context menu | menu | `graph/GraphMenus.tsx` | `canvas-context-menu` | a secondary click on empty canvas (#261) | click outside, a pick | leaves focus |
| Palette's compact flyout | menu | `graph/PaletteSidebar.tsx` | `palette-compact-flyout` | a category in the compact palette | click outside, the category again, its ‹ | leaves focus |
| Watching for changes (the file-watch status) | dialog | `common/SyncIndicator.tsx` | `sync-popover` | the ● status at the right end of the diagnostics bar (#103) | ×, click outside, the status again | no trap |
| Changes since the last version that built | dialog | `graph/LastGoodDiff.tsx` | `last-good-diff` | Compare with that version, on the stale-graph banner | ×, click outside | trap |
| Changes since save | dialog | `common/ChangesSinceSaveDialog.tsx` | `changes-since-save` | the orange unsaved dot beside the model name; History ▸ Changes since save… | ×, click outside, Close | trap |
| Leave the tutorial? / Start in a new window? / Save your changes first? / Resume at step N? | dialog | `common/TutorialChoiceDialog.tsx` | `tutorial-choice` | opening another model during a walkthrough; starting one with something in progress; either replacing unsaved work here; starting one left part-way | ×, click outside, Stay here or Cancel, its other answers | trap |
| Revert the file to this save | dialog | `common/RevertToSaveDialog.tsx` | `revert-to-save` | History ▸ a save marker ▸ Revert the file to this save…; History's "You've undone to" line | ×, click outside, Cancel, Revert the file (not while reverting) | trap |
| Convert to Standard Format? | dialog | `common/DiagnosticPanel.tsx` | `convert-confirm-dialog` | Convert to Standard Format, in the diagnostics panel | ×, click outside, Cancel, Convert | trap |
| Snippet menu | menu | `editor/CodeEditor.tsx` | `snippet-menu` | + Snippet in the editor header | the Snippet button, click outside, a pick | leaves focus |
| Sidecar placement | menu | `editor/SidecarPlacementPicker.tsx` | `sidecar-placement-menu` | Files: in the editor header | the button, click outside, a pick | leaves focus |
| Sidecar variant | menu | `editor/SidecarVariantPicker.tsx` | `sidecar-variant-menu` | Layout: / Labels: in the editor header | the button, click outside, a pick | takes focus |
| The file changed on disk | dialog | `common/ExternalChangeModal.tsx` | `external-change-modal` | an external editor saves the open file while there are unsaved edits here | × (Keep my changes), either answer; no click outside — a stray click is not an answer | trap |
| Couldn't open X (a failed open) | notice | `graph/FailedOpenBanner.tsx` | `failed-open-dismiss` | opening a model that fails outright: a missing file, a server error (#401). A strip between the graph toolbar and the canvas, never over the graph; the open model stays | the × (Dismiss), Escape, Try again, opening any model | none |
| Toasts | notice | `common/NotificationBar.tsx` | `notification-dismiss` | an error, warning or message; one with a `key` replaces the last with that key in place, so a burst (undo, #1377) is one notice | the × on each; no Escape, on purpose | none |

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
| The busy wheel, over the graph or the workspace | `common/BusyIndicator.tsx` | status (#38, #220); one at a time, pointer-events none, and it goes when the work is done |
| The focus breadcrumb and the off-screen nodes button | `graph/FocusBreadcrumb.tsx`, `graph/OffscreenNodesIndicator.tsx` | canvas furniture |
| Port and value tooltips on a node | `graph/MechanismNode.tsx` | hover tooltips, pointer-events none |
| Edge bend handles | `graph/ProjectionEdge.tsx` | parts of the edge |
| Composition frame buttons | `graph/CompositionNode.tsx` | parts of the frame, drawn above the canvas so an edge can't lie over them |
| The palette sidebar itself | `graph/PaletteSidebar.tsx` | a layout panel (Layout ▸ Object palette); its compact flyout is the menu above |
| The hint on a blank screen | `layout/BlankScreen.tsx` | status (#215): covers the pane area while every panel is hidden, and goes when a panel comes back from the Layout menu or its key |
