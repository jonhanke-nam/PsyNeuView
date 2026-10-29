# PsyNeuLink Model File
# Format Version: 1.0
# Model: comp

import psyneulink as pnl
import numpy as np

# ===========================================================
# Constructing Compositions: one composition, four shapes
# From PsyNeuLink's Tutorial notebook, "Constructing Compositions"
# (tutorial/PsyNeuLink Tutorial.ipynb), the notebook's last section.
#
# The notebook builds four compositions from four-unit Linear
# TransferMechanisms: a line of two, a line of three, a recurrent
# pathway, and several hidden layers. Here there is one
# composition, comp, and the walkthrough reshapes it into each in
# turn by editing its pathways below; the mechanisms are made once
# for all four.
# ===========================================================

# Mechanisms
# ===========================================================

input_layer = pnl.TransferMechanism(name='input_layer', function=pnl.Linear, default_variable=np.ones((4,)))
hidden_layer_a = pnl.TransferMechanism(name='hidden_layer_a', function=pnl.Linear, default_variable=np.ones((4,)))
hidden_layer_b = pnl.TransferMechanism(name='hidden_layer_b', function=pnl.Linear, default_variable=np.ones((4,)))
hidden_layer_c = pnl.TransferMechanism(name='hidden_layer_c', function=pnl.Linear, default_variable=np.ones((4,)))
output_layer = pnl.TransferMechanism(name='output_layer', function=pnl.Linear, default_variable=np.ones((4,)))

# Composition
# ===========================================================

comp = pnl.Composition(name='comp')
comp.add_linear_processing_pathway(pathway=[input_layer, output_layer])

# Inputs
# ===========================================================
# A different number on each unit, so you can see where each one
# goes. The Run tab offers it by this name, and opens with it.

one_two_three_four = {input_layer: [[1, 2, 3, 4]]}
