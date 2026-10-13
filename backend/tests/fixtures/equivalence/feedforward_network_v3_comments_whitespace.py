"""A heavily-commented, loosely-formatted variant of feedforward_network.

Should normalize to exactly the same standardized output as the canonical
variant (v1) and the star-import variant (v2). Extra comments, blank
lines, and trailing-comma quirks must not survive canonicalization.
"""

import psyneulink as pnl
import numpy as np


# ===========================================================
# Layers
# ===========================================================

# Hidden layer: 3 sigmoid units between input and output.
hidden_layer = pnl.TransferMechanism(
    input_shapes=[3],                       # 3 hidden units
    function=pnl.Logistic(gain=1.5),        # sigmoid with custom gain
    name='hidden_layer'
)



# -----------------------------------------------------------
#  Input layer — raw features
# -----------------------------------------------------------
input_layer = pnl.TransferMechanism(input_shapes=[4], function=pnl.Linear(), name='input_layer')


# Output layer: 2 sigmoid units (two-class decision).
output_layer = pnl.TransferMechanism(
    input_shapes=[2],
    function=pnl.Logistic(gain=2.0),
    name='output_layer'
)

# ===========================================================
# Projections (weight matrices)
# ===========================================================

hidden_to_output = pnl.MappingProjection(
    sender=hidden_layer,
    receiver=output_layer,
    matrix=np.array(
        [
            [ 1.0, -1.0],   # hidden_0 -> [+out_0, -out_1]
            [-1.0,  1.0],   # hidden_1 -> [-out_0, +out_1]
            [ 0.5,  0.5],   # hidden_2 -> uniform bias
        ]
    ),
    name='hidden_to_output',
)

# 4 inputs project into 3 hidden units.
input_to_hidden = pnl.MappingProjection(
    sender=input_layer,
    receiver=hidden_layer,
    matrix=np.array([[0.5, -0.5, 0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.0, 0.0, 1.0]]),
    name='input_to_hidden',
)

# Composition
ff_network = pnl.Composition(name='ff_network')

# Add nodes
ff_network.add_node(hidden_layer)
ff_network.add_node(input_layer)
ff_network.add_node(output_layer)

# Add projections
ff_network.add_projection(hidden_to_output)
ff_network.add_projection(input_to_hidden)
