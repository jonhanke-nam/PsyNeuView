# PsyNeuLink Model File
# Format Version: 1.0
# PsyNeuLink: 0.18.0.0
# Model: two_port_learn

# A learning pathway whose input node has two input ports of different
# sizes (#358): task_demand takes [RED_task (2 elements), WORD_task (1
# element)] each trial, so the Learn panel's input grid has one group of
# boxes per port.

import psyneulink as pnl

# ==============================================================
# Mechanisms
# ==============================================================

task_demand = pnl.ProcessingMechanism(
    input_ports=[
        {pnl.NAME: 'RED_task', pnl.VARIABLE: [0, 0]},
        {pnl.NAME: 'WORD_task', pnl.VARIABLE: [0]},
    ],
    name='task_demand'
)

hidden = pnl.TransferMechanism(
    input_shapes=[2],
    function=pnl.Logistic(),
    name='hidden'
)

response = pnl.TransferMechanism(
    input_shapes=[2],
    function=pnl.Logistic(),
    name='response'
)

# ==============================================================
# Compositions
# ==============================================================

two_port_learn = pnl.Composition(name='two_port_learn')
two_port_learn.add_backpropagation_learning_pathway(
    [task_demand, hidden, response], learning_rate=0.5
)
