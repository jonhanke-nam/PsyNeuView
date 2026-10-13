# PsyNeuLink Model File
# Format Version: 1.0
# Model: simple_stroop_learn
#
# Learning variant of simple_stroop (#542): same architecture, but as an
# AutodiffComposition whose pathway weights START NEAR ZERO and are meant
# to be TRAINED rather than hand-set.
#
# The classic Stroop story (Cohen, Dunbar & McClelland, 1990) is that word
# reading dominates color naming because it is more practiced — not because
# it is wired differently. Train this model with more word-reading trials
# than color-naming trials and the word-pathway weights grow larger than
# the color-pathway weights, reproducing the asymmetry that simple_stroop
# hard-codes by hand.

import psyneulink as pnl
import numpy as np

# ============================================================
# Mechanisms (same shapes and conventions as simple_stroop)
# ============================================================

# Input layers: 3 units each, representing [red, green, blue].
colors_input = pnl.TransferMechanism(
    input_shapes=[3],
    function=pnl.Linear(),
    name='colors_input'
)

words_input = pnl.TransferMechanism(
    input_shapes=[3],
    function=pnl.Linear(),
    name='words_input'
)

# Response layer: 2 units [say_red, say_green], squashed by a sigmoid.
response = pnl.TransferMechanism(
    input_shapes=[2],
    function=pnl.Logistic(gain=1.0),
    name='response'
)

# ============================================================
# Projections — near-zero initial weights (to be learned)
# ============================================================

colors_to_response = pnl.MappingProjection(
    sender=colors_input,
    receiver=response,
    matrix=np.full((3, 2), 0.01),
    name='colors_to_response'
)

words_to_response = pnl.MappingProjection(
    sender=words_input,
    receiver=response,
    matrix=np.full((3, 2), 0.01),
    name='words_to_response'
)

# ============================================================
# Composition
# ============================================================

stroop_learn_model = pnl.AutodiffComposition(
    name='stroop_learn_model',
    learning_rate=0.5,
)

stroop_learn_model.add_node(colors_input)
stroop_learn_model.add_node(words_input)
stroop_learn_model.add_node(response)
stroop_learn_model.add_projection(colors_to_response)
stroop_learn_model.add_projection(words_to_response)
