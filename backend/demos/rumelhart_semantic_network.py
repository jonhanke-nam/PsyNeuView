# PsyNeuLink Model File
# Format Version: 1.0
# PsyNeuLink: 0.19.0.0
# Model: rumelhart_semantic_network

import numpy as np
import psyneulink as pnl

# ===========================================================
# Rumelhart's semantic network
# From the Cognitive Neuroscience Course, Module 4, "Statistical
# Learning and Backpropagation":
# docs/source/tutorials/cognitive_neuroscience_course/
#   4_statistical_learning_and_backpropagation/notebooks/
#   1_rumelhart_semantic_network.ipynb
# on the PrincetonUniversity/PsyNeuLink docs/refactor-documentation
# branch. Same layers, sizes, names, seed and starting weights as
# the notebook (Rumelhart, Hinton & Williams, 1986).
#
# A noun (oak ... sunfish) and a relation (is, has, can) go in; what
# the noun is, has and can do come out, along with the noun itself.
# hidden_nouns is the representation layer: after training, nouns
# that share properties get similar patterns there.
#
# Training differs from the notebook in how it is batched, not in
# what is learned. The notebook trains one noun at a time (its three
# relations, 5 epochs) and repeats that 50 times over all eight nouns.
# The Learn tab trains one set, so all_relations holds all 24
# noun-relation pairs and is trained for 100 epochs, with a learning
# rate of 4 (the notebook's 1 needs about four times as many epochs
# for the same loss, and the Learn tab trains one epoch at a time to
# report progress, so epochs are what cost). The irrelevant outputs
# are targets of 0, as in the notebook. all_relations_discounted is
# the notebook's Exercise 3: the same pairs with the irrelevant
# outputs' true values halved instead of zeroed.
# ===========================================================

nouns = ['oak', 'pine', 'rose', 'daisy', 'canary', 'robin', 'salmon', 'sunfish']
relations = ['is', 'has', 'can']
is_list = ['living', 'living thing', 'plant', 'animal', 'tree', 'flower', 'bird', 'fish',
           'big', 'green', 'red', 'yellow']
has_list = ['roots', 'leaves', 'bark', 'branches', 'skin', 'feathers', 'wings', 'gills', 'scales']
can_list = ['grow', 'move', 'swim', 'fly', 'breathe', 'breathe underwater', 'breathe air', 'walk',
            'photosynthesize']

# What each noun is, has and can do (one row per noun)
truth_nouns = np.identity(len(nouns))

truth_is = np.array([
    [1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0],  # oak
    [1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0],  # pine
    [1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0],  # rose
    [1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0],  # daisy
    [1, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1],  # canary
    [1, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1],  # robin
    [1, 1, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0],  # salmon
    [1, 1, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0],  # sunfish
], dtype=float)

truth_has = np.array([
    [1, 1, 1, 1, 0, 0, 0, 0, 0],  # oak
    [1, 1, 1, 1, 0, 0, 0, 0, 0],  # pine
    [1, 1, 0, 0, 0, 0, 0, 0, 0],  # rose
    [1, 1, 0, 0, 0, 0, 0, 0, 0],  # daisy
    [0, 0, 0, 0, 1, 1, 1, 0, 0],  # canary
    [0, 0, 0, 0, 1, 1, 1, 0, 0],  # robin
    [0, 0, 0, 0, 0, 0, 0, 1, 1],  # salmon
    [0, 0, 0, 0, 0, 0, 0, 1, 1],  # sunfish
], dtype=float)

truth_can = np.array([
    [1, 0, 0, 0, 0, 0, 0, 0, 1],  # oak
    [1, 0, 0, 0, 0, 0, 0, 0, 1],  # pine
    [1, 0, 0, 0, 0, 0, 0, 0, 1],  # rose
    [1, 0, 0, 0, 0, 0, 0, 0, 1],  # daisy
    [1, 1, 0, 1, 1, 0, 1, 1, 0],  # canary
    [1, 1, 0, 1, 1, 0, 1, 1, 0],  # robin
    [1, 1, 1, 0, 1, 1, 0, 0, 0],  # salmon
    [1, 1, 1, 0, 1, 1, 0, 0, 0],  # sunfish
], dtype=float)

# One-hot inputs, each with a constant 1 on the end as a bias input
nouns_onehot = np.hstack([np.identity(len(nouns)), np.ones((len(nouns), 1))])
rels_onehot = np.hstack([np.identity(len(relations)), np.ones((len(relations), 1))])

# Mechanisms
# ===========================================================

input_nouns = pnl.TransferMechanism(
    name='input_nouns',
    input_shapes=9,
)

input_relations = pnl.TransferMechanism(
    name='input_relations',
    input_shapes=4,
)

