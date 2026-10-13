# A model with mechanisms not added to any composition
# Tests: orphan mechanism warning, diagnostic suggestions

import psyneulink as pnl

a = pnl.TransferMechanism(input_shapes=[1], name='a')
b = pnl.TransferMechanism(input_shapes=[1], name='b')
orphan = pnl.TransferMechanism(input_shapes=[1], name='orphan')
also_orphan = pnl.DDM(name='also_orphan')

proj = pnl.MappingProjection(sender=a, receiver=b, name='a_to_b')

comp = pnl.Composition(name='orphan_test')
comp.add_node(a)
comp.add_node(b)
comp.add_projection(proj)
# orphan and also_orphan are NOT added to the composition
