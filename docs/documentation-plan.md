# Documentation plan

This page articulates PsyNeuView's **documentation posture** — how we layer docs
by audience and purpose so PsyNeuView's docs and PsyNeuLink's existing Sphinx
reference form one coherent corpus.

!!! note "Plan vs. tracker"
    This page is the **stable articulation of the posture**. The **living
    tracker** — audit checklist, sub-issues, and status — is GitHub issue #733.
    Update the issue as work progresses; update this page when the *posture*
    itself changes.

## Two axes, not one ladder

Documentation layers on two orthogonal axes. Conflating them is what makes docs
sprawl and rot.

**Axis 1 — Audience tier:** Newbie → Practitioner (model user) → Advanced →
Developer.

**Axis 2 — Doc type ([Diátaxis](https://diataxis.fr/)):**

| | Learning | Doing |
| --- | --- | --- |
| **Practical** | **Tutorials** — hand-held first wins | **How-to guides** — task recipes |
| **Theoretical** | **Explanation** — concepts, the "why" | **Reference** — exhaustive API / lookup |

Audience tiers map *onto* the quadrants with a depth gradient (Newbie →
Tutorials; Practitioner → How-to + Explanation; Advanced → Reference + "advanced"
notes; Developer → Reference + contributor guide) — instead of four parallel doc
sets that duplicate and rot.

## PsyNeuView vs. PsyNeuLink — "app-how vs. library-what"

This is also the rule that keeps the two from duplicating or drifting:

- **PsyNeuLink owns:** Reference (the Sphinx API) + Explanation of the modeling
  primitives (Mechanisms, Compositions, learning, EM). Answers *"what is X / the
  full API."*
- **PsyNeuView owns:** Tutorials + How-to guides + Explanation of the **app**
  (the flat / PyTorch views, the inspector, the debugger). Answers *"how do I do
  X in the app."*
- **Cross-link, never duplicate.** PsyNeuView never re-documents what a
  Composition *is* — it links to the [PsyNeuLink
  documentation](https://princetonuniversity.github.io/PsyNeuLink/).

## Progressive disclosure

Prefer **structural** layering (separate how-to vs. reference sections, plus
collapsible "Advanced" notes within a page) over a single global verbosity
toggle. (This site enables `pymdownx.details` for exactly that.)

## Plan (phased)

1. Adopt the Diátaxis skeleton + a **"Start here"** landing that routes by
   audience.
2. **Audit + bucket** existing docs into the four quadrants (today: the tutorials
   are *Tutorials*; the technical notes under **Developer** are *Developer*;
   How-to and app-Explanation are largely empty).
3. **Fill the gaps** — a small set of How-to guides and app-Explanation pages are
   the biggest missing pieces.
4. **Cross-link** systematically to PsyNeuLink.
5. **Keep docs executable** where possible — the tutorials capture their
   screenshots from a Playwright spec, so they can't silently drift from the app;
   extend that pattern.

## Open decisions

- **One combined docs site vs. two cross-linked** — leaning **two**, cross-linked
  (each lives with its codebase; avoids a sync/ownership headache).
- **Docs tooling** — markdown-in-repo remains canonical; this MkDocs site is a
  thin, non-disruptive layer over it. A public GitHub Pages deploy is a separate
  (deferred) decision, since the repo is private.

## Tracking

- **#733** — documentation posture umbrella (this plan's living tracker).
- **#734** — Sphinx cross-links from the tutorials.
- **#736** — docs tooling / this site.
