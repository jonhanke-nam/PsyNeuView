/**
 * Shared PsyNeuLink type taxonomy, colours (palette tokens), and helpers.
 * Uses a recursive tree structure to support arbitrary nesting depth.
 */

/** A leaf node — an instantiable PsyNeuLink component */
export interface PnlObjectDef {
  type: string;
  label: string;
  color: string;
  defaults: Record<string, string>;
  icon: string;
}

/** A tree node — either a category (has children) or a leaf (has def) */
export interface TaxonomyNode {
  id: string; // unique path-based key, e.g. "mechanisms.processing.transfer"
  label: string;
  children?: TaxonomyNode[];
  def?: PnlObjectDef; // only on leaf nodes
  // When set, this branch has a "base of the family" leaf among its children
  // (e.g. Transfer category's TransferMechanism). Renders first, marked as base.
  defaultLeafId?: string;
}

/**
 * The full PsyNeuLink component taxonomy as a tree.
 * Top-level nodes are categories. Leaves are instantiable types.
 */
export const PNL_TAXONOMY_TREE: TaxonomyNode[] = [
  {
    id: "mechanisms",
    label: "Mechanisms",
    children: [
      {
        id: "mechanisms.processing",
        label: "Processing",
        defaultLeafId: "mechanisms.processing.processing",
        children: [
          {
            id: "mechanisms.processing.transfer",
            label: "Transfer",
            defaultLeafId: "mechanisms.processing.transfer.transfer",
            children: [
              { id: "mechanisms.processing.transfer.transfer", label: "TransferMechanism", def: { type: "TransferMechanism", label: "Transfer", color: "var(--pnv-type-transfer-mechanism)", defaults: { input_shapes: "[1]", function: "pnl.Linear()" }, icon: "f" } },
              {
                id: "mechanisms.processing.transfer.recurrent",
                label: "Recurrent",
                defaultLeafId: "mechanisms.processing.transfer.recurrent.recurrent",
                children: [
                  { id: "mechanisms.processing.transfer.recurrent.recurrent", label: "RecurrentTransferMechanism", def: { type: "RecurrentTransferMechanism", label: "Recurrent", color: "var(--pnv-type-recurrent-transfer-mechanism)", defaults: { input_shapes: "[1]", function: "pnl.Linear()" }, icon: "↻" } },
                  { id: "mechanisms.processing.transfer.recurrent.kwta", label: "KWTAMechanism", def: { type: "KWTAMechanism", label: "KWTA", color: "var(--pnv-type-kwta-mechanism)", defaults: { input_shapes: "[5]" }, icon: "⬆" } },
                  { id: "mechanisms.processing.transfer.recurrent.lca", label: "LCAMechanism", def: { type: "LCAMechanism", label: "LCA", color: "var(--pnv-type-lca-mechanism)", defaults: { input_shapes: "[2]" }, icon: "⊘" } },
                  { id: "mechanisms.processing.transfer.recurrent.contrastive", label: "ContrastiveHebbianMechanism", def: { type: "ContrastiveHebbianMechanism", label: "Contrastive Hebbian", color: "var(--pnv-type-contrastive-hebbian-mechanism)", defaults: { input_shapes: "[2]" }, icon: "↔" } },
                ],
              },
              { id: "mechanisms.processing.transfer.kohonen", label: "KohonenMechanism", def: { type: "KohonenMechanism", label: "Kohonen", color: "var(--pnv-type-kohonen-mechanism)", defaults: { input_shapes: "[3]" }, icon: "Ko" } },
            ],
          },
          { id: "mechanisms.processing.processing", label: "ProcessingMechanism", def: { type: "ProcessingMechanism", label: "Processing", color: "var(--pnv-type-processing-mechanism)", defaults: { input_shapes: "[1]" }, icon: "p" } },
          {
            id: "mechanisms.processing.integrator",
            label: "Integrator",
            defaultLeafId: "mechanisms.processing.integrator.integrator",
            children: [
              { id: "mechanisms.processing.integrator.integrator", label: "IntegratorMechanism", def: { type: "IntegratorMechanism", label: "Integrator", color: "var(--pnv-type-integrator-mechanism)", defaults: { input_shapes: "[1]" }, icon: "∫" } },
              { id: "mechanisms.processing.integrator.timer", label: "TimerMechanism", def: { type: "TimerMechanism", label: "Timer", color: "var(--pnv-type-timer-mechanism)", defaults: { input_shapes: "[1]" }, icon: "Tm" } },
            ],
          },
          { id: "mechanisms.processing.ddm", label: "DDM", def: { type: "DDM", label: "DDM", color: "var(--pnv-type-ddm)", defaults: {}, icon: "~" } },
          { id: "mechanisms.processing.episodic", label: "EpisodicMemoryMechanism", def: { type: "EpisodicMemoryMechanism", label: "Episodic Memory", color: "var(--pnv-type-episodic-memory-mechanism)", defaults: { input_shapes: "[1]" }, icon: "Em" } },
          { id: "mechanisms.processing.leabra", label: "LeabraMechanism", def: { type: "LeabraMechanism", label: "Leabra", color: "var(--pnv-type-leabra-mechanism)", defaults: { input_shapes: "[1]" }, icon: "Lb" } },
        ],
      },
      {
        id: "mechanisms.evaluation",
        label: "Evaluation",
        children: [
          { id: "mechanisms.evaluation.objective", label: "ObjectiveMechanism", def: { type: "ObjectiveMechanism", label: "Objective", color: "var(--pnv-type-objective-mechanism)", defaults: { input_shapes: "[1]" }, icon: "◎" } },
          {
            id: "mechanisms.evaluation.comparator",
            label: "Comparator",
            defaultLeafId: "mechanisms.evaluation.comparator.comparator",
            children: [
              { id: "mechanisms.evaluation.comparator.comparator", label: "ComparatorMechanism", def: { type: "ComparatorMechanism", label: "Comparator", color: "var(--pnv-type-comparator-mechanism)", defaults: { input_shapes: "[1]" }, icon: "⇋" } },
              { id: "mechanisms.evaluation.comparator.prediction_error", label: "PredictionErrorMechanism", def: { type: "PredictionErrorMechanism", label: "Prediction Error", color: "var(--pnv-type-prediction-error-mechanism)", defaults: { input_shapes: "[1]" }, icon: "PE" } },
            ],
          },
        ],
      },
      {
        id: "mechanisms.control",
        label: "Control",
        children: [
          { id: "mechanisms.control.control", label: "ControlMechanism", def: { type: "ControlMechanism", label: "Control", color: "var(--pnv-type-control-mechanism)", defaults: {}, icon: "⚙" } },
          { id: "mechanisms.control.optimization", label: "OptimizationControlMechanism", def: { type: "OptimizationControlMechanism", label: "Optimization Control", color: "var(--pnv-type-optimization-control-mechanism)", defaults: {}, icon: "∇" } },
          { id: "mechanisms.control.agt", label: "AGTControlMechanism", def: { type: "AGTControlMechanism", label: "AGT Control", color: "var(--pnv-type-agt-control-mechanism)", defaults: {}, icon: "AG" } },
          { id: "mechanisms.control.lc", label: "LCControlMechanism", def: { type: "LCControlMechanism", label: "LC Control", color: "var(--pnv-type-lc-control-mechanism)", defaults: {}, icon: "LC" } },
        ],
      },
      {
        id: "mechanisms.gating",
        label: "Gating",
        children: [
          { id: "mechanisms.gating.gating", label: "GatingMechanism", def: { type: "GatingMechanism", label: "Gating", color: "var(--pnv-type-gating-mechanism)", defaults: {}, icon: "⊡" } },
        ],
      },
      {
        id: "mechanisms.learning",
        label: "Learning",
        children: [
          { id: "mechanisms.learning.learning", label: "LearningMechanism", def: { type: "LearningMechanism", label: "Learning", color: "var(--pnv-type-learning-mechanism)", defaults: {}, icon: "Δ" } },
          { id: "mechanisms.learning.autoassociative", label: "AutoAssociativeLearningMechanism", def: { type: "AutoAssociativeLearningMechanism", label: "AutoAssociative Learning", color: "var(--pnv-type-auto-associative-learning-mechanism)", defaults: {}, icon: "AL" } },
          { id: "mechanisms.learning.kohonen", label: "KohonenLearningMechanism", def: { type: "KohonenLearningMechanism", label: "Kohonen Learning", color: "var(--pnv-type-kohonen-learning-mechanism)", defaults: {}, icon: "KL" } },
          { id: "mechanisms.learning.emstorage", label: "EMStorageMechanism", def: { type: "EMStorageMechanism", label: "EM Storage", color: "var(--pnv-type-em-storage-mechanism)", defaults: {}, icon: "ES" } },
        ],
      },
    ],
  },
  {
    id: "projections",
    label: "Projections",
    children: [
      {
        id: "projections.pathway",
        label: "Pathway",
        children: [
          { id: "projections.pathway.mapping", label: "MappingProjection", def: { type: "MappingProjection", label: "Mapping", color: "var(--pnv-type-mapping-projection)", defaults: {}, icon: "→" } },
          { id: "projections.pathway.masked", label: "MaskedMappingProjection", def: { type: "MaskedMappingProjection", label: "Masked Mapping", color: "var(--pnv-type-masked-mapping-projection)", defaults: {}, icon: "Mm" } },
          { id: "projections.pathway.autoassociative", label: "AutoAssociativeProjection", def: { type: "AutoAssociativeProjection", label: "AutoAssociative", color: "var(--pnv-type-auto-associative-projection)", defaults: {}, icon: "↺" } },
        ],
      },
      {
        id: "projections.modulatory",
        label: "Modulatory",
        children: [
          { id: "projections.modulatory.control", label: "ControlProjection", def: { type: "ControlProjection", label: "Control Proj.", color: "var(--pnv-type-control-projection)", defaults: {}, icon: "⇢" } },
          { id: "projections.modulatory.gating", label: "GatingProjection", def: { type: "GatingProjection", label: "Gating Proj.", color: "var(--pnv-type-gating-projection)", defaults: {}, icon: "Gp" } },
          { id: "projections.modulatory.learning", label: "LearningProjection", def: { type: "LearningProjection", label: "Learning Proj.", color: "var(--pnv-type-learning-projection)", defaults: {}, icon: "⇝" } },
        ],
      },
    ],
  },
  {
    id: "compositions",
    label: "Compositions",
    children: [
      { id: "compositions.composition", label: "Composition", def: { type: "Composition", label: "Composition", color: "var(--pnv-type-composition)", defaults: {}, icon: "⊞" } },
      {
        id: "compositions.autodiff",
        label: "Autodiff",
        defaultLeafId: "compositions.autodiff.autodiff",
        children: [
          { id: "compositions.autodiff.autodiff", label: "AutodiffComposition", def: { type: "AutodiffComposition", label: "Autodiff", color: "var(--pnv-type-autodiff-composition)", defaults: {}, icon: "∂" } },
          { id: "compositions.autodiff.gru", label: "GRUComposition", def: { type: "GRUComposition", label: "GRU", color: "var(--pnv-type-gru-composition)", defaults: {}, icon: "GR" } },
          { id: "compositions.autodiff.em", label: "EMComposition", def: { type: "EMComposition", label: "EM Composition", color: "var(--pnv-type-em-composition)", defaults: {}, icon: "EM" } },
        ],
      },
      { id: "compositions.parameter_estimation", label: "ParameterEstimationComposition", def: { type: "ParameterEstimationComposition", label: "Parameter Estimation", color: "var(--pnv-type-parameter-estimation-composition)", defaults: {}, icon: "Pe" } },
      {
        id: "compositions.cfa",
        label: "Function Approximator",
        defaultLeafId: "compositions.cfa.cfa",
        children: [
          { id: "compositions.cfa.cfa", label: "CompositionFunctionApproximator", def: { type: "CompositionFunctionApproximator", label: "Function Approximator", color: "var(--pnv-type-composition-function-approximator)", defaults: {}, icon: "CF" } },
          { id: "compositions.cfa.regression", label: "RegressionCFA", def: { type: "RegressionCFA", label: "Regression CFA", color: "var(--pnv-type-regression-cfa)", defaults: {}, icon: "Rc" } },
        ],
      },
    ],
  },
  {
    id: "functions",
    label: "Functions",
    children: [
      {
        id: "functions.transfer",
        label: "Transfer",
        children: [
          { id: "functions.transfer.identity", label: "Identity", def: { type: "Identity", label: "Identity", color: "var(--pnv-type-identity)", defaults: {}, icon: "Id" } },
          { id: "functions.transfer.linear", label: "Linear", def: { type: "Linear", label: "Linear", color: "var(--pnv-type-linear)", defaults: {}, icon: "Li" } },
          { id: "functions.transfer.exponential", label: "Exponential", def: { type: "Exponential", label: "Exponential", color: "var(--pnv-type-exponential)", defaults: {}, icon: "Ex" } },
          { id: "functions.transfer.logistic", label: "Logistic", def: { type: "Logistic", label: "Logistic", color: "var(--pnv-type-logistic)", defaults: {}, icon: "Lo" } },
          { id: "functions.transfer.tanh", label: "Tanh", def: { type: "Tanh", label: "Tanh", color: "var(--pnv-type-tanh)", defaults: {}, icon: "Th" } },
          { id: "functions.transfer.relu", label: "ReLU", def: { type: "ReLU", label: "ReLU", color: "var(--pnv-type-relu)", defaults: {}, icon: "Re" } },
          { id: "functions.transfer.gaussian", label: "Gaussian", def: { type: "Gaussian", label: "Gaussian", color: "var(--pnv-type-gaussian)", defaults: {}, icon: "Ga" } },
          { id: "functions.transfer.gaussiandistort", label: "GaussianDistort", def: { type: "GaussianDistort", label: "Gaussian Distort", color: "var(--pnv-type-gaussian-distort)", defaults: {}, icon: "GD" } },
          { id: "functions.transfer.binomialdistort", label: "BinomialDistort", def: { type: "BinomialDistort", label: "Binomial Distort", color: "var(--pnv-type-binomial-distort)", defaults: {}, icon: "BD" } },
          { id: "functions.transfer.softmax", label: "SoftMax", def: { type: "SoftMax", label: "SoftMax", color: "var(--pnv-type-softmax)", defaults: {}, icon: "Sm" } },
          { id: "functions.transfer.transferwithcosts", label: "TransferWithCosts", def: { type: "TransferWithCosts", label: "Transfer w/ Costs", color: "var(--pnv-type-transfer-with-costs)", defaults: {}, icon: "TC" } },
          { id: "functions.transfer.angle", label: "Angle", def: { type: "Angle", label: "Angle", color: "var(--pnv-type-angle)", defaults: {}, icon: "An" } },
          { id: "functions.transfer.hyperspherical", label: "HypersphericalToCartesian", def: { type: "HypersphericalToCartesian", label: "Hyperspherical→Cartesian", color: "var(--pnv-type-hyperspherical-to-cartesian)", defaults: {}, icon: "HC" } },
          { id: "functions.transfer.dropout", label: "Dropout", def: { type: "Dropout", label: "Dropout", color: "var(--pnv-type-dropout)", defaults: {}, icon: "Dr" } },
          { id: "functions.transfer.userdefined", label: "UserDefinedFunction", def: { type: "UserDefinedFunction", label: "User Defined", color: "var(--pnv-type-user-defined-function)", defaults: {}, icon: "UF" } },
        ],
      },
      {
        id: "functions.timer",
        label: "Timer",
        children: [
          { id: "functions.timer.linear", label: "LinearTimer", def: { type: "LinearTimer", label: "Linear Timer", color: "var(--pnv-type-linear-timer)", defaults: {}, icon: "LT" } },
          { id: "functions.timer.accelerating", label: "AcceleratingTimer", def: { type: "AcceleratingTimer", label: "Accelerating", color: "var(--pnv-type-accelerating-timer)", defaults: {}, icon: "AT" } },
          { id: "functions.timer.decelerating", label: "DeceleratingTimer", def: { type: "DeceleratingTimer", label: "Decelerating", color: "var(--pnv-type-decelerating-timer)", defaults: {}, icon: "DT" } },
          { id: "functions.timer.asymptotic", label: "AsymptoticTimer", def: { type: "AsymptoticTimer", label: "Asymptotic", color: "var(--pnv-type-asymptotic-timer)", defaults: {}, icon: "As" } },
        ],
      },
      {
        id: "functions.integrator",
        label: "Integrator",
        children: [
          { id: "functions.integrator.simple", label: "SimpleIntegrator", def: { type: "SimpleIntegrator", label: "Simple", color: "var(--pnv-type-simple-integrator)", defaults: {}, icon: "Si" } },
          { id: "functions.integrator.accumulator", label: "AccumulatorIntegrator", def: { type: "AccumulatorIntegrator", label: "Accumulator", color: "var(--pnv-type-accumulator-integrator)", defaults: {}, icon: "Ac" } },
          { id: "functions.integrator.adaptive", label: "AdaptiveIntegrator", def: { type: "AdaptiveIntegrator", label: "Adaptive", color: "var(--pnv-type-adaptive-integrator)", defaults: {}, icon: "Ai" } },
          { id: "functions.integrator.dualadaptive", label: "DualAdaptiveIntegrator", def: { type: "DualAdaptiveIntegrator", label: "Dual Adaptive", color: "var(--pnv-type-dual-adaptive-integrator)", defaults: {}, icon: "DA" } },
          { id: "functions.integrator.driftdiffusion", label: "DriftDiffusionIntegrator", def: { type: "DriftDiffusionIntegrator", label: "Drift Diffusion", color: "var(--pnv-type-drift-diffusion-integrator)", defaults: {}, icon: "DD" } },
          { id: "functions.integrator.driftonsphere", label: "DriftOnASphereIntegrator", def: { type: "DriftOnASphereIntegrator", label: "Drift on Sphere", color: "var(--pnv-type-drift-on-a-sphere-integrator)", defaults: {}, icon: "DS" } },
          { id: "functions.integrator.ornstein", label: "OrnsteinUhlenbeckIntegrator", def: { type: "OrnsteinUhlenbeckIntegrator", label: "Ornstein-Uhlenbeck", color: "var(--pnv-type-ornstein-uhlenbeck-integrator)", defaults: {}, icon: "OU" } },
          { id: "functions.integrator.leaky", label: "LeakyCompetingIntegrator", def: { type: "LeakyCompetingIntegrator", label: "Leaky Competing", color: "var(--pnv-type-leaky-competing-integrator)", defaults: {}, icon: "LC" } },
          { id: "functions.integrator.fitzhugh", label: "FitzHughNagumoIntegrator", def: { type: "FitzHughNagumoIntegrator", label: "FitzHugh-Nagumo", color: "var(--pnv-type-fitz-hugh-nagumo-integrator)", defaults: {}, icon: "FN" } },
          { id: "functions.integrator.interactive", label: "InteractiveActivationIntegrator", def: { type: "InteractiveActivationIntegrator", label: "Interactive Activation", color: "var(--pnv-type-interactive-activation-integrator)", defaults: {}, icon: "IA" } },
        ],
      },
      {
        id: "functions.distribution",
        label: "Distribution",
        children: [
          { id: "functions.distribution.normal", label: "NormalDist", def: { type: "NormalDist", label: "Normal", color: "var(--pnv-type-normal-dist)", defaults: {}, icon: "No" } },
          { id: "functions.distribution.uniform", label: "UniformDist", def: { type: "UniformDist", label: "Uniform", color: "var(--pnv-type-uniform-dist)", defaults: {}, icon: "Un" } },
          { id: "functions.distribution.exponential", label: "ExponentialDist", def: { type: "ExponentialDist", label: "Exponential", color: "var(--pnv-type-exponential-dist)", defaults: {}, icon: "Ed" } },
          { id: "functions.distribution.gamma", label: "GammaDist", def: { type: "GammaDist", label: "Gamma", color: "var(--pnv-type-gamma-dist)", defaults: {}, icon: "Gm" } },
          { id: "functions.distribution.wald", label: "WaldDist", def: { type: "WaldDist", label: "Wald", color: "var(--pnv-type-wald-dist)", defaults: {}, icon: "Wd" } },
          { id: "functions.distribution.uniformtonormal", label: "UniformToNormalDist", def: { type: "UniformToNormalDist", label: "Uniform→Normal", color: "var(--pnv-type-uniform-to-normal-dist)", defaults: {}, icon: "UN" } },
          { id: "functions.distribution.driftdiffusion_analytical", label: "DriftDiffusionAnalytical", def: { type: "DriftDiffusionAnalytical", label: "DDM Analytical", color: "var(--pnv-type-drift-diffusion-analytical)", defaults: {}, icon: "DA" } },
        ],
      },
      {
        id: "functions.transform",
        label: "Transform",
        children: [
          { id: "functions.transform.linearcombination", label: "LinearCombination", def: { type: "LinearCombination", label: "Linear Combination", color: "var(--pnv-type-linear-combination)", defaults: {}, icon: "LC" } },
          { id: "functions.transform.matrixtransform", label: "MatrixTransform", def: { type: "MatrixTransform", label: "Matrix Transform", color: "var(--pnv-type-matrix-transform)", defaults: {}, icon: "Mt" } },
          { id: "functions.transform.reduce", label: "Reduce", def: { type: "Reduce", label: "Reduce", color: "var(--pnv-type-reduce)", defaults: {}, icon: "Rd" } },
          { id: "functions.transform.concatenate", label: "Concatenate", def: { type: "Concatenate", label: "Concatenate", color: "var(--pnv-type-concatenate)", defaults: {}, icon: "Cn" } },
          { id: "functions.transform.rearrange", label: "Rearrange", def: { type: "Rearrange", label: "Rearrange", color: "var(--pnv-type-rearrange)", defaults: {}, icon: "Ra" } },
          { id: "functions.transform.combinemeans", label: "CombineMeans", def: { type: "CombineMeans", label: "Combine Means", color: "var(--pnv-type-combine-means)", defaults: {}, icon: "CM" } },
          { id: "functions.transform.predictionerrordelta", label: "PredictionErrorDeltaFunction", def: { type: "PredictionErrorDeltaFunction", label: "Prediction Error Delta", color: "var(--pnv-type-prediction-error-delta-function)", defaults: {}, icon: "PD" } },
        ],
      },
      {
        id: "functions.objective",
        label: "Objective",
        children: [
          { id: "functions.objective.stability", label: "Stability", def: { type: "Stability", label: "Stability", color: "var(--pnv-type-stability)", defaults: {}, icon: "St" } },
          { id: "functions.objective.energy", label: "Energy", def: { type: "Energy", label: "Energy", color: "var(--pnv-type-energy)", defaults: {}, icon: "En" } },
          { id: "functions.objective.entropy", label: "Entropy", def: { type: "Entropy", label: "Entropy", color: "var(--pnv-type-entropy)", defaults: {}, icon: "Ey" } },
          { id: "functions.objective.distance", label: "Distance", def: { type: "Distance", label: "Distance", color: "var(--pnv-type-distance)", defaults: {}, icon: "Di" } },
        ],
      },
      {
        id: "functions.optimization",
        label: "Optimization",
        children: [
          { id: "functions.optimization.gradient", label: "GradientOptimization", def: { type: "GradientOptimization", label: "Gradient", color: "var(--pnv-type-gradient-optimization)", defaults: {}, icon: "GO" } },
          { id: "functions.optimization.gridsearch", label: "GridSearch", def: { type: "GridSearch", label: "Grid Search", color: "var(--pnv-type-grid-search)", defaults: {}, icon: "GS" } },
          { id: "functions.optimization.gaussianprocess", label: "GaussianProcess", def: { type: "GaussianProcess", label: "Gaussian Process", color: "var(--pnv-type-gaussian-process)", defaults: {}, icon: "GP" } },
          { id: "functions.optimization.pecoptimization", label: "PECOptimizationFunction", def: { type: "PECOptimizationFunction", label: "PEC Optimization", color: "var(--pnv-type-pec-optimization-function)", defaults: {}, icon: "PO" } },
        ],
      },
      {
        id: "functions.selection",
        label: "Selection",
        children: [
          { id: "functions.selection.onehot", label: "OneHot", def: { type: "OneHot", label: "One-Hot", color: "var(--pnv-type-one-hot)", defaults: {}, icon: "OH" } },
        ],
      },
      {
        id: "functions.learning",
        label: "Learning",
        children: [
          { id: "functions.learning.hebbian", label: "Hebbian", def: { type: "Hebbian", label: "Hebbian", color: "var(--pnv-type-hebbian)", defaults: {}, icon: "Hb" } },
          { id: "functions.learning.contrastivehebbian", label: "ContrastiveHebbian", def: { type: "ContrastiveHebbian", label: "Contrastive Hebbian", color: "var(--pnv-type-contrastive-hebbian)", defaults: {}, icon: "CH" } },
          { id: "functions.learning.kohonen", label: "Kohonen", def: { type: "Kohonen", label: "Kohonen", color: "var(--pnv-type-kohonen)", defaults: {}, icon: "Kh" } },
          { id: "functions.learning.reinforcement", label: "Reinforcement", def: { type: "Reinforcement", label: "Reinforcement", color: "var(--pnv-type-reinforcement)", defaults: {}, icon: "Rf" } },
          { id: "functions.learning.tdlearning", label: "TDLearning", def: { type: "TDLearning", label: "TD Learning", color: "var(--pnv-type-td-learning)", defaults: {}, icon: "TD" } },
          { id: "functions.learning.backpropagation", label: "BackPropagation", def: { type: "BackPropagation", label: "Backpropagation", color: "var(--pnv-type-back-propagation)", defaults: {}, icon: "BP" } },
          { id: "functions.learning.bayesglm", label: "BayesGLM", def: { type: "BayesGLM", label: "Bayes GLM", color: "var(--pnv-type-bayes-glm)", defaults: {}, icon: "BG" } },
          { id: "functions.learning.emstorage", label: "EMStorage", def: { type: "EMStorage", label: "EM Storage", color: "var(--pnv-type-em-storage)", defaults: {}, icon: "EM" } },
        ],
      },
      {
        id: "functions.memory",
        label: "Memory",
        children: [
          { id: "functions.memory.buffer", label: "Buffer", def: { type: "Buffer", label: "Buffer", color: "var(--pnv-type-buffer)", defaults: {}, icon: "Bf" } },
          { id: "functions.memory.contentaddressable", label: "ContentAddressableMemory", def: { type: "ContentAddressableMemory", label: "Content Addressable", color: "var(--pnv-type-content-addressable-memory)", defaults: {}, icon: "CA" } },
          { id: "functions.memory.dictionary", label: "DictionaryMemory", def: { type: "DictionaryMemory", label: "Dictionary", color: "var(--pnv-type-dictionary-memory)", defaults: {}, icon: "DM" } },
        ],
      },
    ],
  },
  {
    id: "ports",
    label: "Ports",
    children: [
      { id: "ports.input", label: "InputPort", def: { type: "InputPort", label: "Input Port", color: "var(--pnv-type-input-port)", defaults: {}, icon: "Ip" } },
      { id: "ports.output", label: "OutputPort", def: { type: "OutputPort", label: "Output Port", color: "var(--pnv-type-output-port)", defaults: {}, icon: "Op" } },
      { id: "ports.parameter", label: "ParameterPort", def: { type: "ParameterPort", label: "Parameter Port", color: "var(--pnv-type-parameter-port)", defaults: {}, icon: "Pp" } },
      {
        id: "ports.modulatory",
        label: "Modulatory Signals",
        children: [
          { id: "ports.modulatory.control", label: "ControlSignal", def: { type: "ControlSignal", label: "Control Signal", color: "var(--pnv-type-control-signal)", defaults: {}, icon: "Cs" } },
          { id: "ports.modulatory.gating", label: "GatingSignal", def: { type: "GatingSignal", label: "Gating Signal", color: "var(--pnv-type-gating-signal)", defaults: {}, icon: "Gs" } },
          { id: "ports.modulatory.learning", label: "LearningSignal", def: { type: "LearningSignal", label: "Learning Signal", color: "var(--pnv-type-learning-signal)", defaults: {}, icon: "Ls" } },
        ],
      },
    ],
  },
];