# Hidden sizes from Rumelhart's paper
hidden_nouns = pnl.TransferMechanism(
    name='hidden_nouns',
    input_shapes=9,
    function=pnl.Logistic(),
)

hidden_mixed = pnl.TransferMechanism(
    name='hidden_mixed',
    input_shapes=16,
    function=pnl.Logistic(),
)

output_I = pnl.TransferMechanism(
    name='output_I',
    input_shapes=8,
    function=pnl.Logistic(),
)

output_is = pnl.TransferMechanism(
    name='output_is',
    input_shapes=12,
    function=pnl.Logistic(),
)

output_has = pnl.TransferMechanism(
    name='output_has',
    input_shapes=9,
    function=pnl.Logistic(),
)

output_can = pnl.TransferMechanism(
    name='output_can',
    input_shapes=9,
    function=pnl.Logistic(),
)

# Projections: random starting weights, seeded as in the notebook
# ===========================================================

np.random.seed(42)

map_in_nouns_h_nouns = pnl.MappingProjection(
    name='map_in_nouns_h_nouns',
    matrix=np.random.rand(9, 9),
    sender=input_nouns,
    receiver=hidden_nouns,
)

map_in_rel_h_mixed = pnl.MappingProjection(
    name='map_in_rel_h_mixed',
    matrix=np.random.rand(4, 16),
    sender=input_relations,
    receiver=hidden_mixed,
)

map_h_nouns_h_mixed = pnl.MappingProjection(
    name='map_h_nouns_h_mixed',
    matrix=np.random.rand(9, 16),
    sender=hidden_nouns,
    receiver=hidden_mixed,
)

map_h_mixed_out_I = pnl.MappingProjection(
    name='map_h_mixed_out_I',
    matrix=np.random.rand(16, 8),
    sender=hidden_mixed,
    receiver=output_I,
)

map_h_mixed_out_is = pnl.MappingProjection(
    name='map_h_mixed_out_is',
    matrix=np.random.rand(16, 12),
    sender=hidden_mixed,
    receiver=output_is,
)

map_h_mixed_out_has = pnl.MappingProjection(
    name='map_h_mixed_out_has',
    matrix=np.random.rand(16, 9),
    sender=hidden_mixed,
    receiver=output_has,
)

map_h_mixed_out_can = pnl.MappingProjection(
    name='map_h_mixed_out_can',
    matrix=np.random.rand(16, 9),
    sender=hidden_mixed,
    receiver=output_can,
)

# Composition
# ===========================================================

rumelhart_semantic_network = pnl.AutodiffComposition(
    name='rumelhart_semantic_network',
    pathways=[
        [input_nouns, map_in_nouns_h_nouns, hidden_nouns],
        [input_relations, map_in_rel_h_mixed, hidden_mixed],
        [hidden_nouns, map_h_nouns_h_mixed, hidden_mixed],
        [hidden_mixed, map_h_mixed_out_I, output_I],
        [hidden_mixed, map_h_mixed_out_is, output_is],
        [hidden_mixed, map_h_mixed_out_has, output_has],
        [hidden_mixed, map_h_mixed_out_can, output_can],
    ],
    learning_rate=4,
)

# Training sets
# ===========================================================
# Every noun with every relation, 24 trials, in the shape
# AutodiffComposition.learn takes. The app offers them in the Learn tab
# by these names (#1216).


def _training_set(discount):
    """Targets for all 24 noun-relation pairs. The relation asked about
    gets its true answers; the other two get their true answers times
    `discount` (0 in the notebook's first network, 0.5 in Exercise 3)."""
    pairs = [(n, r) for n in range(len(nouns)) for r in range(len(relations))]
    return {
        "inputs": {
            input_nouns: [nouns_onehot[n] for n, _ in pairs],
            input_relations: [rels_onehot[r] for _, r in pairs],
        },
        "targets": {
            output_I: [truth_nouns[n] for n, _ in pairs],
            output_is: [truth_is[n] if r == 0 else truth_is[n] * discount for n, r in pairs],
            output_has: [truth_has[n] if r == 1 else truth_has[n] * discount for n, r in pairs],
            output_can: [truth_can[n] if r == 2 else truth_can[n] * discount for n, r in pairs],
        },
        "epochs": 100,
    }


all_relations = _training_set(discount=0)
all_relations_discounted = _training_set(discount=0.5)

# Inputs
# ===========================================================
# Questions to ask the network, in the shape Composition.run takes:
# a noun and a relation, one trial each.

robin_is = {input_nouns: [nouns_onehot[5]], input_relations: [rels_onehot[0]]}
salmon_can = {input_nouns: [nouns_onehot[6]], input_relations: [rels_onehot[2]]}
