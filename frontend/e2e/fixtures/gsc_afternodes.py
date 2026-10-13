# Minimal reproduction of the GSC-edge id-uniqueness case (#651/#699).
#
# `AfterNodes(A, B)` on TARGET is a single graph-structure condition that expands
# to TWO scheduler edges sharing the same owner/target (TARGET): A -> TARGET and
# B -> TARGET. The edge id must key on BOTH endpoints; a target-only id would
# collide the two into one React Flow id and garble the render. This fixture is a
# stable, model-agnostic stand-in for the pattern that used to live in EGO's EM
# STORE node (removed by the 0.19 EMComposition restructure — see #805).

import psyneulink as pnl

A = pnl.TransferMechanism(name="A")
B = pnl.TransferMechanism(name="B")
C = pnl.TransferMechanism(name="C")
TARGET = pnl.TransferMechanism(name="TARGET")

comp = pnl.Composition(name="gsc_afternodes")
comp.add_linear_processing_pathway([A, TARGET])
comp.add_linear_processing_pathway([B, TARGET])
comp.add_linear_processing_pathway([C, TARGET])

# One condition -> three same-target GSC edges (A/B/C -> TARGET). Pre-#699 these
# collided on a target-only id; now each keys on its (source, target) pair.
comp.scheduler.add_condition(TARGET, pnl.AfterNodes(A, B, C))
