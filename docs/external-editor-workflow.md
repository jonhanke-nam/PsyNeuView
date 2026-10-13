# Using PsyNeuView alongside PyCharm (or any external editor)

This guide is for people who write their PsyNeuLink models as `.py` files in a
Python IDE — **PyCharm** is the running example — and want to open the *same*
model in PsyNeuView to view, lay out, label, and run it. It explains every extra
file PsyNeuView puts next to your `.py`, which ones matter, what to commit, and
the round-trip that keeps the two tools from stepping on each other.

> **Companion docs.** [`file-handling.md`](./file-handling.md) is the canonical
> model of how PsyNeuView treats files; [`file-conventions.md`](./file-conventions.md)
> is the file-classification reference. This page is the *user-facing PyCharm
> workflow* that sits on top of them.

## The one rule: your `.py` is the model

A PsyNeuLink model **is** its Python source. PsyNeuView reads from and writes back
to that `.py`; everything else it creates is derived or companion data wrapped
around it. Two consequences you can rely on:

- **PyCharm stays authoritative for code.** You edit the model's structure,
  parameters, and logic in PyCharm exactly as you do today.
- **Deleting any companion file loses only presentation state** — graph layout,
  label names, variant ordering — never the model itself. The `.py` is enough to
  rebuild all of it.

PsyNeuView owns the *presentation*: where nodes sit, what the vector dimensions
are called, which saved layout is active. That split — **code in PyCharm, layout
& labels in PsyNeuView** — is the whole idea behind the workflow.

## What PsyNeuView puts next to your `.py`

Open `model.py` from a normal folder (not one of PsyNeuView's managed clones) and,
as you use the app, these companion ("sidecar") files can appear **beside it**:

| File | What it is | Appears when |
| --- | --- | --- |
| `model.pnlview.json` | **Graph layout** — node positions, viewport, and a demo-origin pointer | You move/arrange nodes |
| `model.labels.yaml` | **Semantic labels** — human names for vector dimensions (e.g. `red_ink`, `green_ink`) | You edit element labels |
| `model.psyneuview.json` | **Index** — the order of your named layouts/label-sets and which one is active | You create, rename, or reorder named variants |
| `model.<name>.pnlview.json` | A **named layout variant** | You save a second, named layout |
| `model.<name>.labels.yaml` | A **named label-set variant** | You save a second, named label set |
| `model.original.py` | **Backup** taken before a "convert to standardized" rewrite | You run Convert |
| `model.star_import_original.py` | **Backup** taken before a `from x import *` rewrite | The app auto-expands a star import |

None of these are files you "open" or "save" directly in PsyNeuView — they're
managed for you and always follow their `.py`. The canonical implementations, if
you ever want the exact format: `backend/app/services/layout.py` (layout),
`backend/app/services/labels.py` (labels), and
`backend/app/services/sidecar_index.py` (the index + the named-variant
convention).

### A concrete before / after

```text
# before you open it in PsyNeuView
my_models/
  stroop.py

# after arranging the graph and naming a few dimensions
my_models/
  stroop.py
  stroop.pnlview.json      # layout you arranged
  stroop.labels.yaml       # the names you gave the dimensions
```

## What to commit to version control

Treat the sidecars by intent:

- **Commit the layout and labels** (`*.pnlview.json`, `*.labels.yaml`,
  `*.psyneuview.json`) if you want collaborators — or future-you — to open the
  model in PsyNeuView and see the *same* arrangement and names. They're small,
  human-diffable, and are exactly how the bundled reference models ship their
  presentation (see e.g. `backend/stroop_reference_with_lc.labels.yaml`).
- **Do not commit the backups.** `*.original.py` and `*.star_import_original.py`
  are one-shot safety copies for undo, not project artifacts.

A `.gitignore` snippet for the backups:

```gitignore
# PsyNeuView one-shot conversion backups — not project artifacts
*.original.py
*.star_import_original.py
```

If you'd rather keep sidecars out of git entirely (you use PsyNeuView purely as a
personal viewer), ignore all of them instead:

