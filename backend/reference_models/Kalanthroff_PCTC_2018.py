# Vendored from PsyNeuLink — PrincetonUniversity/PsyNeuLink
# Source: psyneulink/library/models/Kalanthroff_PCTC_2018.py
# Pinned commit: b0a750db14 (jonhanke-dev, 2026-07-29 sync)
# Vendored: 2026-07-31 for PsyNeuView reference-model runnability (Refs #798, #777)
#
# Curated extract: the composition construction only. The upstream file's
# module-level run driver (argparse, .run() calls, matplotlib plotting) is
# stripped so PsyNeuView loads the model without side effects. Construction
# below is otherwise verbatim upstream. Drift-tracked — re-vendor to update.
# -----------------------------------------------------------------------------

import numpy as np
import psyneulink as pnl


# Implements the Kalanthroff, Davelaar, Henik, Goldfarb & Usher model: Task Conflict and Proactive Control:
# A Computational Theory of the Stroop Task. Psychol Rev. 2018 Jan;125(1):59-82. doi: 10.1037/rev0000083.
# Epub 2017 Oct 16.
# #https://www.ncbi.nlm.nih.gov/pubmed/29035077

# Define Variables ----------------------------------------------------------------------------------------------------
Lambda = 0.03            # PsyNeuLink has Euler integration constant reversed (1-0.97)
pc_high = 0.15           # High proactive control from Figure 6 in Paper
pc_low = 0.025           # Low proactive control from Figure 6 in Paper
pc = pc_low              # Select proactive control
inhibition = -1.3        # Inhibition between units within a layer
inhibition_task = -1.9   # Inhibition between units within task layer
bias = -0.3              # bias input to color feature layer and word feature layer

# Create mechanisms ---------------------------------------------------------------------------------------------------
# 4 Input layers for color, word, task & bias
colors_input_layer = pnl.TransferMechanism(
    input_shapes=2,
    function=pnl.Linear,
    name='COLORS_INPUT'
)

words_input_layer = pnl.TransferMechanism(
    input_shapes=2,
    function=pnl.Linear,
    name='WORDS_INPUT'
)

task_input_layer = pnl.TransferMechanism(
    input_shapes=2,
    function=pnl.Linear,
    name='PROACTIVE_CONTROL'
)

bias_input = pnl.TransferMechanism(
    input_shapes=2,
    function=pnl.Linear,
    name='BIAS'
)

# Built python function to ensure that the logistic function outputs 0 when input is <= 0


def my_special_Logistic(variable):
    maxi = variable - 0.0180
    output = np.fmax([0], maxi)
    return output

# Built python function that takes output of special logistic function and computes conflict by multiplying
# output both task units with each over times 500


def my_conflict_function(variable):
    maxi = variable - 0.0180
    new = np.fmax([0], maxi)
    out = [new[0] * new[1] * 500]
    return out


# Create color feature layer, word feature layer, task demand layer and response layer
color_feature_layer = pnl.RecurrentTransferMechanism(
    input_shapes=2,                     # Define unit size
    function=pnl.Logistic(gain=4, x_0=1),       # to 4 & bias to 1
    integrator_mode=True,       # Set IntegratorFunction mode to True
    integration_rate=Lambda,    # smoothing factor ==  integration rate
    hetero=inhibition,          # Inhibition among units within a layer
    output_ports=[{                          # Create new OutputPort by applying
        pnl.NAME: 'SPECIAL_LOGISTIC',         # the "my_special_Logistic" function
        pnl.VARIABLE: (pnl.OWNER_VALUE, 0),
        pnl.FUNCTION: my_special_Logistic
    }],
    name='COLOR_LAYER')

# The word_feature_layer is set up as the color_feature_layer
word_feature_layer = pnl.RecurrentTransferMechanism(
    input_shapes=2,                     # Define unit size
    function=pnl.Logistic(gain=4, x_0=1),            # to 4 & bias to 1
    integrator_mode=True,   # Set IntegratorFunction mode to True
    integration_rate=Lambda,  # smoothing factor ==  integration rate
    hetero=inhibition,      # Inhibition among units within a layer
    output_ports=[{              # Create new OutputPort by applying
        pnl.NAME: 'SPECIAL_LOGISTIC',        # the "my_special_Logistic" function
        pnl.VARIABLE: (pnl.OWNER_VALUE, 0),
        pnl.FUNCTION: my_special_Logistic
    }],
    name='WORD_LAYER')


# The response_layer is set up as the color_feature_layer & the word_feature_layer
response_layer = pnl.RecurrentTransferMechanism(
    input_shapes=2,                         # Define unit size
    function=pnl.Logistic(gain=4, x_0=1),           # to 4 & bias to 1
    integrator_mode=True,           # Set IntegratorFunction mode to True
    integration_rate=Lambda,        # smoothing factor ==  integration rate
    hetero=inhibition,              # Inhibition among units within a layer
    output_ports=[{           # Create new OutputPort by applying
        pnl.NAME: 'SPECIAL_LOGISTIC',        # the "my_special_Logistic" function
        pnl.VARIABLE: (pnl.OWNER_VALUE, 0),
        pnl.FUNCTION: my_special_Logistic
    }],
    name='RESPONSE_LAYER'
)

