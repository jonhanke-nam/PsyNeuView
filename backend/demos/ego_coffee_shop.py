# PsyNeuLink Model File
# Format Version: 1.0
# PsyNeuLink: 0.21.0.0
# Model: ego_coffee_shop

import numpy as np
import psyneulink as pnl

# ===========================================================
# EGO: episodic memory and context learn the Coffee Shop World
# From the Cognitive Neuroscience Course, Module 5, "Episodic
# Memory", notebook 2:
# docs/source/tutorials/cognitive_neuroscience_course/
#   5_episodic_memory/notebooks/2_ego.ipynb
# on the PrincetonUniversity/PsyNeuLink docs/refactor-documentation
# branch.
#
# The model is PsyNeuLink's own EGO model, from the PsyNeuLink
# Library: psyneulink/library/models/Giallanza2024_EGO_Study2.py
# (Giallanza, Campbell & Cohen, 2024, Toward the emergence of
# intelligent control: episodic generalization and optimization.
# Open Mind 8, 688-722). Its mechanisms, names, sizes, weights,
# learning rate and scheduling are the library model's. The library
# file builds the model inside a function, construct_model(), whose
# memory holds 2 episodes unless told otherwise; opened as it is,
# a run remembers almost nothing and predicts nothing. Its experiment
# passes memory_capacity=len(states), and so does this demo: the
# memory holds one episode per trial of the longest sequence.
#
# The notebook builds the same architecture by hand, with states
# numbered 0-10 (cues 0 and 9) and an older EMComposition setup;
# the library model numbers states 1-10, with 9 and 10 as the cues,
# and is the version PsyNeuLink tests.
#
# Coffee Shop World: each sequence is a cue (9 or 10) and then four
# states. After cue 9 the states go up by 2 (1-3-5-7 or 2-4-6-8);
# after cue 10 they alternate +3/+1 (1-4-5-8 or 2-3-6-7). The first
# state after the cue is random, so only the last three transitions
# of a sequence can be predicted, and only if the model knows which
# coffee shop it is in.
#
# Each input set is one participant's day, in the shape
# Composition.run takes: STATE, one state per trial. Running it is
# what the notebook does: EGO learns as it goes (AutodiffComposition
# .learn), retrieving a prediction, learning from its error, and
# storing the episode, one trial at a time.
#
# - blocked: six visits to the cue-9 shop, then six to the cue-10
#   shop (60 trials).
# - interleaved: the same twelve visits, the shops alternating.
#
# The notebook runs 1000 trials, with random first states and a test
# phase, and plots the curves; the demo keeps 60 fixed trials, so a
# run is quick in the Run tab and every run gives the same numbers.
# By the third visit to a path, blocked predicts each predictable
# state at about 0.9-0.97; interleaved stays near 0.4-0.55, split
# between what the two shops do next.
# ===========================================================

STATE_SIZE = 10
CONTEXT_INTEGRATION_RATE = 0.7
STATE_RETRIEVAL_WEIGHT = None
CONTEXT_RETRIEVAL_WEIGHT = 1.0
PREVIOUS_STATE_RETRIEVAL_WEIGHT = 1.0
MEMORY_FILL = 0.001
SOFTMAX_TEMPERATURE = 0.2
SOFTMAX_THRESHOLD = 0.01
LEARNING_RATE = 2.0
NUM_OPTIM_STEPS = 5

# Sequences
# ===========================================================


def sequence(cue, first):
    """One visit to a coffee shop: the cue, then four states."""
    states = [cue, first]
    for _ in range(3):
        if cue == 9:
            states.append(states[-1] + 2)
        else:
            states.append(states[-1] + 1 if states[-1] % 2 == 0 else states[-1] + 3)
    return states


def one_hot(state):
    """States are numbered 1-10; state k lights unit k-1."""
    v = [0.0] * STATE_SIZE
    v[state - 1] = 1.0
    return v


# The same twelve visits in both orders: each of the four paths
# (shop 9 from 1 or 2, shop 10 from 1 or 2) three times.
BLOCKED_VISITS = [(9, 1), (9, 2)] * 3 + [(10, 1), (10, 2)] * 3
INTERLEAVED_VISITS = [(9, 1), (10, 1), (9, 2), (10, 2)] * 3

blocked_states = [s for cue, first in BLOCKED_VISITS for s in sequence(cue, first)]
interleaved_states = [s for cue, first in INTERLEAVED_VISITS for s in sequence(cue, first)]

MEMORY_CAPACITY = len(blocked_states)

# The model
# ===========================================================
# Built in a function, as the library model is, so the episodic
# memory (EM) is a part of EGO and not a model of its own.


