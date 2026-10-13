# PsyNeuLink Model File
# Format Version: 1.0
# PsyNeuLink: 0.19.0.0
# Model: logic_gate_network

import psyneulink as pnl
import numpy as np

# ===========================================================
# Two-layer logic-gate network
# From the Cognitive Neuroscience Course, Module 0, "Perceptron
# and XOR":
# docs/source/tutorials/cognitive_neuroscience_course/
#   0_primer/notebooks/3_perceptron_and_xor.ipynb
# on the PrincetonUniversity/PsyNeuLink docs/refactor-documentation
# branch. Same layers, sizes and learning rate as the notebook.
#
# Three inputs (A, B, and a constant 1 that acts as a trainable
# bias) feed one Logistic output. Trained with backpropagation, it
# learns AND and OR, but not XOR: XOR isn't linearly separable, so
# no single layer of weights can draw its boundary.
#
# The notebook starts from np.random.rand weights; this seeds them,
# so a run in the app always tells the same story.
# ===========================================================

np.random.seed(0)

# Mechanisms
# ===========================================================

in_layer = pnl.TransferMechanism(
    name='in_layer',
    input_shapes=3,
    function=pnl.Linear,
)

out_layer = pnl.TransferMechanism(
    name='out_layer',
    input_shapes=1,
    function=pnl.Logistic,
)

# Projection
# ===========================================================

in_to_out = pnl.MappingProjection(
    name='in_to_out',
    matrix=np.random.rand(3, 1),
    sender=in_layer,
    receiver=out_layer,
)

# Composition
# ===========================================================

logic_gate_network = pnl.AutodiffComposition(
    name='logic_gate_network',
    learning_rate=10,
)
logic_gate_network.add_node(in_layer)
logic_gate_network.add_node(out_layer)
logic_gate_network.add_projection(sender=in_layer, projection=in_to_out, receiver=out_layer)

# Training sets
# ===========================================================
# The notebook's three gates, in the shape AutodiffComposition.learn takes.
# The app offers them in the Learn tab by these names (#1216). The third
# input is the constant 1 that acts as a bias.

patterns = [[0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 1]]

and_gate = {"inputs": {in_layer: patterns}, "targets": {out_layer: [[0], [0], [0], [1]]}, "epochs": 50}
or_gate = {"inputs": {in_layer: patterns}, "targets": {out_layer: [[0], [1], [1], [1]]}, "epochs": 50}
xor_gate = {"inputs": {in_layer: patterns}, "targets": {out_layer: [[0], [1], [1], [0]]}, "epochs": 50}
