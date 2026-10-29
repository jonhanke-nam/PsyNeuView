# Writing a guided walkthrough

How to add a walkthrough to the **Tutorials ▾** menu: the step list, the verbs a
step can use, how it's tested, and what earlier walkthroughs taught the hard
way. For what the walkthroughs *are*, from a learner's side, see
[Guided walkthroughs: the Cognitive Neuroscience Course](tutorials/16-course-walkthroughs.md).

Engine: #1181. Course: #1180. Orientation (captions, narration, the pointer,
the playback controls, the first-launch offer): #1310.

---

## One list, two runners

A walkthrough is a YAML file in `frontend/src/walkthroughs/`. Two things read
it:

- **the app** (`TourBar`, `TourOverlay`, `useTourProgress`) shows each step's
  instruction, rings its anchor, and moves on when its `done` condition holds;
- **the test driver** (`frontend/e2e/tourDriver.ts`) performs each step's `act`
  the way a learner would, then asserts the app said "✓ Done."

So a walkthrough can't drift from the app: if a step stops completing, its
test fails. The app never reads `act`, and the driver never decides
completion. `done` is the only judge, for both.

## The file

```yaml
id: perceptron                  # ?tour=perceptron; also the registry key
title: Perceptron — AND, and why not XOR
model: Logic Gate Network       # optional: the Open-menu label it runs against
course: "0.3"                   # optional: course lesson, "module.lesson"
orientation: 3                  # optional: its place in PsyNeuView First Steps
psyneulink: 1                   # optional: its place in PsyNeuLink Tutorials (one of the three)
minutes: 3                      # optional: about how long, shown in the menu
docs:                           # optional: the docs pages it relies on, under docs/
  - what-you-can-edit.md        #   (shown in the bar, so drift is caught in review)
developerMode: true             # optional: turn developer mode on while it runs,
                                #   and put it back after (the developer track only)

steps:
  - id: learn-and               # unique within the file
    anchor:                     # what the ring points at: one of
      testid: tab-learn         #   a data-testid anywhere in the app
      # node: out_layer         #   or a canvas node, by model name
    pointer: true               # optional: glide the pointer there before the words
    instruct: >-                # what the learner reads
      Teach it AND. …
    say: >-                     # optional: the caption — one short spoken line,
      Now teach it AND.         #   always shown; read aloud when narration is on
    done:                       # when the step is finished (exactly one verb)
      lastTraining: { targets: { out_layer: [0, 0, 0, 1] }, epochsAtLeast: 50 }
    act:                        # what the test driver does (the app ignores it)
      train: { inputs: { … }, targets: { … }, epochs: 50 }
```

