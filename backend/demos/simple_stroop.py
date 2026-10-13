# PsyNeuLink Model File
# Format Version: 1.0
# PsyNeuLink: 0.18.0.0
# Model: simple_stroop

import psyneulink as pnl
import numpy as np

# ============================================================
# Mechanisms
# ============================================================

# Input layers: 3 units each, representing [red, green, blue].
# Activations are continuous (e.g., 1.0 = fully on, 0.0 = off).
colors_input = pnl.TransferMechanism(
    input_shapes=[3],
    function=pnl.Linear(),
    name='colors_input'
)

words_input = pnl.TransferMechanism(
    input_shapes=[3],
    function=pnl.Linear(intercept=0.1),
    name='words_input'
)

# Response layer: 2 units [say_red, say_green], squashed by a sigmoid.
# Higher activation = stronger tendency to give that response.
response = pnl.TransferMechanism(
    input_shapes=[2],
    function=pnl.Logistic(gain=1.0),
    name='response'
)

# ============================================================
# Projections (with hand-set weight matrices)
# ============================================================

# Color pathway: WEAKER weights (color naming is slower/less automatic).
#   red color  → say_red (positive),  red color  → say_green (inhibitory)
#   green color→ say_green (positive), green color→ say_red (inhibitory)
#   blue has weak/no mapping to either response.
colors_to_response = pnl.MappingProjection(
    sender=colors_input,
    receiver=response,
    matrix=np.array([
        [ 1.5, -1.0],   # red   → [+say_red, -say_green]
        [-1.0,  1.5],   # green → [-say_red, +say_green]
        [ 0.0,  0.0],   # blue  → no effect
    ]),
    name='colors_to_response'
)

# Word pathway: STRONGER weights (reading is fast/automatic).
#   Same structure but higher magnitude — reflects that word reading
#   is more practiced and harder to suppress.
words_to_response = pnl.MappingProjection(
    sender=words_input,
    receiver=response,
    matrix=np.array([
        [ 2.5, -1.5],   # word "red"   → [+say_red, -say_green]
        [-1.5,  2.5],   # word "green" → [-say_red, +say_green]
        [ 0.0,  0.0],   # word "blue"  → no effect
    ]),
    name='words_to_response'
)

# ============================================================
# Compositions
# ============================================================

stroop_model = pnl.Composition(name='stroop_model')

# --- Structure ---
stroop_model.add_node(colors_input)
stroop_model.add_node(words_input)
stroop_model.add_node(response)
stroop_model.add_projection(colors_to_response)
stroop_model.add_projection(words_to_response)
