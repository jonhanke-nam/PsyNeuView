# PyCharm alongside PsyNeuView — setup on macOS

This is the other half of the desk. The
[web app guide](./psyneuview-web-app-getting-started-macos.md) gets PsyNeuView
running; this gets PyCharm set up so the two work on the same model without
fighting each other.

About 15 minutes. You need PsyNeuView already working.

> **Why bother:** you keep the editor you know for writing code, and PsyNeuView
> becomes a live view onto it — save in PyCharm, watch the graph update. See
> [Two ways to work](../workflow-modes.md) for the shape of it.

---

## Step 1: Install PyCharm

```bash
brew install --cask pycharm
```

That's the free Community edition of the current cask. If you already have
PyCharm from the JetBrains Toolbox, use that instead — nothing here depends on
how it was installed.

> **"PyCharm" vs "PyCharm CE" — open `PyCharm`.**
>
> PyCharm used to ship as two applications: **Community Edition (CE)**, free but
> limited, and **Professional**, paid. JetBrains merged them into a single
> **PyCharm** with a free tier and a paid Pro tier, and stopped building CE.
>
> So CE is not a lighter version that is still maintained — it is discontinued.
> It keeps working, but gets no fixes, and Homebrew drops it in December 2026.
> Its version number gives it away: CE stopped at 2025.2, while PyCharm is on
> 2026.2.
>
> Nothing in this workflow needs a paid feature — editing Python, the
> interpreter setting, and save behavior are all core editor functionality.
>
> **If you already have both icons**, open **PyCharm**, not PyCharm CE. Settings
> and interpreters are stored per application, so setting one up and then
> opening the other looks like the setup failed. To remove the old one:
>
> ```bash
> brew uninstall --cask pycharm-ce
> ```

If the download stalls partway (it's about 1 GB and the JetBrains CDN sometimes
hangs), press **Ctrl-C** and run the same command again — it resumes rather than
starting over.

### Then open it

Installing does not launch it. **⌘ + Space**, type `PyCharm`, press **Return**.

The first launch asks a few one-time questions before you see anything useful:

- **Privacy policy / user agreement** — tick to accept, **Continue**.
- **Data sharing** — either answer is fine; **Don't Send** is fine.
- It may offer a theme or keymap. The defaults are fine.

First start takes a minute. You end up on the **Welcome to PyCharm** screen.

## Step 2: Open your models folder as a project

Your models need somewhere to live. Make a folder for them:

```bash
mkdir -p ~/PsyNeuView-models
```

**Keep it outside the `~/PsyNeuView` folder**, which is the app itself. Models
stored inside the app's folder show up as stray untracked files in it, and get
tangled up when the app updates.

Now in PyCharm: on the Welcome screen click **Open** (or **File ▸ Open** if a
project is already open), select `PsyNeuView-models` in your home folder, and
click **Open**.

- If it asks whether you **trust** the project, choose **Trust Project**.
  Without it PyCharm runs in a restricted mode that disables the analysis you
  want here.

Open the *folder*, not an individual file. PyCharm treats a folder as a project,
which is what gives you the interpreter setting in Step 3, and it keeps the
companion files PsyNeuView writes visible in one place.

## Step 3: Point PyCharm at a Python with PsyNeuLink in it

> **Already a PsyNeuLink developer? Skip this step.** If PyCharm is already set
> up against your own PsyNeuLink, leave it exactly as it is — point PsyNeuView
> at your PsyNeuLink instead. See
> [Already a PsyNeuLink developer? Keep your setup](./existing-psyneulink-setup.md).
> The rest of this step is for a machine with no Python setup yet.

Without this, PyCharm underlines every `import psyneulink` in red. It doesn't
stop anything working — PsyNeuView runs the model, not PyCharm — but it makes
the editor useless for autocomplete.

> **Do Step 2 first.** The Python Interpreter setting lives *inside* a project.
> If you open Settings straight from the Welcome screen there is no such entry —
> the title bar says **Settings – WelcomeScreen** and searching for "project"
> turns up only Jupyter and Project Structure. Nothing is wrong; the option
> appears once a project is open.

Open **PyCharm ▸ Settings** (**⌘ ,**).

**1. Find the Interpreter page.** In the search box at the top left, type
`interpreter`. The list below it filters down, and **Interpreter** appears as
the second row, indented under **Python**:

```text
▾ Python
     Interpreter        ← click this
▾ Appearance & Behavior
     Notifications
   Keymap
```

Click it. The right-hand side should now read **Python › Interpreter** at the
top, with a **Python Interpreter:** dropdown saying `<No interpreter>`.

![The Interpreter page before setup: Interpreter selected in the list on the
left, and the Python Interpreter dropdown reading "No interpreter" with the Add
Interpreter link beside it](assets/pycharm-interpreter-page.png)