- `course:` must look like `"0.3"`, and quoting it keeps YAML from reading it as
  a number. Course walkthroughs appear under **Cognitive Neuroscience Course**
  in lesson order; `orientation:` walkthroughs under **PsyNeuView First
  Steps** in part order, first; `psyneulink:` walkthroughs under **PsyNeuLink
  Tutorials** in lesson order, between Getting started and the course (#9;
  the lesson list is in [the PsyNeuLink Tutorials page](tutorials/17-psyneulink-tutorials.md));
  the rest under **Getting started**. A walkthrough belongs to one section. The
  course's section can be left out of the menu from Settings ▸ Tutorials and
  Voice ▸ Tutorials ▸ **Hide the Cognitive Neuroscience Course** (off by
  default, #136); `?tour=<id>` still opens a course walkthrough then.
- `say:` is the caption: **the one sentence you'd say aloud**. The
  instruction is **what you'd point at**, with the exact control names. Every
  step has a caption (a unit test fails otherwise), with no code names, and
  any label it quotes is named in the instruction too (`narrationCaptions.test.ts`, #87).
- `pointer: true` is for a step whose point is "look here": the pointer glides
  from where it last was to the anchor (700 ms), and only then does the bar
  show the instruction. The ring is drawn at once either way. Replay sends it
  again.
- Quote node names that contain brackets: `node: "1 [QUERY]"`.
- Then **register** the walkthrough in `frontend/src/utils/tourStep.ts`: add an
  `import …Yaml from "@/walkthroughs/<id>.yaml?raw"` and an entry in
  `WALKTHROUGHS`. A malformed file fails at app startup, on purpose.

## `done` — when a step is finished

An empty or unrecognised condition is **never** satisfied: a typo sticks rather
than auto-advancing. Node names match exactly, or with a session suffix
(`color_hidden-7`), never as a prefix.

| Verb | Finished once… |
| --- | --- |
| `selectedNode: <name>` | that node is the selection. A projection's name works too: clicking its arrow selects it |
| `nodeExists: <name>` | a node of that name exists, e.g. it was just added |
| `trialsAtLeast: <n>` | the latest run produced at least *n* trials |
| `runsAtLeast: <n>` | the model has run *n* times this session. Use this for "run it again": a second run has the same trial count as the first |
| `paramEquals: { node, param, value }` | the Inspector shows that value. Mechanism and function parameters both count, and so do a projection's (`node` is then its name); numbers compare numerically, and so do matrices written as JSON |
| `functionIs: { node, type }` | the node's function class is `type`, e.g. `Logistic` |
| `lastRunInputs: { <node>: [trials…] }` | the **latest finished run** used exactly these per-trial inputs. One-unit nodes can be plain numbers, `[2, 0, 0]` |
| `lastTraining: { targets?, inputs?, epochsAtLeast? }` | the **latest finished training** used exactly these targets and/or inputs (at least one named), for at least that many epochs. A model that learns without targets (Hebbian) is checked on its inputs |
| `visible: <testid>` | an element with that `data-testid` is on screen: a panel opened, a tab switched to, a tag that appeared. Checked a few times a second while the step is current |
| `hidden: <testid>` | no element with that `data-testid` is on screen: Settings closed, a tag gone |
| `next: true` | the learner pressed **Next** in the bar. For a step that only explains; the bar shows the button only for such a step. Use sparingly — a step that can turn on an action should |
| `traceStepAtLeast: <n>` | the trace bar is on at least step *n* (0-based) |
| `fileNamed: <name.py>` | the open model's file has that name, wherever it is: a new model was started, or a particular file opened |
| `inputShape: { node, shape }` | the node's one input port has that shape, `[2]` for two units, as the model has been parsed. A mechanism with several input ports isn't judged (the Inspector doesn't edit those shapes yet) |
| `projectionExists: { sender, receiver }` | a projection runs from `sender` to `receiver`, by node name: the learner joined them on the canvas, or wrote it into the code |

`lastRunInputs` and `lastTraining` judge a **finished** run or training, not
the form: typing the values isn't enough, and the learner has to run them.
They're also why two steps can't ask for the same inputs twice in a row. The
second would already be satisfied, so vary them (Dynamics kicks the pair, then
feeds it inputs that stay different).

## `act` — what the test driver does

| Verb | The driver… |
| --- | --- |
| `openModel: <label>` | opens **Open ▾** and clicks the button with exactly that label |
| `newModel: <name>` | **Open ▾ → + New Model…**, names it |
| `addFromPalette: <Type>` | searches the Components palette and clicks that type |
| `selectNode: <name>` | clicks the node on the canvas, or the projection's arrow when no node has that name |
| `setParameter: { node, param, value }` | selects the node (or projection) and types into its Inspector row (`param-<name>`); for a projection, the row under **Projection Parameters**, the one that edits the code |
| `setFunction: { node, type }` | selects the node and picks the class in the Inspector's **Change function class** dropdown |
| `setInputShape: { node, shape }` | selects the node and types the shape into the Inspector's **Inputs** row (`port-shape-<port>`), which rewrites `input_shapes=` in the code |
| `connect: { sender, receiver }` | fits the graph, opens the Components palette if it is closed, drags **MappingProjection** onto the receiver and clicks the sender (#311), which writes a new `MappingProjection` into the code. The app's default floating ports hide the port dots, so this, not a port-to-port drag, is the gesture a learner has |
| `renameNode: { node, name }` | selects the node, double-clicks its name in the Inspector's header, types the new one and presses Enter. That changes the node's `name=`, not the Python variable that holds it |
| `runModel: true` | clicks **Run Model** and waits for the results |
| `setTrialInputs: { <node>: [trials…] }` | fills each node's Run-panel **Paste CSV** box. Combine with `runModel: true` in the same step |
| `train: { inputs, targets?, epochs }` | sets the Learn tab's trial count, fills every cell, sets epochs, starts learning, and waits for the step's own `done`. Leave `targets` out for a model with none |
| `pickSet: { tab: run \| learn, name }` | chooses a set the model declares from that tab's **From** menu. For `learn` it then starts learning and waits for the step's own `done`; for `run`, add `runModel: true` |
| `click: <testid>` | clicks the element with that `data-testid` |
| `next: true` | presses the bar's **Next** |
| `pressKey: <key>` | presses a key, by Playwright's name (`Escape`) |
| `undo: true` / `redo: true` | clicks the toolbar's Undo / Redo |
| `replaceInCode: { find, replace }` | selects the first `find` in the editor and types `replace` over it, as a learner editing the code would. The walkthrough names only the fragment, not the file. Add `pickSet` / `runModel` to run the edited model; the driver waits for the edit to reach the app first |

An unknown or missing `act` throws, so the walkthrough fails loudly rather than
timing out. A new verb means adding it to **both** runners: the `TourCondition`
or `TourAction` type and `isDone` in `tourStep.ts`, the driver's types and
`act()` in `tourDriver.ts`, and unit tests in `tourStep.test.ts`.

## Captions, narration and the controls (#1310)

The bar shows, for every step, the instruction and (when the step has one)
its `say:` caption. **Narration** reads the caption with the browser's own
speech (`speechSynthesis`); it is off by default, remembered per browser
(`psyneuview.tour.narration`), and the toggle is disabled where the browser
has no speech. The voice and speaking rate are in Settings ▸ Tutorials and
Voice ▸ Voice (`psyneuview.tour.narrationVoice`, `psyneuview.tour.narrationRate`):
Automatic picks the best English voice installed (Premium/Enhanced first, then
Karen, Daniel, …, never the novelty voices; `pickVoice` in
`utils/narration.ts`), reading at 0.95. Never required: the caption is always on screen.

**What narration reads, and how the bar shows it (#86).** Narration reads only
the caption, never the instruction. Captions run about 11 words (a few
seconds), instructions about 33 (up to 81), too long to hear on every step.
With narration on, the caption leads the bar in italics after a bold
"Narration" heading, with the voice in small type ("Narration (Karen):"); a click
on it opens Settings ▸ Tutorials and Voice, the one place the voice is chosen (#93),
lit while the voice is reading it, and the instruction sits under it as a
smaller details line. With narration off, the instruction leads and the
caption follows in italics. `e2e/narration-matches-bar.spec.ts` checks the
voice gets the visible caption, that it leads and is lit while spoken, and
the voice's timing with Pause, Replay, Next and End.

**Pronunciation (#1407).** Voices spell out capitals ("E-G-O") and stumble
over joined names. `src/walkthroughs/pronunciations.yaml` says how to say
them: a `say:` respelling for every voice (EGO → Ego), and optional eSpeak
`phonemes:` with stress marks, used only when recording. It changes only what
is spoken; the caption on screen keeps the real word. A unit test
(`utils/pronunciation.test.ts`) fails on any capitalised or joined-up word in
a caption that has no entry, so add one, or list the word under `reads_fine`
if voices already say it right. For one-off emphasis in a recording, give the
step a `say_phonemes:`: the same words as `say:`, with phonemes in `[[ ]]`
where the stress is wrong, e.g. `where the model has [[ bˈɪn ]]`. **Pause** stops
the walkthrough moving on by itself (a step finished while paused waits for
Resume) and pauses the voice; **Replay** sends the pointer again and re-reads
the caption; **Skip** moves on without the step being done. The bar and the
ring are drawn above Settings and the other dialogs, so a walkthrough about
Settings keeps its controls while Settings is open, and the Open menu stays
open while the bar's buttons are used.

A walkthrough with `developerMode: true` turns developer mode on when it
starts and puts it back as it was when it ends, finished or not.

### The first-launch offer

The first time PsyNeuView opens in a browser it offers **PsyNeuView First
Steps** (the parts with `orientation:`), a moment after the page is up
and never over a `?tour=` link. The answer is remembered per browser
(`psyneuview.orientation.offer`: `started`, `later` or `never`); "Maybe later"
leaves a reminder in the Tutorials menu until a part is started or the
reminder is dismissed. The e2e fixture (`test-base.ts`) answers the offer for
every spec; a spec about it removes the key in its own `addInitScript`.

## Testing it

The orientation parts are driven by
`frontend/e2e/tutorials/orientation.tutorial.spec.ts`, one test per part, and
their front door by `orientation-controls.tutorial.spec.ts`. For a course or
general walkthrough, add a `test.describe` to
`frontend/e2e/tutorials/tour-demo.tutorial.spec.ts`; a PsyNeuLink Tutorials
lesson gets its own spec, `frontend/e2e/tutorials/pnl-<lesson>.tutorial.spec.ts`:
load it with `loadWalkthrough("<id>")`, `page.goto("/?tour=<id>")`, and
`runWalkthrough(page, w, onStep)`, where `onStep` captures
`docs/tutorials/assets/tour/<id>-step-N.png`. A screenshot is taken **before**
its step's action, so step N's picture shows the result of step N−1.

The spec uses `mutatingTest`, which resets the working dir before each
walkthrough. Keep it that way. With `readOnlyTest`, one walkthrough's edits leak
into the next (logged in `docs/ci/catches.md`).

Where the lesson is a number, **assert the number**, not just that the steps
ran. The Perceptron test captures each training's final loss (AND < 0.01, XOR
> 0.2); the Logistic test checks the final output is 1.

Before opening a PR into `feature/tutorials`:

```bash
cd frontend && npm run build && npx playwright test e2e/tutorials
```

CI runs the tutorials suite on PRs into `feature/tutorials` only when they
touch walkthrough files ([Testing](testing.md)).

## Reviewing them: the review book (#1414)

Clicking through every walkthrough is slow and misses things. The review book
puts every step on one page: its screenshot, the instruction on the bar, the
caption, the words the narrator actually speaks (respellings marked), a player
to hear them, what the ring points at, and warnings (no caption, long
narration, no screenshot, no anchor, words the pronunciation dictionary hasn't
decided).

```bash
# Screenshots come from the tutorial specs. Course walkthroughs' are committed
# (docs/tutorials/assets/tour/); run the orientation spec first for its parts.
cd frontend && npm run build && npx playwright test e2e/tutorials/orientation.tutorial.spec.ts
cd .. && python3 scripts/tutorial-review-book.py --out /tmp/review-book
python3 scripts/tutorial-review-book.py --out /tmp/review-book --only ego,td   # some walkthroughs
python3 scripts/tutorial-review-book.py --out /tmp/review-book --no-audio      # no players
python3 scripts/tutorial-review-book.py --out /tmp/review-book --voice Daniel  # another voice
```

**Audio.** The app reads captions live in the computer's voice, so on macOS
the book renders a preview of each step with `say`, in the voice the app picks
by default (Karen, else Daniel) at the narration rate, with the dictionary's
respellings applied. The previews are written only to the output folder,
never committed. If the repo ever carries recorded narration
(`narration-manifest.json`), the book plays those recordings instead and also
flags stale or missing ones.

It writes `index.html` with `shots/` (JPEG, shrunk with `sips` on macOS) and
`audio/` (AAC `.mp4`, which an Artifact serves; it won't serve `.m4a`) beside
it. Each step card's id is `<walkthrough>--<step>`, so a review comment can
name the step; fixes go into the walkthrough's YAML, and the book is rebuilt.
A whole book is about 390 files: publish it as an Artifact in two batches (the
page and `shots/`, then `audio/`), since one publish takes at most 255.

## Lessons from the course walkthroughs

- **Measure every number an instruction quotes, in the app.** Two course
  notebooks were wrong for PsyNeuLink 0.19: the Logistic exercise's `bias`
  answer gives 1.38, not 1, and the Episodic Memory notebook's STORE and MATCH
  nodes don't exist. Name what the app draws, and cite PsyNeuLink's own
  docstrings for what a node does.
- **Build small models, open large ones.** The New Model starter
  (`input_node → output_node`), a palette node or two, and a projection or
  two joined with `connect` (the palette's MappingProjection dropped on the
  receiver, then a click on the sender) are buildable: the mini Stroop lesson
  adds a third node and joins it that way. Anything with a loop or many
  projections is a demo to open.
- **Let the demo carry its data.** A module-level dict in the shape
  `Composition.run` or `AutodiffComposition.learn` takes is offered in the Run
  or Learn tab's **From** menu, and the first opens preloaded. So a step says
  "pick `xor_gate`" (`pickSet`) instead of making the learner type a table. Keep
  `setTrialInputs` and `train` for when typing the values *is* the lesson.
- **A demo gets a backend test that pins its lesson.** It goes in
  `backend/demos/` (the label comes from the filename), and the test pins the
  numbers or node names the walkthrough relies on, so a PsyNeuLink bump fails
  there, with the names. Seed any random weights. `/demos/reset`'s working
  copy goes in `PSYNEWVIEW_WORKING_DIR`, which the backend tests' conftest
  points at a temp folder for every test, so it never lands in `backend/` or
  in the developer's real `~/.psyneuview/working-copies` (#1134, #1319).
- **Mind load time.** The app gives a model load 30 seconds, and CI runners
  are 1.5–3× slower than a laptop. The notebook's `EMComposition(memory_capacity=1000)`
  took 9s locally and more than 30s in CI, so the demo uses capacity 100.
- **Check the Learn tab's defaults.** Its learning rate field is empty, meaning
  the model's own rate. Until #1220 it started at 0.05 and silently overrode
  every model.
- **Anchors must be on screen.** The ring is only drawn for a visible node. A
  layout that pushes the node off-screen (a leftover custom layout, a crowded
  graph) fails the step.
- **Instructions may name the model.** `openModel` clicks the menu *button*
  with that exact label. It used to match any text, so an instruction reading
  "Open the Bistable Attractor demo" matched itself.
- **A set over 100 trials isn't preloaded.** The Run tab fills in a model's
  first declared set only up to `MAX_PRELOAD_TRIALS`; a longer one is in the
  From menu but has to be picked (`pickSet`). The Conflict Monitoring sets are
  150 trials, so that walkthrough picks them.
- **Trained weights don't survive into a run.** Each run and each training
  re-executes the model file, so a run after training uses the file's starting
  weights. A walkthrough that wants to show what a network learned reads the
  training's last pass (the job's `results`) in its test, and says so in its
  instruction, as the semantic-network one does.
- **Mind the Learn tab's per-epoch cost.** It trains one epoch at a time to
  stream progress, so a training's time is about epochs × a fixed overhead
  (about 0.16 s per epoch for the 24-trial semantic network, 16 s for 100
  epochs locally). Fewer epochs at a higher learning rate are cheaper than the
  notebook's many short ones.
- **A library model's defaults may not be its experiment.** The PsyNeuLink
  Library's EGO file builds its model with a two-episode memory unless told
  otherwise; its experiment passes `memory_capacity=len(states)`. Opened as it
  is, a run predicted nothing. Run the library model in the app before deciding
  to open it rather than a demo, and say in the walkthrough's header why a demo
  was needed.
- **Keep a nested composition out of module scope.** The app opens the first
  top-level composition it finds. With EGO's `EMComposition` assigned to a
  module-level name, it opened EM instead of EGO. Building the model inside a
  function (as the library does) and assigning only the outer composition fixes
  it.
- **Wide inputs make small training sets.** The Learn tab draws one box per
  number. A semantic-network episode is 51 numbers; an ISC-CI episode is 204
  (three 64-number embeddings and 12 targets), so its demo declares 24 episodes,
  not the notebook's 20,000. When a lesson needs more data than that, the
  walkthrough says so rather than pretending.
- **Say what the app can't do, in the walkthrough.** EGO and ISC-CI end with a
  step that names what the notebook does in Python (making the data, long
  experiments, plots, running a trained network) and the app doesn't, so a
  learner coming from the notebook isn't left looking for it.
- **A total can hide the lesson.** The Learn tab charts one number per epoch.
  TD's lesson is *where* in the trial the error is, and with the notebook's
  mid-trial cue the total doesn't fall at all. The TD walkthrough trains twice
  (cue from the start, then a late cue) so the chart's two shapes carry the
  lesson, and a backend test pins the per-timestep claims the instructions
  make.
- **Check a demo teaches its lesson before writing steps.** The Hebbian demo
  first used Logistic units, which sit at 0.5 with no input, so every feature
  ended wired to every other: the chart fell nicely and there was nothing to
  learn. Read the learned weights, not just the metric.
- **A numpy-only notebook can still be a PsyNeuLink lesson.** Modules 0.1 and
  1.2 have no PsyNeuLink model; their walkthroughs build the smallest model
  that does the notebook's arithmetic (a projection's matrix; a recurrent
  layer) and say in their last step what stays in the notebook. Two things
  made the Hopfield demo work. Each trial is one update: the cue goes in on the
  first, zeros after, and the recurrent projection carries each output into
  the next trial, so the Run tab's trials are the notebook's loop. And a
  recurrent layer's first trial adds in its *starting* output, which is its
  function at 0: a Logistic with a bias starts every unit at +1, not 0, and
  the cue came back wrong. A steep `Tanh` would be the obvious step function,
  but PsyNeuLink's overflows to NaN on large negative inputs at that gain; a
  Logistic with scale 2 and offset −1 is the same curve and doesn't.
- **An Inspector edit of a list goes to the backend.** The Inspector rewrites
  the code at once, before the backend answers; that rewrite stopped at the
  first comma, so editing a projection's matrix broke the file (#45). List,
  tuple and dict values now skip it. A walkthrough that edits a matrix types
  it as the Inspector shows it, `[[10,4],[2,5],[3,6]]`.
- **An input node can be the answer.** The Run tab hides an input node's
  logged value as a repeat of its input. A Hopfield layer is both input and
  output, and its result was hidden; now the row is hidden only when it
  really repeats the input (#49).
- **Edit code through the editor's own text.** `replaceInCode` used to retype
  the whole file from the editor's rendered text, which CodeMirror draws only
  near the view and which gives a blank line twice: on the Hopfield demo it
  doubled every blank line. It now selects the fragment and types over it.
- **Header comments carry the provenance.** Each course walkthrough's YAML
  header links the source notebook and the course landing page and names the
  PsyNeuLink it was validated against; the course page repeats them.