/** Recursively collect all leaf PnlObjectDefs from the tree */
export function collectAllDefs(nodes: TaxonomyNode[]): PnlObjectDef[] {
  const result: PnlObjectDef[] = [];
  function walk(node: TaxonomyNode) {
    if (node.def) result.push(node.def);
    if (node.children) node.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

/** Flat list of all defs (for search, favorites, etc.) */
export const ALL_PNL_DEFS: PnlObjectDef[] = collectAllDefs(PNL_TAXONOMY_TREE);

/** Find a def by type name */
export function findDefByType(type: string): PnlObjectDef | undefined {
  return ALL_PNL_DEFS.find((d) => d.type === type);
}

// Type names under the top-level "projections" category. A projection
// connects two nodes, so a palette drag of one of these can't become a
// graph node — it routes through the add_projection path instead (#311).
export const PROJECTION_TYPES: Set<string> = new Set(
  collectAllDefs(PNL_TAXONOMY_TREE.filter((n) => n.id === "projections")).map(
    (d) => d.type,
  ),
);

/** True if `type` is a projection class (Mapping, Control, Learning, …). */
export function isProjectionType(type: string): boolean {
  return PROJECTION_TYPES.has(type);
}

// Type -> accent colour (MechanismNode when nodes are coloured by type, and
// the palette's dot). Each is a palette token, --pnv-type-*, defined in
// styles/palette.css beside the rest of the colours (#1302).
export const TYPE_COLORS: Record<string, string> = Object.fromEntries(
  ALL_PNL_DEFS.map((d) => [d.type, d.color]),
);

// Role -> colour (matches show_graph defaults): the node role tokens from
// docs/icon-ontology.md. A colour picker that needs the hex reads the token
// through paletteHex() (utils/paletteColor.ts), as GraphStylePanel does.
export const ROLE_COLORS: Record<string, string> = {
  INPUT: "var(--pnv-role-input)",
  OUTPUT: "var(--pnv-role-output)",
  SINGLETON: "var(--pnv-role-singleton)",
  PROBE: "var(--pnv-role-probe)",
  CONTROL: "var(--pnv-role-control)",
  CONTROLLER: "var(--pnv-role-controller)",
  CONTROLLER_OBJECTIVE: "var(--pnv-role-controller)",
  LEARNING: "var(--pnv-role-learning)",
  FEEDBACK_SENDER: "var(--pnv-role-feedback-sender)",
  CYCLE: "var(--pnv-role-cycle)",
  INTERNAL: "var(--pnv-role-internal)",
};

/** The palette token behind each role colour, for code that needs the hex. */
export const ROLE_TOKENS: Record<string, `--pnv-${string}`> = Object.fromEntries(
  Object.entries(ROLE_COLORS).map(([role, v]) => [role, v.slice(4, -1) as `--pnv-${string}`]),
);

// Role priority -- higher priority roles determine the color
export const ROLE_PRIORITY: string[] = [
  "CONTROLLER", "CONTROLLER_OBJECTIVE", "CONTROL", "LEARNING",
  "PROBE", "OUTPUT", "INPUT", "FEEDBACK_SENDER", "CYCLE", "INTERNAL",
];

