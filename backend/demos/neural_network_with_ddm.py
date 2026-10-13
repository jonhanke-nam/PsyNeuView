# PsyNeuLink Model File
# Format Version: 1.0
# PsyNeuLink: 0.18.0.0
# Model: mixed_nn_ddm

import psyneulink as pnl
import numpy as np

# ===========================================================
# Mixed Neural Network + Drift Diffusion Model
# Based on PsyNeuLink Scripts/Examples/Mixed-NN-and-DDM.py
#
# Demonstrates combining a feedforward neural network with a
# DDM decision mechanism — a common hybrid architecture in
# computational cognitive science.
# ===========================================================

# Mechanisms
# ===========================================================

# Neural network layers
input_layer = pnl.TransferMechanism(
    input_shapes=3,
    function=pnl.Linear(),
    name='input_layer'
)

hidden_layer = pnl.TransferMechanism(
    input_shapes=5,
    function=pnl.Logistic(),
    name='hidden_layer'
)

# Drift diffusion decision mechanism
ddm = pnl.DDM(
    function=pnl.DriftDiffusionAnalytical(
        drift_rate=1.0,
        threshold=0.6,
        noise=0.5,
        starting_value=0.0,
    ),
    name='ddm'
)

# ===========================================================
# Projections
# ===========================================================

# Random connectivity from input to hidden
input_to_hidden = pnl.MappingProjection(
    sender=input_layer,
    receiver=hidden_layer,
    matrix=(0.2 * np.random.rand(3, 5)) - 0.1,
    name='input_to_hidden'
)

# Full connectivity from hidden to DDM
hidden_to_ddm = pnl.MappingProjection(
    sender=hidden_layer,
    receiver=ddm,
    name='hidden_to_ddm'
)

# ===========================================================
# Composition
# ===========================================================

nn_ddm_model = pnl.Composition(name='nn_ddm_model')
nn_ddm_model.add_node(input_layer)
nn_ddm_model.add_node(hidden_layer)
nn_ddm_model.add_node(ddm)
nn_ddm_model.add_projection(input_to_hidden)
nn_ddm_model.add_projection(hidden_to_ddm)
