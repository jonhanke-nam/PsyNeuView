from psyneulink import *
import numpy as np

hidden_layer = TransferMechanism(
    input_shapes=[3],
    function=Logistic(gain=1.5),
    name='hidden_layer',
)

input_layer = TransferMechanism(
    input_shapes=[4],
    function=Linear(),
    name='input_layer',
)

output_layer = TransferMechanism(
    input_shapes=[2],
    function=Logistic(gain=2.0),
    name='output_layer',
)

hidden_to_output = MappingProjection(
    sender=hidden_layer,
    receiver=output_layer,
    matrix=np.array([
        [1.0, -1.0],
        [-1.0, 1.0],
        [0.5, 0.5],
    ]),
    name='hidden_to_output',
)

input_to_hidden = MappingProjection(
    sender=input_layer,
    receiver=hidden_layer,
    matrix=np.array([
        [0.5, -0.5, 0.5],
        [-0.5, 0.5, -0.5],
        [0.5, 0.5, 0.5],
        [0.0, 0.0, 1.0],
    ]),
    name='input_to_hidden',
)

ff_network = Composition(name='ff_network')
ff_network.add_node(hidden_layer)
ff_network.add_node(input_layer)
ff_network.add_node(output_layer)
ff_network.add_projection(hidden_to_output)
ff_network.add_projection(input_to_hidden)
