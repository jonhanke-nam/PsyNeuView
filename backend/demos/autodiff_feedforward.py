"""Minimal AutodiffComposition demo: a 3-layer feedforward learning model.

Used by #216 smoke tests as the canonical AutodiffComposition fixture,
and useful as a starting point for users exploring PsyNeuLink's PyTorch-
backed learning compositions.
"""

import psyneulink as pnl

input_layer = pnl.TransferMechanism(name="input_layer", input_shapes=2)
hidden_layer = pnl.TransferMechanism(name="hidden_layer", input_shapes=3)
output_layer = pnl.TransferMechanism(name="output_layer", input_shapes=2)

autodiff_comp = pnl.AutodiffComposition(name="autodiff_comp")
autodiff_comp.add_node(input_layer)
autodiff_comp.add_node(hidden_layer)
autodiff_comp.add_node(output_layer)
autodiff_comp.add_projection(sender=input_layer, receiver=hidden_layer)
autodiff_comp.add_projection(sender=hidden_layer, receiver=output_layer)
