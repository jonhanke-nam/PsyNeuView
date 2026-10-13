# Already a PsyNeuLink developer? Keep your setup

This page is for people who **already have PsyNeuLink and an IDE working** — a
PsyNeuLink checkout they develop against, PyCharm configured for it, the whole
thing. You want to add PsyNeuView as a view onto that work, without disturbing
any of it.

Short version: **change nothing in PyCharm.** Point PsyNeuView at your
PsyNeuLink instead.

> The [PyCharm setup guide](./pycharm-setup-macos.md) assumes a machine with
> nothing on it, and has you point PyCharm's interpreter at PsyNeuView's own
> environment. That is the right advice for a blank machine and the wrong advice
> for you. **Skip its Step 3.**

---

## Why you don't have to touch PyCharm

The two tools do not share an environment, and do not need to:

| | runs models | resolves your imports |
| --- | --- | --- |
| **PsyNeuView** | in its own backend environment | — |
| **PyCharm** | — | with whatever interpreter you have set |

PyCharm's interpreter drives **only PyCharm's own analysis** — completion,
import resolution, the red underlines. It has no bearing on how PsyNeuView
executes a model; that happens in PsyNeuView's backend, in a separate process.

So your existing interpreter, pointed at your own PsyNeuLink, stays exactly as
it is. It is the one you develop against, and it should keep resolving your
imports.

## Which PsyNeuLink is PsyNeuView using now?

Out of the box, **not yours, and not any git checkout** — a fresh `make install`
takes PsyNeuLink from **PyPI** and installs it into PsyNeuView's own virtual
environment:

```text
~/PsyNeuView/backend/.venv/lib/python3.13/site-packages/psyneulink
```

The **⚙ ▸ Environment** panel says so: `Source: pypi`, with repo, branch, commit
and path all blank. Blank is not missing information — it is what "an ordinary
package install, with no repository behind it" looks like. Those fields fill in
only once you switch to a GitHub or local source.

This matters because a released PyPI build and the checkout you develop in are
usually not the same code. Until you change it, PsyNeuView runs the released
one.

## What to change instead

Point **PsyNeuView** at the PsyNeuLink you already have.

1. In PsyNeuView, click the **⚙** button in the toolbar.
2. The **Environment** section shows which PsyNeuLink is currently active — repo,
   branch, commit, path, version.
3. Under **Change install**, choose the **editable local checkout** source and
   give it the path to your PsyNeuLink repo.
4. **Apply & restart.**

Full detail, including what the Environment panel is telling you, is in
[Configuring which PsyNeuLink source is used](../tutorials/08-configuring-psyneulink-source.md).

**What you should see afterwards.** The Environment panel reads your checkout's
repository, branch and commit — not the word "local":

```text
Source:  github
Repo:    PrincetonUniversity/PsyNeuLink
Branch:  jonhanke-dev
Commit:  3cd9f5a55b
Path:    /Users/you/.../PsyNeuLink
```

That is correct. PsyNeuView reads the git remote of the folder you gave it, so
it can tell you exactly which commit is live rather than just a directory. **The
`Path` line is the confirmation** that it is your working tree and not a clone
of the same repo.

The version will also change to something like `0.18.0.0+449.g3cd9f5a55b`, which
can look like a downgrade from a release number such as `0.19.1.0`. It is not —
it is `git describe` of your checkout, so it names the commit rather than a
release.

Both tools now read the same PsyNeuLink: PyCharm through your interpreter,
PsyNeuView through its backend. Your IDE never had to move.

## Two things this does to your machine

Worth knowing in advance rather than noticing later:

- **It writes into your checkout, but does not dirty it.** PsyNeuView installs
  your repo with `pip install -e`, which creates a `psyneulink.egg-info/`
  directory in the source tree. PsyNeuLink's own `.gitignore` already covers
  `*.egg-info/`, so `git status` is unchanged — verified on a real checkout.
  The install also uses `--no-deps`, so it does not touch your dependencies.
- **It changes PsyNeuView's environment, not yours.** "Apply & restart"
  reinstalls PsyNeuLink inside PsyNeuView's backend and restarts it. Your
  environment is untouched.
- **The source setting is per-machine, not per-install.** Choosing a GitHub
  source clones it to `~/.psyneuview/sources/PsyNeuLink-<owner>/` — a location
  keyed to your home directory, not to a particular PsyNeuView checkout. Two
  copies of PsyNeuView on one machine share that clone store, so switching
  source in one is visible to the other. Surprising if you keep a second
  checkout around and expect them to be independent.

## Has this been tested?

Yes, against a real PsyNeuLink checkout: the switch took about two seconds, a
reference model loaded correctly against the checkout's code afterwards, feature
detection stayed at full (the `_debugger` hook was still found), and the
checkout was left with no git changes.

Not yet confirmed: **running** a model against a local checkout. Loading is
verified; running was not exercised in that test.

## If the two ever disagree

They can drift apart — if PyCharm resolves against one PsyNeuLink and
PsyNeuView runs another, code can look correct in the IDE and fail in the app,
or the reverse. The symptom is confusing precisely because each tool is
individually right.

The Environment panel (**⚙**) always states which build PsyNeuView is running —
`pypi`, or a repo and commit. Compare it against your PyCharm interpreter when
something behaves in a way neither tool explains.

The likeliest version of this is also the easiest to miss: PsyNeuView still on
`Source: pypi` while PyCharm resolves against your checkout. Both tools look
correctly configured, because separately they are.

## See also

- [Configuring which PsyNeuLink source is used](../tutorials/08-configuring-psyneulink-source.md)
- [PyCharm setup on macOS](./pycharm-setup-macos.md) — the blank-machine path
- [Two ways to work](../workflow-modes.md)
- [The sync check](../tutorials/13-sync-check.md) — confirm edits flow both ways
