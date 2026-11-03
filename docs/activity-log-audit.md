# What the activity log records: the audit

The activity log (`frontend/src/utils/activityLog.ts`) is what a problem
report says happened in the page: the Mac app's Report a Problem reads it
through `window.__pnvDiagnostics` ([Settings and the Mac app](settings-and-mac-app.md#diagnostics-windowpnvdiagnostics)),
and Settings ▸ About downloads it in a browser. This page is the audit asked
for in [#177](https://github.com/jonhanke-nam/PsyNeuView/issues/177): every
control in the app, whether what it does is recorded, how, and, where it
isn't, why not.

**The rule for everything here:** names and paths may be recorded, never a
model's source, a file's contents, or anything typed into a field. The home
folder is written `~`, and a value whose key looks like a token or a password
is never recorded. These are applied on the way into the log, so a caller
can't forget them.

**The setting.** Settings ▸ General ▸ Problem reports ▸ *Keep a log of my
actions for problem reports* (on by default) covers the **user actions**
below: `menu`, `click`, `canvas`, `edit` and `step`. Off, none of those is
recorded or saved, the ones recorded are dropped (from the copy on disk too),
no wait is linked to an action, and a report starts with "Action logging was
off". Everything else stays on, because a report is hard to use without it.

## How most of it is logged: one listener, not a call per button

Since #177 a single capture-phase click listener (`frontend/src/utils/clickLog.ts`,
installed by `installDiagnostics`) records any `button`, `[role=menuitem]`,
`[role=tab]`, `[role=button]`, link or `summary` pressed anywhere, by its
label: its `aria-label`, its text, or its `title` when the text is only a
symbol (↩, ⚙). Where the control is comes from the nearest ancestor marked:

| Mark | Entry | Example |
|---|---|---|
| `data-pnv-menu="Open"` on a menu's list | `menu` | `Open › Open from path…` |
| `data-pnv-where="Toolbar"` on an area | `click` | `Toolbar › Save` |
| none | `click` | `Run Model` |

Marked today: the Open, Tutorials and Layout menus (`data-pnv-menu`); the
toolbar, the bottom tab bar and the Settings dialog (`data-pnv-where`). A new
button needs nothing to be logged; a new menu or area adds the one attribute
to say where it is.

Not a control, so never recorded by the listener: text fields, the code
editor, selects and checkboxes (a setting change is recorded by its store,
with the value only when the key isn't sensitive), and plain clicks on the
canvas or on text. Nor the button that opens a menu (`aria-haspopup="menu"`):
the menu records its own opening (`Open menu opened`), and one click
shouldn't be two entries.

## The controls

### Toolbar

| Control | Logged? | As |
|---|---|---|
| Open menu — opening it | yes (#176) | `menu` · `Open menu opened` |
| Open menu — any item, including a model's name | yes | `menu` · `Open › <item>` |
| Open from path… — the path typed | the open, not the typing | `model` · `Opened ~/…` (the path is a name) |
| New model, Import model or project… | yes | `menu` · `Open › …` |
| Save | yes (#177) | `click` · `Toolbar › Save`, then `model` · `Saved ~/…` or `Save failed: …` |
| Save a copy… — the dialog's buttons | yes (#177) | `click` · the button's label |
| Undo, Redo | yes (#177) | `click` · `Toolbar › Undo: Moved node a (⌘Z)`, and `edit` · `Undo: Moved node a` once applied |
| History panel — jump to a step | yes (#177) | `click` · the step; `edit` · `Undo: …`/`Redo: …` with `steps` |
| Layout menu — opening, and each item | yes (#176, items earlier) | `menu` · `Layout menu opened`, `Layout › <item>` |
| Tutorials menu — opening, and each item | yes | `menu` · `Tutorials menu opened`, `Tutorials › <item>` |
| Settings gear, Developer indicator | yes (#177) | `click` · `Toolbar › Settings`, `Toolbar › Developer` |
| Model name, unsaved dot, lock tag, PsyNeuLink source badge | yes (#177) | `click` · the label; a lock or unlock also `model` · `Locked (view only): ~/…` |
| Busy wheel | not a control | its waits are the wait log |

### Bottom panel

| Control | Logged? | As |
|---|---|---|
| Switching tabs (Inspector, Scheduler, Run, Learn, Run State, Show Graph, Style) | yes (#177) | `click` · `Bottom tabs › Run`; the current tab is also in the state |
| Run Model | yes | `click` · `Run Model`, then `run` · `Run started: <composition>` / `Run finished` with the outcome |
| Learn | yes | `click`, then `learn` · started / finished / failed / cancelled |
| Trace stepping: step, trial, autoplay, clear | yes | `step` · `Step 2 of 9`, `Autoplay started at 2×`, `Trace cleared` |
| Inspector — a parameter changed | yes (#177) | `edit` · `Modified <param> in <node>`: the name, never the value |
| Inspector — function, conditions, projections, snippets | yes (#177) | `edit` · `Changed function of a to Linear`, `Added … condition on a`, `Added projection a → b`, `Inserted snippet: <label>` |
| Inspector — every other button | yes (#177) | `click` · the button's label |
| Run and Learn inputs typed | no, by rule | never what is typed |

### Graph canvas

| Control | Logged? | As |
|---|---|---|
| Selecting a node (click, Inspector, shortcut) | yes (#177) | `canvas` · `Selected node a` (the store's selection, so every route counts once) |
| Selecting an edge | yes (#177) | `canvas` · `Selected edge a->b` |
| Clearing the selection | yes (#177) | `canvas` · `Selection cleared` |
| Dragging a node | yes (#177) | `edit` · `Moved node a`, once, when the drag ends (`onNodeDragStop`), not per mouse move |
| Dropping from the palette, deleting a node | yes (#177) | `edit` · `Added TransferMechanism "a"`, `Deleted node a` |
| Context menu items | yes (#177) | `click` · the item's label |
| Panning and zooming | **no, deliberately** | one entry per gesture would flood the log and says little about a problem; the view's layout style and direction are in the state |
| Rubber-band selection of several nodes | **no** | React Flow keeps the multi-selection; the store tracks the one selected node. Left for now: a problem rarely turns on it |
| Fit, layout buttons over the graph | yes (#177) | `click` · the button's label |

### Code editor

| Control | Logged? | As |
|---|---|---|
| Typing | the fact, never the text | `edit` · `Edited the code`, as undo records it |
| Preview, error banner buttons | yes (#177) | `click` · the label; the error itself is `error` · `Model error: …` |

### Settings

| Control | Logged? | As |
|---|---|---|
| Opening a section | yes | `menu` · `Settings › general` |
| Any setting changed | yes | `setting` · `<inventory id> = <value>`, the value left out when the key is sensitive |
| Buttons (Check now, Apply & restart, Move…, Show in Finder, Download diagnostics) | yes (#177) | `click` · `Settings › <label>`; a PsyNeuLink switch also `psyneulink` entries |
| The address reports go to | the change, never the address | `setting` · `mac-report-send-to changed` |

### Elsewhere

| What | Logged? | As |
|---|---|---|
| Keyboard shortcuts that did something | yes | `menu` · `Shortcut: <label>` |
| Walkthroughs: started, each step, ended | yes | `walkthrough` |
| Every message shown | yes | `notification`, with its type |
| A model error in the diagnostics bar | yes | `error` |
| The model or PsyNeuLink's code changing on disk | yes | `file` |
| A PsyNeuLink switch, update check, the Mac app switching PsyNeuView | yes | `psyneulink` |
| Drag-and-drop of a file onto the window | the import's outcome | the messages shown, and `model` · `Opened …` |
| Every request to the server, and every long step | yes (#176) | the wait log, with its start, stop, outcome and cause |
| A page loading | yes (#177) | `logging` · `Page loaded`, so the saved copy shows a reload |

## What survives a restart

The page's log starts empty when the page loads. The saver
(`frontend/src/utils/activitySaver.ts`) sends new entries and finished
waits to the server in batches, at once when the page is hidden or about
to unload, and the server keeps them under `~/.psyneuview/activity-log`
(`backend/app/services/activity_log.py`): `current.jsonl` for this launch,
`previous.jsonl` for the last, each capped at 2 MB. A report's `timeline`
has this launch's earlier page loads from the copy, and `previousActivity`
the previous launch's. It stays on the machine; nothing reads it but a
report and the About download.

## Deliberately not logged, and why

- **Panning and zooming the graph**: a gesture a second, no diagnostic value.
- **Mouse movement, hovering, tooltips**: the same.
- **Rubber-band multi-selection**: not tracked by the store; see above.
- **What is typed anywhere**: the rule. The name of the thing changed is the
  most the log holds.
- **Background polls** (health, running jobs, update checks): not waits
  unless they run a second or more, and then marked background (#176).
