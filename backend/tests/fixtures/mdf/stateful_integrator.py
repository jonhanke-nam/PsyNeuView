"""Stateful IntegratorMechanism model for MDF gap #87 (execution semantics)."""
import psyneulink as pnl

integ = pnl.IntegratorMechanism(
    name="integ",
    function=pnl.SimpleIntegrator(rate=0.5),
)

comp = pnl.Composition(name="stateful")
comp.add_node(integ)
