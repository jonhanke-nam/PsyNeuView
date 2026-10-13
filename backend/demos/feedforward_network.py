# PsyNeuLink Model File
# Format Version: 1.0
# PsyNeuLink: 0.18.0.0
# Model: feedforward_network

import psyneulink as pnl

# ===========================================================
# A simple 3-layer feedforward neural network (5-2-5).
# From the PsyNeuLink Basics and Primer: "Simple Configurations"
# ===========================================================

# Input layer: 5 units, linear (default)
input_layer = pnl.ProcessingMechanism(
    input_shapes=5,
    name='input_layer'
)

# Hidden layer: 2 units, logistic activation
hidden_layer = pnl.ProcessingMechanism(
    input_shapes=2,
    function=pnl.Logistic(),
    name='hidden_layer'
)

# Output layer: 5 units, logistic activation
output_layer = pnl.ProcessingMechanism(
    input_shapes=5,
    function=pnl.Logistic(),
    name='output_layer'
)

# ===========================================================
# Projections
# ===========================================================

input_to_hidden = pnl.MappingProjection(
    sender=input_layer,
    receiver=hidden_layer,
    name='input_to_hidden'
)

hidden_to_output = pnl.MappingProjection(
    sender=hidden_layer,
    receiver=output_layer,
    name='hidden_to_output'
)

# ===========================================================
# Composition
# ===========================================================

my_network = pnl.Composition(name='my_network')
my_network.add_node(input_layer)
my_network.add_node(hidden_layer)
my_network.add_node(output_layer)
my_network.add_projection(input_to_hidden)
my_network.add_projection(hidden_to_output)
