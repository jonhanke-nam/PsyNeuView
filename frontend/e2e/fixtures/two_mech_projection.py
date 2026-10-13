# PsyNeuLink Model File
# Format Version: 1.0
# Model: two_mech_projection
#
# E2E fixture #2 (issue #148) — two mechanisms with an explicit
# MappingProjection between them. Smallest model that exercises edge
# rendering, projection inspection, and the canvas connector code path.

import psyneulink as pnl

# ============================================================
# Mechanisms
# ============================================================

sender_mech = pnl.TransferMechanism(input_shapes=[3], function=pnl.Linear(), name='sender_mech')
receiver_mech = pnl.TransferMechanism(input_shapes=[3], function=pnl.Logistic(), name='receiver_mech')

# ============================================================
# Projections
# ============================================================

sender_to_receiver = pnl.MappingProjection(
    sender=sender_mech,
    receiver=receiver_mech,
    name='sender_to_receiver',
)

# ============================================================
# Composition
# ============================================================

two_mech_projection = pnl.Composition(name='two_mech_projection')
two_mech_projection.add_node(sender_mech)
two_mech_projection.add_node(receiver_mech)
two_mech_projection.add_projection(sender_to_receiver)
