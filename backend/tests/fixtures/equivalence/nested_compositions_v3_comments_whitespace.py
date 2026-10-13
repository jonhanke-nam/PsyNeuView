"""A heavily-commented, loosely-formatted variant of nested_compositions.

Should normalize to exactly the same standardized output as the canonical
variant (v1) and the star-import variant (v2). Extra comments, blank
lines, and trailing-comma quirks must not survive canonicalization.

Pins nested-composition emission specifically (#234): inner_comp must
be declared before outer_comp in the canonical output so the
``outer_comp.add_node(inner_comp)`` reference resolves forward, and
inner_comp's own structure block must be present.
"""

import psyneulink as pnl
import numpy as np


# ===========================================================
# Inner-composition mechanisms
# ===========================================================

# Two layers inside the nested composition.
inner_a = pnl.TransferMechanism(
    input_shapes=[2],                # 2 features
    function=pnl.Linear(),           # identity passthrough
    name='inner_a'
)



# -----------------------------------------------------------
#  inner_b — sigmoid hidden unit
# -----------------------------------------------------------
inner_b = pnl.TransferMechanism(input_shapes=[2], function=pnl.Logistic(gain=1.5), name='inner_b')


# Outer-composition mechanism (sits alongside the nested comp).
outer_x = pnl.TransferMechanism(
    input_shapes=[2],
    function=pnl.Linear(),
    name='outer_x'
)

# ===========================================================
# Inner-composition projection
# ===========================================================

inner_a_to_b = pnl.MappingProjection(
    sender=inner_a,
    receiver=inner_b,
    matrix=np.array(
        [
            [1.0, 0.0],   # identity passthrough
            [0.0, 1.0],
        ]
    ),
    name='inner_a_to_b',
)

# Inner composition: two mechs + one projection.
inner_comp = pnl.Composition(name='inner_comp')

inner_comp.add_node(inner_a)
inner_comp.add_node(inner_b)
inner_comp.add_projection(inner_a_to_b)


# Outer composition: contains outer_x alongside the nested comp.
outer_comp = pnl.Composition(name='outer_comp')

outer_comp.add_node(inner_comp)
outer_comp.add_node(outer_x)
