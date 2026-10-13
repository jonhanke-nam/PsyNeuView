# Where PsyNeuView keeps things

PsyNeuView uses a handful of folders: one for your models, any catalogs you
add, the PsyNeuLink it runs, and a hidden place for its own data. This page
says where each is, which ones are yours to edit, what changes when you
switch PsyNeuLink, and how to move your models folder. Settings shows the
same picture, with paths and a **Show in Finder** button for each:
**Settings ▸ Folders**
([#1295](https://github.com/jonhanke-nam/PsyNeuView/issues/1295)). What you
can *do* with a file from each place — edit it, lock it, where Save goes —
is on [What you can edit, and why](what-you-can-edit.md).

> The names **My Project Folder** and **catalogs** are placeholders while the
> naming decision is made ([settings etiquette](settings-etiquette.md)). The
> folder on disk is already named for good: see
> [How PsyNeuView names things it makes for you](#how-psyneuview-names-things-it-makes-for-you).

## For everyone

### My Project Folder

Where new models are saved, and the first section of the Open menu.

| | Folder |
|---|---|
| New installs on a Mac | `~/Documents/PsyNeuView-My-Models` — visible in Finder, backed up and synced like the rest of Documents |
| Earlier installs on a Mac | `~/.psyneuview/models`, a hidden folder (the leading dot hides it in Finder). Kept as it is; Settings ▸ Folders offers once to move it, see [Moving your folder](#moving-your-folder) |
| Linux, a container, the hosted service | `models/` inside the PsyNeuView checkout |
| Set by hand | Settings ▸ Folders ▸ My Project Folder ▸ **Change…** points PsyNeuView at any folder (nothing is moved) |

Beside each model `.py` go its layout and label files, or a hidden
`.psyneuview/` folder holding them ([file conventions](file-conventions.md)).
They are part of the folder and move with it.

### Your catalogs

Any other folder of models you add in **Settings ▸ Folders**. Each is its
own section of the Open menu, listing that folder's `.py` files. Renaming
and removing happen there too; removing a catalog takes it off the menu and
never touches the files. The section heading shows the folder.

**Settings ▸ Open menu** is only the menu's shape: the order of the
sections, and which of the catalogs still under development (PsyNeuLink
Examples, Reference Models, Demo Models) show. Those always sit below the
everyday sections — My Project Folder, the PsyNeuLink Library and your
catalogs — and can be reordered only among themselves.

### Which PsyNeuLink

PsyNeuView uses **one PsyNeuLink at a time**, and **Settings ▸ General ▸
PsyNeuLink version** is where most people choose it:

- **Latest development** (recommended, and the default for a new install):
  the newest features, from the `devel` branch of
  `PrincetonUniversity/PsyNeuLink`. The official release lags too far behind
  it today; if that changes, the recommendation will.
- **Official release**: a stable release from PyPI, picked from every
  release with its date, newest first. One that can't install on the Python
  this PsyNeuView runs (or was withdrawn by its authors) is greyed out with
  the reason. Releases before 0.19.1.0 — the first with the debugger hook —
  are marked *"no run stepping"*: models load and run, but run stepping,
  value pills and Run State need 0.19.1.0 or later, and Settings warns
  before you apply one.

**Kept releases.** Installing an official release keeps its file under
`~/.psyneuview/releases` and installs it from there with its dependencies
resolved normally. Switching back to a kept release reuses the kept
PsyNeuLink download; a release whose dependencies differ may still need the
network. Kept releases are listed in **Settings ▸ Developer ▸ Managed
PsyNeuLink copies and checkouts** with their size and can be removed there,
never the one in use. When PyPI can't be reached, Settings shows the last
list it saw, or the kept releases alone, and says so.

Switching reinstalls PsyNeuLink and restarts the model runner; Settings says
what will change first (the Open menu's Library, Examples and Tests) and
what won't (My Project Folder and your catalogs). Another repo, branch or a
checkout of your own is a developer matter, set in **Settings ▸ Developer ▸
Which PsyNeuLink is installed** — the same setting, in full. While one of
those is in use, General says *"Custom (set in Developer)"*. The managed
copies PsyNeuView keeps and your checkouts are developer matters too, below.

**Which PsyNeuLink is installed** (Developer,
[#1331](https://github.com/jonhanke-nam/PsyNeuView/issues/1331),
[#1334](https://github.com/jonhanke-nam/PsyNeuView/issues/1334)) is a
status line — *"✓ In use now: Your PsyNeuLink checkout · … "* — and one
**Switch to** dropdown of everything it can be switched to. **Another local
checkout…** and **Another GitHub repo or branch…** come first, always in
view; below them, groups that fold, each with its count: **Your checkouts**,
one group per GitHub repo (the heading names the repo, each row a branch
alone), and the **Official releases on PyPI** with their dates, the newest
in the heading, the newest five shown and the rest behind *Show older (n)*
(one that can't install here is greyed, with the reason). Only the group
holding the PsyNeuLink in use starts open, with that row marked ✓; folded,
the group's heading says *✓ in use*. The arrow keys move over headings and
rows, Right and Left unfold and fold, Enter picks. Names are shown in full,
a long branch wrapping, with the full *repo @ branch* as the tooltip. A
known source needs no fields: its full name and what the switch changes
appear under the dropdown.
*Another local checkout…* shows a **Path** field with **Choose…**, a Finder
folder picker inside the Mac app (in a browser, type the path). The folder
is checked as soon as typing pauses, and the line under the field says what
it is (#1342): a PsyNeuLink checkout (a `psyneulink` folder beside a
`pyproject.toml` or `setup.py`); an empty or missing folder, with **Download
PsyNeuLink here** and a **Download from** choice (*Latest development*,
Princeton `devel`, first, then the other GitHub sources Settings knows),
after which Apply & restart downloads PsyNeuLink into that folder, installs
it so edits there take effect and switches to it; or a folder of other
files, refused in plain words with no button. A failed download leaves the
folder as it was. *Another GitHub repo or branch…* shows Repo and
Branch with the usual suggestions. **Apply & restart** appears only for a
valid choice that differs from what is in use; an empty path, a repo that
isn't `owner/name`, or a blank branch shows a line saying what is missing
instead. **Manage known sources** (folded) holds Rename and Remove for each
source, never Remove for the one in use; removing only takes it off the
list. The source in use is put on the list the first time Settings sees it,
so a checkout installed by the Mac app's setup or a terminal stays known
after you switch away. A placeholder like `owner/repo` is never recorded,
and one already in `~/.psynewview.json` is dropped when read
([#1292](https://github.com/jonhanke-nam/PsyNeuView/issues/1292)).

**Automatic updates** ([#1304](https://github.com/jonhanke-nam/PsyNeuView/issues/1304)).
Under the version choice, one line says how current the installed
PsyNeuLink is and when that was checked: *"PsyNeuLink 0.20.2+260 (devel,
commit 7a86e22) · 3 commits behind · last checked 10:42"*, *"✓ Up to date ·
… · last checked 10:42"*, or for an official release *"0.20.2.0 · a newer
release, 0.21.0.0, is available"* / *"✓ Newest release"*. **Check now** asks
again. **Keep Latest development up to date automatically** is on by
default: PsyNeuView checks when it starts and every 4 hours; a managed
GitHub install that is behind is marked ready and installed **the next time
PsyNeuView starts**, never mid-session (updating restarts the model runner),
and until then a note says *"An update is ready; it installs next time
PsyNeuView starts"*. If that update fails, the version in use stays and the
failure is shown and logged. An official release is only reported, never
switched. A checkout of your own is never updated this way; it has its own
options in Developer ([Checkouts](#checkouts)). Everything recorded — the
last check, its result, a ready update, the last automatic update's outcome
— is in `GET /api/settings/pnl-updates`, and in short under `updates` in
`/api/settings/info`, so Report a Problem can include it.

**Whose files you can edit.** PsyNeuLink's own files — the Library models,
the Examples — open in place, so the file in the editor is a file of the
PsyNeuLink in use ([#1225](https://github.com/jonhanke-nam/PsyNeuView/issues/1225),
[#1305](https://github.com/jonhanke-nam/PsyNeuView/issues/1305)):

- A PsyNeuLink that **PsyNeuView manages** — *Latest development* and the
  other GitHub copies, an *Official release* from PyPI, a kept release — is
  **not editable**. PsyNeuView keeps it identical to its source. The editor
  is read only and says why at the top of the file, with a link to Settings ▸
  Developer.
- **Your own checkout is editable**, as soon as you choose it: type, Save,
  and the change is in your repo, where PyCharm or git see it too. To keep a
  stray edit out of a checkout, click the toolbar tag (*your PsyNeuLink
  checkout · editing*) and choose to protect it; click again to allow edits.
  That is remembered per checkout.

The whole picture — these two cases, the models included with PsyNeuView,
and the per-model lock — is on
[What you can edit, and why](what-you-can-edit.md).

### The PsyNeuLink in use, and what depends on it

PsyNeuView runs one PsyNeuLink at a time. It comes from one of three places;
**Settings ▸ About** says which in one line, **Settings ▸ Folders** says so
on the Library and Examples rows ("from the PsyNeuLink you've selected"),
and **Settings ▸ Developer** shows where it is installed and, under
PsyNeuLink details, the repo, branch, commit and freshness:

| Source | Where it lives | Yours to edit? |
|---|---|---|
| GitHub (`owner/repo @ branch`) | a managed copy under `~/.psyneuview/sources` | No — PsyNeuView keeps it identical to the branch |
| PyPI (a release) | inside PsyNeuView's Python environment | No |
| A local checkout | the folder you chose | Yes, unless you protect it from the toolbar tag |

Three sections of the Open menu list models **from the installed
PsyNeuLink**: **PsyNeuLink Library**, **PsyNeuLink Examples** and the
**Developer / Tests** entry. Their headings say where they come from
("from PrincetonUniversity/PsyNeuLink @ devel"). Switching PsyNeuLink in
**Settings ▸ Developer** changes what those three list, and nothing else:
My Project Folder and your catalogs stay the same. Settings says so before
you apply a switch, and the Open menu says once afterwards what the three
sections now list.

**Reference Models** and **Demo Models** are included with PsyNeuView and
don't change with PsyNeuLink. They open as working copies in PsyNeuView's
working folder, so the bundled originals are never edited
([What you can edit, and why](what-you-can-edit.md#models-included-with-psyneuview)).

### Working copies of included models

Opening a **Reference Model** or a **Demo** (both included with PsyNeuView),
or a **PsyNeuLink Example** from a managed PsyNeuLink, doesn't open the
included file itself. PsyNeuView copies it to a **working copy** and opens
that: the copy is what you edit and save, and the included original is never
changed. All working copies go in one folder, outside every install
([#1319](https://github.com/jonhanke-nam/PsyNeuView/issues/1319)):

| | Folder |
|---|---|
| Default | `~/.psyneuview/working-copies`, hidden, one per user, created on first use |
| Set by hand | `PSYNEWVIEW_WORKING_DIR` (developer setups and the test suite) |

**Settings ▸ Folders** shows it as **Working copies of included models**,
with Show in Finder. What it means for your edits:

- A Reference Model or PsyNeuLink Example keeps your edits. Reopening it from
  the Open menu loads your working copy and says so ("Loaded your edited copy
  … your changes were kept"), with the choice to restore the included
  version. Restoring is something you ask for; it never happens on its own.
- A Demo starts fresh every time it is opened.
- Layout and label files belong to the working copy and sit in the same
  folder (beside it, or in its hidden `.psyneuview/` folder).
- Because the folder is outside the app, an app update doesn't lose them.

A fuller page on which files are yours to edit is in progress
([#1309](https://github.com/jonhanke-nam/PsyNeuView/issues/1309)).

**Before #1319** the working copies went in the running PsyNeuView's own
`backend/` folder. In the Mac app that folder is replaced when the app moves
to a new included version, so an edited Reference Model reopened as the
original after an update. Now, each time the backend starts, it looks for
working copies left in that folder — and, when PsyNeuView runs from a Mac
app install, in the `backend/` of the other `psyneuview-<version>` installs
beside it — and moves them to the working-copies folder, under the same
rules as [Moving your folder](#moving-your-folder):

- only files with the names of included models and their layout, label and
  index files are touched, never anything else, never a file git tracks;
- copy, check byte for byte, and only then remove the original; if anything
  fails, the original stays where it was and the failure is recorded;
- a file already in the working-copies folder is never overwritten. If the
  two are identical the old one is simply removed; if they differ, the one in
  the working-copies folder is kept, the old one is left where it was, and
  the difference is recorded;
- the outcome goes in the preferences file (`working_copies_last_migration`)
  so Report a Problem can include it;
- nothing happens while `PSYNEWVIEW_WORKING_DIR` is set, or in a container or
  the hosted service.

### Layouts for read-only PsyNeuLink files

A **PsyNeuLink Library** model opens in place, and when the PsyNeuLink in use
is one PsyNeuView manages — *Latest development* or another GitHub copy, an
*Official release*, a kept release — its file is read only
([What you can edit, and why](what-you-can-edit.md#a-psyneulink-that-psyneuview-manages-read-only)).
Moving its nodes, or giving them labels, is still recorded: those are
PsyNeuView's files, not PsyNeuLink's. They go in one per-user folder, outside
every install ([#1321](https://github.com/jonhanke-nam/PsyNeuView/issues/1321)):

| | Folder |
|---|---|
| Default | `~/.psyneuview/layouts/<source>/<path>`, hidden, one per user, created on first use |
| Set by hand | `PSYNEUVIEW_LAYOUTS_DIR` (developer setups and the test suite) |

`<source>` says where the PsyNeuLink came from, not which version it is:
`PsyNeuLink-PrincetonUniversity` for that GitHub repo (whether PsyNeuView
cloned it or installed it straight from GitHub), `PsyNeuLink-jonhanke-nam`
for a fork, `PsyNeuLink-PyPI` for every official release. `<path>` is the
file's path inside PsyNeuLink (`psyneulink/library/models/Cohen_Huston1994.pnlview.json`).
So:

- switching release, or letting an automatic update reinstall *Latest
  development*, keeps the layout: the file is found by source and path, and
  the install that was replaced never held it;
- the install itself is never written to — nothing lands in `site-packages`
  or in a managed copy's working tree;
- **Settings ▸ Folders** shows the folder as **Layouts for read-only
  PsyNeuLink files**, with Show in Finder.

Your own checkout is different: its files are yours to edit, and their layout
and label files go beside them like any file of yours.

**Before #1321** only the managed GitHub copies had their layouts kept out of
the tree (under `~/.psyneuview/sources/.state/artifacts`); for a `git+`
install or an official release they were written into a hidden `.psyneuview/`
folder inside `site-packages`, and lost on every reinstall. Now, each time
the backend starts, it looks in both old places and moves what it finds to
the layouts folder, under the same rules as
[Moving your folder](#moving-your-folder):

- inside the install, only files PsyNeuView added are touched — anything the
  install's own `RECORD` lists stays, and so does anything that isn't a
  layout, label, index or backup file;
- copy, check byte for byte, and only then remove the original; if anything
  fails, the original stays where it was and the failure is recorded;
- a file already in the layouts folder is never overwritten: identical, the
  old one is simply removed; different, the one in the layouts folder is
  kept, the old one is left where it was, and the difference is recorded;
- the outcome goes in the preferences file (`layouts_last_migration`) so
  Report a Problem can include it;
- nothing happens while `PSYNEUVIEW_LAYOUTS_DIR` is set, or in a container or
  the hosted service.

### Moving your folder

**Settings ▸ Folders ▸ My Project Folder ▸ Move…** moves the folder and
everything in it. In the Mac app you pick the destination in a folder
picker; in a browser you type it (the folder is on the machine running
PsyNeuView, which may not be the one you're looking at).

What a move promises:

- the models and their layout and label files move together, including the
  hidden `.psyneuview/` folders;
- nothing is deleted until the copy is complete and checked file by file.
  If anything fails partway, the old folder is left as it was and the
  setting is unchanged;
- a destination that already has files is merged into, as long as no names
  clash. If any do, the move is refused and the clashing names are listed;
- the Open menu, recent files and any catalog inside the folder follow;
- moving back is just another move;
- the outcome is recorded, so Report a Problem can include it.

The one-time offer in Settings ▸ Folders (for a folder still at
`~/.psyneuview/models`) uses the same move. "Not now" is remembered.

When the folder is fixed by the `PSYNEWVIEW_MODELS_DIR` environment variable
(developer setups and the test suite), it can't be changed or moved from
Settings, and no offer is made.

### Show in Finder

Inside the Mac app, every location in Settings ▸ Folders has a **Show in Finder**
button. In a browser it is **Copy path** instead. An app from before this
feature (0.5.15 and earlier) can't open Finder from the page: the path is
copied and a note asks you to update the app.

## For developers

### Checkouts

A checkout is a git clone you own. **Settings ▸ Developer ▸ Where PsyNeuView
and PsyNeuLink are installed** shows the two in use, with their paths and
whether they are yours to edit. PsyNeuView can run from one (the Mac
app's **Settings ▸ Developer ▸ Which PsyNeuView runs**), and can install
PsyNeuLink from one (**Settings ▸ Developer ▸ Which PsyNeuLink is
installed ▸ Local checkout**). Both are yours to edit. A PsyNeuLink checkout
is editable from PsyNeuView's editor as soon as it is chosen, unless you
protect it from the toolbar badge (above, *Whose files you can edit*).
The checkouts PsyNeuView has switched to are listed under **Settings ▸
Developer ▸ Managed PsyNeuLink copies and checkouts**.

**Keeping a checkout current** ([#1304](https://github.com/jonhanke-nam/PsyNeuView/issues/1304)).
**Settings ▸ Developer ▸ Keep your checkouts current** lists each checkout
of yours — the PsyNeuLink checkouts Settings knows and the PsyNeuView
checkout the backend runs from — with two switches, both off by default,
each naming the remote branch it uses (`origin/devel`):

- **Check for upstream changes**: fetches on the same schedule as the
  PsyNeuLink check and says behind or up to date, and when that was checked.
- **Pull on launch**: when the backend starts, a **fast-forward only** pull
  of the branch the checkout is on. With uncommitted changes nothing is
  pulled and the reason is shown (*"3 files changed locally; not pulled"*);
  the same for local commits the remote doesn't have. A branch is never
  switched. A PsyNeuLink checkout in use that moved restarts the model
  runner. (A pull doesn't reinstall: if the checkout's `pyproject.toml`
  changed, switch to it again in Which PsyNeuLink is installed.)

Each switch and the last check and pull are kept per checkout in
`~/.psynewview.json` (`checkout_updates`, `checkout_update_state`).

### Managed copies

A GitHub source is cloned once into `~/.psyneuview/sources/<Repo>-<owner>`
(for example `PsyNeuLink-PrincetonUniversity`) and installed from there in
editable mode; switching branches is a fetch and a checkout
([clone_manager.py](https://github.com/jonhanke-nam/PsyNeuView/blob/devel/backend/app/services/clone_manager.py)).
Old copies pile up. Settings ▸ Developer lists each with its size on disk
(walked with a time cap, so a very large one reads "at least …") and when it
was last used, and offers **Remove** for any copy not in use. Removing
deletes that one folder and its state file, nothing else; switching to that
source again clones it afresh. The copy in use can't be removed.

### The `~/.psyneuview` layout

```
~/.psyneuview/
    models/                   the legacy project folder (Mac app installs before #1295)
    releases/
        psyneulink-0.20.2.0-py3-none-any.whl   a kept official release
        pypi-psyneulink.json              the last PyPI listing seen, for offline use
    sources/
        PsyNeuLink-PrincetonUniversity/   a managed copy
        PsyNeuLink-jonhanke-nam/          another
        .state/
            <copy>.json       which pyproject.toml the venv was last installed against
    layouts/                  layout, label and index files for models inside a read-only
        PsyNeuLink-PrincetonUniversity/   PsyNeuLink (a managed copy, a git+ install, a
        PsyNeuLink-PyPI/                  release), keyed by source so a reinstall keeps
                              them (#1321; before that, sources/.state/artifacts for
                              copies only, and site-packages itself otherwise)
    working-copies/           working copies of included models (Reference Models, Demos,
                              PsyNeuLink Examples from a managed PsyNeuLink), with their
                              layout, label and index files (#1319)
~/.psynewview.json            the preferences file (the misspelling is historical and load-bearing)
```

`~/.psynewview.json` holds `model_dirs` (My Project Folder first), `catalogs`,
`pnl_sources` (the remembered sources), `source_history` and `file_history`
(typeahead history), `sidecar_placement_default`,
`psyneulink_checkouts_protected` (the checkouts you protected from edits;
the older `psyneulink_checkout_edits_allowed` is still read, so a checkout
allowed under it stays editable), and from #1295
`project_folder_last_move` (the last move's outcome) and
`project_folder_move_offer_dismissed`, from #1304 `pnl_auto_update`,
`pnl_update_state` (the last check, a ready update, the last automatic
install), `checkout_updates` and `checkout_update_state` (per checkout), and from #1319
`working_copies_last_migration` (the last move of working copies out of an
install's `backend/`: when, from where, how many, any conflicts or failures),
and from #1321 `layouts_last_migration` (the same, for the last move of
layouts out of `site-packages` and the old artifacts tree).
Writes are atomic.

### Environment variables

| Variable | Effect |
|---|---|
| `PSYNEWVIEW_MODELS_DIR` | Colon-separated model folders; the first is My Project Folder. Wins over the preferences file; Settings can't change or move the folder while it is set. The Mac app sets it today. |
| `PSYNEUVIEW_CONFIG_FILE` | Another preferences file instead of `~/.psynewview.json` (the e2e harness uses a temp one). |
| `PSYNEUVIEW_CLONE_ROOT` | Another folder for managed copies instead of `~/.psyneuview/sources`. |
| `PSYNEUVIEW_RELEASES_DIR` | Another folder for kept official releases (and the PyPI listing copy) instead of `~/.psyneuview/releases`. |
| `PSYNEUVIEW_DEPLOYMENT_MODE` | `local`, `mac_app`, `container` or `hosted` ([deployment modes](deployment-modes.md)). The visible default folder applies to `local` and `mac_app` on macOS only. |
| `PSYNEUVIEW_PNL_UPDATE_CHECKS` | `0` keeps the scheduled PsyNeuLink update checks, the start-time install and the launch pulls off in this process (#1304). They are also off in test mode and wherever installing isn't possible. |
| `PSYNEWVIEW_WORKING_DIR` | Another folder for the working copies of included models instead of `~/.psyneuview/working-copies` (the e2e harness uses a temp one). While it is set, no working copies are moved out of old installs. |
| `PSYNEUVIEW_LAYOUTS_DIR` | Another folder for the layouts and labels of read-only PsyNeuLink files instead of `~/.psyneuview/layouts` (the e2e harness and the backend tests use a temp one). While it is set, nothing is moved there from the old places (#1321). |
| `PSYNEWVIEW_TEST_MODE` | The test-only endpoints ([testing](testing.md)). |

Note the two spellings: `PSYNEWVIEW_` is historical and kept; newer
variables use `PSYNEUVIEW_`.

### The API

- `GET /api/locations` — everything above as data: the PsyNeuView and
  PsyNeuLink in use, the project folder, catalogs, app-data folders
  (`appData.workingCopies` is the working-copies folder, with
  `workingCopiesFixedBy` when the environment sets it and
  `workingCopiesLastMigration`, the last move into it; `appData.layouts` is
  the layouts folder for read-only PsyNeuLink files, with `layoutsFixedBy`
  and `layoutsLastMigration` likewise, #1321), managed copies (with
  `size_bytes`, `size_complete`, `last_used`, `in_use`) and known checkouts.
- `DELETE /api/locations/managed-copies/{name}` — remove one managed copy;
  refused for the one in use and for anything outside the sources folder.
  Gated like install (local deployments, loopback only).
- `GET /api/catalogs` — the project folder with `moveOffer` and `lastMove`.
- `GET /api/settings/pnl-releases` — every official release, newest first,
  with date, `compatible`/`reason`, `limited`/`limited_reason`, `kept`; plus
  `offline`, `in_use` and `releases_dir`. `POST /api/settings/install` with
  `{source: "pypi", version}` installs that release from its kept file
  (downloading it first if needed) with dependencies resolved normally;
  without `version`, the newest.
  `DELETE /api/settings/pnl-releases/{version}` removes a kept file, never
  the release in use.
- `GET /api/settings/pnl-updates` — how current PsyNeuLink is and when that
  was checked, the automatic-update switch, whether an update is ready for
  the next start, the last automatic update's outcome, and each checkout
  with its switches and last check and pull (#1304); no network.
  `POST …/check` checks now; `POST …/auto-update` `{enabled}` is the switch.
  `POST /api/settings/checkout-updates/prefs` `{path, check?,
  pull_on_launch?}`, `…/check` `{path}` and `…/pull` `{path}` act on one
  known checkout. The switches and the pull are gated like install.
- `POST /api/catalogs/project-folder/move` — the move; 400 with the reason,
  including the clashing names.
- `POST /api/catalogs/project-folder/move-offer/dismiss` — "Not now".
- Test mode only: `POST /api/test/models-dir` clears or sets
  `PSYNEWVIEW_MODELS_DIR` in the running backend, so a spec can move the
  folder and put the variable back.

## How PsyNeuView names things it makes for you

Folders and files PsyNeuView creates for people use **hyphens between
words, with PsyNeuView first**: `PsyNeuView-My-Models`. No spaces, no
underscores, so a path reads the same in Finder, a terminal and a URL. One
exception by design: the problem-report folder
`PNV-debugging-YYYY-MM-DD_HH-MM-SS` keeps its single underscore between the
date and the time. Folders people don't see — `~/.psyneuview`, the managed
copies — keep their existing names.
