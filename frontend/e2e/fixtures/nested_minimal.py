# PsyNeuLink Model File
# Format Version: 1.0
# Model: nested_minimal
#
# E2E fixture #5 (issue #148) — smallest nested-Composition shape:
# one inner Composition containing two mechanisms with a projection,
# embedded as a node inside an outer Composition between two outer
# mechanisms. Mirrors the shape of backend/demos/nested_compositions.py
# but with the minimum nodes needed to exercise the nesting code path.

import psyneulink as pnl

# ============================================================
# Mechanisms
# ============================================================

outer_in = pnl.TransferMechanism(input_shapes=[2], function=pnl.Linear(), name='outer_in')

inner_a = pnl.TransferMechanism(input_shapes=[2], function=pnl.Linear(), name='inner_a')
inner_b = pnl.TransferMechanism(input_shapes=[2], function=pnl.Logistic(), name='inner_b')

outer_out = pnl.TransferMechanism(input_shapes=[2], function=pnl.Linear(), name='outer_out')

# ============================================================
# Projections
# ============================================================

inner_a_to_b = pnl.MappingProjection(sender=inner_a, receiver=inner_b, name='inner_a_to_b')
outer_in_to_inner = pnl.MappingProjection(sender=outer_in, receiver=inner_a, name='outer_in_to_inner')
inner_to_outer_out = pnl.MappingProjection(sender=inner_b, receiver=outer_out, name='inner_to_outer_out')

# ============================================================
# Compositions
# ============================================================

inner_comp = pnl.Composition(name='inner_comp')
inner_comp.add_node(inner_a)
inner_comp.add_node(inner_b)
inner_comp.add_projection(inner_a_to_b)

nested_minimal = pnl.Composition(name='nested_minimal')
nested_minimal.add_node(outer_in)
nested_minimal.add_node(inner_comp)
nested_minimal.add_node(outer_out)
nested_minimal.add_projection(outer_in_to_inner)
nested_minimal.add_projection(inner_to_outer_out)
