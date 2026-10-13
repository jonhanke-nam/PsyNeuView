# PsyNeuLink Model File
# Format Version: 1.0
# Model: with_controller
#
# E2E fixture #3 (issue #148) — minimal Composition that owns a
# ControlMechanism via add_controller. The controller adjusts the
# intercept of `driven` via a ControlSignal. Smaller than any of the
# library models, but exercises the controller code path that
# the inspector and run panel both need to render.

import psyneulink as pnl

# ============================================================
# Mechanisms
# ============================================================

driven = pnl.TransferMechanism(input_shapes=[1], name='driven')

# ============================================================
# Controller
# ============================================================

ctrl = pnl.ControlMechanism(
    control_signals=[(pnl.INTERCEPT, driven)],
    name='ctrl',
)

# ============================================================
# Composition
# ============================================================

with_controller = pnl.Composition(name='with_controller')
with_controller.add_node(driven)
with_controller.add_controller(ctrl)
