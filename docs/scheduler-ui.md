# PsyNeuView Scheduler UI — the canonical model

This is the **single source of truth** for how PsyNeuView lets a user *see*,
*edit*, and *understand* a PsyNeuLink Composition's schedule. It is the keystone
reference for the scheduler umbrella
([#377](https://github.com/jonhanke-nam/PsyNeuView/issues/377)); every other
sub-issue in that umbrella implements one section of this document.

It defines the **target model**. Where today's behavior differs, the gap is
called out inline with a *Current* note and a pointer to the sub-issue that
closes it. This document sits above the implementation; it does not prescribe
component names, only the user-facing model and where each control lives.

> **Status:** the **(D) Hybrid** information architecture in [§4](#4-the-ia-decision)
> is **approved** (2026-06-08). Implementation proceeds against this model.
> Wireframes for the dedicated Scheduler tab are deferred to a follow-up once the
> first interaction slice (§5, priority use case) lands.

## Priority use case

The single most common scheduler operation developers write by hand is a
**relational condition between two nodes**:

```python
comp.scheduler.add_condition(decisionGate, pnl.WhenFinished(responseLayer))
```

"Make `decisionGate` wait until `responseLayer` has finished." Making *this*
gesture effortless and graphical is the priority for the first implementation
slice. The whole node-centric interaction model (§5) is designed around it, and
`WhenFinished(node)` is its flagship relation. See [§5](#5-the-interaction-model-node-centric-authoring)
for the worked example.

## First principle: the `.py` is the source of truth

A PsyNeuLink model **is** its Python source, and that includes its schedule. Every
scheduler edit in the GUI resolves to a line of Python that is written back to the
`.py`:

- a condition becomes `comp.scheduler.add_condition(node, pnl.SomeCondition(...))`
- termination becomes `comp.scheduler.termination_conds = { pnl.TimeScale.X: ... }`
- mode becomes `comp.scheduler.mode = pnl.SchedulingMode.X`

No scheduler feature may introduce GUI-only state that isn't expressible in the
source. If you can set it in PsyNeuView, you can read it in the `.py`, and vice
versa. This mirrors the file-handling first principle in
[`file-handling.md`](./file-handling.md).

## 1. The mental model: structure vs. schedule

A Composition has two halves a user must reason about independently:

| Half | Question it answers | PsyNeuView surface today |
| --- | --- | --- |
| **Structure** | *Which* nodes exist and *how* they connect | the graph canvas — first-class, graphical, editable |
| **Schedule** | *When* each node fires, and *when execution stops* | scattered into the composition inspector — mostly read-only |

The whole point of umbrella #377 is to bring the **schedule** up to parity with
the **structure**: as legible, as graphical, as editable.

### The conditions → consideration-queue relationship

The single most important idea for users to internalize:

> **You edit conditions. The execution order is *derived* from them.**

A PsyNeuLink scheduler does not store an execution order you set directly. It
computes a **consideration queue** — the ordered sets of nodes eligible to fire
at each step — from (a) the graph's dependencies and (b) the conditions you've
attached. So the consideration queue is **never an editable field**. It is the
**feedback surface**: the thing that updates when you change a condition, and the
thing that animates when you run the model.

Design consequence: the UI must always show the *cause* (conditions) next to the
*effect* (the derived queue), so editing feels like a feedback loop, not like
poking an opaque box.

*Current:* the consideration queue is serialized read-only by
`_serialize_scheduler_config` in `backend/app/services/introspector.py` and shown
as a static list in `InspectorPanel.tsx`. The "edit a condition → watch the queue
change" loop does not exist yet.

## 2. The settable surface — everything a user can express

"Anything you could set with the scheduler" resolves to this inventory. Each row
is something the target UI must let a user edit (except the derived queue, which
is feedback only).

| Surface | PsyNeuLink API | Editable today? | Sub-issue |
| --- | --- | --- | --- |
| **Scheduler mode** | `scheduler.mode = SchedulingMode.{STANDARD, EXACT_TIME}` | ❌ read-only badge | [#381](https://github.com/jonhanke-nam/PsyNeuView/issues/381) |
| **Basic conditions** (per node) | `scheduler.add_condition(node, Cond(...))` | ⚠️ ~12 types, add/remove only | [#384](https://github.com/jonhanke-nam/PsyNeuView/issues/384) (coverage) |
| **Composite conditions** | `All` / `Any` / `Not` nesting | ❌ display-only | [#383](https://github.com/jonhanke-nam/PsyNeuView/issues/383) |
| **Graph Structure Conditions** | `BeforeNode`, `AfterNode(s)`, `AddEdgeTo`, `RemoveEdgeFrom`, `WithNode` | ✅ add/remove | — (shipped) |
| **Termination conditions** (per TimeScale) | `scheduler.termination_conds = {TimeScale.X: Cond}` | ❌ display-only (codegen exists, no UI) | [#382](https://github.com/jonhanke-nam/PsyNeuView/issues/382) |
| **Default condition** | nodes with no condition default to `Always()` | n/a (implicit) | covered by [#383](https://github.com/jonhanke-nam/PsyNeuView/issues/383)/[#384](https://github.com/jonhanke-nam/PsyNeuView/issues/384) |
| **Consideration queue** | *derived* — not set | feedback only | viz: [#386](https://github.com/jonhanke-nam/PsyNeuView/issues/386), [#387](https://github.com/jonhanke-nam/PsyNeuView/issues/387) |

### Condition vocabulary (target coverage, [#384](https://github.com/jonhanke-nam/PsyNeuView/issues/384))

Conditions group by the *kind of thing* they reference. This grouping should
drive the builder UI, because it determines what arguments a condition needs.

- **Node + count** — `EveryNCalls`, `AfterNCalls`, `BeforeNCalls`, `AtNCalls`,
  `AfterNCallsCombined` *(needs: a node + an integer n)*
- **Node only** — `JustRan`, `WhenFinished`, `WhenFinishedAny`, `WhenFinishedAll`
  *(needs: one or more nodes)*
- **Time / pass / trial** — `AtPass`, `BeforePass`, `AfterPass`, `EveryNPasses`,
  `AtTrial`, `AfterTrial`, `AtTimeStep`, `AtTime`/`BeforeTime`/`AfterTime`
  *(needs: an integer or a TimeScale-qualified value)*
- **Static** — `Always`, `Never`, `AllHaveRun`, `AtRunStart`
  *(needs: nothing, or an optional scope)*
- **Composite** — `All`, `Any`, `Not` *(needs: child conditions)*
- **Threshold / value-based** — `Threshold`, `WhenFinished`-style on parameter
  values *(needs: node, parameter, comparator, value)*

*Current:* `BASIC_CONDITION_TYPES` in `InspectorPanel.tsx` covers the first
handful (`EveryNCalls`, `AfterNCalls`, `BeforeNCalls`, `AtNCalls`, `JustRan`,
`WhenFinished`, `AtPass`, `AfterPass`, `EveryNPasses`, `Always`, `Never`,
`AllHaveRun`). Everything else in this list is the #384 gap.

## 3. Principles for the UI

1. **Graphical-first.** Relational conditions ("B runs after A") should be
   authored by pointing at nodes, not by typing names into dropdowns.
2. **In-context for per-node, dedicated for composition-wide.** See §4.
3. **Always round-trips.** Every edit writes `.py` and re-introspects (the
   existing `structural-change` round-trip).
4. **Explains itself.** Every condition gets a plain-English read-back
   ("B runs every 2nd time A runs") and conditions that can't be satisfied or
   reference deleted nodes are flagged
   ([#388](https://github.com/jonhanke-nam/PsyNeuView/issues/388)).
5. **Cause next to effect.** Editing a condition shows its consequence on the
   derived queue.

## 4. The IA decision

**The core question this issue exists to answer:** where does scheduler editing
live? Four candidate homes, evaluated against the two scales of concern —
*per-node* (this node's firing condition) and *composition-wide* (mode,
termination, the global execution order).

| Option | Per-node editing | Composition-wide editing | Verdict |
| --- | --- | --- | --- |
| **(A) Dedicated tab only** | divorced from the node you're looking at — hunt in a list | natural home | good globally, poor for node-centric authoring |
| **(B) Enriched inspector only** | natural (you're already on the node) | no room — mode/termination/global queue/conflicts bloat a selection-modal panel | good per-node, no home for the global picture |
| **(C) Canvas-native only** | great for *relational* conditions, useless for numeric (`EveryNCalls n=3`) and impossible for mode/termination | impossible | an input *method*, not a home |
| **(D) Hybrid** | inspector + canvas selection | dedicated Scheduler tab | **recommended** |

### Recommendation: (D) Hybrid, with a defined split

The scheduler genuinely operates at two scales, and forcing both into one surface
is precisely what created today's "everything jammed in the composition inspector"
problem. So:

**Per-node conditions live in-context** — authored two interchangeable ways:
- **From the inspector** when a node is selected (today's location, made fully
  editable: add/edit/remove basic + composite conditions for *this* node).
- **From canvas selection** ([#385](https://github.com/jonhanke-nam/PsyNeuView/issues/385)):
  select the owner node, pick a relation, click the dependency node. This is the
  graphical-first path for relational conditions.

**Composition-wide concerns live in a dedicated Scheduler tab/panel**
([#380](https://github.com/jonhanke-nam/PsyNeuView/issues/380)):
- scheduler **mode** toggle ([#381](https://github.com/jonhanke-nam/PsyNeuView/issues/381))
- **termination** conditions per TimeScale ([#382](https://github.com/jonhanke-nam/PsyNeuView/issues/382))
- the **derived consideration queue** (read-only feedback, with run-time
  animation [#387](https://github.com/jonhanke-nam/PsyNeuView/issues/387))
- a **roster** of every condition in the composition (each row links to its
  owner node — the same click-to-highlight that exists today)
- **validation summary** ([#388](https://github.com/jonhanke-nam/PsyNeuView/issues/388))

Canvas is the *input method* for relational conditions and the *static
visualization* of execution order ([#386](https://github.com/jonhanke-nam/PsyNeuView/issues/386)),
not a settings home.

### Why not the pure options

- **Not pure (A):** a single tab separates per-node condition editing from the
  node you're reasoning about, and kills the "select nodes to author" interaction
  the project explicitly wants.
- **Not pure (B):** the inspector is selection-modal — you cannot see the global
  timing picture while inspecting one node — and has no room for mode, termination,
  the global queue, and conflict reporting without becoming a scroll trap.
- **Not pure (C):** canvas authoring can't express numeric/static conditions or
  any composition-wide setting; it's a great *gesture*, not a *home*.

## 5. The interaction model (node-centric authoring)

The target gesture for relational conditions (#385):

1. **Select the owner** — the node whose firing you're conditioning.
2. **Pick a relation** from a small contextual menu: *runs after…*, *runs every N
   calls of…*, *runs when … finishes*, *runs at pass N*, *always / never*, …
3. **Supply the argument** — for relational conditions, a follow-up **click on the
   canvas** picks the dependency node; for numeric conditions, an inline field.
4. **Stack** — add more relations and combine them with **All / Any / Not** to
   build a composite ([#383](https://github.com/jonhanke-nam/PsyNeuView/issues/383)).
5. **Confirm** → writes `comp.scheduler.add_condition(owner, …)` and
   re-introspects; the derived queue updates in the Scheduler tab.

The same condition is editable afterward in-place (no delete-and-re-add), both
from the node inspector and the Scheduler tab roster.

### Worked example: the priority use case

`comp.scheduler.add_condition(decisionGate, pnl.WhenFinished(responseLayer))`:

1. Select **decisionGate** on the canvas (the owner — the node that will wait).
2. Pick **"Runs when … finishes"** from its contextual scheduling menu.
3. Click **responseLayer** on the canvas (the node to wait for).
4. PsyNeuView writes
   `comp.scheduler.add_condition(decisionGate, pnl.WhenFinished(responseLayer))`
   via the existing `add_basic_condition` `structural-change` action, re-introspects,
   and shows the condition on decisionGate with the plain-English read-back
   *"runs when responseLayer finishes."*

The backend codegen (`_add_basic_condition` → `_build_condition_expr` in
`file_writer.py`) and the form-based path already produce this line today; the
slice that lands this use case is the **graphical gesture** in
[#385](https://github.com/jonhanke-nam/PsyNeuView/issues/385), not new plumbing.

## 6. Where each control lives (summary map)

| Control | Home | Sub-issue |
| --- | --- | --- |
| Add/edit/remove a node's conditions | Node inspector **and** canvas selection | [#383](https://github.com/jonhanke-nam/PsyNeuView/issues/383), [#385](https://github.com/jonhanke-nam/PsyNeuView/issues/385) |
| Graph Structure Conditions | Canvas (GSC edges) + inspector | shipped |
| Scheduler mode | Scheduler tab | [#381](https://github.com/jonhanke-nam/PsyNeuView/issues/381) |
| Termination per TimeScale | Scheduler tab | [#382](https://github.com/jonhanke-nam/PsyNeuView/issues/382) |
| Consideration queue (read-only) | Scheduler tab + optional canvas overlay | [#386](https://github.com/jonhanke-nam/PsyNeuView/issues/386) |
| All-conditions roster | Scheduler tab | [#380](https://github.com/jonhanke-nam/PsyNeuView/issues/380) |
| Validation / explanations | Inline on each condition + Scheduler tab summary | [#388](https://github.com/jonhanke-nam/PsyNeuView/issues/388) |

## 7. Execution-time view

At rest, the Scheduler tab shows the *static* derived queue. During/after a run,
the trace stepper animates it ([#387](https://github.com/jonhanke-nam/PsyNeuView/issues/387)):
which nodes are **pending** vs **fired** at each scheduler step, grouped per pass,
ideally annotated with *why* a node fired ("EveryNCalls(A,2) satisfied"). This is
the payoff of the cause-next-to-effect principle — you watch your authored
conditions play out. Builds on the existing trace stepper and per-node execution
counts; relates to the stepwise-debugger umbrella
([#247](https://github.com/jonhanke-nam/PsyNeuView/issues/247)).

## 8. Open questions (for review)

1. **Tab vs. docked panel?** Is the composition-wide surface a top-level tab
   alongside Inspector/Run, or a docked panel that appears when nothing (or the
   composition background) is selected? The latter reuses today's "click
   background → see scheduler" affordance.
2. **One scheduler per composition, but models nest.** For nested compositions,
   does the Scheduler tab scope to the selected composition, or show a
   breadcrumbed hierarchy? (PsyNeuLink schedules are per-Composition.)
3. **GSC vs. basic conditions — one surface or two?** Graph Structure Conditions
   already render as edges and feel structural; basic/temporal conditions feel
   like node properties. Do we unify them in the roster or keep the visual split?
4. **How much PsyNeuLink vocabulary do we expose by name?** Do users see
   `EveryNCalls`, or only the plain-English "runs every 2nd time …"? Proposal:
   plain-English primary, formal name secondary/toggleable.
5. **Threshold/value conditions** pull in parameter + comparator semantics that
   overlap the inspector's parameter editing — worth scoping carefully in #384.
