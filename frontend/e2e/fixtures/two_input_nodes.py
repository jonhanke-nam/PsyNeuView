# PsyNeuLink Model File
# Format Version: 1.0
# Model: two_input_nodes
#
# Fixture for the input-grouping toggle (#570): two independent input
# mechanisms (no projection between them) so the Composition has TWO
# INPUT nodes. That's the case where "group by trial" is meaningful —
# each trial groups both nodes' input cells together.

import psyneulink as pnl

input_a = pnl.TransferMechanism(input_shapes=[2], function=pnl.Linear(), name='input_a')
input_b = pnl.TransferMechanism(input_shapes=[3], function=pnl.Linear(), name='input_b')

two_input_nodes = pnl.Composition(name='two_input_nodes')
two_input_nodes.add_node(input_a)
two_input_nodes.add_node(input_b)
