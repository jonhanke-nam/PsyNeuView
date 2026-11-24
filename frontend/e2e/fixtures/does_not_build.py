# E2E fixture (#386): a model that fails while it is built.
# It parses, so the editor shows it, but running it raises before any
# Composition exists: opening it must replace the model on screen with
# this one's error, never keep the previous model's graph up.

import psyneulink as pnl

lonely = pnl.TransferMechanism(name="lonely")
raise RuntimeError("this model does not build")
