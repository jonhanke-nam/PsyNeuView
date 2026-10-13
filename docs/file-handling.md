# PsyNeuView File Handling — the canonical model

This is the **single source of truth** for how PsyNeuView thinks about files: the
formats it supports, the verbs a user can perform on them, and where files live
on disk. It is the keystone reference for the file-system umbrella
([#341](https://github.com/jonhanke-nam/PsyNeuView/issues/341)); every other
sub-issue in that umbrella implements one section of this document.

It defines the **target model**. Where today's behavior differs, the gap is
called out inline with a *Current* note and a pointer to the sub-issue that
closes it. The companion document
[`file-conventions.md`](./file-conventions.md) covers the lower-level
file-*classification* algorithm (extension + content sniffing); this document
sits above it and describes the user-facing model.

## First principle: the `.py` is the source of truth

A PsyNeuLink model **is** its Python source. The GUI reads from and writes back
to that `.py` file; everything else (graph layout, bundles, MDF) is derived from
or wrapped around it. No file-handling change may break this principle — it is an
explicit non-goal of the umbrella to move the source of truth elsewhere.

## The four verbs

There are exactly four user-facing file actions. Each means one thing.

| Verb | Meaning | Targets the… | Result |
| --- | --- | --- | --- |
| **Open** | Bring a model into the workspace | a chosen source | model loaded, becomes "current" |
| **Save** | Write the current model back to **its own** file, in place | the loaded file's own path | dirty → clean |
| **Save As** (Save a copy) | Write the current model to a **new** location and/or format you choose | a path/format you pick | a new file; may become current |
| *(Import / Export)* | **Not** separate verbs — they are **format adapters** of Open and Save As | — | — |

The key clarification users need today: **Save** and **Save As** are different.
Save updates the file you already have open, at its real location. Save As makes
a copy somewhere you choose. Import is just "Open, where the source is a foreign
format." Export is just "Save a copy, in a foreign format."

### Open

Open accepts any supported input and resolves it to a working `.py` model:

- a local `.py` source (native picker — *Current:* a raw text-path prompt; see
  [#347](https://github.com/jonhanke-nam/PsyNeuView/issues/347))
- a `.pnlproject` bundle — opened **in place**: extracted to a working dir,
  with Save re-zipping back into the origin bundle
  ([#348](https://github.com/jonhanke-nam/PsyNeuView/issues/348)). (A *dropped*
  bundle with no on-disk path is still imported into the models dir instead.)
- an MDF file (*Import MDF*)
- a catalog entry (Demo, Reference, PsyNeuLink Library, My Project Folder, your own catalogs)
- a file from a GitHub repo
  ([#258](https://github.com/jonhanke-nam/PsyNeuView/issues/258))
- a recent / bookmarked source

The Open menu groups these into three labelled zones
([#350](https://github.com/jonhanke-nam/PsyNeuView/issues/350)):

- **Actions** — New, Open from path…, Import MDF…, From GitHub repo…
  (in the Mac app, the file choosers are the native macOS panels; in a browser
  they are PsyNeuView's own, since a web page cannot see real filesystem paths)
- **Catalogs** — Reference Models, Demo Models, PsyNeuLink Library, My Project Folder, and any catalogs you add
- **History** — Recent (Bookmarks land here once
  [#253](https://github.com/jonhanke-nam/PsyNeuView/issues/253) ships its
  persistent-sources model)

### Save

Save writes the current source back to **the loaded file's own path**, then
re-introspects. It never silently retargets to the default models directory.

*Current:* Save (Cmd+S) lives inside the Code editor pane and calls
`/api/model/save-source`, which does write in place — but there is no Save button
in the toolbar, and no dirty indicator, so it is unclear whether a save did
anything. Fixed by
[#343](https://github.com/jonhanke-nam/PsyNeuView/issues/343) (toolbar File
cluster) and [#345](https://github.com/jonhanke-nam/PsyNeuView/issues/345)
(dirty state).

### Save As / Save a copy

Save As writes a **new** file to a location and format the user chooses:

- choose **directory + filename** (native picker / dir chooser)
- choose **format**: `.py` · `.pnlproject` bundle · MDF (`.mdf.yaml` preferred,
  `.mdf.json` offered)
- on an existing target, show an **explicit overwrite confirmation** — never a
  silent failure
- a `.py` copy carries the model's layout, labels and index with it, renamed to
  the copy's stem and placed by the [sidecar rules](#sidecar-backup-placement);
  the lock in a layout is left behind, so a copy starts unlocked
  ([#1244](https://github.com/jonhanke-nam/PsyNeuView/issues/1244)). A
  `.pnlproject` bundle carries them inside; MDF has none. A layout or labels
  file already at the destination gets the same overwrite confirmation as the
  `.py`.

*Current:* Save As (`/api/models/save-as`) can only write to the default models
directory and returns HTTP 409 on a name collision — there is no way to overwrite
or pick a directory (this is
[#301](https://github.com/jonhanke-nam/PsyNeuView/issues/301)). The standalone
**Export…** button is a second, parallel "save a copy" path that should fold into
this one ([#351](https://github.com/jonhanke-nam/PsyNeuView/issues/351)). Both
fixed by [#346](https://github.com/jonhanke-nam/PsyNeuView/issues/346).

## Formats matrix

| Format | Extension | Role | Written by | Read by | User-facing | Round-trip |
| --- | --- | --- | --- | --- | --- | --- |
| PsyNeuLink Python source | `.py` | **Source of truth** | Save, Save As | Open, introspector | Yes | n/a (it *is* the model) |
| Project bundle | `.pnlproject` | Self-contained archive (zip: manifest + `model.py` + `layout.json` + MDF mirror [+ reserved weights, runData]) | Save As / Export, Save (in place) | Open (in place) / Import | Yes | **Yes** ([#348](https://github.com/jonhanke-nam/PsyNeuView/issues/348)): open in place, edit, Save re-zips into the origin bundle |
| MDF (interchange) | `.mdf.yaml` / `.mdf.json` | Cross-tool interchange (ModECI MDF) | Save As / Export | Open / Import | Yes | Via the MDF round-trip harness ([#88](https://github.com/jonhanke-nam/PsyNeuView/issues/88)) |
| Layout sidecar | `.pnlview.json` | Graph positions, viewport, demo-origin pointer | auto (on node move) | Open | **No** (internal) | follows its `.py` |
| Convert backup | `.original.py` | Pre-conversion backup | convert-to-standardized | manual recovery | **No** (internal) | n/a |
| Star-import backup | `.star_import_original.py` | Pre-`*`-rewrite backup | star-import auto-convert | undo-star-convert | **No** (internal) | n/a |

YAML is the preferred default for human-readable MDF export; JSON is offered for
tools that require it. Bare `.json` / `.yaml` are accepted on Open only if their
content sniffs as valid MDF (see [`file-conventions.md`](./file-conventions.md)).

## Bundle spec (`.pnlproject`)

A `.pnlproject` is a zip with a `manifest.json` inventory plus the files it
references. **Format version `2.0`** (readers still accept `1.0`; missing
optional fields are tolerated):

```jsonc
// manifest.json
{
  "formatVersion": "2.0",
  "psyneulink": "<version the bundle was written with>",
  "model": { "name": "<model>", "description": "" },
  "created": "<ISO-8601 UTC>",
  "modified": "<ISO-8601 UTC>",
  "files": {
    "source":  "model.py",            // required
    "layout":  "layout.json" | null,  // the .pnlview.json contents
    "mdf":     "<model>.mdf.yaml" | null, // MDF (YAML) mirror, when serializable
    "weights": [],                    // reserved (not yet populated)
    "runData": null                   // reserved (not yet populated)
  }
}
```

The MDF mirror is **best-effort**: a model that can't serialize (e.g. it uses
`GraphStructureCondition`s — see
[PsyNeuLink#7](https://github.com/jonhanke-nam/PsyNeuLink/issues/7)) is still
bundled, just without `files.mdf`, and Save surfaces a soft warning.

### Round-trip (open in place ↔ save back)

`POST /api/model/open-project` extracts a bundle that lives on disk into a
deterministic working directory under `~/.psyneuview/bundles/<name>-<hash>/`
(the hash is over the bundle's absolute path, so reopening reuses the dir) and
returns that working `.py` plus the origin bundle path. The app then treats the
working file like any `.py`. Save detects the recorded origin and re-zips the
working source + its layout sidecar + a refreshed MDF mirror back into the
**same** `.pnlproject`, written atomically. The toolbar chip shows the bundle
name (not the hashed working path) with a `BUNDLE` tag.

## File roles

Every file PsyNeuView touches is exactly one of:

- **source** — the `.py`. Editable, the source of truth.
- **bundle** — a `.pnlproject`. Self-contained; wraps a source plus its
  derived/companion data for sharing or archival.
- **interchange** — MDF. A lossy-where-necessary bridge to other tools.
- **sidecar** — `.pnlview.json` and similar. Machine-managed, never shown as a
  file the user opens or saves directly; it follows its source.
- **backup** — `.original.py` and similar. Safety copies; not user-facing.

Only **source**, **bundle**, and **interchange** appear in Open / Save As.
**Sidecar** and **backup** are implementation details.

## Where files live

Three locations, with one rule each:

1. **The loaded file's own location** — wherever the user opened it from.
   **Save targets this, always.**
2. **The default models directory** — PsyNeuView's managed workspace (served by
   `/api/models`). New models and Save-As copies land here **only when the user
   doesn't choose otherwise**.
3. **Managed / read-only clones** — PsyNeuLink library models, reference models,
   GitHub-fetched sources, branch-managed checkouts. These are **not** written in
   place. Editing one is really "Open a working copy, then Save that."

   The working copies of the models included with PsyNeuView (Reference
   Models, Demos) and of PsyNeuLink Examples from a managed PsyNeuLink all go
   in one folder outside every install, `~/.psyneuview/working-copies` (or
   `PSYNEWVIEW_WORKING_DIR`), so an app update doesn't lose them; copies left
   in an install's `backend/` by older versions are moved there on startup
   ([where things live](where-things-live.md#working-copies-of-included-models),
   [#1319](https://github.com/jonhanke-nam/PsyNeuView/issues/1319)).

   PsyNeuLink's own files (the library models, opened in place) follow the
   active PsyNeuLink install ([#1225](https://github.com/jonhanke-nam/PsyNeuView/issues/1225)):
   from **GitHub** or **PyPI** they are never written, and the backend refuses
   the write; from **your own local checkout** they're editable by default, and
   edits go straight into your repo ([#1305](https://github.com/jonhanke-nam/PsyNeuView/issues/1305)).
   The toolbar badge can protect a checkout from edits, per checkout, and allow
   them again. The editor is read only while a file is protected, and says why
   at the top of the file. The user-facing rules for every kind of file,
   including the per-model lock, are on
   [What you can edit, and why](what-you-can-edit.md).
   PsyNeuLink examples (`Scripts/Examples`) open in place too when the source
   is your local checkout, under the same protection; from GitHub or PyPI they
   still open as a working copy.

### Sidecar & backup placement

Sidecars and backups must **never pollute a managed or read-only source clone** —
untracked companion files there break branch switching (this is
[#316](https://github.com/jonhanke-nam/PsyNeuView/issues/316)).

The rule ([#349](https://github.com/jonhanke-nam/PsyNeuView/issues/349),
generalised to every read-only PsyNeuLink in
[#1321](https://github.com/jonhanke-nam/PsyNeuView/issues/1321)), enforced by
`managed_layouts.redirect_path()` (`clone_manager.artifact_path()` delegates
to it):

- **Source outside every managed PsyNeuLink** (the common case — a user file
  anywhere on disk, or a file of the user's own editable checkout): the
  sidecar/backup is written **next to its `.py`**, as before.
- **Source inside a read-only PsyNeuLink** — a managed clone
  (`~/.psyneuview/sources/<repo>-<owner>/…`), or a `git+` / PyPI install in
  the Python environment's `site-packages` — the companion is redirected to
  `~/.psyneuview/layouts/<source key>/<path relative to the source>`. The
  key names the source, not the version (`PsyNeuLink-PrincetonUniversity`
  for a GitHub repo, cloned or `git+`-installed; `PsyNeuLink-PyPI` for every
  official release), and the relative path mirrors the package's own layout
  (`psyneulink/library/models/…`), so files for different sources and models
  don't collide and a reinstall doesn't lose them. The clone's git working
  tree stays clean, and nothing is written into `site-packages`.

All companion writers route through `artifact_path()` / `redirect_path()`: the
layout, labels and index sidecars (via `sidecar_placement.resolve_path`), the
convert backup (`converter.convert_to_standard_format`), and the star-import
backup (the load + `undo-star-convert` endpoints).

Companions written before #1321 — under `sources/.state/artifacts`, or inside
`site-packages` — are moved to the layouts folder when the backend starts
(`managed_layouts.migrate_legacy_layouts`; only files the install's `RECORD`
doesn't list; copy, verify, then remove; never overwrites; outcome recorded
as `layouts_last_migration`).

For clones that already accumulated stray companions before this rule existed,
`clone_manager.checkout()` purges any untracked `.pnlview.json` /
`.original.py` / `.star_import_original.py` before its dirty-tree check, so branch
switches self-heal.

## How the model maps to the UI

A single **File cluster** in the toolbar, beside the model browser:

```
[ Open v ] [ Save ] [ Save a copy as… ]   model_name.py •unsaved [standard]
   catalog     |            |
   + Open...    |           one dialog, pick a format:
               in place       .py  → server copy, becomes the active file
                              .pnlproject / MDF → download
```

- The path is a **truncated chip** (middle-ellipsis, hover = full path, click =
  copy), never the raw absolute path inline
  ([#344](https://github.com/jonhanke-nam/PsyNeuView/issues/344)).
- A **•unsaved** marker and an enabled/disabled Save reflect dirty state
  ([#345](https://github.com/jonhanke-nam/PsyNeuView/issues/345)).
- Save / Save-a-copy live here, not buried in the Code editor pane
  ([#343](https://github.com/jonhanke-nam/PsyNeuView/issues/343)).
- **Export is not a separate button.** "Write a copy of the current model in
  format X" is one gesture: **Save a copy as…** opens a single dialog whose
  format picker covers `.py`, `.pnlproject`, and MDF
  ([#351](https://github.com/jonhanke-nam/PsyNeuView/issues/351)). Choosing
  `.py` writes a server-side copy and switches to it; the bundle/MDF formats
  stream a download.

## Backend endpoints (current, for reference)

| Verb / aspect | Endpoint |
| --- | --- |
| Open a local file | `POST /api/model/load` |
| Save in place | `POST /api/model/save-source` |
| Save As (new copy) | `POST /api/models/save-as` |
| Save layout sidecar | `POST /api/model/save-layout` |
| Export bundle (download) | `POST /api/model/export-project` |
| Open bundle in place | `POST /api/model/open-project` |
| Save back into bundle | `POST /api/model/save-project` |
| Export MDF | `POST /api/model/export-mdf` |
| Import bundle (upload) | `POST /api/model/import-project` |
| Import MDF | `POST /api/model/import-mdf` |
| Convert to standardized | `POST /api/model/convert` |
| List / browse managed models | `GET /api/models`, `/api/models/browse`, `/api/models/dirs` |
| Catalogs | `GET /api/demos`, `/api/reference-models`, `/api/library-models` |
| GitHub source | `GET /api/model/github/tree`, `/api/model/github/file` |

These endpoint names are descriptive of today's wiring; the umbrella may
consolidate them as the verbs above are unified.

## Adding a new format

1. Add the format to the **Formats matrix** above with its role and round-trip
   status.
2. Decide which verbs expose it (Open / Save As) — it must map onto an existing
   verb, not introduce a new one.
3. Implement the classifier hook per [`file-conventions.md`](./file-conventions.md).
4. Add tests covering Open and (if applicable) Save-a-copy round-trip.

## See also

- Umbrella: [#341](https://github.com/jonhanke-nam/PsyNeuView/issues/341)
- Classifier algorithm: [`file-conventions.md`](./file-conventions.md)
- MDF versioning policy: [`mdf-versioning.md`](./mdf-versioning.md)
