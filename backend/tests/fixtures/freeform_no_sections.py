# A model with no section banners or format header
# Tests: free-form detection, editability, diagnostics

import psyneulink as pnl
import numpy as np

weights = np.array([[1.0, -0.5], [-0.5, 1.0]])

a = pnl.TransferMechanism(input_shapes=[2], name='a')
b = pnl.TransferMechanism(input_shapes=[2], function=pnl.Logistic(), name='b')
proj = pnl.MappingProjection(sender=a, receiver=b, matrix=weights, name='a_to_b')

comp = pnl.Composition(name='freeform_model')
comp.add_node(a)
comp.add_node(b)
comp.add_projection(proj)
