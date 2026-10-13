"""Nested-Composition model pinning MDF gap #82 (upstream PsyNeuLink#3)."""
import psyneulink as pnl

a = pnl.TransferMechanism(name="a")
b = pnl.TransferMechanism(name="b")

inner = pnl.Composition(name="inner")
inner.add_node(b)

outer = pnl.Composition(name="outer")
outer.add_linear_processing_pathway([a, inner])
