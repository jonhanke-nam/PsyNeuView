# PsyNeuLink Model File
# Format Version: 1.0
# Model: hebbian_learning

import psyneulink as pnl

# ===========================================================
# Hebbian learning in one recurrent layer
# From the Cognitive Neuroscience Course, Module 1, "Hebbian
# learning": docs/source/tutorials/cognitive_neuroscience_course/
#   1_dynamics_in_perception/notebooks/1_hebbian_learning.ipynb
# on the PrincetonUniversity/PsyNeuLink docs/refactor-documentation
# branch (PsyNeuView #48).
#
# Nine feature units (three sizes, three colours, three shapes)
# connected to each other by a recurrent projection that learns
# with PsyNeuLink's Hebbian rule: each trial, the weight between
# two units grows by learning_rate x (their activities' product).
# Features that appear together in an object end up wired together.
#
# There is no target and no error, so there is no loss. The Learn
# tab reports the *weight change* each epoch instead: how far the
# learned weights moved, relative to their size. Hebbian learning
# never stops on its own — every epoch adds the same amount — so
# that relative change falls towards zero (1, 1/2, 1/3, ...) as
# the weights grow.
#
# Two settings make this the notebook's "fire together, wire
# together" model rather than something stranger:
#
# * Activity is cleared at the start of every trial (integrator_mode
#   with integration_rate 1, reset at each trial's start). This is the
#   notebook's own fix, its clear_value() callback. Without it, the
#   previous object's activity feeds back into the next one, the
#   network learns associations *between* objects, and with a Linear
#   unit the weights blow up to inf, then NaN.
#
# * Each trial the layer updates twice: first it takes in the object,
#   then its learned connections pass that activity along once. So a
#   partial cue (a triangle alone) comes out completed by what it was
#   wired to (large, blue). Learning uses the first update, the object
#   as it was shown.
#
# With a learning rate of 0.05 and 20 epochs, each pair of features
# that appear together ends with a weight of 1.0; pairs that never
# appear together stay at 0.
#
# This is a plain Composition, not an AutodiffComposition: it trains
# under ExecutionMode.Python, through PsyNeuLink's own learning
# mechanism (the AutoAssociativeLearningMechanism that
# enable_learning=True creates).
# ===========================================================

# Features: small, medium, large, red, yellow, blue, circle,
# rectangle, triangle.

# Mechanism
# ===========================================================

feature_layer = pnl.RecurrentTransferMechanism(
    name='feature_layer',
    input_shapes=9,
    function=pnl.Linear,
    enable_learning=True,
    learning_rate=0.05,
    auto=0,
    hetero=0,
    integrator_mode=True,
    integration_rate=1.0,
    reset_stateful_function_when=pnl.AtTrialStart(),
)

# Composition
# ===========================================================

hebbian_learning = pnl.Composition(name='hebbian_learning')
hebbian_learning.add_node(feature_layer)
# Two updates per trial: take in the object, then pass it along once.
hebbian_learning.termination_processing = {
    pnl.TimeScale.TRIAL: pnl.AfterNCalls(feature_layer, 2),
}

# Training set
# ===========================================================
# The notebook's three objects, one per trial. No targets: this
# is the shape Composition.learn takes for a model that learns
# without them, and the Learn tab opens with it.

small_red_circle = [1, 0, 0, 1, 0, 0, 1, 0, 0]
medium_yellow_rectangle = [0, 1, 0, 0, 1, 0, 0, 1, 0]
large_blue_triangle = [0, 0, 1, 0, 0, 1, 0, 0, 1]

three_objects = {
    "inputs": {feature_layer: [small_red_circle, medium_yellow_rectangle, large_blue_triangle]},
    "epochs": 20,
}
