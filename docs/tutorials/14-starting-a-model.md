# Starting a model in the two-editor workflow

The other tutorials begin "open a reference model". This one begins earlier —
with an empty file, or with somebody else's script — and gets you to the point
where [the two-editor loop](../workflow-modes.md)
is running.

Three ways in. Pick the one that matches where your model is now.

> **What you need:** PsyNeuView running, and PyCharm set up
> ([macOS setup](../guides/pycharm-setup-macos.md)).

---

## A. A new model, written in PyCharm

**In PyCharm**, make a new `.py` in your models folder. The smallest thing worth
opening is a mechanism and a composition containing it:

```python
import psyneulink as pnl

decision = pnl.TransferMechanism(
    input_shapes=[2],
    function=pnl.Logistic(gain=1.0),
    name='decision',
)

model = pnl.Composition(name='model')
model.add_node(decision)
```

Save it. **In PsyNeuView**, *Open ▸ from path…* and give it that file. You get
one node on the canvas.

From here you're in the loop: add a mechanism in PyCharm, save, and watch it
appear. Nothing else to set up.

### What if you open it before it's finished?

You will, constantly — that's the normal rhythm of writing a model. PsyNeuView
re-reads the file on every save, including the saves where you're midway
through a line.

- **Valid Python, no composition yet** → loads, empty canvas. Not an error.
- **Not valid Python yet** → an error message, and the canvas holds whatever it
  last understood. Keep typing; the next save that parses picks up where you
  left off.

If you find yourself looking at errors constantly, that's the argument for
saving deliberately rather than on focus-loss —
[Step 4 of the setup guide](../guides/pycharm-setup-macos.md#step-4-decide-when-pycharm-saves).

## B. A model that already exists

Someone else's script, one of the PsyNeuLink examples, or something you wrote
before you had PsyNeuView. Just open it — *Open ▸ from path…*.

**PsyNeuView takes models as they are.** It doesn't require a particular layout
or house style, and it won't ask to rewrite your file on the way in. Verbatim
PsyNeuLink examples are expected to work as-is.

Two things worth knowing:

**Star imports are rewritten, automatically.** If your file says
`from psyneulink import *`, PsyNeuView converts it to `import psyneulink as pnl`
and tells you it did. It keeps a copy of what you gave it as
`model.star_import_original.py`. This one is not optional — the app needs
qualified names to know what it's looking at.

**Standardizing is available, and optional.** PsyNeuView has an internal "standard
format" that some editing features work best against. If you want it, it's in
the Inspector as **Convert to Standard Format** — and it backs your file up as
`model.original.py` first. You never have to. Converting rewrites your code's
structure, so on a file you share with other people, think before you do.

## C. Built in PsyNeuView, then taken into PyCharm

Building on the canvas and moving to an IDE later is the same workflow entered
from the other end.

1. Build the model in PsyNeuView — palette, canvas, inspector.
2. **Save** it somewhere inside a folder you want as a PyCharm project.
3. In PyCharm, **File ▸ Open** that *folder* (not the file).
4. Set the interpreter —
   [Step 3](../guides/pycharm-setup-macos.md#step-3-point-pycharm-at-a-python-with-psyneulink-in-it).

You're now in exactly the state route A ends in, and the file is ordinary
PsyNeuLink code — nothing PsyNeuView-specific in it.

---

## What appears next to your file

Whichever route you took, once you start arranging and labelling in PsyNeuView
you'll see companion files show up beside your `.py`:

```text
my_models/
  model.py               # yours — the model
  model.pnlview.json     # PsyNeuView's — node positions
  model.labels.yaml      # PsyNeuView's — names for vector dimensions
```

Your `.py` is the model; the rest is presentation and can be regenerated. Which
of them to commit is covered in
[Using PsyNeuView alongside PyCharm](../external-editor-workflow.md#what-to-commit-to-version-control),
and hiding them in PyCharm is
[Step 5](../guides/pycharm-setup-macos.md#step-5-hide-the-files-you-dont-edit-by-hand).

## Next

- [The sync check](13-sync-check.md) — confirm edits flow both ways before you
  build anything substantial.
- [Building a model](03-building-a-model.md) — the canvas and palette in depth.
- [Two ways to work](../workflow-modes.md) — how the two tools divide the work.
