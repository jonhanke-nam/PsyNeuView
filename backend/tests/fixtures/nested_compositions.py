# A model with nested compositions
# Tests: nesting depth detection, multiple nodes, CIM handling

import psyneulink as pnl

inner_a = pnl.TransferMechanism(input_shapes=[2], name='inner_a')
inner_b = pnl.TransferMechanism(input_shapes=[2], function=pnl.Logistic(), name='inner_b')
inner_proj = pnl.MappingProjection(sender=inner_a, receiver=inner_b, name='inner_proj')

inner_comp = pnl.Composition(name='inner_comp')
inner_comp.add_node(inner_a)
inner_comp.add_node(inner_b)
inner_comp.add_projection(inner_proj)

outer_input = pnl.TransferMechanism(input_shapes=[2], name='outer_input')
outer_output = pnl.TransferMechanism(input_shapes=[2], name='outer_output')

outer_comp = pnl.Composition(name='outer_comp')
outer_comp.add_node(outer_input)
outer_comp.add_node(inner_comp)
outer_comp.add_node(outer_output)
outer_comp.add_projection(pnl.MappingProjection(sender=outer_input, receiver=inner_a, name='outer_to_inner'))
outer_comp.add_projection(pnl.MappingProjection(sender=inner_b, receiver=outer_output, name='inner_to_outer'))
