# Vendored from PsyNeuLink — PrincetonUniversity/PsyNeuLink
# Source: psyneulink/library/models/Cohen_Huston1994.py
# Pinned commit: b0a750db14 (jonhanke-dev, 2026-07-29 sync)
# Vendored: 2026-07-30 for PsyNeuView reference-model runnability (Refs #794, #777)
#
# Curated extract: the composition construction only. The upstream file's
# module-level run driver (argparse, .run() calls, matplotlib plotting) is
# stripped so PsyNeuView loads the model without side effects. The Composition
# construction below is otherwise verbatim upstream. Drift-tracked — re-vendor
# to update; do NOT hand-edit the construction.
# -----------------------------------------------------------------------------
import numpy as np
import psyneulink as pnl

# This implements the model by Cohen, J. D., & Huston, T. A. (1994). Progress in the use of interactive
# models for understanding attention and performance. In C. Umilta & M. Moscovitch(Eds.),
# AttentionandperformanceXV(pp.453-456). Cam- bridge, MA: MIT Press.
# The model aims to capture top-down effects of selective attention and the bottom-up effects of attentional capture.

# Define Parameters ---------------------------------------------------------------------------------------------------
RATE = 0.01  # Integration rate (called time constant in paper)
INHIBITION = -2.0  # lateral inhibition
BIAS = 4.0  # In contrast to the paper this is negative, since the logistic function's x_0 already includes a negation

# Create mechanisms ---------------------------------------------------------------------------------------------------
# Input layers (Linear)
# Note: These layers don't appear in the original paper, they are just a way to feed inputs into the model

# Colors: ('red', 'green', 'black'),
color_input_layer = pnl.ProcessingMechanism(
    input_shapes=3,
    function=pnl.Linear,
    name='COLOR INPUT'
)

# Words: ('RED', 'GREEN', 'XXXX')
word_input_layer = pnl.ProcessingMechanism(
    input_shapes=3,
    function=pnl.Linear,
    name='WORD INPUT'
)

# Tasks: ('Color Naming', 'Word Reading')
task_input_layer = pnl.ProcessingMechanism(
    input_shapes=2,
    function=pnl.Linear,
    name='TASK INPUT'
)

# Hidden layers (Logistic with recurrent connections for inhibition between units)
# Note: These are the layers presented in the original paper. Here, we use RecurrentTransferMechanism to implement
# the lateral inhibition described there. The auto parameters default is 0, which means no self-excitation.

color_hidden_layer = pnl.RecurrentTransferMechanism(
    input_shapes=3,
    function=pnl.Logistic(x_0=BIAS),
    integrator_mode=True,
    hetero=INHIBITION,
    # noise=pnl.NormalDist(mean=0.0, standard_deviation=.0),
    integration_rate=RATE,
    name='COLOR HIDDEN'
)

word_hidden_layer = pnl.RecurrentTransferMechanism(
    input_shapes=3,
    function=pnl.Logistic(x_0=BIAS),
    hetero=INHIBITION,
    integrator_mode=True,
    # noise=pnl.NormalDist(mean=0.0, standard_deviation=.05),
    integration_rate=RATE,
    name='WORD HIDDEN'
)

task_layer = pnl.RecurrentTransferMechanism(
    input_shapes=2,
    function=pnl.Logistic(),
    hetero=INHIBITION,
    integrator_mode=True,
    integration_rate=RATE,
    name='TASK DEMAND'
)

# Responses: ('red', 'green'):
response_layer = pnl.RecurrentTransferMechanism(
    input_shapes=2,
    function=pnl.Logistic(),
    hetero=INHIBITION,
    integrator_mode=True,
    integration_rate=RATE,
    name='RESPONSE'
)

# Log mechanisms ------------------------------------------------------------------------------------------------------
task_layer.set_log_conditions('value')
color_hidden_layer.set_log_conditions('value')
word_hidden_layer.set_log_conditions('value')
response_layer.set_log_conditions('value')

# Create Projections --------------------------------------------------------------------------------------------------

# Input Projections
# Note: Projections from input to hidden layers are identity matrices which are set by PsyNeuLink by default, we
# do not need to explicitly define them here.

