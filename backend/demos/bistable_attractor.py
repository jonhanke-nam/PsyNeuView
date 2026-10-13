# PsyNeuLink Model File
# Format Version: 1.0
# PsyNeuLink: 0.19.0.0
# Model: bistable_attractor

import psyneulink as pnl
import numpy as np

# ===========================================================
# Bistable attractor: two nodes that inhibit each other
# From the Cognitive Neuroscience Course, Module 1, "Dynamic
# Systems and Bistable Perception":
# docs/source/tutorials/cognitive_neuroscience_course/
#   1_dynamics_in_perception/notebooks/
#   3_dynamic_systems_and_bistable_perception.ipynb
# on the PrincetonUniversity/PsyNeuLink docs/refactor-documentation
# branch. Same mechanisms, weights and names as the notebook's
# Logistic version.
#
# Each node integrates over time and inhibits the other through a
# weight of -1, so the pair settles into a stable state (an
# attractor). The course drives it with a single kick, 2 into
# node_attract1 and 6 into node_attract2 on the first trial, then
# nine trials of zero input, and watches where it settles.
# ===========================================================

# Mechanisms
# ===========================================================

node_attract1 = pnl.TransferMechanism(
    name='node_attract1',
    function=pnl.Logistic(gain=1, bias=0, offset=0),
    integrator_mode=True,
    integration_rate=.5,
    default_variable=np.zeros((1,)),
)

node_attract2 = pnl.TransferMechanism(
    name='node_attract2',
    function=pnl.Logistic(gain=1, bias=0, offset=0),
    integrator_mode=True,
    integration_rate=.5,
    default_variable=np.zeros((1,)),
)

# Projections: mutual inhibition
# ===========================================================

connect_a1_a2 = pnl.MappingProjection(
    name='connect_a1_a2',
    matrix=[-1],
)

connect_a2_a1 = pnl.MappingProjection(
    name='connect_a2_a1',
    matrix=[-1],
)

# Composition
# ===========================================================

bistable_attractor = pnl.Composition(name='bistable_attractor')
bistable_attractor.add_linear_processing_pathway(
    pathway=(node_attract1, connect_a1_a2, node_attract2, connect_a2_a1, node_attract1)
)

# Inputs
# ===========================================================
# The course's two experiments, in the shape Composition.run takes. The
# app offers them in the Run tab by these names (#1216).

kick = {
    node_attract1: [2] + [0] * 9,
    node_attract2: [6] + [0] * 9,
}

steady_difference = {
    node_attract1: [0] * 10,
    node_attract2: [1] * 10,
}