*PyCharm 2026.2. The two highlighted controls are the ones this step uses —
everything else on the page can be ignored.*

> **Two things that make this step look broken.**
>
> - **Typing in that search box hides most of the list.** It filters rather than
>   jumps, so settings you expect to see disappear. That is the search working,
>   not settings missing. Clear it with the **✕** to get the full list back.
> - **If there is no `Python` section at all**, no project is open — the window
>   title says *Settings – WelcomeScreen* instead of your project's name. Go
>   back to Step 2.

**2. Point it at PsyNeuView's Python.** Click **Add Interpreter** (top right,
beside the dropdown) **▸ Add Local Interpreter…**.

The dialog opens on **Environment: Generate new**. Click the radio button
**Select existing** — top row, to the right — **before anything else**. You are
pointing PyCharm at a Python that already exists, not building a new one.

The dialog re-draws when you switch: *Base Python* and *Location* are replaced
by **Type** and a field for the interpreter itself. **The two modes offer
different Types**, which is the trap — in *Generate new* the Type list is
environment builders (Virtualenv, Conda, Pipenv, Poetry, uv, Hatch) and there
is no **Python** entry at all. It appears only after you switch.

> **Two ways this goes wrong, both from staying on "Generate new":**
>
> - **No `Python` in the Type list.** You are seeing environment builders
>   instead. Switch mode; the list changes.
> - **"Already contains Python with version 3.13"** with **OK** greyed out
>   after pasting the path. That reads like the path is wrong. It is not —
>   PyCharm is refusing to *create* an environment on top of the one already
>   there, which is the one you want. Click **Select existing** (the radio at
>   the top, or the **"Select existing interpreter"** link inside the error).
>
> Watch the **Location** field too: left on *Generate new*, PyCharm defaults it
> to a new `.venv` inside your models folder. Accepting that builds a second,
> empty environment with no PsyNeuLink in it — and leaves a stray `.venv`
> beside your models.

With **Select existing** chosen, set **Type** to **Python**.

Now the **Python path** row. Its dropdown lists only the Pythons PyCharm found
by itself — Homebrew and system ones — and **PsyNeuView's is not among them**,
because it lives inside the PsyNeuView folder rather than anywhere PyCharm
thinks to look. Do not pick from that list. Instead click the **folder icon** at
the right of the row, and in the chooser paste the path printed by:

```bash
echo "$HOME/PsyNeuView/backend/.venv/bin/python"
```

That is the path if you followed the
[web app guide](./psyneuview-web-app-getting-started-macos.md), which clones
into your home folder — it is the `pwd` you were asked to write down in Step 4.
If you put PsyNeuView somewhere else, run this from inside that folder instead:

```bash
echo "$PWD/backend/.venv/bin/python"
```

If the chooser has no obvious place to type, press **⌘ ⇧ G** to open a
"go to path" box, paste, and press **Return**.

You are aiming for the file named exactly **`python`** inside
`PsyNeuView/backend/.venv/bin`. That folder also holds `python3`, `python3.13`,
`pip` and a long list of other tools — `python` is the one:

![The Select Python Interpreter chooser, its breadcrumb reading Users /
your-name / PsyNeuView / backend / .venv / bin / python, with the file named
"python" highlighted in the list](assets/pycharm-select-interpreter.png)

*PyCharm 2026.2. Check the breadcrumb along the top says `PsyNeuView` and
`.venv` — that is what distinguishes this from a system Python.*

Then **OK**.

Click **OK**, then **OK** again to close Settings.

**It worked if** the interpreter now reads a path inside `PsyNeuView` — not
`/opt/homebrew` or `/usr/bin` — and the package table has filled with real
packages instead of "Nothing to show":

![The Interpreter page after setup: the interpreter reads
~/PsyNeuView/backend/.venv 3.13.7, and the package table lists dozens of
installed packages](assets/pycharm-interpreter-set.png)

*PyCharm 2026.2. The populated table is the real confirmation — it means
PyCharm is reading the same environment PsyNeuView runs models in.*

An **empty table** means you picked a bare system Python. PyCharm accepts that
without complaint and it leaves every `import psyneulink` underlined red, so it
is worth checking now rather than wondering later.

> **Menu names move between versions.** This matches **PyCharm 2026.2**. Older
> builds put the same setting under `Project: <name> ▸ Python Interpreter`
> rather than `Python ▸ Interpreter`. If your list does not match, search
> `interpreter` and take whatever the top result is.

**Check it worked:** open one of your models. `import psyneulink as pnl` should
have no red underline, and typing `pnl.` should offer completions.

## Step 4: Decide when PyCharm saves

**This is the setting that shapes how the whole workflow feels**, because
PsyNeuView reacts to saves. Under
**Settings ▸ Appearance & Behavior ▸ System Settings**:

