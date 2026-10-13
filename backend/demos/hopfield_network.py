# PsyNeuLink Model File
# Format Version: 1.0
# Model: hopfield_network

import numpy as np
import psyneulink as pnl

# ===========================================================
# A Hopfield network that stores two letters
# From the Cognitive Neuroscience Course, Module 1, "Hopfield
# Networks": docs/source/tutorials/cognitive_neuroscience_course/
#   1_dynamics_in_perception/notebooks/2_hopfield_networks.ipynb
# on the PrincetonUniversity/PsyNeuLink docs/refactor-documentation
# branch (PsyNeuView #49).
#
# The notebook does this in numpy. This is the same network as a
# PsyNeuLink RecurrentTransferMechanism: 25 units, one per pixel of
# a 5x5 letter, read a row at a time (units 0-4 are the top row).
# +1 is a dark pixel, -1 a light one.
#
# Storing: the recurrent weights are the notebook's Hebbian rule,
# the outer product of each stored pattern with itself, averaged
# over the patterns. Two units that agree in a pattern get a
# positive weight; two that disagree get a negative one. The
# diagonal is set to 0, so no unit feeds itself (the notebook says
# so; its code leaves the diagonal at 1, which changes nothing here).
#
# Recalling: each update, every unit adds up its weighted inputs
# from the others and becomes +1 if the sum is 0 or more, else -1,
# all at once, as in the notebook's pattern_complete(). PsyNeuLink
# has no sign function, so the units use a Logistic stretched to
# run from -1 to +1 (scale 2, offset -1) and made so steep (gain
# 1000) that it is a step: a sum of 1/4 or more, either way, comes
# out as +1 or -1. The bias of 0.1 sends a sum of exactly 0 to +1,
# as the notebook's `pattern >= 0` does. (A steep Tanh would be
# the obvious choice, but PsyNeuLink's Tanh overflows to NaN for
# large negative sums at this gain; the Logistic doesn't.)
#
# One trial is one update. The cue goes in on the first trial; on
# the trials after it the input is 0, so only the network's own
# connections move it. The recurrent projection carries the last
# trial's output into the next, so the trials are the settling.
# ===========================================================

# Letters: '#' is +1 (dark), '.' is -1 (light)
# ===========================================================


def letter(*rows):
    return np.array([[1 if c == '#' else -1 for c in row] for row in rows]).flatten()


A = letter(
    '.###.',
    '#...#',
    '#####',
    '#...#',
    '#...#',
)

Z = letter(
    '#####',
    '...#.',
    '..#..',
    '.#...',
    '#####',
)

X = letter(
    '#...#',
    '.#.#.',
    '..#..',
    '.#.#.',
    '#...#',
)

O = letter(
    '.###.',
    '#...#',
    '#...#',
    '#...#',
    '.###.',
)

# Storing: Hebbian weights from the training set
# ===========================================================

training_set = [A, Z]

weights = sum(np.outer(p, p) for p in training_set) / len(training_set)
np.fill_diagonal(weights, 0)

# Mechanism
# ===========================================================

hopfield = pnl.RecurrentTransferMechanism(
    name='hopfield',
    input_shapes=25,
    matrix=weights,
    function=pnl.Logistic(gain=1000, scale=2, offset=-1),
)

# Composition
# ===========================================================

hopfield_network = pnl.Composition(name='hopfield_network')
hopfield_network.add_node(hopfield)

# Cues
# ===========================================================
# Each set is one cue followed by five trials of no input: five
# updates. The Run tab offers them by these names, and opens with
# the first.

quiet = [0] * 25

# The notebook's own noisy Z: add_noise(Z, noise_level=.3) after
# np.random.seed(42) and one earlier call. Units 6, 11, 14 and 18
# are wrong.
noisy_Z_pixels = [
    1, 1, 1, 1, 1,
    -1, 1, -1, 1, -1,
    -1, 1, 1, -1, 1,
    -1, 1, -1, 1, -1,
    1, 1, 1, 1, 1,
]
noisy_Z = {hopfield: [noisy_Z_pixels] + [quiet] * 5}

# Between the two: A's top two rows over Z's bottom three. It
# differs from A in 10 units and from Z in 5.
A_over_Z_pixels = [int(v) for v in A[:10]] + [int(v) for v in Z[10:]]
A_over_Z = {hopfield: [A_over_Z_pixels] + [quiet] * 5}
