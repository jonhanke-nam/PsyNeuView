"""Conjoint Compositions (one shared mechanism) pinning MDF gap #83
(upstream PsyNeuLink#4)."""
import psyneulink as pnl

shared = pnl.TransferMechanism(name="shared")
x = pnl.TransferMechanism(name="x")
y = pnl.TransferMechanism(name="y")

c1 = pnl.Composition(name="c1")
c1.add_linear_processing_pathway([x, shared])

c2 = pnl.Composition(name="c2")
c2.add_linear_processing_pathway([shared, y])
