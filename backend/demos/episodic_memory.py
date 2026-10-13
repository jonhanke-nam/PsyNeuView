# PsyNeuLink Model File
# Format Version: 1.0
# PsyNeuLink: 0.19.0.0
# Model: episodic_memory

import psyneulink as pnl

# ===========================================================
# Episodic memory: an EMComposition with three fields
# From the Cognitive Neuroscience Course, Module 5, "Episodic
# Memory":
# docs/source/tutorials/cognitive_neuroscience_course/
#   5_episodic_memory/notebooks/1_episodic_memory.ipynb
# on the PrincetonUniversity/PsyNeuLink docs/refactor-documentation
# branch. Same arguments as the notebook's first EMComposition,
# except memory_capacity: 100 here, 1000 in the notebook. At 1000 the
# model takes about 9s to load on a fast machine and over 30s on a CI
# runner, past the app's load limit; at 100 it takes about 1.4s and
# draws the same 16 nodes. Capacity is how many episodes fit, which
# this walkthrough doesn't depend on.
#
# Each field is a slot of an episode (sizes 2, 4 and 3). A query
# is compared with every stored episode field by field; each
# field's similarity scores are weighted (0.33 each), summed across
# fields and softmaxed, and that picks what is retrieved.
#
# The notebook describes STORE and MATCH nodes. The PsyNeuLink this
# app pins (0.19) builds the same computation without them: each
# field's [FIELD_MEMORY] node computes its similarity scores, and
# COMBINED SCORES does the weighting-and-softmax.
# ===========================================================

episodic_memory = pnl.EMComposition(
    name='episodic_memory',
    memory_capacity=100,
    memory_template=[[0, 0], [0, 0, 0, 0], [0, 0, 0]],
    fields={
        '1': {pnl.FIELD_WEIGHT: .33, pnl.LEARN_FIELD_WEIGHT: False, pnl.TARGET_FIELD: False},
        '2': {pnl.FIELD_WEIGHT: .33, pnl.LEARN_FIELD_WEIGHT: False, pnl.TARGET_FIELD: False},
        '3': {pnl.FIELD_WEIGHT: .33, pnl.LEARN_FIELD_WEIGHT: False, pnl.TARGET_FIELD: False},
    },
    memory_fill=.001,
    normalize_memories=True,
    softmax_gain=1.,
    softmax_threshold=0.1,
    memory_decay=0,
)
