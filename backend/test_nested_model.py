# PsyNeuLink Model File
# Format Version: 1.0
# PsyNeuLink: 0.18.0.0
# Model: nested_compositions

import psyneulink as pnl

# ============================================================
# Mechanisms
# ============================================================

outer_a = pnl.TransferMechanism(input_shapes=[2], function=pnl.Linear(), name='outer_a')

inner_x = pnl.TransferMechanism(input_shapes=[2], function=pnl.Linear(), name='inner_x')
inner_y = pnl.TransferMechanism(input_shapes=[2], function=pnl.Logistic(), name='inner_y')

outer_b = pnl.TransferMechanism(input_shapes=[2], function=pnl.Linear(), name='outer_b')

# ============================================================
# Projections
# ============================================================

inner_proj = pnl.MappingProjection(sender=inner_x, receiver=inner_y, name='inner_proj')
a_to_inner = pnl.MappingProjection(sender=outer_a, receiver=inner_x, name='a_to_inner')
inner_to_b = pnl.MappingProjection(sender=inner_y, receiver=outer_b, name='inner_to_b')

# ============================================================
# Compositions
# ============================================================

inner_comp = pnl.Composition(name='inner_comp')
inner_comp.add_node(inner_x)
inner_comp.add_node(inner_y)
inner_comp.add_projection(inner_proj)

outer_comp = pnl.Composition(name='outer_comp')
outer_comp.add_node(outer_a)
outer_comp.add_node(inner_comp)
outer_comp.add_node(outer_b)
outer_comp.add_projection(a_to_inner)
outer_comp.add_projection(inner_to_b)
