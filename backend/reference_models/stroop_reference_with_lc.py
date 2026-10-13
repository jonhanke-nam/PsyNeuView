# PsyNeuLink Model File
# Format Version: 1.0
# PsyNeuLink: 0.18.0.0
# Model: stroop_with_lc
#
# Stroop model (Cohen et al., 1990) augmented with a Locus Coeruleus
# (LC) control mechanism. The LC monitors the shared output layer and
# modulates the gain of both hidden layers, capturing the
# neuromodulatory role of norepinephrine in amplifying task-relevant
# processing under conflict.
# 
# Processing nodes mirror the basic Stroop reference
# (stroop_reference_basic) for consistency: hidden/output layers are
# TransferMechanisms, word_input carries Linear(offset=1), and the
# decision DDM uses a DriftDiffusionIntegrator.

import psyneulink as pnl
import numpy as np

# ===========================================================
# Processing mechanisms
# ===========================================================

# Color naming pathway
color_input = pnl.ProcessingMechanism(
    input_shapes=2,
    name='color_input',
)

color_hidden = pnl.TransferMechanism(
    input_shapes=2,
    function=pnl.Logistic(bias=-4, gain=1.1),
    name='color_hidden',
)

# Word reading pathway (stronger weights — word reading is more automatic)
word_input = pnl.ProcessingMechanism(
    input_shapes=2,
    function=pnl.Linear(offset=1),
    name='word_input',
)

word_hidden = pnl.TransferMechanism(
    input_shapes=2,
    function=pnl.Logistic(bias=-4),
    name='word_hidden',
)

# Shared output layer
decision = pnl.TransferMechanism(
    input_shapes=2,
    function=pnl.Logistic(),
    name='decision',
)

# Task specification
task_input = pnl.ProcessingMechanism(
    input_shapes=2,
    name='task_input',
)

# Decision mechanism
response = pnl.DDM(
    input_format=pnl.ARRAY,
    function=pnl.DriftDiffusionIntegrator(),
    name='response',
)

# ===========================================================
# Locus Coeruleus control mechanism
#
# Monitors the output layer and adjusts the gain of color_hidden
# and word_hidden via the FitzHugh-Nagumo dynamics built into
# LCControlMechanism. Higher LC activity => higher gain in cortex.
# ===========================================================

lc = pnl.LCControlMechanism(
    name='LC',
    modulated_mechanisms=[color_hidden, word_hidden, decision, response],
    base_level_gain=0.5,
    scaling_factor_gain=1.0,
    objective_mechanism=pnl.ObjectiveMechanism(
        # Energy with a hollow matrix reduces the 2-unit decision layer to a
        # scalar Botvinick conflict signal (cross-unit red×green co-activation).
        # A plain Linear here passes the 2-vector through unchanged, leaving a
        # 2-element OUTCOME that the LC's scalar drive can't consume (#627).
        function=pnl.Energy(
            input_shapes=2,
            matrix=[[0, -2.5], [-2.5, 0]],
        ),
        monitor=[decision],
        name='LC_objective',
    ),
)

# ===========================================================
# Projections (with hand-set weight matrices)
# ===========================================================

color_input_to_hidden = pnl.MappingProjection(
    sender=color_input,
    receiver=color_hidden,
    matrix=np.array([[2, -2], [-2, 2]]),
    name='color_input_to_hidden',
)

color_hidden_to_decision = pnl.MappingProjection(
    sender=color_hidden,
    receiver=decision,
    matrix=np.array([[2, -2], [-2, 2]]),
    name='color_hidden_to_decision',
)

word_input_to_hidden = pnl.MappingProjection(
    sender=word_input,
    receiver=word_hidden,
    matrix=np.array([[3, -3], [-3, 3]]),
    name='word_input_to_hidden',
)

word_hidden_to_decision = pnl.MappingProjection(
    sender=word_hidden,
    receiver=decision,
    matrix=np.array([[3, -3], [-3, 3]]),
    name='word_hidden_to_decision',
)

task_to_color = pnl.MappingProjection(
    sender=task_input,
    receiver=color_hidden,
    matrix=np.array([[4, 4], [0, 0]]),
    name='task_to_color',
)

task_to_word = pnl.MappingProjection(
    sender=task_input,
    receiver=word_hidden,
    matrix=np.array([[0, 0], [4, 4]]),
    name='task_to_word',
)

decision_to_response = pnl.MappingProjection(
    sender=decision,
    receiver=response,
    name='decision_to_response',
)


# ===========================================================
# Composition
# ===========================================================

stroop_with_lc = pnl.Composition(name='stroop_with_lc')

stroop_with_lc.add_node(color_input)
stroop_with_lc.add_node(color_hidden)
stroop_with_lc.add_node(word_input)
stroop_with_lc.add_node(word_hidden)
stroop_with_lc.add_node(decision)
stroop_with_lc.add_node(task_input)
stroop_with_lc.add_node(response)
stroop_with_lc.add_node(lc)


stroop_with_lc.add_projection(color_input_to_hidden)
stroop_with_lc.add_projection(color_hidden_to_decision)
stroop_with_lc.add_projection(word_input_to_hidden)
stroop_with_lc.add_projection(word_hidden_to_decision)
stroop_with_lc.add_projection(task_to_color)
stroop_with_lc.add_projection(task_to_word)
stroop_with_lc.add_projection(decision_to_response)
