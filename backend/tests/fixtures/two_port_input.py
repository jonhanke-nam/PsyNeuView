# PsyNeuLink Model File
# Format Version: 1.0
# PsyNeuLink: 0.18.0.0
# Model: two_port_input

# An input node with two input ports of different sizes (#332): task_demand
# takes [RED_task (2 elements), WORD_task (1 element)] each trial, written
# [[1, 0], [0]] in Composition.run's inputs.

import psyneulink as pnl

# ==============================================================
# Mechanisms
# ==============================================================

color_input = pnl.TransferMechanism(
    input_shapes=[2],
    function=pnl.Linear(),
    name='color_input'
)

task_demand = pnl.ProcessingMechanism(
    input_ports=[
        {pnl.NAME: 'RED_task', pnl.VARIABLE: [0, 0]},
        {pnl.NAME: 'WORD_task', pnl.VARIABLE: [0]},
    ],
    output_ports=[
        {pnl.NAME: 'RED_out', pnl.VARIABLE: (pnl.OWNER_VALUE, 0)},
        {pnl.NAME: 'WORD_out', pnl.VARIABLE: (pnl.OWNER_VALUE, 1)},
    ],
    name='task_demand'
)

response = pnl.TransferMechanism(
    input_shapes=[2],
    function=pnl.Linear(),
    name='response'
)

# ==============================================================
# Projections
# ==============================================================

color_to_response = pnl.MappingProjection(
    sender=color_input,
    receiver=response,
    name='color_to_response'
)

task_to_response = pnl.MappingProjection(
    sender=task_demand.output_ports['RED_out'],
    receiver=response,
    name='task_to_response'
)

# ==============================================================
# Compositions
# ==============================================================

two_port_input = pnl.Composition(name='two_port_input')
two_port_input.add_node(color_input)
two_port_input.add_node(task_demand)
two_port_input.add_node(response)
two_port_input.add_projection(color_to_response, color_input, response)
two_port_input.add_projection(task_to_response, task_demand, response)
