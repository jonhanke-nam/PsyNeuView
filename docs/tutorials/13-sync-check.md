# The sync check — proving edits flow both ways

A one-minute check that PsyNeuView and your editor are actually talking to each
other. Run it the first time you set up the [two-tool
workflow](../workflow-modes.md#mode-b--psyneuview-beside-pycharm), and any time
something feels stale.

Each check tests **one direction** and has an unambiguous pass. They build on
each other, so run them in order.

> **What you need:** a model open in PsyNeuView, and the same `.py` open in
> PyCharm. Any model will do — these checks don't depend on what it contains.

---

## Check 1 — PyCharm reaches PsyNeuView

The cheapest possible signal: does text get through at all?

1. In **PyCharm**, add a comment at the end of the file:
   ```python
   # sync check
   ```
2. Save (**⌘S**).
3. Look at PsyNeuView's **code panel**.

**Pass:** the comment appears within a second or two. You didn't reload anything.

**If nothing happens,** PsyNeuView isn't watching the file. Close and reopen the
model in PsyNeuView (*Open ▸ from path…*), then try again. A backend restart
after you opened the model is the usual cause.

## Check 2 — the graph, not just the text

Check 1 only proves text arrived. This proves PsyNeuView actually *re-read the
model*, which is what you care about.

1. In **PyCharm**, add a mechanism and put it in the composition. Adjust the
   names to match your file:
   ```python
   sync_check_mech = pnl.TransferMechanism(name='sync_check_mech')
   my_composition.add_node(sync_check_mech)
   ```
2. Save.

**Pass:** a new node labelled `sync_check_mech` appears on the canvas.

**If the code panel updates but no node appears,** the file probably doesn't
parse — check PyCharm for a syntax error, or PsyNeuView for an error message.
An incomplete edit is a normal thing to see mid-typing; it should resolve as
soon as the file is valid again.

## Check 3 — PsyNeuView reaches PyCharm

Now the other direction.

1. In **PsyNeuView**, change a parameter on any node through the inspector.
2. Look at **PyCharm**.

**Pass:** PyCharm shows the file has changed on disk, and the new value is in
the source.

**Note what PyCharm does here** — this is worth knowing once rather than
discovering during real work. If PyCharm has no unsaved changes of its own it
generally reloads the file quietly. If it *does*, it will tell you the file
changed underneath it and ask what you want. That's PyCharm's own conflict
handling, not PsyNeuView's.

## Check 4 — the conflict prompt

The one behavior that's alarming if you meet it by surprise, so meet it
deliberately.

1. In **PsyNeuView's code editor**, type a comment — and **don't** save it.
   Typing updates the canvas but doesn't write your file, so this edit will sit
   here unsaved for as long as you leave it.
2. In **PyCharm**, change something else and save.

**Pass:** PsyNeuView asks which version you want instead of silently picking one.

3. Choose **Keep my changes**.
4. Check the file on disk — in PyCharm, or with `cat model.py`.

**Pass:** the file still holds *PyCharm's* version. Choosing to keep your
in-app changes doesn't overwrite the file; it just means PsyNeuView holds onto
them until you actually save.

If no prompt appeared, check that your comment is really unsaved — the Save
button is enabled when it is. With nothing unsaved on this side there is no
conflict to report, and PyCharm's version is simply applied, which is checks 1
and 2 working correctly rather than check 4 failing.

---

## What sync doesn't cover

Worth stating plainly, so its absence doesn't read as a bug:

- **Layout and labels are PsyNeuView's.** Moving nodes and naming dimensions
  writes companion files, not your `.py`, and PyCharm has no opinion about them.
- **Hand-editing a companion file in PyCharm isn't part of the loop.** Those
  files are managed for you; edit them in the app.
- **Sync is per-model.** PsyNeuView watches the file you have open, not the
  whole project. Changing a *different* file in PyCharm does nothing here, even
  if the open model imports it.

## Guarantees

The behavior on this page is asserted by
`frontend/e2e/external-edit-sync.spec.ts` and
`backend/tests/test_external_edit_sync.py`, which drive the real app the same
way these checks do — writing the `.py` from outside and asserting what the app
does. If a check here stops passing, those fail too.

## See also

- [Two ways to work](../workflow-modes.md) — Mode A and Mode B.
- [Using PsyNeuView alongside PyCharm](../external-editor-workflow.md) — the
  companion files, and what to commit.
- [Editing via the code editor](06-editing-code.md) — editing inside the app.
