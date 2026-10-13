# Python code conventions — PEP and best-practice baseline

This document records the Python style baseline that PsyNeuView's
standardized PsyNeuLink Python conventions (parent issue
[#188](https://github.com/jonhanke-nam/PsyNeuView/issues/188)) build on,
and lists where the conventions deliberately diverge from the
out-of-the-box PEP and tool defaults.

Sub-issue: [#191](https://github.com/jonhanke-nam/PsyNeuView/issues/191).
Companion document: [`python-code-conventions-survey.md`](python-code-conventions-survey.md)
captures de-facto patterns observed in the existing PsyNeuLink corpus.

## Why this document exists

#188 introduces a *standard format* for PsyNeuLink Python files —
referenced by features like the **format-issue banner** and the
**Convert to standard format** button — but until now "standard" was
defined only by implication. This document supplies the PEP / tool side
of that definition. The corpus side is in the companion survey doc.
Together the two converge on a concrete spec the #188 work can point at.

## Existing tooling in the project ecosystem

### PsyNeuView (this repo)

- Backend (`backend/pyproject.toml`): uses **Ruff** ≥ 0.3.0 as a dev
  dependency. No project-level Ruff configuration file ships in the
  repo, so backend code is linted against Ruff defaults.
- Frontend / TypeScript tooling is out of scope for this document.
- **No explicit lint configuration exists for emitted or user-facing
  PsyNeuLink Python.** That is the territory #188 is filling in.

### Upstream PsyNeuLink

`setup.cfg` in the upstream repo defines a fairly permissive Python
style baseline:

- **`pycodestyle`** is run via the `pytest-pycodestyle` plugin, with an
  explicit ignore list (full list reproduced below). Notable: `E501`
  (line too long) is ignored — there is no enforced line length.
- **`pydocstyle`** is run via `pytest-pydocstyle`, with `D100`–`D107`
  ignored. Translation: docstrings are **optional**.
- **`Scripts/` is excluded from `pycodestyle` entirely.** That folder
  holds PsyNeuLink's user-facing model scripts — exactly the corpus
  PsyNeuView's "standard format" applies to. Upstream has deliberately
  chosen *not* to enforce a Python style baseline on model files, which
  leaves PsyNeuView free to define one without conflicting with
  upstream expectations.

The full upstream `pycodestyle` ignore list (from `setup.cfg`):

```
E114, E115, E116, E121, E122, E123, E124, E125, E126, E127, E128, E129,
E131, E201, E202, E203, E221, E225, E231, E241, E251, E252, E261, E262,
E265, E301, E302, E303, E306, E501, E721, E722, E731, E741,
W503, W504, W605
```

In effect this disables most PEP 8 whitespace, indentation, blank-line,
and line-length rules, plus a handful of common code-smell rules.

## PEP conformance — what PsyNeuView's "standard format" targets

The following table records each PEP / tool the standards-decision in
#188 needs to take a position on, and the position taken in this
document. "Status" values:

- **Adopted** — applies as written.
- **Partial** — adopted with documented deviations (listed below).
- **Optional** — not required, but allowed.
- **Out of scope** — does not apply to model files.

| Reference                  | Topic                                | Status   | Notes                                                                                                  |
| -------------------------- | ------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------ |
| PEP 8                      | Style guide for Python code          | Partial  | Default Ruff/pycodestyle baseline minus the deviations in the next section.                            |
| PEP 257                    | Docstring conventions                | Optional | Following upstream PsyNeuLink, missing-docstring rules (D100–D107) are not enforced on model files.    |
| PEP 20                     | The Zen of Python                    | Adopted  | Used as a tie-breaker for judgment calls where the survey shows no clear majority.                     |
| PEP 484                    | Type hints                           | Optional | Permitted in backend / utility code. Not required for model files; do not penalise their absence.      |
| PEP 526                    | Variable annotations                 | Optional | Same as PEP 484: permitted, not required for model files.                                              |
| Ruff (default rules)       | Linter                               | Adopted  | Baseline for backend code. For model-file checking the deliberate-divergence list below applies.       |
| Black                      | Formatter                            | Out of scope (for now) | Backend code is not currently Black-formatted. If we adopt Black later we will record it here.         |
| isort                      | Import sorting                       | Adopted  | Standard grouping (stdlib → third-party → local). Reconfirm against survey-observed practice.          |
| `pycodestyle` / `pydocstyle` (upstream) | Style + docstrings | Reference | Upstream's ignore list is the floor — PsyNeuView's "standard format" should not be *stricter* than upstream is on its own non-Scripts code. |

## Deliberate divergences from PEP 8 / Ruff defaults

Adopted from upstream PsyNeuLink's `setup.cfg` `pycodestyle` ignore list,
on the principle that PsyNeuView's standard format should not impose
rules upstream itself has chosen not to enforce on its own code base.

| Code  | Rule                                                                | Why we ignore it                                                                                          |
| ----- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| E501  | Line too long                                                       | Upstream ignores. Model files often have long parameter calls that are clearer on one line.               |
| E114–E131 | Continuation-line indentation rules                             | Upstream ignores. Hand-written model files use a range of acceptable continuation styles.                 |
| E201, E202, E203, E221, E225, E231, E241 | Whitespace around tokens         | Upstream ignores. Visual alignment of related declarations is common and useful in model code.            |
| E251, E252                              | Whitespace around `=` in keyword args | Upstream ignores. Some authors visually align long kwarg blocks.                                       |
| E261, E262, E265                        | Comment formatting                | Upstream ignores. Inline notes and section comments use varied styles in the corpus.                      |
| E301–E306                               | Blank-line rules                  | Upstream ignores. Vertical grouping of nodes vs. projections (see survey doc) is more important than a strict blank-line count. |
| E721, E722                              | Bare `except`, `type` comparison  | Upstream ignores. Not a concern for typical model-construction code.                                      |
| E731                                    | Lambda assignment                 | Upstream ignores. Lambdas are sometimes used inline for PsyNeuLink function specs.                        |
| E741                                    | Ambiguous variable names (`l`, `I`) | Upstream ignores. Acceptable in mathematical model code where the symbol matches the equation.          |
| W503 / W504                             | Line break before/after binary operator | Upstream ignores. Either style is acceptable.                                                       |
| W605                                    | Invalid escape sequence           | Upstream ignores. Rare in model files.                                                                    |
| D100–D107 (pydocstyle)                  | Missing docstrings                | Upstream ignores. Module / class / function docstrings are optional in model files.                       |

## Rules the standard format **does** enforce

Beyond the upstream baseline, the #188 standard format introduces some
rules that are PsyNeuView-specific. The authoritative source for each
is the #188 spec; the companion survey document records the empirical
evidence supporting them.

- **Aliased qualified imports — `import psyneulink as pnl`.** Survey
  confirms this is the dominant modern style (~95% of library models).
- **No `from psyneulink import *`.** Upstream allows star imports in
  Scripts (and ~70% of `Scripts/Examples/` use them), but PsyNeuView's
  standard format disallows them (#153's *Convert to standard format*
  button rewrites them). Reason: the format-issue banner and the GUI's
  Python-to-canvas analysis need to be able to resolve every explicit
  name used by a model, which star imports defeat.
- **Vertical grouping by component kind.** Mechanisms first as a single
  vertical block, then projections as a single vertical block, then the
  composition assembly. Survey shows this is already the dominant
  pattern (~90% of files).
- **`snake_case` for variable names.** Survey confirms near-universal.
- **Kwargs-only construction for mechanisms / projections /
  compositions.** Survey confirms ~98% practice; positional arguments
  appear only in ultra-compact one-liners.
- **Default naming for auto-created components.** `New_<ComponentType>_<n>`,
  per [#181](https://github.com/jonhanke-nam/PsyNeuView/issues/181).

The standard format **does not enforce** the following — survey shows
these vary across the corpus and there is no consensus to codify yet:

- `name=` kwarg casing (`'ALL CAPS'` vs. `'snake_case'`) — both styles
  are widely used. Internal consistency within a file is the only
  sensible enforceable constraint here.
- Composition variable naming (descriptive vs. short).
- Presence of a file-level docstring (~30% of library models have one;
  encouraged but not required).

## Recommendations for #188

Concrete proposals informed by the companion survey doc:

- **Adopt the upstream PsyNeuLink ignore list verbatim** as the floor
  for the standard format. Do not be stricter than upstream is on its
  own non-Scripts code.
- **Target Scripts-style files only.** The standard format applies to
  user-facing model files (PsyNeuView models, PsyNeuLink Scripts /
  library models). Library internals, framework plumbing, and the
  PsyNeuView backend follow their own already-established rules and
  are out of scope.
- **Use Ruff as the implementation engine.** Configure Ruff with the
  ignore list in this document and ship that configuration in a
  `pyproject.toml` (or `ruff.toml`) section dedicated to model files.
  This lets the #153 format-issue check share an implementation with
  any CI lint job rather than re-implementing rule checks.
- **Adopt the survey's strong-majority patterns as required rules:**
  aliased imports, mechanisms-then-projections-then-composition layout,
  `snake_case` variables, kwargs-only construction (see the "Rules the
  standard format **does** enforce" section above).
- **Adopt the survey's mixed-but-co-existing patterns as allowed
  styles with internal-consistency enforcement:** `name=` casing,
  composition variable naming. The format-issue checker should warn on
  *inconsistent* use within a single file but not on the choice itself.
- **Keep docstrings optional but well-supported.** Module-level
  docstrings make the Load Model dropdown more informative (showing
  citation / intent inline with the file name); encourage in
  contributor docs and surface in the UI, but do not enforce.

## References

- [PEP 8 — Style Guide for Python Code](https://peps.python.org/pep-0008/)
- [PEP 257 — Docstring Conventions](https://peps.python.org/pep-0257/)
- [PEP 20 — The Zen of Python](https://peps.python.org/pep-0020/)
- [PEP 484 — Type Hints](https://peps.python.org/pep-0484/)
- [PEP 526 — Syntax for Variable Annotations](https://peps.python.org/pep-0526/)
- [Ruff documentation](https://docs.astral.sh/ruff/)
- Upstream PsyNeuLink `setup.cfg` (pycodestyle / pydocstyle configuration).
