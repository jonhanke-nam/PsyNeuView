# PsyNeuLink Model File
# Format Version: 1.0
# Model: xor_comp

import psyneulink as pnl
import numpy as np

# ===========================================================
# XOR Learning: a three-layer network learns XOR by backpropagation
# From PsyNeuLink's Basics and Primer, "Learning"
# (docs/source/BasicsAndPrimer.rst, LearningMechanisms), with the
# Primer's own code and names, brought up to PsyNeuLink 0.20.2.0:
#
#   - Composition(name='XOR Composition'): the first positional
#     argument is now pathways, so the Primer's
#     Composition('XOR Composition') is refused.
#   - add_backpropagation_learning_pathway returns a Pathway; the
#     Learn tab finds the TARGET mechanism it made for you.
#   - The starting weights are random in the Primer
#     (np.random.rand); here they come from a seeded generator, so
#     every run starts from the same weights and its numbers can be
#     quoted.
#
# Input (two units) -> Hidden (ten, Logistic) -> Output (one,
# Logistic). The call adds the learning components: a TARGET
# mechanism, a Comparator, and a LearningMechanism for each
# projection, which sends a LearningProjection to change its matrix.
# ===========================================================

# Mechanisms and Projections
# ===========================================================

rng = np.random.default_rng(1)

input = pnl.ProcessingMechanism(name='Input', default_variable=np.zeros(2))
hidden = pnl.ProcessingMechanism(name='Hidden', default_variable=np.zeros(10), function=pnl.Logistic())
output = pnl.ProcessingMechanism(name='Output', default_variable=np.zeros(1), function=pnl.Logistic())
input_weights = pnl.MappingProjection(name='Input Weights', matrix=rng.random((2, 10)))
output_weights = pnl.MappingProjection(name='Output Weights', matrix=rng.random((10, 1)))

# Composition, with backpropagation along the pathway
# ===========================================================

xor_comp = pnl.Composition(name='XOR Composition')
learning_components = xor_comp.add_backpropagation_learning_pathway(
    pathway=[input, input_weights, hidden, output_weights, output])

# Training set
# ===========================================================
# The four XOR conditions, in the shape Composition.learn takes.
# The target is given for Output; the Learn tab opens with it.

xor_training = {
    "inputs": {input: [[0, 0], [0, 1], [1, 0], [1, 1]]},
    "targets": {output: [[0], [1], [1], [0]]},
    "epochs": 250,
}
