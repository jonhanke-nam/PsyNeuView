# PsyNeuLink Model File
# Format Version: 1.0
# Model: deep_nested
#
# E2E fixture: two-level nesting (outer > mid > inner) to exercise box-in-box
# cluster frames in the flat view (#718). Flattened, mid_a carries compPath
# ['mid'] and inner_a/inner_b carry ['mid', 'inner'].

import psyneulink as pnl

# Innermost composition.
inner_a = pnl.TransferMechanism(input_shapes=[2], name='inner_a')
inner_b = pnl.TransferMechanism(input_shapes=[2], name='inner_b')
inner = pnl.Composition(name='inner')
inner.add_node(inner_a)
inner.add_node(inner_b)
inner.add_projection(pnl.MappingProjection(sender=inner_a, receiver=inner_b))

# Middle composition: one mechanism plus the inner composition.
mid_a = pnl.TransferMechanism(input_shapes=[2], name='mid_a')
mid = pnl.Composition(name='mid')
mid.add_node(mid_a)
mid.add_node(inner)
mid.add_projection(pnl.MappingProjection(sender=mid_a, receiver=inner_a))

# Outer composition: input mechanism, the mid composition, output mechanism.
outer_in = pnl.TransferMechanism(input_shapes=[2], name='outer_in')
outer_out = pnl.TransferMechanism(input_shapes=[2], name='outer_out')
outer = pnl.Composition(name='outer')
outer.add_node(outer_in)
outer.add_node(mid)
outer.add_node(outer_out)
outer.add_projection(pnl.MappingProjection(sender=outer_in, receiver=mid_a))
outer.add_projection(pnl.MappingProjection(sender=inner_b, receiver=outer_out))
