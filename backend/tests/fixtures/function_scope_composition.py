# A model whose nodes are built inside a function, but whose composition
# is exposed at module scope. Exercises handle synthesis (#422): the
# function-scoped mechanisms should still get a varName + line resolved
# from their `name=` kwarg (both a literal and a module constant).

import psyneulink as pnl

STIMULUS = 'stimulus'


def build():
    stim = pnl.TransferMechanism(
        name=STIMULUS,
        function=pnl.Linear(slope=1.0),
    )
    hidden = pnl.TransferMechanism(name='hidden_layer')
    comp = pnl.Composition(name='func_scope_comp')
    comp.add_node(stim)
    comp.add_node(hidden)
    comp.add_projection(pnl.MappingProjection(sender=stim, receiver=hidden))
    return comp


func_scope_comp = build()
