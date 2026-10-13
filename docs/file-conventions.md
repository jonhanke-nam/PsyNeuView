# PsyNeuView File-Type Naming Convention

> **See first:** [`file-handling.md`](./file-handling.md) is the top-level model
> for how PsyNeuView treats files (the four verbs, the formats matrix, where
> files live). This document is the lower-level **classifier** reference it
> points to — the extension + content-sniffing algorithm that answers "what is
> this file?".

This document defines the file-type naming convention used by PsyNeuView and
the algorithm used to classify user-supplied files. The canonical implementation
lives in [`backend/app/services/file_types.py`](https://github.com/jonhanke-nam/PsyNeuView/blob/devel/backend/app/services/file_types.py)
(`classify_file()` / `classify_upload()`); every route that accepts user file
input should delegate to that module rather than checking extensions inline.

See also: issue [#91](https://github.com/jonhanke-nam/PsyNeuView/issues/91).

## Why we need a convention

PsyNeuView accepts several different file formats:

- PsyNeuLink Python sources
- PsyNeuView project bundles
- MDF (Model Description Format) models, in JSON or YAML

The MDF spec (ModECI MDF v0.4) does not define a dedicated file extension —
it ships as plain `.json` or `.yaml`. Those generic extensions collide with
every other JSON / YAML payload in the world, so extension alone cannot tell
us whether a file is meant to be loaded as MDF, a PsyNeuView project manifest,
a config file, or something else entirely.

Our convention is **defense-in-depth**: a *compound extension* gives a clear
hint to humans and tools, and a *content sniff* makes the classification
authoritative regardless of how the file was named.

## Naming table

| Format               | Canonical extension | Also accepted          | Notes                                         |
| -------------------- | ------------------- | ---------------------- | --------------------------------------------- |
| PsyNeuLink Python    | `.py`               | —                      | Source executed by the warm sandbox.          |
| PsyNeuView project   | `.pnlproject`       | —                      | Zip archive containing `manifest.json`.       |
| PsyNeuView layout    | `.pnlview.json`     | —                      | Sidecar: node positions. See [Sidecars](#sidecars). |
| PsyNeuView labels    | `.labels.yaml`      | —                      | Sidecar: element-name overlays. See [Sidecars](#sidecars). |
| PsyNeuView index     | `.psyneuview.json`  | —                      | Sidecar: which variant is active. See [Sidecars](#sidecars). |
| MDF JSON             | `.mdf.json`         | bare `.json` (sniffed) | ModECI MDF model serialized as JSON.          |
| MDF YAML             | `.mdf.yaml`         | `.mdf.yml`, bare `.yaml` / `.yml` (sniffed) | ModECI MDF model serialized as YAML. **Preferred for human-readable export.** |

YAML is the preferred default for human-readable MDF exports; JSON is offered
for tools that demand it.

## Sidecars

A model is one `.py` file. Everything PsyNeuView adds — where the nodes sit, what
the elements are called, which variant is open — lives in **sidecar** files
beside it, so the model stays an ordinary PsyNeuLink script that runs without
PsyNeuView.

| Suffix | Holds | Written by |
|---|---|---|
| `.pnlview.json` | Node positions and viewport, and per-node view settings: dragged ports, hand-shaped edges, a node's values shown as a list or a grid (`valueViews`) | Moving a node, or `POST /api/model/save-layout` |
| `.labels.yaml` | Semantic element-name overlays | Editing labels |
| `.psyneuview.json` | Which layout / settings variant is active | Switching variants |

The suffixes are defined once, in `backend/app/services/sidecar_index.py`
(`LAYOUT_SUFFIX`, `SETTINGS_SUFFIX`, `INDEX_SUFFIX`).

### Named variants

A model can carry several layouts. The default is unsuffixed; a named variant
inserts its name before the suffix, and **the name on disk *is* the variant
name** — it is recovered by parsing the filename, not from an index.

```
stroop_reference_with_lc.py                    the model
stroop_reference_with_lc.pnlview.json          default layout
stroop_reference_with_lc.1.pnlview.json        layout variant named "1"
stroop_reference_with_lc.labels.yaml           labels
stroop_reference_with_lc.psyneuview.json       index — which of the above is active
```

`.psyneuview.json` is an index, not content: it records which variant is active,
so switching variants does not rewrite any layout.

### Where they are written

Beside the `.py` when a sidecar already exists there; otherwise in a hidden
`.psyneuview/` directory next to it (#927). **`.psyneuview/` is gitignored**, so
a sidecar meant to ship with a bundled model has to be lateral — this bit twice
while authoring the curated reference-model layouts, which were silently written
somewhere they could never be committed.

### When these pile up in a checkout

Until #1319, `backend/` — the working directory when the app runs — was also
where the working copies of Reference Models and Demos went, with every sidecar
written beside them, so each one a session opened landed in the checkout as an
untracked file. They now go to `~/.psyneuview/working-copies` (or
`PSYNEWVIEW_WORKING_DIR`), and copies left in `backend/` from before are moved
there when the backend starts — except files git tracks, which are left alone
([where things live](where-things-live.md#working-copies-of-included-models)).
Anything else that lands in the checkout is still nobody's deliberate work, and
nothing clears it.

That is untidy until one of those names becomes *tracked* upstream, which happens
whenever a scratch model is promoted into the repo. Then the checkout stops
fast-forwarding and quietly serves stale code (#1134).

Git handles the two populations in opposite ways, and the difference decides what
is safe to do about them:

| | on checkout | your local copy |
|---|---|---|
| untracked | merge is refused, files are named | survives |
| **ignored** | overwritten, no message | **destroyed** |

This is why the artifact *shapes* (`*.pnlview.json`, `*.labels.yaml`) are not
gitignored wholesale. Ignoring them would silence the refusal that currently
protects a sidecar holding positions someone dragged by hand. Only specific
working copies whose pristine original lives elsewhere in the repo are listed by
name in `.gitignore`.

To see what a sync would touch before running it:

```bash
python3 scripts/check_anchor_collisions.py --scope backend/
```

It separates copies that are byte-identical to the incoming version, which are
safe to delete, from those holding content the ref does not have — and it reports
the ignored files too, which git would otherwise replace without saying so.

### Precedence

For a bundled reference model the layout resolves user → curated → auto (#1008):
a user's layout is never overwritten by the shipped one, the shipped one seeds
only when absent, and with neither the auto-layout runs.

## Detection algorithm

Implemented in `classify_file()`:

1. **Existence check.** Missing path or non-regular file ⇒ `UNKNOWN` with a
   descriptive `error`.
2. **Extension fast hint.** Inspect the filename:
   - `.py` ⇒ `PNL_PYTHON` (definitive — no syntax check at this layer).
   - `.pnlproject` ⇒ candidate `PNLPROJECT`, must be content-verified.
   - `.mdf.json` / `.mdf.yaml` / `.mdf.yml` ⇒ candidate MDF, *compound hint*.
   - Bare `.json` / `.yaml` / `.yml` ⇒ candidate MDF, *no compound hint*.
   - Anything else ⇒ `UNKNOWN` with an "unsupported extension" error.

   Compound extensions are checked before the bare ones; otherwise
   `model.mdf.json` would match `.json` first.
3. **Content sniff.**
   - `PNLPROJECT`: open as zip, require a `manifest.json` member.
   - MDF candidates: delegate to `modeci_mdf.utils.load_mdf()` — if the model
     loads without raising, the file is valid MDF.
4. **Disagreement handling.**
   - **Compound MDF extension + content fails to parse** ⇒ explicit `error`
     ("`...` has an MDF extension but its content could not be parsed as MDF").
     This is a hard failure, not a silent reclassification — if the user
     named it `.mdf.json` they meant it.
   - **Bare `.json` / `.yaml` + content IS valid MDF** ⇒ accept as MDF, but
     attach a `warning` suggesting the user rename to the compound form for
     clarity.
   - **Bare `.json` / `.yaml` + content is NOT MDF** ⇒ `UNKNOWN` with an
     error. PsyNeuView only accepts bare JSON/YAML if it parses as MDF.
   - **`.pnlproject` that is not a valid bundle** ⇒ `UNKNOWN` with an error.

The result is a `Classification` dataclass:

```python
@dataclass
class Classification:
    file_type: FileType            # the resolved type, or UNKNOWN
    warnings: list[str] = []       # soft hints (e.g. "consider renaming")
    error: str | None = None       # populated only on UNKNOWN
```

`Classification.ok` is `True` iff `file_type is not UNKNOWN and error is None`.

## Examples

| Filename             | Content        | Result                                                                  |
| -------------------- | -------------- | ----------------------------------------------------------------------- |
| `model.py`           | (any)          | `PNL_PYTHON`, ok                                                        |
| `tiny.pnlproject`    | zip + manifest | `PNLPROJECT`, ok                                                        |
| `tiny.pnlproject`    | not a zip      | `UNKNOWN`, error: "...not a valid project bundle"                       |
| `model.mdf.json`     | valid MDF      | `MDF_JSON`, ok, no warnings                                             |
| `model.mdf.json`     | invalid MDF    | `UNKNOWN`, error: "...MDF extension but content could not be parsed"    |
| `model.mdf.yaml`     | valid MDF      | `MDF_YAML`, ok                                                          |
| `model.mdf.yml`      | valid MDF      | `MDF_YAML`, ok                                                          |
| `model.json`         | valid MDF      | `MDF_JSON`, ok, warning: "consider renaming to `.mdf.json`"             |
| `config.json`        | not MDF        | `UNKNOWN`, error: "bare .json/.yaml accepted only if valid MDF"         |
| `model.yaml`         | valid MDF      | `MDF_YAML`, ok, warning: "consider renaming to `.mdf.yaml`"             |
| `image.png`          | (any)          | `UNKNOWN`, error: "Unsupported file extension"                          |

## Using the classifier

Every code path that ingests a user file should funnel through one of:

- `classify_file(path)` — for files already on disk (e.g. the
  `/api/model/load` endpoint that takes a `file_path`).
- `classify_upload(filename, content_bytes)` — for in-memory multipart
  uploads. Internally writes a temp file and calls `classify_file`.

The handler should:

1. Call the classifier.
2. If `result.file_type is UNKNOWN`, return HTTP 400 with `result.error`.
3. Otherwise dispatch to the format-specific loader keyed off
   `result.file_type`.
4. Surface `result.warnings` to the user (e.g. as a non-blocking notification)
   so the rename hint actually reaches them.

## Adding a new format

When introducing a new accepted file format:

1. Add a member to the `FileType` enum.
2. Add the canonical extension (and any accepted aliases) to the extension
   tables in `file_types.py`.
3. Add a content-sniff helper if the extension is ambiguous; otherwise the
   extension can be definitive (like `.py`).
4. Update this document's naming table and the algorithm description.
5. Add tests in [`backend/tests/test_file_types.py`](https://github.com/jonhanke-nam/PsyNeuView/blob/devel/backend/tests/test_file_types.py) covering: canonical
   extension + valid content; canonical extension + invalid content; any
   sniffable bare-extension cases; and the unsupported-extension error path.
