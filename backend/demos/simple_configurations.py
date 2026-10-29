# PsyNeuLink Model File
# Format Version: 1.0
# Model: my_network

import psyneulink as pnl

# ===========================================================
# Simple Configurations: a 5-2-5 network made from a pathway
# From PsyNeuLink's Basics and Primer, "Simple Configurations"
# (docs/source/BasicsAndPrimer.rst), with the Primer's own code
# and names.
#
#   Input   five units. A ProcessingMechanism's default function
#           is Linear, so it passes its input through unchanged.
#   hidden  two units, Logistic.
#   output  five units, Logistic.
#
# No projection is written below. The pathway list says only the
# order of the three mechanisms, and PsyNeuLink makes a
# MappingProjection from each to the next, sized to fit (5 by 2,
# then 2 by 5), with its default FULL_CONNECTIVITY_MATRIX: every
# sending unit joined to every receiving unit with a weight of 1.
#
# So each hidden unit gets the sum of the five inputs, and each
# output unit the sum of the two hidden units. The Primer's input
# [1, 4.7, 3.2, 6, 2] sums to 16.9: both hidden units are
# Logistic(16.9), about 1, and every output is Logistic(2), about
# 0.881.
# ===========================================================

# Mechanisms
# ===========================================================

input_layer = pnl.ProcessingMechanism(input_shapes=5, name='Input')
hidden_layer = pnl.ProcessingMechanism(input_shapes=2, function=pnl.Logistic, name='hidden')
output_layer = pnl.ProcessingMechanism(input_shapes=5, function=pnl.Logistic, name='output')

# Composition: the pathway makes the projections
# ===========================================================

my_network = pnl.Composition(pathways=[[input_layer, hidden_layer, output_layer]], name='my_network')

# Inputs
# ===========================================================
# The Primer's run, in the shape Composition.run takes. The Run
# tab offers it by this name, and opens with it.

primer_input = {input_layer: [[1, 4.7, 3.2, 6, 2]]}
