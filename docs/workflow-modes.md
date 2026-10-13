# Two ways to work: PsyNeuView alone, or PsyNeuView + your editor

There are two supported ways to use PsyNeuView, and the difference between them
is simply **how many tools have their hands on the model at once**.

| | **Mode A — PsyNeuView alone** | **Mode B — PsyNeuView + PyCharm** |
| --- | --- | --- |
| Where you edit code | In the app's code editor | In PyCharm |
| Where you arrange the graph | In the app | In the app |
| What you need installed | PsyNeuView | PsyNeuView and an IDE |
| Best when | The model starts here, or you're mostly reading and running one | The model already lives in a Python project, is under version control, or you want the IDE's refactoring and debugging |

Neither is a setting you switch on. They're just descriptions of how you're
working, and you can move between them freely — the files on disk are the same
either way.

## The one principle behind both

**A PsyNeuLink model *is* its Python source.** PsyNeuView reads from and writes
back to that `.py`; everything else it creates is presentation wrapped around it
— where nodes sit, what you've named the vector dimensions, which saved layout
is active.

That gives a clean division of labor, and it's the whole reason Mode B works at
all:

| | owns | writes |
| --- | --- | --- |
| **Your IDE** | the model's code | `model.py` |
| **PsyNeuView** | how it looks | `model.pnlview.json`, `model.labels.yaml`, `model.psyneuview.json` |

Delete any of PsyNeuView's files and you lose layout and labels — never the
model. The `.py` is enough to rebuild all of it.

---

## Mode A — PsyNeuView on its own

One window. Open a model (or build one from the palette), arrange it, run it,
save it.

1. **Open or create.** Open a reference model, open a `.py` from a path, or
   start building on the canvas.
2. **Edit** — through the inspector, the canvas, or the built-in code editor.
   All three change the same underlying source.
3. **Run**, look at the results, adjust, run again.
4. **Save.** Your `.py` is written, and the layout and label files land beside
   it.

Everything is in one place, and nothing else is competing to write your files.
If that describes how you work, you can stop reading here — the rest of this
page is about the second tool.

---

## Mode B — PsyNeuView beside PyCharm

This is for people who already write PsyNeuLink models as `.py` files in an IDE
and want to *see* them — lay them out, label them, run them — without giving up
the editor they know.

Both windows stay open on the same file. **PyCharm owns the code. PsyNeuView
owns the presentation.** As long as that holds, the two never collide.

### The loop

1. **Write the model in PyCharm** and save.
2. **Open it in PsyNeuView** — *Open ▸ from path…*, or drop the file in.
3. **Arrange and label in PsyNeuView.** This writes only the companion files,
   never your `.py`.
4. **Go back to PyCharm, change the code, and save.** PsyNeuView notices and
   updates — the code panel and the graph both. You don't reload anything.
5. **Run in PsyNeuView**, and keep going round.

Step 4 is the part worth trying immediately, because it's the one people don't
believe until they see it. The [sync check](tutorials/13-sync-check.md) walks
you through proving it, in both directions, in about a minute.

### How to tell it's actually watching

Sync used to be invisible: when it worked you saw the canvas change, and when it
stopped you saw nothing at all — *"no changes yet"* and *"not connected"* looked
identical.

There is now a small indicator that always says which:

| it says | meaning |
|---|---|
| **Watching for changes** | armed — edits in PyCharm will appear here |
| **Reloaded from disk** | briefly, just after a change arrived, so the canvas moving is explained |
| **Waiting on you** | both sides changed; it's asking which to keep |
| **Not watching** | no model open, or the connection dropped |

If it says *Not watching* while a model is open, sync will recover on its own
when the connection comes back. Nothing is lost in the meantime — your file is
untouched, and PsyNeuView simply won't notice changes until it reconnects.

### What crosses between the two

| Change | Made in PyCharm | Made in PsyNeuView |
| --- | --- | --- |
| Add or remove a mechanism | Appears on the canvas | Written into your `.py` |
| Change a parameter | Appears in the inspector | Written into your `.py` |
| Move a node, save a layout | — | Companion file only; PyCharm's `.py` untouched |
| Name a vector dimension | — | Companion file only |

The bottom two rows are the point of the division: PsyNeuView's *visual* work
never touches the file PyCharm is editing.

### What stays put when the model changes

Editing in PyCharm changes the graph, and the arrangement has to survive an edit
it knows nothing about. Two kinds of thing, and the difference is worth knowing:

