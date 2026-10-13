# PsyNeuLink Model File
# Format Version: 1.0
# Model: recurrent_self
#
# E2E fixture #4 (issue #148) — a RecurrentTransferMechanism in a
# Composition. Tests that the canvas can render a node with a self-loop
# / recurrent projection and that the inspector surfaces the auto and
# hetero matrices the mechanism owns.

import psyneulink as pnl

# ============================================================
# Mechanisms
# ============================================================

recurrent = pnl.RecurrentTransferMechanism(
    input_shapes=[3],
    function=pnl.Logistic(),
    auto=0.5,
    hetero=-0.1,
    name='recurrent',
)

# ============================================================
# Composition
# ============================================================

recurrent_self = pnl.Composition(name='recurrent_self')
recurrent_self.add_node(recurrent)