def construct_model(memory_capacity):
    # Mechanisms
    # ===========================================================

    # STATE is the only input: the state the model is in now.
    state_input_layer = pnl.ProcessingMechanism(name='STATE', input_shapes=STATE_SIZE)

    # PREVIOUS STATE holds the last trial's state (it updates after EM).
    previous_state_layer = pnl.ProcessingMechanism(name='PREVIOUS STATE', input_shapes=STATE_SIZE)

    # CONTEXT integrates the states over time: a running, fading summary.
    context_layer = pnl.TransferMechanism(
        name='CONTEXT',
        input_shapes=STATE_SIZE,
        function=pnl.Tanh(),
        integrator_mode=True,
        integration_rate=CONTEXT_INTEGRATION_RATE,
    )

    # A learned bias for the context representation.
    context_bias = pnl.TransferMechanism(
        name='CONTEXT [BIAS]',
        input_shapes=1,
        default_variable=[1.0],
    )

    # The context, normalized, is what queries the episodic memory.
    context_normalized = pnl.TransferMechanism(
        name='CONTEXT [NORMALIZED]',
        input_shapes=STATE_SIZE,
        function=pnl.Normalize(),
    )

    # Episodic memory: stores (state, previous state, context) triplets
    # and, given a previous state and a context, retrieves the state that
    # followed them. STATE's field weight is None: it is stored, never
    # used to search.
    em = pnl.EMComposition(
        name='EM',
        memory_template=[[0] * STATE_SIZE,   # state
                         [0] * STATE_SIZE,   # previous state
                         [0] * STATE_SIZE],  # context
        memory_fill=MEMORY_FILL,
        memory_capacity=memory_capacity,
        memory_decay_rate=0,
        softmax_gain=1 / SOFTMAX_TEMPERATURE,
        softmax_threshold=SOFTMAX_THRESHOLD,
        fields={
            'STATE': {pnl.FIELD_WEIGHT: STATE_RETRIEVAL_WEIGHT,
                      pnl.LEARN_FIELD_WEIGHT: False,
                      pnl.TARGET_FIELD: False},
            'PREVIOUS STATE': {pnl.FIELD_WEIGHT: PREVIOUS_STATE_RETRIEVAL_WEIGHT,
                               pnl.LEARN_FIELD_WEIGHT: False,
                               pnl.TARGET_FIELD: False},
            'CONTEXT': {pnl.FIELD_WEIGHT: CONTEXT_RETRIEVAL_WEIGHT,
                        pnl.LEARN_FIELD_WEIGHT: False,
                        pnl.TARGET_FIELD: False},
        },
        normalize_field_weights=False,
        normalize_memories=False,
        concatenate_queries=False,
        enable_learning=False,
        device=pnl.CPU,
        store_on_optimization=pnl.LAST,
    )

    # PREDICTION reads out the state EM retrieved: the predicted next state.
    prediction_layer = pnl.ProcessingMechanism(name='PREDICTION', input_shapes=STATE_SIZE)

    # Pathways
    # ===========================================================

    state_to_previous_state_pathway = [
        state_input_layer,
        pnl.MappingProjection(matrix=pnl.IDENTITY_MATRIX, learnable=False),
        previous_state_layer,
    ]
    state_to_context_pathway = [
        state_input_layer,
        pnl.MappingProjection(matrix=pnl.IDENTITY_MATRIX, learnable=False),
        context_layer,
    ]
    state_to_em_pathway = [
        state_input_layer,
        pnl.MappingProjection(sender=state_input_layer,
                              receiver=em.nodes['STATE [VALUE]'],
                              matrix=pnl.IDENTITY_MATRIX,
                              learnable=False),
        em,
    ]
    previous_state_to_em_pathway = [
        previous_state_layer,
        pnl.MappingProjection(sender=previous_state_layer,
                              receiver=em.nodes['PREVIOUS STATE [QUERY]'],
                              matrix=pnl.IDENTITY_MATRIX,
                              learnable=False),
        em,
    ]
    # The only learned mapping (with the bias): CONTEXT -> CONTEXT [NORMALIZED].
    context_learning_pathway = [
        context_layer,
        pnl.MappingProjection(sender=context_layer,
                              matrix=pnl.IDENTITY_MATRIX,
                              receiver=context_normalized,
                              learnable=True),
        context_normalized,
        pnl.MappingProjection(sender=context_normalized,
                              matrix=pnl.IDENTITY_MATRIX,
                              receiver=em.nodes['CONTEXT [QUERY]'],
                              learnable=False),
        em,
        pnl.MappingProjection(sender=em.nodes['STATE [RETRIEVED]'],
                              receiver=prediction_layer,
                              matrix=pnl.IDENTITY_MATRIX,
                              learnable=False),
        prediction_layer,
    ]

    # Composition
    # ===========================================================

    ego = pnl.AutodiffComposition(
        name='EGO',
        pathways=[state_to_previous_state_pathway,
                  state_to_context_pathway,
                  state_to_em_pathway,
                  previous_state_to_em_pathway,
                  context_learning_pathway],
        learning_rate=LEARNING_RATE,
        loss_spec=pnl.Loss.BINARY_CROSS_ENTROPY,
        # The target for PREDICTION is the state that actually comes next.
        targets=(prediction_layer, state_input_layer),
        execute_in_additional_optimizations={
            context_layer: pnl.LAST,
            previous_state_layer: pnl.LAST,
        },
        optimizations_per_minibatch=NUM_OPTIM_STEPS,
        device=pnl.CPU,
    )

    ego.add_node(context_bias, required_roles=[pnl.NodeRole.BIAS])
    ego.add_projection(
        sender=context_bias,
        receiver=context_normalized,
        projection=pnl.MappingProjection(matrix=np.zeros((1, STATE_SIZE)), learnable=True),
    )

    ego.infer_backpropagation_learning_pathways(pnl.ExecutionMode.PyTorch)

    # Each trial: (1) EM retrieves with the previous state and the
    # context; (2) the prediction is compared with the current state and
    # the context mapping learns from the error; (3) the previous state
    # and the context update with the current state, for the next trial.
    ego.scheduler.add_condition(em, pnl.BeforeNodes(previous_state_layer, context_layer))
    ego.scheduler.add_condition(context_normalized, pnl.BeforeNodes(em))
    ego.scheduler.add_condition(prediction_layer, pnl.BeforeNodes(previous_state_layer, context_layer))

    return ego, state_input_layer


ego_coffee_shop, state_input_layer = construct_model(memory_capacity=MEMORY_CAPACITY)

# Inputs
# ===========================================================
# One participant's day each, in the shape Composition.run takes.

blocked = {state_input_layer: [one_hot(s) for s in blocked_states]}
interleaved = {state_input_layer: [one_hot(s) for s in interleaved_states]}
