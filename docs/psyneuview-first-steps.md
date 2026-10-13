# PsyNeuView First Steps

Eight short walkthroughs, inside the app, for someone who has just opened
PsyNeuView for the first time: what you are looking at, where your work lives,
what it runs on, and what happens when you edit, save and run a model. Each
takes two to four minutes, so they fit between other things, and they can be
taken in any order.

They are in the **Tutorials ▾** menu, under **PsyNeuView First Steps**,
and offered once when PsyNeuView first opens in a browser ("Maybe later"
leaves a reminder in the menu). The modelling course has its own set:
[Guided walkthroughs: the Cognitive Neuroscience Course](tutorials/16-course-walkthroughs.md).

## How a walkthrough works

The instruction sits in a bar along the bottom of the window, a ring marks the
thing it is about, and a pointer glides to it. A step moves on when you have
done what it asks (opened the tab, selected the node, run the model); a step
that only explains has a **Next** button. Under the instruction is a one-line
**caption**, always shown; **Narration** reads the captions aloud, and is off
until you turn it on (the choice is remembered). The voice and how fast it
reads are chosen in Settings ▸ Tutorials and Voice, which also says how to
download a more natural (Premium) voice for free. **Pause** holds the walkthrough, **Replay** repeats the step, and
**Skip** moves on; **End** leaves it at any point.

## The eight parts

| | Walkthrough | What you do | Based on |
| --- | --- | --- | --- |
| 1 | **The window: the panels, and what "the model" is** | A tour of the toolbar, the code editor, the canvas, the palette and the bottom tabs, on the Stroop model. A model is a PsyNeuLink Python file; the code and the picture are two views of it. | [What PsyNeuView is](introduction.md) |
| 2 | **Opening a model: the Open menu and where each section comes from** | Down the Open menu: New Model, Open from path, My Project Folder, the PsyNeuLink Library (which changes with the PsyNeuLink you select), and the catalogs under development. Ends by opening Stroop. | [Where PsyNeuView keeps things](where-things-live.md) |
| 3 | **Editing: in code or on the canvas, and how they stay in sync** | Start a new model; change a function in the code and watch the canvas rebuild; change a parameter in the Inspector and watch the code change; undo and redo; what happens when the file changes outside PsyNeuView; which edits are written to the file at once and which wait for Save. | [Editing via the code editor](tutorials/06-editing-code.md), [Editing via the inspector](tutorials/05-editing-inspector.md), [Using PsyNeuView with PyCharm](external-editor-workflow.md) |
| 4 | **Saving, and where things live: what you can edit and why** | Save against Save a copy; Settings ▸ Folders; the layout and label files that travel with a model; why PsyNeuLink's own files are read only; locking a model so the graph and Inspector can't change it. | [What you can edit, and why](what-you-can-edit.md), [Where PsyNeuView keeps things](where-things-live.md) |
| 5 | **What it runs on: which PsyNeuLink, its version, and keeping it up to date** | Settings ▸ General ▸ PsyNeuLink version: Latest development or an official release; the status line; automatic updates, installed at the next start. | [Where PsyNeuView keeps things](where-things-live.md) |
| 6 | **Running a model: Run, inputs, results, and stepping** | On the Bistable Attractor demo: the inputs a model declares, Run Model, the results per trial, stepping through the run with the trace bar, Run State, and a second input set. | [Running a model](tutorials/02-running-a-model.md), [Stepping with the debugger](tutorials/04-debugger-stepping.md) |
| 7 | **Settings in two minutes** | Each section of Settings (About, General, Appearance, Tutorials and Voice, Open menu, Folders, Keyboard shortcuts, Developer) and what it is for; what to leave alone; Problem reports and Help ▸ Report a Problem… in the Mac app; closing with Escape. | [Settings, and the Mac app](settings-and-mac-app.md) |
| 8 | **For developers: developer mode, checkouts, and editing PsyNeuLink** | The developer track. Developer mode and its badge; which PsyNeuLink is installed and where; a managed PsyNeuLink is read only, your own checkout is editable; keeping checkouts current; what the Mac app adds. Turns developer mode on for its duration and puts it back after. | [What you can edit, and why](what-you-can-edit.md), [Where PsyNeuView keeps things](where-things-live.md) |

Parts 1 to 7 assume the defaults a regular user has: the included PsyNeuView,
PsyNeuLink "Latest development" kept up to date, models in My Project Folder,
developer mode off. Part 8 is for people who develop PsyNeuLink or PsyNeuView.

A walkthrough can also be linked to directly: `?tour=orientation-window`,
`?tour=orientation-open`, `?tour=orientation-editing`,
`?tour=orientation-saving`, `?tour=orientation-psyneulink`,
`?tour=orientation-running`, `?tour=orientation-settings`,
`?tour=orientation-developers`.

## What you need

A working PsyNeuView. Part 6 steps through a run, which needs a PsyNeuLink
with the debugger hook (0.19.1.0 or later; the default install has it). Parts
3 and 4 create a model file (`orientation_edit.py`, `orientation_save.py`) in
My Project Folder.

## What you can expect

- Every part runs in the tutorials test suite
  (`frontend/e2e/tutorials/orientation.tutorial.spec.ts`), driven from the same
  step list the app shows, so a part can't quietly stop matching the app.
- Each part's bar names the docs page it is based on, the "Based on" column
  above, so a change to that page is a reason to re-read the part.
- The first-launch offer, the menu group and the bar's controls are tested in
  `frontend/e2e/tutorials/orientation-controls.tutorial.spec.ts`.

Tracking: [#1310](https://github.com/jonhanke-nam/PsyNeuView/issues/1310)
(the orientation), [#1311](https://github.com/jonhanke-nam/PsyNeuView/issues/1311)–[#1318](https://github.com/jonhanke-nam/PsyNeuView/issues/1318)
(the parts). For adding a walkthrough of your own:
[Writing a guided walkthrough](guided-walkthroughs.md).
