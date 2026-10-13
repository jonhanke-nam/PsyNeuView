# Icon Ontology for PsyNeuView Component Palette

Mapping PsyNeuLink's class hierarchy to visually meaningful icons for the
collapsed palette sidebar. Currently uses placeholder Unicode symbols that
convey functional meaning at a glance. An existing PNL icon ontology from
the PsyNeuLink team needs to be located and integrated (see issue #74).

**Note:** The taxonomy is stored as a recursive tree (`PNL_TAXONOMY_TREE` of
`TaxonomyNode` objects) in [`frontend/src/constants/pnlTypes.ts`](https://github.com/jonhanke-nam/PsyNeuView/blob/devel/frontend/src/constants/pnlTypes.ts). Each leaf
node has a `def: PnlObjectDef` with an `icon` field.

## Design Principles

1. **Functional metaphor** -- icons should suggest what the component *does*
2. **Distinguishable at 11px** -- must render clearly in compact palette (32x32 buttons)
3. **Color + icon** -- icons inherit the component's accent color, so the combination
   must be readable against a white background
4. **Consistent within categories** -- similar components should have related icons
5. **No emoji** -- use Unicode math/technical symbols for cross-platform consistency

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

## Icon Mapping

### Placeholder Unicode Icons (pending the official PNL ontology)

| Component | Legacy | Placeholder | Rationale |
|-----------|--------|-------------|-----------|
| **Mechanisms > Processing** | | | |
| TransferMechanism | T | **f** | function application (f(x)) |
| RecurrentTransferMechanism | R | **↻** | recurrence/loop |
| ProcessingMechanism | P | **p** | generic processor |
| IntegratorMechanism | I | **∫** | mathematical integral = accumulation |
| KWTAMechanism | K | **⬆** | top-K selection |
| ContrastiveHebbianMechanism | CH | **↔** | bidirectional correlation |
| **Mechanisms > Decision** | | | |
| DDM | D | **~** | stochastic random walk / noise |
| LCAMechanism | L | **⊘** | competing/inhibition |
| **Mechanisms > Evaluation** | | | |
| ObjectiveMechanism | O | **◎** | target/bullseye |
| ComparatorMechanism | C | **⇋** | comparison/bidirectional |
| **Mechanisms > Control** | | | |
| ControlMechanism | Ct | **⚙** | control gear |
| GatingMechanism | G | **⊡** | gate/switch |
| OptimizationControlMechanism | OC | **∇** | gradient/optimization |
| **Mechanisms > Learning** | | | |
| LearningMechanism | Ln | **Δ** | delta rule / weight change |
| **Projections** | | | |
| MappingProjection | M | **→** | directed connection |
| ControlProjection | Cp | **⇢** | dashed control signal |
| LearningProjection | Lp | **⇝** | learning signal (wavy) |
| AutoAssociativeProjection | A | **↺** | self-loop |
| **Compositions** | | | |
| Composition | Co | **⊞** | nested graph structure |
| AutodiffComposition | Ad | **∂** | partial derivative / autodiff |

### Icon Selection Notes

**Why not emoji?** Emoji rendering varies across platforms and font sizes. At 11px
in a 32x32 button, most emoji are illegible or get replaced with system fallbacks.
Unicode math/technical symbols from standard fonts render consistently.

**Why not SVG?** SVG icons are better long-term but require an icon library or
custom icon set. Unicode symbols are a pragmatic first step that we can upgrade
later. The `icon` field in each `TaxonomyNode`'s `def` (`PnlObjectDef`) could
later accept either a string (Unicode) or a React component (SVG).

**Legibility test candidates:** The following symbols render well at small sizes
in monospace/sans-serif fonts across macOS, Windows, and Linux:
- Math: ∫ ∂ ∇ Δ Σ ∞
- Arrows: → ⇢ ⇝ ↺ ↻ ⇋
- Shapes: ◎ ◆ ⊡ ⊞ ⊘
- Technical: ⚙ ~

**Fallback:** If a Unicode symbol doesn't render on a user's system, the
component's full `label` is still shown in expanded mode, and the tooltip
always shows the full type name.

---

## show_graph Visual Conventions (for reference)

PsyNeuLink's `show_graph()` uses these shapes and colors in GraphViz:

| Node Type | Shape | Color |
|-----------|-------|-------|
| Regular mechanism | oval | role-based |
| FEEDBACK_SENDER | septagon | orange |
| CYCLE | doublecircle | brown |
| Controller | doubleoctagon | purple |
| CIM | rectangle | green/red/blue |
| Nested composition | rectangle | pink |
| agent_rep (OCM) | egg | purple |

| Role | Color |
|------|-------|
| INPUT | green (#2e7d32) |
| OUTPUT | red (#c62828) |
| CONTROL | blue (#1565c0) |
| LEARNING | orange (#e65100) |
| PROBE | pink (#e91e63) |
| INTERNAL | gray (#555) |

The palette icons don't need to match show_graph's shape/color system exactly,
since show_graph is about runtime graph rendering, while the palette is about
component selection. But consistency in color associations helps users build
mental models.

---

## Types Now in the Tree Taxonomy

The following types were previously missing from the palette but have since
been added to `PNL_TAXONOMY_TREE` on `devel`. They still use legacy
single-letter/abbreviation icons and need placeholder or official icons:

### Mechanisms (added to tree, still have letter icons)
- KWTAMechanism, ContrastiveHebbianMechanism, KohonenMechanism
- PredictionErrorMechanism, EpisodicMemoryMechanism, TimerMechanism
- GatingMechanism, OptimizationControlMechanism, AGTControlMechanism, LCControlMechanism
- LeabraMechanism, AutoAssociativeLearningMechanism, KohonenLearningMechanism, EMStorageMechanism

### Projections (added to tree)
- GatingProjection, MaskedMappingProjection

### Compositions (added to tree)
- EMComposition, GRUComposition, ParameterEstimationComposition

### Functions (added to tree — full categories)
- Transfer, Timer, Integrator, Distribution, Transform, Objective, Optimization, Selection, Learning, Memory

### Ports (added to tree)
- InputPort, OutputPort, ParameterPort, ControlSignal, GatingSignal, LearningSignal

## Types Still Missing

- PathwayProjection (base class — may not need a palette entry)

See GitHub issues #61-67 for the hierarchical palette expansion plan.

## Pending icon polish

All instantiable PNL component types now have palette entries (per #77).
Many still use 2-letter ASCII placeholders rather than Unicode glyphs in
the spirit of the original `feature/icon-ontology` work (#75). Upgrading
these awaits #74 (locating the official PNL icon ontology), so
that we don't pick arbitrary glyphs we'll have to re-pick later.
