from psyneulink import *
import numpy as np

inner_a = TransferMechanism(
    input_shapes=[2],
    function=Linear(),
    name='inner_a',
)

inner_b = TransferMechanism(
    input_shapes=[2],
    function=Logistic(gain=1.5),
    name='inner_b',
)

outer_x = TransferMechanism(
    input_shapes=[2],
    function=Linear(),
    name='outer_x',
)

inner_a_to_b = MappingProjection(
    sender=inner_a,
    receiver=inner_b,
    matrix=np.array([
        [1.0, 0.0],
        [0.0, 1.0],
    ]),
    name='inner_a_to_b',
)

inner_comp = Composition(name='inner_comp')
inner_comp.add_node(inner_a)
inner_comp.add_node(inner_b)
inner_comp.add_projection(inner_a_to_b)

outer_comp = Composition(name='outer_comp')
outer_comp.add_node(inner_comp)
outer_comp.add_node(outer_x)
