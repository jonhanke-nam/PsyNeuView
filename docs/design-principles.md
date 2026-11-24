# Design principles

Three rules the owner has set for everything PsyNeuView and the Mac app show or
do. They apply to the code, the backend and the Mac app alike, and reviewers
(people and CodeRabbit) check new work against them.

## 1. What's displayed must be accurate

What the app shows matches the model as it is now. A person should never have
to wonder whether what they are looking at still applies.

- **Derived views carry the version they came from.** Run results, per-trial
  values, stepping traces, graph highlights, previews and anything else
  computed from the model are tagged with the model version that produced
  them (for run results: a hash of the source that ran, plus the composition
  name).
- **Stale is flagged or cleared, never shown as current.** When the model
  changes, a derived view either says plainly that it describes an earlier
  version (and offers to bring it up to date), or is cleared. Highlights that
  would point at nodes or values that may have changed are turned off.
- **Going back makes it current again.** If Undo returns the model to the exact
  version a result came from, the result is current again, because the
  versions match.
- **Changes that don't touch the model don't make things stale.** Moving nodes,
  folding or expanding a composition, and other layout-only changes leave the
  source alone.

The first application is run results going stale after an edit
([#337](https://github.com/jonhanke-nam/PsyNeuView/issues/337)).

**Checking a change:** if it adds or changes a view computed from the model,
where is the version stored, and what does the view do when the model moves on?

## 2. Automatic behaviour only by consent

Anything that changes the person's app or data without them asking for it at
that moment happens only after they have agreed to it.

- **Off by default.** Automatic installs, automatic rewrites of files, moving
  folders, changing settings on the person's behalf: none of it is on until
  they turn it on.
- **A quick opt-in.** Turning it on is one clear choice, offered where it is
  relevant (a setting in the one Settings surface, or a one-time offer), never
  buried. An existing user's saved choice is never switched silently.
- **It always says what changed and why.** When automatic behaviour acts, the
  app tells the person what it did and why, in plain English, and how to turn
  it off.

The first application is the Mac app's "Install updates automatically"
setting, which is off until the person opts in
([PsyNeuView-MacApp#79](https://github.com/jonhanke-nam/PsyNeuView-MacApp/issues/79)).

**Checking a change:** if the app does something on its own, is it off by
default, how does a person turn it on, and what does the app say when it acts?

## 3. Nothing on the graph is hidden or confusing

Everything on the graph is visible in two dimensions. A person should never
misread what connects to what because one thing sits on top of another.

- **Arrows never substantively overlap.** Arrows between the same two nodes,
  in either direction, and arrows that share an end attach at distinct points
  on each node and stay apart for most of their length. A brief crossing is
  fine; running on top of each other is not.
- **Arrows never pass behind or through nodes they don't connect to.** An
  arrow routes around any node in its way.
- **Nodes never overlap.** This holds in every layout, Custom included, after
  moves, additions and expanded compositions.
- **Labels stay readable.** Arrow labels and port names don't sit on top of
  each other or on top of nodes.

Where the Like show_graph layout follows show_graph's own course for an arrow
and that course already keeps it apart, the course is kept: show_graph is the
reference.

The first application is a second arrow dragged between two nodes that are
already connected, which was drawn exactly on top of the first
([#388](https://github.com/jonhanke-nam/PsyNeuView/issues/388)). The wider
work, a "nothing hidden" check across every reference model and view, is
[#389](https://github.com/jonhanke-nam/PsyNeuView/issues/389).

**Checking a change:** if it draws or moves anything on the graph, can any
arrow, node or label end up on top of another, or an arrow behind a node?

## Related

- [Settings, and the Mac app as a thin wrapper](settings-and-mac-app.md): one
  Settings surface, one control per setting. Opt-in switches live there.
- [UI interaction conventions](ui-interaction-conventions.md): how controls
  advertise what they do.
