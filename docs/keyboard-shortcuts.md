# Keyboard shortcuts: the standard set

This page is the standard for PsyNeuView's keyboard shortcuts
([#292](https://github.com/jonhanke-nam/PsyNeuView/issues/292)). Every
shortcut the app has is listed here, with its default key on the Mac and on
Windows and Linux, and the convention it follows.

**New shortcuts are added here first, in the pull request that adds them.**
`frontend/src/shortcuts/keyboardShortcutsDoc.test.ts` reads the table below
and fails when it and the registry (`frontend/src/shortcuts/registry.ts`)
disagree: a shortcut missing from either, a different default key, or a
different area.

In the app, **Help ▸ Keyboard Shortcuts** (also ⌘/ or Ctrl+/, and **?** when
you are not typing) lists the same set, marks any you have changed with the
default beside it, and links to **Settings ▸ Keyboard shortcuts**, where each
one can be changed.

## The rules

- **⌘ on the Mac, Ctrl on Windows and Linux.** Option on the Mac is Alt
  elsewhere. A binding is written once, as `Mod`, and shown the platform's
  way: ⇧⌘Z on a Mac, Ctrl+Shift+Z elsewhere.
- **Conventions, in order:** Apple's Human Interface Guidelines first; where
  Apple has nothing to say, Preview, then Xcode, then Figma.
- **Never take a key the operating system or the browser keeps.** ⌘Q, ⌘Tab
  and ⌘Space belong to macOS. In a browser, ⌘W, ⌘T, ⌘N, ⌘L, ⌘1–⌘9 and ⌘0
  belong to the browser and never reach the page; inside the Mac app they do.
  Where a shortcut's key cannot reach the page in a browser, a second key that
  can is provided (as ⇧1 does for fitting the graph), or it can be changed in
  Settings, which refuses keys that would never arrive.
- **A shortcut with no ⌘ or Ctrl never fires while you are typing** — not in
  a field, not in the code editor. That covers "?" and ⇧1.
- **Defaults are stored per platform** (`mac` and `other`, the
  `platformDefaults` of a registry entry), so a Windows app needs no rework.
  Today every default is the same on both, written with `Mod`.

## The set

Keys are shown the way the app shows them. "Area" is the heading the
shortcut is listed under in Settings and in Help ▸ Keyboard Shortcuts.

| Action | Id | Mac | Windows and Linux | Area | Convention |
|---|---|---|---|---|---|
| Save model | `model.save` | ⌘S | Ctrl+S | File | Apple HIG: File ▸ Save |
| Undo | `history.undo` | ⌘Z | Ctrl+Z | Edit | Apple HIG: Edit ▸ Undo. Covers the whole model, so it also wins inside the code editor |
| Redo | `history.redo` | ⇧⌘Z | Ctrl+Shift+Z | Edit | Apple HIG: Edit ▸ Redo |
| Show Inspector | `inspector.focus` | ⌘I | Ctrl+I | View | Apple HIG: Show Inspector (Xcode, Pages, Keynote) |
| Show or hide the graph | `layout.toggleGraph` | ⌘1 | Ctrl+1 | View | Xcode: ⌘1–⌘9 show its navigators ([#191](https://github.com/jonhanke-nam/PsyNeuView/issues/191)). A browser keeps it |
| Show or hide the code editor | `layout.toggleCode` | ⌘2 | Ctrl+2 | View | As above |
| Show or hide the Inspector panel | `layout.toggleBottom` | ⌘3 | Ctrl+3 | View | As above |
| Show or hide the Components panel | `layout.togglePalette` | ⌘4 | Ctrl+4 | View | As above |
| Delete the selected nodes | `graph.deleteSelection` | Backspace | Backspace | Graph | Apple HIG: Delete. Never while typing |
| Cancel the current gesture | `gesture.cancel` | Escape | Escape | Graph | Apple HIG: Escape cancels. Passes on to an open menu or dialog when there is nothing to cancel |
| Show keyboard shortcuts | `help.shortcuts` | ⌘/ | Ctrl+/ | Help | Google's apps, Slack, GitHub |
| Show keyboard shortcuts (second key) | `help.shortcutsQuestion` | ? | ? | Help | Gmail, GitHub, Figma. Never while typing |

<!-- TODO(#289): when #289 (PR #293) is in devel, add its three rows above and
check them with keyboardShortcutsDoc.test.ts:
| Fit the graph to the window | `view.fitGraph` | ⌘9 | Ctrl+9 | View | Preview: View ▸ Zoom to Fit. A browser keeps it |
| Fit the graph to the window (second key) | `view.fitGraphShift` | ⇧1 | Shift+1 | View | Figma, Sketch. Never while typing |
| Show the graph at actual size (100%) | `view.actualSize` | ⌘0 | Ctrl+0 | View | Preview: View ▸ Actual Size. A browser keeps it, and so does the Mac app's View ▸ Actual Size (below) |
-->

## Keys the Mac app's menus keep

The Mac app's native menus match their keys before the page sees them, so
these cannot be changed in Settings. Help ▸ Keyboard Shortcuts lists them,
inside the Mac app, marked "set by macOS". They are declared in
PsyNeuView-MacApp's `Sources/PsyNeuView/Models/MenuShortcuts.swift`; this table
and `MAC_APP_MENU_KEYS` in `frontend/src/shortcuts/reference.ts` follow it.

| Menu item | Key |
|---|---|
| PsyNeuView ▸ Settings… (opens this app's Settings) | ⌘, |
| PsyNeuView ▸ Quit PsyNeuView | ⌘Q |
| File ▸ New Window | ⌘N |
| File ▸ Close Window | ⌘W |
| Edit ▸ Cut, Copy, Paste, Select All | ⌘X, ⌘C, ⌘V, ⌘A |
| View ▸ Actual Size (the whole window) | ⌘0 |
| View ▸ Zoom In, Zoom Out (the whole window) | ⌘+ (and ⌘=), ⌘- |
| Services ▸ Start Services, Restart Services | ⌃⌘S, ⌃⌘R |
| Development ▸ Switch Branch…, View Logs | ⌘B, ⌘L |
| Window ▸ Minimize | ⌘M |
| Help ▸ Keyboard Shortcuts, Report a Problem… | none |

**Open question:** View ▸ Actual Size takes ⌘0 for the whole window, so inside
the Mac app the graph's own ⌘0 ("actual size", #289) never reaches the page.
Which one keeps ⌘0 is still to be decided.

Rebinding the native keys is not offered: they are shown read-only, the
simpler default the issue suggested. Making the native menu follow a key
rebound in Settings (for a web shortcut that also has a native menu item) is
left for when such a menu item exists; today none does.

## When there is a Windows app

- **Alt opens the menus**, with an underlined access key in each menu name.
- **F1 opens Help**, as Windows apps do.
- Ctrl takes ⌘'s place throughout, as the "Windows and Linux" column already
  shows.
