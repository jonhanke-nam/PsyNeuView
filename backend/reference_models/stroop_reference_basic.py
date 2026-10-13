# PsyNeuLink Model File
# Format Version: 1.0
# PsyNeuLink: 0.18.0.0
# Model: stroop_basic

import psyneulink as pnl
import numpy as np

# ===========================================================
# Stroop Model (Cohen et al., 1990) — simplified
# From the PsyNeuLink Basics and Primer: "Elaborate Configurations"
#
# Two processing pathways (color naming, word reading) plus
# task specification pathways, converging on a DDM decision.
#
# Element-name convention (Cohen 1990): each 2-unit layer's index 0
# represents "red" / first response channel, index 1 represents
# "green" / second response channel. Per-mechanism element labels
# live in the sidecar ``stroop_reference_basic.labels.yaml`` (Layer 3
# in PsyNeuView's three-layer plan, #356 / #361) so this model file
# stays compatible with stock PsyNeuLink — PsyNeuView's resolver
# surfaces the labels through the pill / Run State / Inspector
# regardless of whether the runtime PsyNeuLink supports the
# model-intrinsic ``element_names`` kwarg.
# ===========================================================

# Mechanisms
# ===========================================================

# Color naming pathway
color_input = pnl.ProcessingMechanism(
    input_shapes=2,
    name='color_input',
)

color_hidden = pnl.TransferMechanism(
    input_shapes=2,
    function=pnl.Logistic(bias=-4, gain=1.1),
    name='color_hidden',
)

# Word reading pathway
word_input = pnl.ProcessingMechanism(
    input_shapes=2,
    name='word_input',
    function=pnl.Linear(offset=1),
)

word_hidden = pnl.TransferMechanism(
    input_shapes=2,
    function=pnl.Logistic(bias=-4),
    name='word_hidden',
)

# Shared output layer
output = pnl.TransferMechanism(
    input_shapes=2,
    function=pnl.Logistic(),
    name='output',
)

# Task specification
#   task_to_color [[4,4],[0,0]] enables both color-hidden units when
#   task_input[0] is on → task_input[0] is the "color naming" task.
#   task_to_word  [[0,0],[4,4]] mirrors for the word-reading task at
#   task_input[1].
task_input = pnl.ProcessingMechanism(
    input_shapes=2,
    name='task_input',
)

# Decision mechanism
decision = pnl.DDM(
    input_format=pnl.ARRAY,
    function=pnl.DriftDiffusionIntegrator(),
    name='decision'
)

# ===========================================================
# Projections (with hand-set weight matrices)
# ===========================================================

# Color pathway weights
color_input_to_hidden = pnl.MappingProjection(
    sender=color_input,
    receiver=color_hidden,
    matrix=np.array([[2, -2], [-2, 2]]),
    name='color_input_to_hidden'
)

color_hidden_to_output = pnl.MappingProjection(
    sender=color_hidden,
    receiver=output,
    matrix=np.array([[2, -2], [-2, 2]]),
    name='color_hidden_to_output'
)

# Word pathway weights (stronger — word reading is more automatic)
word_input_to_hidden = pnl.MappingProjection(
    sender=word_input,
    receiver=word_hidden,
    matrix=np.array([[3, -3], [-3, 3]]),
    name='word_input_to_hidden'
)

word_hidden_to_output = pnl.MappingProjection(
    sender=word_hidden,
    receiver=output,
    matrix=np.array([[3, -3], [-3, 3]]),
    name='word_hidden_to_output'
)

# Task specification weights
task_to_color = pnl.MappingProjection(
    sender=task_input,
    receiver=color_hidden,
    matrix=np.array([[4, 4], [0, 0]]),
    name='task_to_color'
)

task_to_word = pnl.MappingProjection(
    sender=task_input,
    receiver=word_hidden,
    matrix=np.array([[0, 0], [4, 4]]),
    name='task_to_word'
)

# Output to decision
output_to_decision = pnl.MappingProjection(
    sender=output,
    receiver=decision,
    name='output_to_decision'
)

# ===========================================================
# Composition
# ===========================================================

stroop_model = pnl.Composition(name='stroop_model')

# Add nodes
stroop_model.add_node(color_input)
stroop_model.add_node(color_hidden)
stroop_model.add_node(word_input)
stroop_model.add_node(word_hidden)
stroop_model.add_node(output)
stroop_model.add_node(task_input)
stroop_model.add_node(decision)

# Add projections
stroop_model.add_projection(color_input_to_hidden)
stroop_model.add_projection(color_hidden_to_output)
stroop_model.add_projection(word_input_to_hidden)
stroop_model.add_projection(word_hidden_to_output)
stroop_model.add_projection(task_to_color)
stroop_model.add_projection(task_to_word)
stroop_model.add_projection(output_to_decision)