- **What you placed** — a node you dragged, an edge you bent, a port you moved.
  Saved, and never moved on their own.
- **What was computed** — everything else. Worked out from the graph each time,
  and it *follows* the things you placed.

Both are steady while the model is steady: reopening a file you haven't touched
gives back the picture you left. The difference shows when the model changes. Add
a mechanism in PyCharm and it appears where the layout engine thinks it belongs,
among the nodes you positioned — and an unrelated edge may take a new route
around it. Nothing you touched moved, but the picture did.

Select anything and the inspector says which kind it is — *placed by you* or
*placed automatically*, *shaped by you* or *routed automatically*. Dragging
something is what turns the second into the first.

The practical version: **arrange what you care about, and let the rest follow.**
Anything you have not arranged will quietly do something sensible as the model
grows, and anything you have arranged will stay where you put it.

### Things to know before you start

**Typing here doesn't write your file.** As you edit in the app's code editor
the canvas keeps up with you, but your `.py` is not touched — the graph is built
from a private copy of what you've typed. Your file changes when you **Save**
(⌘S, or the Save button), and not before. So PsyNeuView never writes the file
PyCharm has open unless you asked it to.

**Inspector and canvas edits do write, immediately.** Changing a parameter or
renaming a node is a deliberate action, so it goes straight to the `.py` — and
it commits any unsaved code-editor text along with it, since the change is
applied to the file. If you have unfinished edits in the code panel, finish them
before reaching for the inspector.

**If you edit both at once, you'll be asked.** When the file changes on disk
while you have unsaved changes in PsyNeuView, the two versions have genuinely
diverged and only you know which one you want, so the app stops and asks rather
than picking:

- **Load from disk** — take PyCharm's version; your unsaved changes here go away.
- **Keep my changes** — carry on in PsyNeuView; the file on disk keeps PyCharm's
  version until you save over it.

If there's nothing unsaved in PsyNeuView, there's no conflict and nothing to ask
about — PyCharm's version is simply applied.

**And saving can't quietly overwrite PyCharm's work.** The prompt above depends
on PsyNeuView having *noticed* the change, and noticing is a notification, not a
guarantee — a dropped connection or a restart can miss one. So Save checks the
file itself before writing: if it changed since PsyNeuView loaded it, the save
is refused and you get the same choice. Nothing is written, and neither version
is lost.

**A half-finished file doesn't blank the canvas.** A model under edit is broken
for much of the time it's being edited — a mechanism half typed, an import not
yet added — and every one of those saves reaches PsyNeuView. Rather than tearing
the graph down and rebuilding it a keystroke later, it keeps the last version
that built and says so:

> **Showing the last version that built.** The file does not run right now, so
> the graph has not been updated.

The banner offers **Compare with that version** — a diff between the file as it
stands and the last one that worked. Mid-edit, *"what did I just change"* is
usually a faster route to the problem than the syntax error is.

The same happens as you type in PsyNeuView's own editor, a moment after you
pause: for a syntax error, and for a line you just wrote that parses but fails
when it runs (an undefined name, a misspelt class). The banner names the error
and its line, and goes away as soon as the code builds again.

### Keeping the project tidy

PsyNeuView's companion files appear next to your `.py`, which means PyCharm's
project view and `git status` will show them. What to commit, what to ignore,
and how to hide them from the project view are all covered in
[Using PsyNeuView alongside PyCharm](external-editor-workflow.md).

---

## Which should I use?

Ask where the model lives.

- **It doesn't exist yet, or it's a reference model you're exploring** →
  Mode A. Add the IDE later if you need it; nothing has to change.
- **It's a file in a Python project you already work on** → Mode B. You keep
  your IDE, and PsyNeuView becomes the view onto it.
- **You want to build visually and then take it into a project** → start in
  Mode A, save the `.py` where you want it, open that folder in PyCharm. You're
  now in Mode B.

## See also

- [Using PsyNeuView alongside PyCharm](external-editor-workflow.md) — the
  companion files in detail: what each one is, what to commit, how to hide them.
- [The sync check](tutorials/13-sync-check.md) — prove edits flow both ways.
- [File handling](file-handling.md) — the canonical model of how PsyNeuView
  treats files.
- [Getting started](getting-started.md) — installing and running the app.
- [PyCharm setup on macOS](guides/pycharm-setup-macos.md) — the IDE side of Mode B,
  click by click.
- [Already a PsyNeuLink developer?](guides/existing-psyneulink-setup.md) — adding
  PsyNeuView to a working PsyNeuLink setup without changing it.