# Bidirectional Projections
# To define the bidirectional connections between layers, we create pairs of MappingProjections with appropriate
# weight matrices.

# Task to Color (and vice versa)
task_color_weights = pnl.MappingProjection(
    matrix=np.array([
        [4.0, 4.0, 4.0],
        [0.0, 0.0, 0.0]
    ])
)

color_task_weights = pnl.MappingProjection(
    matrix=np.array([
        [4.0, 0.0],
        [4.0, 0.0],
        [4.0, 0.0]
    ])
)

# Task to Word (and vice versa)
task_word_weights = pnl.MappingProjection(
    matrix=np.array([
        [0.0, 0.0, 0.0],
        [4.0, 4.0, 4.0]
    ])
)

word_task_weights = pnl.MappingProjection(
    matrix=np.array([
        [0.0, 4.0],
        [0.0, 4.0],
        [0.0, 4.0]
    ])
)

# Color to response (and vice versa)
color_response_weights = pnl.MappingProjection(
    matrix=np.array([
        [1.5, 0.0],
        [0.0, 1.5],
        [0.0, 0.0]
    ])
)

response_color_weights = pnl.MappingProjection(
    matrix=np.array([
        [1.5, 0.0, 0.0],
        [0.0, 1.5, 0.0]
    ])
)

# Word to response (and vice versa)
word_response_weights = pnl.MappingProjection(
    matrix=np.array([
        [2.5, 0.0],
        [0.0, 2.5],
        [0.0, 0.0]
    ])
)

response_word_weights = pnl.MappingProjection(
    matrix=np.array([
        [2.5, 0.0, 0.0],
        [0.0, 2.5, 0.0]
    ])
)

# Create Pathways -----------------------------------------------------------------------------------------------------

# Bidirectional pathways between color and response
color_response_pathway_1 = pnl.Pathway(
    pathway=[
        color_input_layer,
        color_hidden_layer,
        color_response_weights,
        response_layer,
    ],
    name='COLOR_RESPONSE_PATHWAY_1'
)

color_response_pathway_2 = pnl.Pathway(
    pathway=[
        response_layer,
        response_color_weights,
        color_hidden_layer
    ],
    name='COLORS_RESPONSE_PATHWAY_2'
)

# Bidirectional pathways between word and response
word_response_pathway_1 = pnl.Pathway(
    pathway=[
        word_input_layer,
        word_hidden_layer,
        word_response_weights,
        response_layer
    ],
    name='WORDS_RESPONSE_PATHWAY_1'
)

word_response_pathway_2 = pnl.Pathway(
    pathway=[
        response_layer,
        response_word_weights,
        word_hidden_layer
    ],
    name='WORDS_RESPONSE_PATHWAY_2'
)

# Bidirectional pathways between task and color
task_color_response_pathway_1 = pnl.Pathway(
    pathway=[
        task_input_layer,
        task_layer,
        task_color_weights,
        color_hidden_layer
    ],
    name='TASK_COLOR_RESPONSE_PATHWAY_1'
)

task_color_response_pathway_2 = pnl.Pathway(
    pathway=[
        color_hidden_layer,
        color_task_weights,
        task_layer])

# Bidirectional pathways between task and word
task_word_response_pathway_1 = pnl.Pathway(
    pathway=[
        task_input_layer,
        task_layer,
        task_word_weights,
        word_hidden_layer])

task_word_response_pathway_2 = pnl.Pathway(
    pathway=[
        word_hidden_layer,
        word_task_weights,
        task_layer])

# Create Composition --------------------------------------------------------------------------------------------------
Bidirectional_Stroop = pnl.Composition(
    pathways=[
        color_response_pathway_1,
        word_response_pathway_1,
        task_color_response_pathway_1,
        task_word_response_pathway_1,
        color_response_pathway_2,
        word_response_pathway_2,
        task_color_response_pathway_2,
        task_word_response_pathway_2
    ],
    reinitialize_mechanisms_when=pnl.Never(),
    name='Bidirectional Stroop Model'
)