# The task_demand_layer is set up as the color_feature_layer but with a different python function on it's OutputPort
# and a differnet inhibition weight on the hetero
task_demand_layer = pnl.RecurrentTransferMechanism(
    input_shapes=2,                      # Define unit size
    function=pnl.Logistic(gain=4, x_0=1),            # to 4 & bias to 1
    integrator_mode=True,   # Set IntegratorFunction mode to True
    integration_rate=Lambda,  # smoothing factor ==  integration rate
    hetero=inhibition_task,  # Inhibition among units within a layer
    output_ports=[               # Create new OutputPort by applying
        {
            pnl.NAME: 'SPECIAL_LOGISTIC',        # the "my_conflict_function" function
            pnl.VARIABLE: (pnl.OWNER_VALUE, 0),
            pnl.FUNCTION: my_special_Logistic
        },
        {
            pnl.NAME: 'CONFLICT',
            pnl.VARIABLE: (pnl.OWNER_VALUE, 0),
            pnl.FUNCTION: my_conflict_function
        }
    ],
    name='TASK_LAYER'
)


# Log mechanisms ------------------------------------------------------------------------------------------------------
color_feature_layer.set_log_conditions('SPECIAL_LOGISTIC')       # Log output of my_special_Logistic function
word_feature_layer.set_log_conditions('SPECIAL_LOGISTIC')        # Log output of my_special_Logistic function
response_layer.set_log_conditions('SPECIAL_LOGISTIC')            # Log output of my_special_Logistic function
task_demand_layer.set_log_conditions('SPECIAL_LOGISTIC')         # Log output of my_special_Logistic function

task_demand_layer.set_log_conditions('CONFLICT')                 # Log outout of my_conflict_function function

# Connect mechanisms --------------------------------------------------------------------------------------------------
color_input_weights = pnl.MappingProjection(
    matrix=np.array([
        [0.0, 0.0],     # response layer projections are set to all
        [0.0, 0.0]      # zero for initialization period first
    ])
)
word_input_weights = pnl.MappingProjection(
    matrix=np.array([
        [0.0, 0.0],
        [0.0, 0.0]
    ])
)
color_task_weights = pnl.MappingProjection(
    matrix=np.array([
        [2.0, 0.0],     # color to task projection
        [2.0, 0.0]
    ])
)
word_task_weights = pnl.MappingProjection(
    matrix=np.array([
        [0.0, 2.0],     # word to task projection
        [0.0, 2.0]
    ])
)
task_color_weights = pnl.MappingProjection(
    matrix=np.array([
        [1.0, 1.0],     # task to color projection
        [0.0, 0.0]
    ])
)
task_word_weights = pnl.MappingProjection(
    matrix=np.array([
        [0.0, 0.0],     # task to word projection
        [1.0, 1.0]
    ])
)
color_response_weights = pnl.MappingProjection(
    matrix=np.array([
        [2.0, 0.0],     # color to response projection
        [0.0, 2.0]
    ])
)
word_response_weights = pnl.MappingProjection(
    matrix=np.array([
        [2.5, 0.0],     # word to response projection
        [0.0, 2.5]
    ])
)
task_input_weights = pnl.MappingProjection(
    matrix=np.array([
        [1.0, 0.0],     # proactive control to task
        [0.0, 1.0]
    ])
)

# to send a control signal from the task demand layer to the response layer,
# set matrix to -1 to reduce response layer activation
# specify the sender of the projection which is the second OutputPort the task demand layer
# specify the receiver of the projection
task_conflict_to_response_weights = pnl.MappingProjection(
    matrix=np.array([[-1.0, -1.0]]),
    sender=task_demand_layer.output_ports[1],
    receiver=response_layer
)

# Create pathways -----------------------------------------------------------------------------------------------------
color_response_process = pnl.Pathway(pathway=[
    colors_input_layer,
    color_input_weights,
    color_feature_layer,
    color_response_weights,
    response_layer
],
    name='COLORS_RESPONSE_PROCESS'
)

word_response_process = pnl.Pathway(
    pathway=[words_input_layer,
             word_input_weights,
             word_feature_layer,
             word_response_weights,
             response_layer
             ],
    name='WORDS_RESPONSE_PROCESS'
)

task_color_process = pnl.Pathway(
    pathway=[task_input_layer,
             task_input_weights,
             task_demand_layer,
             task_color_weights,
             color_feature_layer,
             color_task_weights,
             task_demand_layer
             ],
    name='TASK_COLOR_PROCESS'
)

task_word_process = pnl.Pathway(
    pathway=[task_input_layer,
             task_demand_layer,
             task_word_weights,
             word_feature_layer,
             word_task_weights,
             task_demand_layer
             ],
    name='TASK_WORD_PROCESS'
)

bias_color_process = pnl.Pathway(
    pathway=[bias_input, color_feature_layer],
    name='BIAS_COLOR'
)

bias_word_process = pnl.Pathway(
    pathway=[bias_input, word_feature_layer],
    name='WORD_COLOR'
)

conflict_process = pnl.Pathway(
    pathway=[
        task_demand_layer,
        task_conflict_to_response_weights,
        response_layer
    ],
    name='CONFLICT_PROCESS'
)

# Create Composition --------------------------------------------------------------------------------------------------
PCTC = pnl.Composition(
    pathways=[
        word_response_process,
        color_response_process,
        task_color_process,
        task_word_process,
        bias_word_process,
        bias_color_process,
        task_word_process,
        conflict_process
    ],
    reinitialize_mechanisms_when=pnl.Never(),
    name='PCTC_MODEL')
