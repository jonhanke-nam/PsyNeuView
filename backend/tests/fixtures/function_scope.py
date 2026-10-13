# A file with PNL objects created inside a function
# Tests: function-scope detection warning

import psyneulink as pnl

def make_model():
    """This mechanism is invisible to the GUI."""
    hidden = pnl.TransferMechanism(name='hidden_in_func')
    return hidden

# This one IS visible
visible = pnl.TransferMechanism(name='visible')

comp = pnl.Composition(name='func_scope_test')
comp.add_node(visible)
