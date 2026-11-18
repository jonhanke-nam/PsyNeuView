# Icon Ontology for PsyNeuView Component Palette

How the Components panel's icons are drawn (#283): one SVG per palette item
and per top-level category, under
[`frontend/src/assets/component-icons/`](https://github.com/jonhanke-nam/PsyNeuView/tree/devel/frontend/src/assets/component-icons),
listed in its `icons.yaml` with where each drawing came from. The panel shows
them in the list (where the colour dot was) and in the folded strip.

The taxonomy is stored as a recursive tree (`PNL_TAXONOMY_TREE` of
`TaxonomyNode` objects) in [`frontend/src/constants/pnlTypes.ts`](https://github.com/jonhanke-nam/PsyNeuView/blob/devel/frontend/src/constants/pnlTypes.ts).
Each leaf's `def.icon` text is now only a fallback, should an item ever be
missing from `icons.yaml` (`componentIcons.test.ts` fails if one is).

## Design Principles

1. **Functional metaphor** -- an icon suggests what the component *does*
2. **Clear at 11px** -- drawn on a 20-unit grid with 1.5-unit round strokes, so
   they hold up at 11px; the panel draws them at 14px in the list, 16px for an
   item and 18px for a category in the folded strip
3. **Coloured by type** -- every SVG draws in `currentColor`, so an icon takes
   its item's type colour (`--pnv-type-*`), and will follow a dark theme when
   one comes. Input and output ports keep show_graph's green and red (the
   `tint` in `icons.yaml`)
4. **Related components, related icons** -- each kind has its own frame (below),
   and a mark shared across kinds means the same thing (the book is memory,
   the crosshair a target, the step an error, the delta learning)
5. **No emoji, no fonts** -- SVG paths only, so they look the same everywhere

---

## PsyNeuLink Class Hierarchy

### Mechanisms

```
Mechanism
 +-- ProcessingMechanism_Base
 |    +-- ProcessingMechanism          -- Generic processor
 |    +-- TransferMechanism            -- Input-output transformation (f(x))
 |    |    +-- RecurrentTransferMechanism   -- Self-recurrent transfer
 |    |    |    +-- LCAMechanism           -- Leaky Competing Accumulator
 |    |    |    +-- KWTAMechanism          -- K-Winners-Take-All
 |    |    |    +-- ContrastiveHebbianMechanism
 |    |    +-- KohonenMechanism        -- Self-organizing map
 |    +-- IntegratorMechanism          -- Stateful accumulation over time
 |    |    +-- TimerMechanism          -- Temporal accumulation
 |    +-- ObjectiveMechanism           -- Evaluates performance/error
 |    |    +-- ComparatorMechanism     -- Compares sample vs target
 |    |    +-- PredictionErrorMechanism
 |    +-- EpisodicMemoryMechanism      -- Episodic memory storage/retrieval
 |    +-- CompositionInterfaceMechanism -- CIM (bridge between compositions)
 +-- ModulatoryMechanism_Base
      +-- ControlMechanism             -- Modulates parameters via control signals
      |    +-- DefaultControlMechanism
      |    +-- GatingMechanism         -- Gates/suppresses signals
      |    +-- OptimizationControlMechanism  -- Uses optimization to control
      |    |    +-- AGTControlMechanism      -- Adaptive Gain Theory
      |    +-- LCControlMechanism      -- Locus Coeruleus (norepinephrine)
      +-- LearningMechanism            -- Modulates weights via learning signals
           +-- AutoAssociativeLearningMechanism
           +-- KohonenLearningMechanism
           +-- EMStorageMechanism
```

### Projections

```
Projection
 +-- PathwayProjection_Base
 |    +-- MappingProjection            -- Feed-forward weighted connection
 |    +-- AutoAssociativeProjection    -- Self-recurrent weighted connection
 +-- ModulatoryProjection_Base
      +-- ControlProjection            -- Carries control signals
      +-- GatingProjection             -- Carries gating signals
      +-- LearningProjection           -- Carries learning signals (weight updates)
```

### Compositions

```
Composition
 +-- AutodiffComposition               -- PyTorch auto-differentiation
 |    +-- EMComposition                -- Expectation-Maximization
 |    +-- GRUComposition               -- GRU cell
 +-- CompositionFunctionApproximator   -- Function approximation
 |    +-- RegressionCFA
 +-- ParameterEstimationComposition    -- Parameter fitting
```

### Ports

```
Port
 +-- InputPort                         -- Receives signals
 +-- OutputPort                        -- Sends signals
 |    +-- ModulatorySignal
 |         +-- ControlSignal           -- Control output
 |         |    +-- GatingSignal       -- Gating output
 |         +-- LearningSignal          -- Learning output
 +-- ParameterPort                     -- Receives parameter modulation
```

### Functions (by category)

```
Transfer:     Identity, Linear, Logistic, Tanh, ReLU, SoftMax, Exponential, Gaussian, Dropout
Integrator:   SimpleIntegrator, AccumulatorIntegrator, AdaptiveIntegrator, DriftDiffusionIntegrator, OrnsteinUhlenbeck
Learning:     Hebbian, ContrastiveHebbian, Kohonen, Reinforcement, BackPropagation, BayesGLM
Objective:    Stability, Distance
Optimization: GradientOptimization, GridSearch, GaussianProcess
Distribution: NormalDist, UniformDist, ExponentialDist, GammaDist, WaldDist
Memory:       Buffer, ContentAddressableMemory, DictionaryMemory
Transform:    Concatenate, Rearrange, Reduce, MatrixTransform, CombineMeans
```

---

## Icon Families

| Kind | Frame | Example |
|------|-------|---------|
| Mechanism | a ring (show_graph's oval) around a mark saying what it does | Transfer: an S-curve; Integrator: an integral sign; Control: a dial |
| Projection | a link from a sender at the **bottom** to a receiver at the **top** (inputs below, outputs above, as on the canvas); pathway ones solid, modulatory ones dashed and ending in their mark | Control: a square end; Gating: a bar; Learning: a triangle |
| Composition | MetaCell's dashed boundary (show_graph's rectangle) around what it holds | Composition: a small graph; EM Composition: a book |
| Function | no frame, just the function's shape: transfer functions bare curves, timers and distributions on a baseline, integrators from a left axis | Logistic: an S-curve; Normal: a bell on a baseline |
| Port | part of a node's outline with the port on it: inputs on the bottom edge, outputs on the top, parameters a diamond on the side; modulatory signals send a dashed line to their projection's mark | Control Signal: a dashed line to a square |

Marks shared across kinds: the **book** (Episodic Memory, EM Composition, EM
Storage), the **crosshair** (Objective, Parameter Estimation), the **step**
(Prediction Error and its delta function), the **delta** (Learning and its
three variants), the **dial** (the four control mechanisms), the **random
walk** (DDM and the drift diffusion functions), the **grid of units**
(Kohonen, Kohonen Learning, the Kohonen function).

## Sources and permission

Icons are adapted from MetaCell's PsyNeuLinkView
(https://github.com/MetaCell/PsyNeuLinkView, `src/client/assets/svg/`), used
with permission: the lab licensed that work. Where MetaCell had a fitting
icon it is used, keeping only its path data (colour comes from the panel);
the rest were drawn new for PsyNeuView in the same style (MetaCell's rounded
outlines, about the same stroke weight). An `original` icon with a `based_on`
reuses part of a MetaCell drawing, such as the dashed boundary every
composition icon is drawn in. Credited in the repository's `NOTICE`.

To add or change an icon: draw it on a `0 0 20 20` grid in `currentColor`
(no fixed colours, scripts, links or styles; `componentIcons.test.ts`
checks), give it a file under `component-icons/`, and add its line to
`icons.yaml` with its source and meaning, then update the table below.

### Every icon and where it came from


| Palette entry | Icon file | Source | What it shows |
|---|---|---|---|
| *mechanisms* (folded strip) | `processing-mechanism.svg` | MetaCell `node/gray.svg` | MetaCell's node: the plain mechanism, a ring with a core |
| *projections* (folded strip) | `mapping-projection.svg` | MetaCell `node/composition.svg` | MetaCell's link between two nodes, turned to run bottom to top |
| *compositions* (folded strip) | `composition.svg` | original, on MetaCell `comp.svg` | MetaCell's dashed boundary around a small graph |
| *functions* (folded strip) | `functions.svg` | original | an italic f: a function |
| *ports* (folded strip) | `ports.svg` | original | a node with a port on each edge |
| ProcessingMechanism | `processing-mechanism.svg` | MetaCell `node/gray.svg` | MetaCell's node: the plain mechanism, a ring with a core |
| TransferMechanism | `transfer-mechanism.svg` | original | ring + a logistic curve: input in, transformed out |
| RecurrentTransferMechanism | `recurrent-transfer-mechanism.svg` | original | ring + a loop arrow: its output feeds back |
| KWTAMechanism | `kwta-mechanism.svg` | original | ring + bars, one winner: the k strongest win |
| LCAMechanism | `lca-mechanism.svg` | original | ring + two accumulators racing from one start; one wins |
| ContrastiveHebbianMechanism | `contrastive-hebbian-mechanism.svg` | original | ring + a two-way arrow: plus and minus phases |
| KohonenMechanism | `kohonen-mechanism.svg` | original | ring + a grid of units: a self-organising map |
| IntegratorMechanism | `integrator-mechanism.svg` | original | ring + an integral sign: accumulates over time |
| TimerMechanism | `timer-mechanism.svg` | original | ring + clock hands: counts time |
| DDM | `ddm.svg` | original | ring + a random walk: noisy evidence drifting to a bound |
| EpisodicMemoryMechanism | `episodic-memory-mechanism.svg` | MetaCell `node/green-book.svg` | MetaCell's book: a store of episodes |
| LeabraMechanism | `leabra-mechanism.svg` | original | ring + stacked layers: a layered network |
| ObjectiveMechanism | `objective-mechanism.svg` | MetaCell `detect.svg` | MetaCell's crosshair: aims at a target and scores the result |
| ComparatorMechanism | `comparator-mechanism.svg` | original | ring + opposed arrows: sample against target |
| PredictionErrorMechanism | `prediction-error-mechanism.svg` | original | ring + a step: the jump between expected and received |
| ControlMechanism | `control-mechanism.svg` | original | ring + a dial: turns other components' parameters |
| OptimizationControlMechanism | `optimization-control-mechanism.svg` | original | control dial + a nabla: chooses the setting by optimising |
| AGTControlMechanism | `agt-control-mechanism.svg` | original | control dial + a wave: adaptive gain follows performance |
| LCControlMechanism | `lc-control-mechanism.svg` | original | control dial + spikes: locus coeruleus bursts |
| GatingMechanism | `gating-mechanism.svg` | original | ring + a signal stopped at a bar: lets signals through or not |
| LearningMechanism | `learning-mechanism.svg` | original | ring + a delta: changes weights |
| AutoAssociativeLearningMechanism | `auto-associative-learning-mechanism.svg` | original | learning delta + a loop: learns its own recurrent weights |
| KohonenLearningMechanism | `kohonen-learning-mechanism.svg` | original | learning delta + a small grid: trains a self-organising map |
| EMStorageMechanism | `em-storage-mechanism.svg` | original | learning delta + a page: writes entries into memory |
| MappingProjection | `mapping-projection.svg` | MetaCell `node/composition.svg` | MetaCell's link between two nodes, turned to run bottom to top |
| MaskedMappingProjection | `masked-mapping-projection.svg` | original | a link with a mask square on it: some weights held fixed |
| AutoAssociativeProjection | `auto-associative-projection.svg` | original | a loop from a node back into itself |
| ControlProjection | `control-projection.svg` | original | dashed + a square end: carries a control signal |
| GatingProjection | `gating-projection.svg` | original | dashed + a bar end: carries a gating signal |
| LearningProjection | `learning-projection.svg` | original | dashed + a triangle end: carries a learning signal |
| Composition | `composition.svg` | original, on MetaCell `comp.svg` | MetaCell's dashed boundary around a small graph |
| AutodiffComposition | `autodiff-composition.svg` | original, on MetaCell `comp.svg` | boundary + a partial-derivative sign: trained by gradients |
| GRUComposition | `gru-composition.svg` | original, on MetaCell `comp.svg` | boundary + a gated loop: a recurrent unit |
| EMComposition | `em-composition.svg` | original, on MetaCell `comp.svg` | boundary + a book: episodic memory as a network (relates to Episodic Memory) |
| ParameterEstimationComposition | `parameter-estimation-composition.svg` | original, on MetaCell `comp.svg` | boundary + a crosshair: fits parameters to data (relates to Objective) |
| CompositionFunctionApproximator | `composition-function-approximator.svg` | original, on MetaCell `comp.svg` | boundary + a curve through points: approximates a function |
| RegressionCFA | `regression-cfa.svg` | original, on MetaCell `comp.svg` | boundary + a fitted line: regression |
| Identity | `identity.svg` | original | y = x: passes values unchanged |
| Linear | `linear.svg` | original | a straight line with a slope and offset |
| Exponential | `exponential.svg` | original | a rising exponential |
| Logistic | `logistic.svg` | original | an S-curve from 0 to 1 |
| Tanh | `tanh.svg` | original | an S-curve through zero, from -1 to 1 |
| ReLU | `relu.svg` | original | flat, then rising: rectified linear |
| Gaussian | `gaussian.svg` | original | a bell-shaped curve |
| GaussianDistort | `gaussian-distort.svg` | original | a line with Gaussian noise added |
| BinomialDistort | `binomial-distort.svg` | original | a line with values knocked out at random |
| SoftMax | `softmax.svg` | original | bars with one standing out: turns values into probabilities |
| TransferWithCosts | `transfer-with-costs.svg` | original | an S-curve plus a cost line under it |
| Angle | `angle.svg` | original | an angle: maps values onto angles |
| HypersphericalToCartesian | `hyperspherical-to-cartesian.svg` | original | a point on a sphere and its x, y: angles to coordinates |
| Dropout | `dropout.svg` | original | a broken line: some values dropped |
| UserDefinedFunction | `user-defined-function.svg` | MetaCell `node/green-puzzle.svg` | MetaCell's puzzle piece: plug in your own code |
| LinearTimer | `linear-timer.svg` | original | time axis + a straight ramp to an end tick |
| AcceleratingTimer | `accelerating-timer.svg` | original | time axis + a ramp that speeds up |
| DeceleratingTimer | `decelerating-timer.svg` | original | time axis + a ramp that slows down |
| AsymptoticTimer | `asymptotic-timer.svg` | original | time axis + a ramp levelling off under a limit |
| SimpleIntegrator | `simple-integrator.svg` | original | even steps up: adds the input each time |
| AccumulatorIntegrator | `accumulator-integrator.svg` | original | growing steps up: accumulates with a rate |
| AdaptiveIntegrator | `adaptive-integrator.svg` | original | a curve closing on its input: an exponential average |
| DualAdaptiveIntegrator | `dual-adaptive-integrator.svg` | original | a fast and a slow average |
| DriftDiffusionIntegrator | `drift-diffusion-integrator.svg` | original | a random walk between two bounds (relates to DDM) |
| DriftOnASphereIntegrator | `drift-on-a-sphere-integrator.svg` | original | a random walk on a sphere |
| OrnsteinUhlenbeckIntegrator | `ornstein-uhlenbeck-integrator.svg` | original | a noisy walk pulled back to a mean |
| LeakyCompetingIntegrator | `leaky-competing-integrator.svg` | original | two accumulators: one rises, the other is pushed back (relates to LCA) |
| FitzHughNagumoIntegrator | `fitzhugh-nagumo-integrator.svg` | original | spikes: a neuron firing |
| InteractiveActivationIntegrator | `interactive-activation-integrator.svg` | original | a curve held between a ceiling and a floor |
| NormalDist | `normal-dist.svg` | original | baseline + a bell: normal distribution |
| UniformDist | `uniform-dist.svg` | original | baseline + a flat block: uniform |
| ExponentialDist | `exponential-dist.svg` | original | baseline + a decaying curve |
| GammaDist | `gamma-dist.svg` | original | baseline + a skewed hump |
| WaldDist | `wald-dist.svg` | original | baseline + a sharp hump with a long tail: first-passage times |
| UniformToNormalDist | `uniform-to-normal-dist.svg` | original | a flat block becoming a bell |
| DriftDiffusionAnalytical | `drift-diffusion-analytical.svg` | original | a response-time curve under a bound: the DDM's solution (relates to DDM) |
| LinearCombination | `linear-combination.svg` | original | a sum sign: weights and adds its inputs |
| MatrixTransform | `matrix-transform.svg` | original | a matrix: multiplies by a weight matrix |
| Reduce | `reduce.svg` | original | many lines into one |
| Concatenate | `concatenate.svg` | original | two pieces joined end to end |
| Rearrange | `rearrange.svg` | original | crossing paths: values moved to new places |
| CombineMeans | `combine-means.svg` | original | bars and their mean line |
| PredictionErrorDeltaFunction | `prediction-error-delta-function.svg` | original | a step: the prediction error (relates to Prediction Error) |
| Stability | `stability.svg` | original | a ball resting in a valley |
| Energy | `energy.svg` | original | a lightning bolt: energy |
| Entropy | `entropy.svg` | original | scattered dots: disorder |
| Distance | `distance.svg` | original | two points and the span between them |
| GradientOptimization | `gradient-optimization.svg` | original | a step down a slope: gradient descent |
| GridSearch | `grid-search.svg` | original | a grid with one cell picked: tries every setting |
| GaussianProcess | `gaussian-process.svg` | original | a curve with an uncertainty band |
| PECOptimizationFunction | `pec-optimization-function.svg` | original | a valley with its lowest point targeted (relates to Parameter Estimation) |
| OneHot | `one-hot.svg` | original | a row with one cell filled: one-hot |
| Hebbian | `hebbian.svg` | original | two units and a strong link: cells that fire together wire together |
| ContrastiveHebbian | `contrastive-hebbian.svg` | original | two units, a two-way arrow (relates to Contrastive Hebbian) |
| Kohonen | `kohonen.svg` | original | a grid with a winning unit (relates to Kohonen) |
| Reinforcement | `reinforcement.svg` | original | a star: learns from reward |
| TDLearning | `td-learning.svg` | original | two moments, the next one's estimate passed back to the one before: temporal difference |
| BackPropagation | `back-propagation.svg` | original | an arrow down through the layers: the error flows back (outputs on top) |
| BayesGLM | `bayes-glm.svg` | original | a bell over a fitted line: Bayesian regression |
| EMStorage | `em-storage.svg` | original, on MetaCell `node/green-book.svg` | a smaller copy of MetaCell's book with an arrow in: writes to memory |
| Buffer | `buffer.svg` | original | stacked slots: a queue of recent values |
| ContentAddressableMemory | `content-addressable-memory.svg` | original | entries and a magnifier: looked up by content |
| DictionaryMemory | `dictionary-memory.svg` | original | keys and values: a dictionary |
| InputPort | `input-port.svg` | original | a node with its port on the bottom edge (green, as in show_graph) |
| OutputPort | `output-port.svg` | original | a node with its port on the top edge (red, as in show_graph) |
| ParameterPort | `parameter-port.svg` | original | a node with a diamond on its side: a parameter, as the canvas draws it |
| ControlSignal | `control-signal.svg` | original | an output port sending a dashed line to a square: a control signal |
| GatingSignal | `gating-signal.svg` | original | an output port sending a dashed line to a bar: a gating signal |
| LearningSignal | `learning-signal.svg` | original | an output port sending a dashed line to a triangle: a learning signal |

---

## show_graph Visual Conventions (for reference)

PsyNeuLink's `show_graph()` uses these shapes and colors in GraphViz. The
canvas draws the same shapes (#192, #193: `utils/nodeShape.ts`), each with
a tooltip saying what it means, and the graph legend lists the ones the
open model uses:

| Node Type | Shape | Color | On the canvas |
|-----------|-------|-------|---------------|
| Regular mechanism | oval | role-based | oval |
| FEEDBACK_SENDER | octagon | role-based | octagon |
| CYCLE | doublecircle | role-based | double outline |
| Controller | doubleoctagon | purple | double octagon |
| CIM | rectangle | green/red/blue | square (CIMNode) |
| Nested composition | rectangle | pink | rectangle when collapsed; a frame when expanded |
| agent_rep (OCM) | egg | purple | not drawn: the canvas has no agent_rep node yet |

show_graph names its colours (`green`, `red`, `blue`, `purple`, `orange`,
`pink`, `brown`, `black`), and Graphviz draws each name with its X11 value in
show_graph's own PDF and PNG. (A browser reads the same names in an SVG with
their CSS values, which differ for green, #008000, and purple, #800080; the
app's show_graph tab redraws both as the PDF does, so the two agree.)
PsyNeuView's role tokens (`--pnv-role-*` in `frontend/src/styles/palette.css`,
#190) take the X11 values for red, green and purple, which must match
show_graph exactly; the other roles read the same both ways, except that orange
and pink are too pale on white for an outline and use the nearest named orange
and pink that still read:

| Role | show_graph | PsyNeuView outline | As text |
|------|-----------|--------------------|---------|
| INPUT | green (#00ff00) | #00ff00 | #008000 |
| OUTPUT | red (#ff0000) | #ff0000 | #dd0000 |
| CONTROL | blue (#0000ff) | #0000ff | same |
| Controller and its objective | purple (#a020f0) | #a020f0 | same (5.3:1 on white) |
| LEARNING | orange (#ffa500) | darkorange (#ff8c00) | #e65100 |
| PROBE | pink (#ffc0cb) | hotpink (#ff69b4) | #d81b60 |
| INPUT and OUTPUT | brown (#a52a2a) | #a52a2a | same |
| INTERNAL | black | #000 | same |

The palette icons don't need to match show_graph's shape/color system exactly,
since show_graph is about runtime graph rendering, while the palette is about
component selection. But consistency in color associations helps users build
mental models.
