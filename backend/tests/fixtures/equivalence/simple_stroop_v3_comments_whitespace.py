"""A heavily-commented, loosely-formatted variant of simple_stroop.

Should normalize to exactly the same standardized output as the canonical
variant (v1) and the star-import variant (v2). Extra comments, blank
lines, and trailing-comma quirks must not survive canonicalization.
"""

import psyneulink as pnl
import numpy as np


# -----------------------------------------------------------
#  Color input layer
# -----------------------------------------------------------
# Red / green / blue activations. Continuous values.
colors_input = pnl.TransferMechanism(
    input_shapes=[3],            # 3 units
    function=pnl.Linear(),       # identity function
    name='colors_input'
)



# -----------------------------------------------------------
#  Word input layer
# -----------------------------------------------------------
words_input = pnl.TransferMechanism(input_shapes=[3], function=pnl.Linear(intercept=0.1), name='words_input')


# Response layer: 2 units (say_red, say_green), sigmoid-squashed.
response = pnl.TransferMechanism(
    input_shapes=[2],
    function=pnl.Logistic(gain=1.0),
    name='response'
)

# ===========================================================
# Projections
# ===========================================================

colors_to_response = pnl.MappingProjection(
    sender=colors_input,
    receiver=response,
    matrix=np.array(
        [
            [ 1.5, -1.0],   # red   -> [+say_red, -say_green]
            [-1.0,  1.5],   # green -> [-say_red, +say_green]
            [ 0.0,  0.0],   # blue  -> no effect
        ]
    ),
    name='colors_to_response',
)

# words are STRONGER than colors (the Stroop effect)
words_to_response = pnl.MappingProjection(
    sender=words_input,
    receiver=response,
    matrix=np.array([[2.5, -1.5], [-1.5, 2.5], [0.0, 0.0]]),
    name='words_to_response',
)

# Composition
stroop_model = pnl.Composition(name='stroop_model')

# Add nodes
stroop_model.add_node(colors_input)
stroop_model.add_node(words_input)
stroop_model.add_node(response)

# Add projections
stroop_model.add_projection(colors_to_response)
stroop_model.add_projection(words_to_response)
