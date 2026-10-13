# Python code conventions — survey of de-facto PsyNeuLink practice

This document captures the **conventions that PsyNeuLink-using Python
code actually uses today**, based on a corpus survey across upstream
PsyNeuLink's library models, its `Scripts/Examples/` directory, and
PsyNeuView's own demo files. It feeds into the standards-decision
tracked at parent issue
[#188](https://github.com/jonhanke-nam/PsyNeuView/issues/188).

Sub-issue: [#190](https://github.com/jonhanke-nam/PsyNeuView/issues/190).
Companion document: [`python-code-conventions-peps.md`](python-code-conventions-peps.md)
captures the PEP / tooling baseline.

## Why this document exists

Before deciding what PsyNeuView's "standard format" *should* be, it is
worth knowing what PsyNeuLink users *already do*. Where the corpus has
a strong majority pattern, the standard should usually adopt it.
Where the corpus is split, the standards-decision in #188 needs to make
an explicit call.

## Corpus surveyed

Spans three categories of PsyNeuLink-using code:

1. **Upstream library models** (`PsyNeuLink/psyneulink/library/models/`)
   — the curated models PsyNeuView surfaces under the **Library**
   section of the Load Model dropdown.
2. **Upstream examples** (`PsyNeuLink/Scripts/Examples/`) — author-written
   demo and tutorial scripts. These are explicitly excluded from
   upstream `pycodestyle` and so represent unconstrained author style.
3. **PsyNeuView demos** (`PsyNeuView/backend/demos/`) — modern PsyNeuView
   demo scripts written by the PsyNeuView team.

## Headline summary

PsyNeuLink model code is **moderately consistent**, with clear dominant
patterns in most dimensions and a few areas where the corpus is
genuinely split. The strongest conventions are:

1. **Aliased qualified imports** — `import psyneulink as pnl` dominates
   modern code (~95% of library models). Older `Scripts/Examples/` files
   use bare `from psyneulink import *`.
2. **Mechanisms-then-projections-then-composition** vertical layout —
   ~90% of surveyed files lay out the file as a block of mechanism
   definitions, then a block of projection / weight-matrix definitions,
   then the composition assembly.
3. **`snake_case` for variable names** (near-universal).
4. **`ALL CAPS` for the `name=` kwarg** in upstream library models (~85%)
   — though newer PsyNeuView demos use `snake_case` there too.
5. **Kwargs-only construction** — ~98% of mechanism / projection
   construction passes everything as keyword arguments.

The dimensions where the corpus is genuinely split — and where #188
needs to take a position — are flagged below in the relevant sections
and re-summarized under **Decision points for #188** at the end.

## Component ordering

**Dominant pattern (~90% of files):**

1. Parameters block (constants, `argparse` setup if used).
2. **Mechanisms** as a vertical block, often grouped by conceptual
   layer (input → hidden → output / response).
3. **Projections** as a vertical block, often grouped by pathway pair
   (e.g. task-to-color, color-to-task).
4. **Composition** assembly, called last.

A small minority of older `Scripts/Examples/` files (e.g. some uses of
`add_linear_processing_pathway()`) interleave mechanisms and
projections inside the composition setup.

Representative example: `PsyNeuLink/psyneulink/library/models/Cohen_Huston1994.py`
— mechanisms block at lines 30–96, projections block at lines 104–176,
pathway / composition assembly at lines 178–250.

## Naming conventions

### Variable names

Near-universal **`snake_case`** for mechanism, projection, and most
composition variables:

- Mechanisms: `color_input_layer`, `response_layer`, `task_layer`.
- Projections: `color_response_weights`, `task_color_weights`.

### `name=` kwarg

Two co-existing styles:

- **`ALL CAPS`** (dominant in upstream library models, ~85%): e.g.
  `name='COLOR INPUT'`, `name='TASK_DEMAND'`, `name='RESPONSE'`.
- **`snake_case`** (newer PsyNeuView demos): e.g.
  `name='colors_input'`, `name='response'`.

The variable name and the `name=` kwarg are **largely independent**:
the same variable `color_hidden_layer` might carry `name='COLOR HIDDEN'`
or `name='color_hidden'` depending on author era. This is one of the
clear **decision points** for #188.

### Composition variables

Mixed practice — descriptive full names (`System_Conflict_Monitoring`,
`Stroop_model`, `PCTC`), short names (`comp`, `c`), or domain names
(`task`). No clear winner. Library models lean descriptive; small demos
lean short.

## Import style

The corpus is **clearly split by era**:

- **`import psyneulink as pnl`** — ~95% of upstream library models, and
  the dominant style in PsyNeuView demos. Confirmed in
  `Botvinick_conflict_monitoring_model.py:4`, `Cohen_Huston1994.py:4`,
  `GilzenratModel.py:7`, etc.
- **`from psyneulink import *`** — ~70% of `Scripts/Examples/` files.
  Confirmed in `Scripts/Examples/Stroop Model.py:1` and
  `Scripts/Examples/Basics And Primer/Stroop Model - Basic.py:1`.

PsyNeuView's "standard format" already calls for the aliased form (and
#153's *Convert to standard format* button rewrites star imports), which
aligns with modern practice but **diverges from a meaningful share of
the existing corpus**. The conversion tooling matters.

### Import group ordering

Where multiple imports exist, the corpus follows the standard PEP 8
grouping: standard library, then third-party (`numpy`), then
`psyneulink`. E.g. in `Botvinick_conflict_monitoring_model.py`:

```python
import argparse

import numpy as np
import psyneulink as pnl
```

## Keyword arguments vs. positional arguments

**Kwargs-only is overwhelmingly dominant (~98%).** Every surveyed
mechanism / projection / composition constructor passes everything as
keyword arguments. Positional arguments appear only in ultra-compact
one-liners, and are rare.

No strict kwarg-ordering convention emerges, but the recurring pattern
in library models is:

1. Shape (`input_shapes` first if present).
2. `function`.
3. Modifier kwargs (`integrator_mode`, `hetero`, `integration_rate`,
   etc.).
4. `name` last.

Representative example, `Botvinick_conflict_monitoring_model.py:77–85`:

```python
color_hidden_layer = pnl.RecurrentTransferMechanism(
    input_shapes=3,
    function=pnl.Logistic(x_0=BIAS),
    integrator_mode=True,
    hetero=INHIBITION,
    integration_rate=RATE,
    name='COLOR HIDDEN'
)
```

## Whitespace and formatting

### Line length

Typical maximum line length in practice is **100–130 characters**.
Library models cluster around 100–130; PsyNeuView demos sit lower
(~77). No file in the surveyed corpus is restricted to PEP 8's nominal
79-character limit — consistent with upstream PsyNeuLink ignoring
`E501` (see the companion PEP document).

### Continuation style

Multi-line constructor calls use a **hanging indent**: opening
parenthesis stays on the same line as the function call, arguments sit
on subsequent lines, and the closing parenthesis sits either on its own
line or with the final argument.

### Blank-line conventions

- **One** blank line between sibling mechanism definitions.
- **Two** blank lines between major sections (Parameters → Mechanisms
  → Projections → Composition).
- Section transitions are commonly marked with a dashed comment header,
  e.g. `# Create mechanisms ---------------------------------`.

## Comment density

Density varies meaningfully by category:

- **Library models** — moderately commented. File-level docstrings
  citing the source paper are common; inline comments at parameter
  lines; section headers between mechanism / projection / composition
  blocks; per-component comments where the design rationale isn't
  obvious. Example: `Botvinick_conflict_monitoring_model.py` has a 22-line
  file-header citation, parameter comments, section headers, and
  per-mechanism design notes.
- **`Scripts/Examples/`** — sparse comments. Mostly section headers and
  occasional one-liners (e.g. `Stroop Model - Basic.py`).
- **PsyNeuView demos** — minimal comments. Section headers used to
  punctuate parameter / mechanism / projection / run sections; few
  inline comments.

File-level docstrings (PEP 257 module docstrings) appear in roughly
**2/7 library models** (e.g. `MontagueDayanSejnowski96.py`,
`GilzenratModel.py:1–6`) — meaningful but not standard practice.

## Other recurring patterns

- **No `if __name__ == '__main__':` blocks** in any surveyed library
  model or example. Modules run code at top level when imported as
  scripts; PsyNeuView demos are imported, not run directly.
- **Matrix specification** — weight matrices are inlined as
  `np.array(...)` inside the projection constructor, not stored in
  separate intermediate variables. Exception: parameter constants
  declared at the top of the file.
- **`argparse` for runtime configuration** — used in ~60% of library
  models (Botvinick, Cohen_Huston1994, GilzenratModel, Kalanthroff,
  MontagueDayanSejnowski96, Nieuwenhuis2005Model), rarely in Examples.
- **Pathway naming** — when `pnl.Pathway(...)` is constructed explicitly
  (rather than passed as a bare list), it carries a descriptive `name=`.
  When `add_linear_processing_pathway()` is used inline, pathways
  typically go unnamed.

## Decision points for #188

The corpus is split on the following dimensions. The standards-decision
under #188 needs to make an explicit call rather than picking by default:

1. **`name=` casing.** Upstream library models prefer `'ALL CAPS'`;
   PsyNeuView demos prefer `'snake_case'`. Recommendation: allow both
   but require **internal consistency within a single file**. (No
   strong reason to override either tradition globally; the GUI does
   not care about casing.)
2. **Composition variable naming.** No clear majority; descriptive
   names work well for paper-grounded models, short names (`comp`, `c`)
   work well for prototypes. Recommendation: do not enforce; the
   default name for auto-generated compositions should follow #181's
   `New_<Type>_<n>` pattern.
3. **Star imports.** Currently dominant in `Scripts/Examples/` (~70%)
   but absent in library models. The standard format already calls for
   the aliased form (#153 rewrites star imports). This is a deliberate
   divergence from the legacy Examples corpus; #188 should keep it but
   record that conversion tooling needs to handle the migration.
4. **File-level docstrings.** Present in ~30% of library models. Not
   currently required, but extracting the docstring would make the
   Load Model dropdown more useful (showing the citation/intent
   alongside the file name). Recommendation: keep optional, but
   encourage; add UI surface for it if not already present.

## Recommendations for the #188 standard format

Pulling the above into concrete proposals:

- **Adopt as required:** `snake_case` variable names, kwargs-only
  construction, aliased `import psyneulink as pnl`, mechanisms-then-
  projections-then-composition layout, one blank line between mechanism
  definitions, two between major sections.
- **Adopt as recommended (not enforced):** dashed section-header
  comments, `argparse` for runnable demos, file-level docstrings.
- **Allow either of two styles, require consistency within a file:**
  `name=` casing (`ALL CAPS` vs. `snake_case`), composition variable
  naming (descriptive vs. short).
- **Forbid:** `from psyneulink import *` in PsyNeuView-canonical model
  files. Convert via #153's *Convert to standard format* button.
- **Defer to PEP / tooling baseline** (see companion PEP doc): line
  length, whitespace rules, docstring formatting — adopt the upstream
  PsyNeuLink `pycodestyle` ignore list as the floor.

## Files surveyed

Representative subset; the full survey covered the entire library-model
directory plus a sample across `Scripts/Examples/`.

**Upstream library models** (`PsyNeuLink/psyneulink/library/models/`):

- `Botvinick_conflict_monitoring_model.py`
- `Cohen_Huston1994.py`
- `Cohen_Huston1994_horse_race.py`
- `GilzenratModel.py`
- `Kalanthroff_PCTC_2018.py`
- `MontagueDayanSejnowski96.py`
- `Nieuwenhuis2005Model.py`

**Upstream examples** (`PsyNeuLink/Scripts/Examples/`):

- `Botvinick Model Composition.py`
- `Stroop Model.py`
- `Basics And Primer/Stroop Model - Basic.py`
- `Basics And Primer/Stroop Model - Conflict Monitoring.py`
- `Tutorial/Stroop Model - EVC.py`

**PsyNeuView demos** (`PsyNeuView/backend/demos/`):

- `simple_stroop.py`
- `stroop_basic.py`
