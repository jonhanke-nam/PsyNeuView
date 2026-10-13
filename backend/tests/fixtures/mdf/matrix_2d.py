"""Non-square explicit weight matrix (2x3 MappingProjection) for MDF gap #84
(upstream PsyNeuLink#5)."""
import psyneulink as pnl

m1 = pnl.TransferMechanism(name="m1", input_shapes=2)
m2 = pnl.TransferMechanism(name="m2", input_shapes=3)

comp = pnl.Composition(name="mat2d")
comp.add_linear_processing_pathway(
    [m1, pnl.MappingProjection(matrix=[[1.0, 2.0, 0.0], [0.0, 1.0, 2.0]]), m2]
)
