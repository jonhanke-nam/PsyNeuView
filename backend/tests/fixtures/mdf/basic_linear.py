"""Minimal two-mechanism linear pathway for the MDF round-trip harness.

Deliberately uses only features MDF round-trips cleanly today:
TransferMechanisms with Linear functions and a single MappingProjection.
"""
import psyneulink as pnl

input_layer = pnl.TransferMechanism(
    name="input_layer",
    function=pnl.Linear(slope=2.0, intercept=1.0),
)
output_layer = pnl.TransferMechanism(
    name="output_layer",
    function=pnl.Linear(slope=0.5),
)

comp = pnl.Composition(name="basic_linear")
comp.add_linear_processing_pathway([input_layer, output_layer])
