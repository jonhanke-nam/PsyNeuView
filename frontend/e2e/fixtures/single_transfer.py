# PsyNeuLink Model File
# Format Version: 1.0
# Model: single_transfer
#
# E2E fixture #1 (issue #148) — smallest possible model.
# One TransferMechanism in one Composition. Use as the baseline for any
# test that just needs "a model is loaded" without caring about shape.

import psyneulink as pnl

# ============================================================
# Mechanisms
# ============================================================

solo = pnl.TransferMechanism(input_shapes=[2], function=pnl.Linear(), name='solo')

# ============================================================
# Composition
# ============================================================

single_transfer = pnl.Composition(name='single_transfer')
single_transfer.add_node(solo)