```gitignore
# PsyNeuView companion files (personal viewer setup)
*.pnlview.json
*.labels.yaml
*.psyneuview.json
*.original.py
*.star_import_original.py
```

## The recommended PyCharm ↔ PsyNeuView loop

1. **Write / edit the model in PyCharm** as usual, and save.
2. **Open it in PsyNeuView** (Open ▸ from path…, or drop the file in). PsyNeuView
   introspects the `.py` and renders the graph.
3. **Arrange, label, and run in PsyNeuView.** Layout and label edits write only to
   the sidecars — they never touch your `.py`'s code.
4. **Back to PyCharm for code changes.** Save, and PsyNeuView picks the change up
   on its own — the code panel and the graph both. No reload step.

Step 4 works because PsyNeuView watches the `.py` you have open and re-reads the
model when it changes on disk. Three things follow, and they're worth knowing
before you rely on them:

- **PsyNeuView's own writes aren't mistaken for yours.** Saving in the app
  doesn't bounce back as an external change.
- **If both sides changed, you're asked.** When the file changes on disk while
  you have unsaved edits in PsyNeuView, the app stops and offers you the choice —
  load from disk, or keep your changes — rather than picking a winner. Choosing
  to keep yours leaves the file on disk alone until you actually save.
- **Typing in PsyNeuView does not write your file.** The canvas follows what you
  type, but the graph is built from a private copy — your `.py` changes when you
  Save, and not before ([#1029](https://github.com/jonhanke-nam/PsyNeuView/issues/1029)).
  Inspector and canvas edits are the exception: those are deliberate actions and
  are written straight away, committing any unsaved code-editor text with them.

Together those make the round trip safe, but the habit that avoids all surprises
is still: **do your code editing in one window at a time.**

To confirm all of this is working on your machine, run
[the sync check](./tutorials/13-sync-check.md) — four short tests, about a
minute.

> **Rule of thumb:** let PyCharm own the `.py` and let PsyNeuView own the
> sidecars. As long as a given file has one author at a time, the two tools never
> collide.

## Keeping your PyCharm project tidy

If you'd prefer not to see the companion files in PyCharm's project view, you have
options today and a cleaner one coming:

- **Today:** collapse or exclude them in PyCharm (mark the pattern as
  hidden/excluded in the project view), or `.gitignore` them so at least VCS
  stays quiet.
- **Planned** ([#927](https://github.com/jonhanke-nam/PsyNeuView/issues/927)): a
  per-model option to collect all sidecars into a single hidden `.psyneuview/`
  folder beside the `.py`, so your model folder shows just the `.py`:

  ```text
  my_models/
    stroop.py
    .psyneuview/
      stroop.pnlview.json
      stroop.labels.yaml
  ```

  The planned rule: **lateral files win when present, and the dot-folder is the
  home for new sidecars.** So a brand-new model gets a clean folder by default
  (its sidecars go into `.psyneuview/`), while a model that already has visible
  lateral sidecars keeps using them — a model's sidecars are never split across
  both places. Discovery is lateral-first, dot-folder fallback: a **visible** file
  is never silently ignored in favor of a **hidden** one, so you never have to
  wonder why a file sitting in plain sight isn't the one being used. A per-model
  setting will let you force either layout if you want everything visible.

## See also

- [`file-handling.md`](./file-handling.md) — the canonical file model (the four
  verbs, formats matrix, where files live).
- [`file-conventions.md`](./file-conventions.md) — how a file's type is decided.
- [`workflow-modes.md`](./workflow-modes.md) — the two ways to work with the
  app, and how to choose. This page is the detail behind its Mode B.
- [The sync check](./tutorials/13-sync-check.md) — prove edits flow both ways.
- Tracking issues: two-headed workflow umbrella
  [#1027](https://github.com/jonhanke-nam/PsyNeuView/issues/1027), conflict
  semantics [#926](https://github.com/jonhanke-nam/PsyNeuView/issues/926),
  dot-folder declutter
  [#927](https://github.com/jonhanke-nam/PsyNeuView/issues/927).
</content>
</invoke>