| Setting | Effect on the loop |
| --- | --- |
| **Save files when switching to another application** | Clicking over to PsyNeuView saves automatically, so the graph updates as you switch. Convenient, but it means you're saving work-in-progress code you may not consider finished. |
| **Save files if the IDE is idle for N seconds** | Saves on a timer whether or not you've switched. Same caveat, less predictable. |
| Neither | Nothing reaches PsyNeuView until you press **⌘S**. Most predictable. |

**The recommendation: turn both off and save with ⌘S.** A PsyNeuLink model is
broken for most of the time you're editing it — half a mechanism typed, an
import not yet added — and auto-saving pushes every one of those broken
intermediate states at PsyNeuView. Saving deliberately means the app only ever
sees code you meant to finish.

## Step 5: Hide the files you don't edit by hand

PsyNeuView keeps layout and labels in companion files beside your `.py`
(`model.pnlview.json`, `model.labels.yaml`, `model.psyneuview.json`). They're
managed for you — you never open them directly — so they're just noise in
PyCharm's project tree.

**Settings ▸ Editor ▸ File Types ▸ Ignored Files and Folders**, add:

```
*.pnlview.json;*.labels.yaml;*.psyneuview.json;*.py~;
```

`*.py~` is PyCharm's own backup file, which it creates briefly whenever it saves
and then deletes. Ignoring it stops it flickering in and out of the tree.

For git, see the `.gitignore` guidance in
[Using PsyNeuView alongside PyCharm](../external-editor-workflow.md#what-to-commit-to-version-control)
— which of these to commit is a real decision, not just tidiness.

## Step 6: Confirm the two are actually talking

Open the same model in both, then run
[the sync check](../tutorials/13-sync-check.md). Four short tests, about a
minute. Don't skip it — it's much better to find a broken setup now than
halfway through building a model.

---

## Two dialogs, and which is which

In a two-editor setup you'll eventually see a prompt from *each* tool. They look
similar and mean different things:

| Dialog | Who | What happened | What to do |
| --- | --- | --- | --- |
| **"File Cache Conflict"** | PyCharm | PsyNeuView wrote the file while PyCharm had unsaved changes | Pick whichever version you want. "Load File System Changes" takes PsyNeuView's. |
| **"model.py changed on disk"** | PsyNeuView | PyCharm saved while PsyNeuView had unsaved changes | **Load from disk** takes PyCharm's; **Keep my changes** keeps yours and leaves the file alone. |

Both exist for the same reason: two editors changed the same file and only you
know which version you meant. Neither is an error.

> **Heads up:** PyCharm's dialog takes over the keyboard until you answer it.
> If PyCharm suddenly stops responding to typing, look for it.

The way to see neither dialog is the habit from
[Two ways to work](../workflow-modes.md): **edit code in one window at a time.**

## If something goes wrong

| What you see | What to do |
| --- | --- |
| Installed PyCharm but nothing opened | Installing doesn't launch it — **⌘ + Space**, type `PyCharm`, Return. See **Step 1** |
| Two PyCharm icons — which one? | Open **PyCharm**. **PyCharm CE** is the discontinued build — see **Step 1** |
| Settings has no "Python Interpreter" | No project is open — the title bar says *Settings – WelcomeScreen*. Do **Step 2**, then reopen Settings |
| "Already contains Python with version 3.x", OK greyed out | You are on **Generate new**. Switch to **Select existing** — see **Step 3** |
| Type list has Virtualenv/Conda/Poetry but no **Python** | Same cause — those are the *Generate new* options. Switch to **Select existing** |
| The Python path dropdown does not list PsyNeuView's Python | Expected — it only auto-detects standard locations. Use the **folder icon** and browse to it |
| Interpreter set, but the package list stays empty | You picked a system Python from the dropdown rather than the one in `PsyNeuView/backend/.venv` |
| Set the interpreter but imports are still red | You may have set it in the *other* PyCharm. Settings are per application |
| PyCharm opened but there is no project | You skipped **Step 2** — make `~/PsyNeuView-models` and open that folder |
| Saving in PyCharm changes nothing in PsyNeuView | Reopen the model in PsyNeuView (*Open ▸ from path…*). A backend restart after you opened it is the usual cause. |
| `import psyneulink` underlined red | Step 3 — the interpreter isn't set |
| PyCharm won't accept typing | A dialog is waiting — see the table above |
| Companion files cluttering the tree | Step 5 |
| PsyNeuView keeps showing broken/incomplete models | Step 4 — auto-save is pushing work-in-progress |

## See also

- [PsyNeuView web app — getting started on macOS](./psyneuview-web-app-getting-started-macos.md)
- [Already a PsyNeuLink developer? Keep your setup](./existing-psyneulink-setup.md)
- [Two ways to work](../workflow-modes.md)
- [Using PsyNeuView alongside PyCharm](../external-editor-workflow.md)
- [The sync check](../tutorials/13-sync-check.md)
