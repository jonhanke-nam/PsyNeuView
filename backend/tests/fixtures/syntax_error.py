# A file with a deliberate syntax error on line 7
# Tests: syntax error detection, line number reporting

import psyneulink as pnl

a = pnl.TransferMechanism(name='a')
b = pnl.TransferMechanism(name='b'  # Missing closing paren
comp = pnl.Composition(name='broken')
