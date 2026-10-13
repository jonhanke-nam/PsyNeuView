"""A heavily-commented, loosely-formatted variant of neural_network_with_ddm.

Should normalize to exactly the same standardized output as the canonical
variant (v1) and the star-import variant (v2). Extra comments, blank
lines, and trailing-comma quirks must not survive canonicalization.

Pins DDM serialization in particular: drift_rate / threshold / noise on
DriftDiffusionAnalytical must come back alphabetized in the canonical
output regardless of source order.
"""

import psyneulink as pnl
import numpy as np


# ===========================================================
# Mechanisms
# ===========================================================

# Decision unit: a drift-diffusion process integrating evidence.
decision = pnl.DDM(
    function=pnl.DriftDiffusionAnalytical(
        drift_rate=2.0,      # strong evidence pull
        threshold=1.5,       # moderate decision boundary
        noise=0.3            # nontrivial diffusion noise
    ),
    name='decision'
)



# -----------------------------------------------------------
#  Hidden layer (1 sigmoid unit between input and DDM)
# -----------------------------------------------------------
hidden_layer = pnl.TransferMechanism(input_shapes=[1], function=pnl.Logistic(gain=1.5), name='hidden_layer')


# Input layer: 2 raw evidence features (e.g. red vs green stimulus).
input_layer = pnl.TransferMechanism(
    input_shapes=[2],
    function=pnl.Linear(),
    name='input_layer'
)

# ===========================================================
# Projections (weights)
# ===========================================================

hidden_to_decision = pnl.MappingProjection(
    sender=hidden_layer,
    receiver=decision,
    matrix=np.array(
        [
            [1.5],   # single hidden unit drives a single DDM input
        ]
    ),
    name='hidden_to_decision',
)

# 2 inputs collapse onto a single hidden unit (red pushes +, green pushes -)
input_to_hidden = pnl.MappingProjection(
    sender=input_layer,
    receiver=hidden_layer,
    matrix=np.array([[0.5], [-0.5]]),
    name='input_to_hidden',
)

# Composition
decision_network = pnl.Composition(name='decision_network')

# Add nodes
decision_network.add_node(decision)
decision_network.add_node(hidden_layer)
decision_network.add_node(input_layer)

# Add projections
decision_network.add_projection(hidden_to_decision)
decision_network.add_projection(input_to_hidden)
