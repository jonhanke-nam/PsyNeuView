# Guided walkthroughs: the PsyNeuLink Tutorials

Step-by-step walkthroughs that run **inside the app** and follow PsyNeuLink's
own introductory material: its *Tutorial* notebook and its *Basics and
Primer*. They are the **PsyNeuLink Tutorials** section of the **Tutorials ▾**
menu, between PsyNeuView First Steps / Getting started and the Cognitive
Neuroscience Course. As with the course walkthroughs, a step moves on only
once you have done it.

> **What you need:** nothing beyond a working build. Each lesson starts a new
> model or opens a bundled demo.
>
> **Tracking:** #9 (this section), #8 (the foldable menu it depends on),
> #1181 (the walkthrough engine).

![The Tutorials menu with the PsyNeuLink Tutorials section](assets/tour/pnl-menu.png)

---

## The lessons, in order

The source material, in PsyNeuLink's repository:

- the Tutorial notebook, [`tutorial/PsyNeuLink Tutorial.ipynb`](https://github.com/PrincetonUniversity/PsyNeuLink/blob/master/tutorial/PsyNeuLink%20Tutorial.ipynb)
  (also linked from the docs as *Tutorial*);
- the [Basics and Primer](https://princetonuniversity.github.io/PsyNeuLink/BasicsAndPrimer.html)
  (`docs/source/BasicsAndPrimer.rst`), with its example scripts under
  `Scripts/Examples/Basics And Primer/` and `Scripts/Examples/Tutorial/`.

The notebook first, section by section, then the Primer's sections. The
numbers are the `psyneulink:` lesson numbers in the walkthrough files; the
rows with a `?tour=` are built.

| # | Lesson | Source | `?tour=` | What you do |
| --- | --- | --- | --- | --- |
| 1 | Creating a mechanism — Linear and Logistic | Tutorial: *Creating a mechanism*, *Logistic Function* | `pnl-mechanism` | **Build** from New Model, **run** the notebook's inputs, **edit** slope and intercept, switch the function to Logistic |
| 2 | From nodes to graphs — a composition | Tutorial: *From Nodes to Graphs: Compositions* | `pnl-composition` | **Build** from New Model, select the projection, **run** 4 and a five-trial sweep, give both nodes **two units**, make it Logistic, run x and 3x, and the step mechanism |
| 3 | Adding projections — the mapping matrix | Tutorial: *Adding Projections* | `pnl-projections` | **Build** from New Model: a Linear unit (slope 2, intercept 2) into a Logistic one; click the arrow for the **identity matrix**; **run** the sweep; write **0.5** into the matrix (the explicit `MappingProjection`) and run again |
| 4 | The mini Stroop model | Tutorial: *Compositions*, *Mini-Stroop Model* | `pnl-mini-stroop` | **Build** from New Model: add a third node from the palette and **name** it words; give all three **two units**; make the response Logistic and words' slope 1.5; **join** words to the response with a MappingProjection from the palette; **run** a congruent and an incongruent trial |
| 5 | The pre-trained Stroop model | Tutorial: *Pre-trained Complete Stroop Model* | | The Cohen et al. (1990) network with its weights written in; task demand; the eight input combinations |
| 6 | Constructing compositions | Tutorial: *Constructing Compositions* | | Lines of two and three layers, a recurrent pathway, several hidden layers, and what each graph looks like |
| 7 | Simple configurations | Primer: *Simple Configurations* | | A 5-2-5 feedforward network from a pathway; the projections PsyNeuLink adds for you |
| 8 | More elaborate configurations | Primer: *More Elaborate Configurations* | | The Stroop model with two pathways and a decision mechanism |
| 9 | Dynamics of execution | Primer: *Dynamics of Execution* | | The scheduler, conditions, and time scales |
| 10 | Control | Primer: *Control* | | A `ControlMechanism` and what it modulates |
| 11 | Parameters | Primer: *Parameters* (accessing, setting, function and modulable parameters) | | Reading and changing parameters, in the Inspector and in code |
| 12 | Displaying and logging values | Primer: *Displaying and Logging Values* | | Reports and logs, and the app's run results and trace |
| 13 | Learning | Primer: *Learning*, *LearningMechanisms* | | A learning pathway and backpropagation |
| 14 | Customization | Primer: *Customization* | | A user-defined function |

Lessons 5–14 are listed so the order is settled; they are not built yet. The
notebook's own ending, *Constructing Compositions*, says "more content is
being added weekly", so the list may grow with it.

---

### 1. Creating a mechanism — Linear and Logistic

Notebook cells 6–17. Validated against PsyNeuLink 0.20.2.0.

The notebook makes one `TransferMechanism` with `Linear(slope=1, intercept=0)`
and executes it on its own. The app always runs a composition, so the
walkthrough starts a **new model**, `first_mechanism`, whose starter has
`input_node` feeding `output_node`: `input_node` passes the number through
unchanged, and `output_node` plays the notebook's mechanism. Select
`output_node`: a TransferMechanism takes an input, applies its function, and
passes the result on; the Inspector shows Linear, slope 1, intercept 0, the
notebook's y = ax + b.

Then the notebook's executions, each in the **Run** tab: an input of **2**
gives **2**. Set slope to **3** in the Inspector (the code changes to match)
and run **4**: **12**. The second exercise, slope **4** and intercept **5**
with an input of **3**: **17**, since 4 × 3 + 5. Last, change the function
from Linear to **Logistic**, an S-shaped curve between 0 and 1, and run the
notebook's **−2**: about **0.119**, low on the curve's left tail. The
tutorial spec asserts all four outputs.

![Running the notebook's first input](assets/tour/pnl-mechanism-step-4.png)

**What stays in the notebook.** `.execute()` on a lone mechanism, with no
composition; `.plot()` of the curve, which the app does not draw, so you read
one point at a time; and the notebook's gain and offset examples
(`Logistic(gain=5, offset=10)`, and gain −5), which were written for an older
Logistic. PsyNeuLink now adds `offset` to the output
(`scale / (1 + e^(−gain · (x + bias − x_0))) + offset`), so that setting gives
10.00005 for an input of −2, not a step at −2; the horizontal shift the
notebook means is `x_0` today, and a steep gain makes the step. The
walkthrough's last step says so, as the course's Logistic walkthrough does
for the same drift.

---

### 2. From nodes to graphs — a composition

Notebook cells 18–27. Validated against PsyNeuLink 0.20.2.0.

The notebook puts its mechanism in a `Composition` with
`add_linear_processing_pathway`, draws it with `show_graph`, and runs the
composition. Here a model is always a composition, so the walkthrough starts a
**new model**, `first_composition`, and points at what the starter already
is: `input_node`, `output_node`, and the projection `input_to_output` between
them. Click the arrow: the Inspector shows the projection, and in the code
the pathway is `add_node` twice and `add_projection` once; the canvas is the
notebook's `show_graph`, redrawn on every edit.

Then the notebook's runs, in the **Run** tab. An input of **4** gives **4**:
two Linear nodes pass it straight through. The notebook's 51-point sweep
from −3 to 3 becomes one run of five trials, **−3, −1.5, 0, 1.5, 3**, whose
outputs equal their inputs, five points of the straight line it plots. Next
the notebook's two-unit mechanism, `default_variable=[0, 0]`: in the
Inspector's **Inputs** row, set `input_node`'s shape to **[2]**, then
`output_node`'s. The code changes to `input_shapes=[2]`, today's name for
that size, and the projection between them resizes to a 2 × 2 identity
matrix. Change `output_node`'s function to **Logistic** and run two trials,
**[−1, −3]** and **[1, 3]**: **0.269, 0.047** and **0.731, 0.953**, each unit
its own point on the curve, the second unit's the steeper of the notebook's
two plotted curves. Last, the notebook's step mechanism: set **gain** to
**100** and the midpoint **x_0** to **1**, and run **[0.9, 1.1]**:
**0.00005** and **0.99995**, which the results table rounds to 0 and 1, just
below the step and just above it. The tutorial spec asserts all four runs.

![The two-unit model after the sweep, with input_node's shape set to [2]](assets/tour/pnl-composition-step-6.png)

**What stays in the notebook.** `show_graph()`, which the canvas does all
the time; `reportOutputPref`, whose printout is the Run tab's results table;
the 51-point loops and their plots, which here are trials in one run with no
curve drawn; and `default_variable` as the input used when none is given,
which has no counterpart because the Run tab always sends inputs. The step
mechanism's `Logistic(gain=100, offset=100)` was written for the older
Logistic that added `offset` inside the exponent; PsyNeuLink now adds it to
the output, so the step at an input of 1 is `x_0=1` today, as the walkthrough
sets it.

---

### 3. Adding projections — the mapping matrix

Notebook cells 28–33. Validated against PsyNeuLink 0.20.2.0.

The notebook joins a `Linear(slope=2, intercept=2)` unit to a `Logistic()`
one, first with the `IDENTITY_MATRIX` keyword in the pathway list and then
with an explicit `MappingProjection(sender=…, receiver=…, matrix=[[1]])`, and
sweeps each from −3 to 3: a projection takes one mechanism's output,
multiplies it by its matrix, and delivers the result to the next. The
walkthrough starts a **new model**, `adding_projections`, and makes the
starter's two nodes the notebook's units: set `input_node`'s **slope** to
**2** and **intercept** to **2**, and change `output_node`'s function to
**Logistic**. Click the arrow: under **Projection Parameters** the matrix is
**[[1]]**, the 1 × 1 identity the keyword means, and in the code the
projection is already the notebook's explicit form, a `MappingProjection`
with its sender and receiver; the identity is its default, so no matrix is
written.

Then the sweep, in the **Run** tab: five trials, **−3, −1.5, 0, 1.5, 3**,
give **0.018, 0.269, 0.881, 0.993, 1.000**, the Logistic curve with its
midpoint at −1 (where 2x + 2 = 0) and twice as steep. The notebook keeps the
matrix at 1, so its two compositions draw the same curve; to see the matrix
do something, the walkthrough writes **[[0.5]]** into the matrix row, which
puts `matrix=[[0.5]]` into the code (the notebook's explicit matrix), and
runs the same five trials again: **0.119, 0.378, 0.731, 0.924, 0.982**, the
midpoint still at −1 and the curve half as steep. The tutorial spec asserts
both runs and that `matrix=[[0.5]]` reached the source.

![The projection selected: under Projection Parameters its matrix is [[1]], the identity](assets/tour/pnl-projections-step-6.png)

**What stays in the notebook.** The `IDENTITY_MATRIX` keyword inside a
pathway list, which makes the projection for you; here the projection is
always written out, the notebook's explicit way, with the identity as its
default. `show_graph()` is the canvas; the 51-point sweeps are five trials
with no curve drawn; and the notebook's names for its units, `linear` and
`logistic`, stay there, since the walkthrough does not rename the starter's
nodes.

---

### 4. The mini Stroop model

Notebook cells 34–38. Validated against PsyNeuLink 0.20.2.0.

The notebook's first composition that is not a line: two input mechanisms,
`Colors` (Linear) and `Words` (Linear, slope 1.5), converge on a `Response`
mechanism (Logistic), each with two units (`default_variable=[0, 0]`), one
for red and one for blue, joined by two `add_linear_processing_pathway`
calls. It models the Stroop task, where naming a word's ink colour is slowed
when the word names a different colour. The walkthrough starts a **new
model**, `mini_stroop`, whose starter is already one of the two pathways:
`input_node` plays Colors and `output_node` plays Response. It adds a
**TransferMechanism** from the Components palette and **renames** it `words`
(double-click the name in the Inspector's header); gives `words`,
`input_node` and `output_node` an input shape of **[2]**; makes
`output_node` **Logistic** and sets `words`' **slope** to **1.5**; then
joins `words` to `output_node`: drag **MappingProjection** from the palette
onto `output_node` and click `words`, its sender. A second arrow appears,
and the code gains a `MappingProjection` with the 2 × 2 identity as its
matrix, so the word "red" feeds the red response.

Then the notebook's two trials, in the **Run** tab. Congruent, blue ink and
the word "blue" (`input_node` **[0, 1]**, `words` **[0, 1]**): **0.5** and
**0.924**. The red unit gets nothing and sits at the Logistic's midpoint; the
blue unit gets 1 from the ink and 1.5 from the word. Incongruent, red ink and
the word "blue" (`input_node` **[1, 0]**): **0.731** and **0.818**. The ink
pushes toward red, the word pushes harder toward blue, and the two responses
are close: the conflict that slows naming the ink. The tutorial spec asserts
both trials and that the drag wrote a second `MappingProjection` into
`output_node`.

![Both inputs joined to output_node, before the congruent trial](assets/tour/pnl-mini-stroop-step-10.png)

**What stays in the notebook.** `add_linear_processing_pathway`, which makes
each projection for you; here every projection is written out as a
`MappingProjection`. `show_graph()` is the canvas. The names `Colors` and
`Response` stay there, since `input_node` and `output_node` play them; and
renaming in the Inspector changes a node's `name=`, not the Python variable
that holds it, so the code still calls the word unit
`New_TransferMechanism_1`. The pre-trained Stroop model that follows in the
notebook is lesson 5.

---

## What you can expect

- [x] **Tutorials ▾** has a **PsyNeuLink Tutorials** section, folded on first
      run like the course, between Getting started and the course.
- [x] Lesson 1 is a walkthrough built the same way as the course's: its step
      list drives `frontend/e2e/tutorials/pnl-mechanism.tutorial.spec.ts`,
      which captures the screenshots on this page and asserts the outputs the
      steps quote (2, 12, 17, 0.119).
- [x] Lesson 2 is built the same way (`pnl-composition.tutorial.spec.ts`):
      it gives both nodes two units through the Inspector's Inputs row and
      asserts the four runs (4; the sweep; 0.269/0.047 and 0.731/0.953; the
      step's 0.00005/0.99995).
- [x] Lesson 3 is built the same way (`pnl-projections.tutorial.spec.ts`):
      it edits a projection's matrix under Projection Parameters and asserts
      both sweeps (0.018 … 1.000 through the identity; 0.119 … 0.982 through
      0.5) and the `matrix=[[0.5]]` written into the code.
- [x] Lesson 4 is built the same way (`pnl-mini-stroop.tutorial.spec.ts`):
      it adds and renames a node, joins it with a MappingProjection from the
      palette, and asserts both trials (congruent 0.5/0.924, incongruent
      0.731/0.818).
- [x] Every step has a caption for narration.
- [ ] **Not yet:** lessons 5–14. Each will be added in order, as a walkthrough
      with a bundled demo where the model is too big to build by hand.

## Further reading

- [Guided walkthroughs: the Cognitive Neuroscience Course](16-course-walkthroughs.md),
  the other lesson section; its Logistic walkthrough covers the same curve and
  the same `bias`/`x_0` drift.
- [Writing a guided walkthrough](../guided-walkthroughs.md), for adding a lesson.
- PsyNeuLink: [Basics and Primer](https://princetonuniversity.github.io/PsyNeuLink/BasicsAndPrimer.html),
  [`TransferMechanism`](https://princetonuniversity.github.io/PsyNeuLink/TransferMechanism.html),
  [`Logistic`](https://princetonuniversity.github.io/PsyNeuLink/TransferFunctions.html),
  [`MappingProjection`](https://princetonuniversity.github.io/PsyNeuLink/MappingProjection.html).
