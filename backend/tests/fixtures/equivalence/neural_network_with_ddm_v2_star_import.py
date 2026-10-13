from psyneulink import *
import numpy as np

decision = DDM(
    function=DriftDiffusionAnalytical(
        drift_rate=2.0,
        threshold=1.5,
        noise=0.3,
    ),
    name='decision',
)

hidden_layer = TransferMechanism(
    input_shapes=[1],
    function=Logistic(gain=1.5),
    name='hidden_layer',
)

input_layer = TransferMechanism(
    input_shapes=[2],
    function=Linear(),
    name='input_layer',
)

hidden_to_decision = MappingProjection(
    sender=hidden_layer,
    receiver=decision,
    matrix=np.array([[1.5]]),
    name='hidden_to_decision',
)

input_to_hidden = MappingProjection(
    sender=input_layer,
    receiver=hidden_layer,
    matrix=np.array([[0.5], [-0.5]]),
    name='input_to_hidden',
)

decision_network = Composition(name='decision_network')
decision_network.add_node(decision)
decision_network.add_node(hidden_layer)
decision_network.add_node(input_layer)
decision_network.add_projection(hidden_to_decision)
decision_network.add_projection(input_to_hidden)
