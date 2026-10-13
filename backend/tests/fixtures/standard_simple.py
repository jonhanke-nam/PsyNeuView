# PsyNeuLink Model File
# Format Version: 1.0
# PsyNeuLink: 0.18.0.0
# Model: standard_simple

import psyneulink as pnl

# ==============================================================
# Mechanisms
# ==============================================================

input_node = pnl.TransferMechanism(
    input_shapes=[2],
    function=pnl.Linear(),
    name='input_node'
)

output_node = pnl.TransferMechanism(
    input_shapes=[2],
    function=pnl.Logistic(gain=1.0, bias=-2.0),
    name='output_node'
)

# ==============================================================
# Projections
# ==============================================================

input_to_output = pnl.MappingProjection(
    sender=input_node,
    receiver=output_node,
    name='input_to_output'
)

# ==============================================================
# Compositions
# ==============================================================

standard_simple = pnl.Composition(name='standard_simple')
standard_simple.add_node(input_node)
standard_simple.add_node(output_node)
standard_simple.add_projection(input_to_output)
