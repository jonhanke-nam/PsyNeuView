# Vendored from PsyNeuLink — PrincetonUniversity/PsyNeuLink
# Source: psyneulink/library/models/Cohen_Huston1994_horse_race.py
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


# This implements the horse race Figure shown in Cohen & Huston (1994).
# Note that noise is turned off and each stimulus is only showed once for each stimulus onset asynchrony.

# Define Variables ----------------------------------------------------------------------------------------------------
rate = 0.1          # The integration rate was changed from 0.01 to 0.1
inhibition = -2.0   # Mutual inhibition across each layer
bias = 4.0          # bias for hidden layer units

# Different time steps at which the System should end run and start new terminate_processing run
# This is needed for conditions in which the irrelevant condition is like a neutral trial and could already lead to
# a correct response. This is basically the reason why with long positive stimulus onset asynchrony the three
# condistions (congruent, incongruent, neutral) lead to the same reaction time.
terminate2 = 180
terminate3 = 200
terminate4 = 220
terminate5 = 240

# Create mechanisms ---------------------------------------------------------------------------------------------------
#   Linear input units, colors: ('red', 'green'), words: ('RED','GREEN')
colors_input_layer = pnl.TransferMechanism(
    input_shapes=3,
                                           function=pnl.Linear,
                                           name='COLORS_INPUT')

words_input_layer = pnl.TransferMechanism(
    input_shapes=3,
                                          function=pnl.Linear,
                                          name='WORDS_INPUT')

task_input_layer = pnl.TransferMechanism(
    input_shapes=2,
                                         function=pnl.Linear,
                                         name='TASK_INPUT')

#   Task layer, tasks: ('name the color', 'read the word')
task_layer = pnl.RecurrentTransferMechanism(
    input_shapes=2,
                                            function=pnl.Logistic(),
                                            hetero=-2,
                                            integrator_mode=True,
                                            integration_rate=0.1,
                                            name='TASK')

#   Hidden layer units, colors: ('red','green') words: ('RED','GREEN')
colors_hidden_layer = pnl.RecurrentTransferMechanism(
    input_shapes=3,
                                                     function=pnl
                                                     .Logistic(x_0=4.0),
                                                     integrator_mode=True,
                                                     hetero=-2.0,
                                                     # noise=pnl.NormalDist(mean=0.0, standard_deviation=.0),
                                                     integration_rate=0.1,  # cohen-huston text says 0.01
                                                     name='COLORS HIDDEN')

words_hidden_layer = pnl.RecurrentTransferMechanism(
    input_shapes=3,
                                                    function=pnl.Logistic(x_0=4.0),
                                                    hetero=-2,
                                                    integrator_mode=True,
                                                    # noise=pnl.NormalDist(mean=0.0, standard_deviation=.05),
                                                    integration_rate=0.1,
                                                    name='WORDS HIDDEN')
#   Response layer, responses: ('red', 'green'): RecurrentTransferMechanism for self inhibition matrix
response_layer = pnl.RecurrentTransferMechanism(
    input_shapes=2,
                                                function=pnl.Logistic(),
                                                hetero=-2.0,
                                                integrator_mode=True,
                                                integration_rate=0.1,
                                                name='RESPONSE')

# Log mechanisms ------------------------------------------------------------------------------------------------------
#task_layer.set_log_conditions('gain')
task_layer.set_log_conditions('value')
colors_hidden_layer.set_log_conditions('value')
words_hidden_layer.set_log_conditions('value')
response_layer.set_log_conditions('value')
# Connect mechanisms --------------------------------------------------------------------------------------------------
# (note that response layer projections are set to all zero first for initialization

color_input_weights = pnl.MappingProjection(matrix=np.array([[1.0, 0.0, 0.0],
                                                             [0.0, 1.0, 0.0],
                                                             [0.0, 0.0, 0.0]]))

word_input_weights = pnl.MappingProjection(matrix=np.array([[1.0, 0.0, 0.0],
                                                            [0.0, 1.0, 0.0],
                                                            [0.0, 0.0, 0.0]]))

task_input_weights = pnl.MappingProjection(matrix=np.array([[1.0, 0.0],
                                                            [0.0, 1.0]]))

color_task_weights  = pnl.MappingProjection(matrix=np.array([[4.0, 0.0],
                                                             [4.0, 0.0],
                                                             [4.0, 0.0]]))

task_color_weights  = pnl.MappingProjection(matrix=np.array([[4.0, 4.0, 4.0],
                                                             [0.0, 0.0, 0.0]]))

word_task_weights = pnl.MappingProjection(matrix=np.array([[0.0, 4.0],
                                                           [0.0, 4.0],
                                                           [0.0, 4.0]]))

task_word_weights = pnl.MappingProjection(matrix=np.array([[0.0, 0.0, 0.0],
                                                           [4.0, 4.0, 4.0]]))

response_color_weights = pnl.MappingProjection(matrix=np.array([[0.0, 0.0, 0.0],
                                                                [0.0, 0.0, 0.0]]))

response_word_weights  = pnl.MappingProjection(matrix=np.array([[0.0, 0.0, 0.0],
                                                                [0.0, 0.0, 0.0]]))

color_response_weights = pnl.MappingProjection(matrix=np.array([[1.5, 0.0],
                                                                [0.0, 1.5],
                                                                [0.0, 0.0]]))
word_response_weights  = pnl.MappingProjection(matrix=np.array([[2.5, 0.0],
                                                                [0.0, 2.5],
                                                                [0.0, 0.0]]))

Bidirectional_Stroop = pnl.Composition(name='FEEDFORWARD_STROOP_SYSTEM')

# Create pathways -----------------------------------------------------------------------------------------------------
Bidirectional_Stroop.add_linear_processing_pathway(
    pathway=[
        colors_input_layer,
        color_input_weights,
        colors_hidden_layer,
        color_response_weights,
        response_layer,
        response_color_weights,
        colors_hidden_layer
    ],
    name='COLORS_RESPONSE_PROCESS'
)

Bidirectional_Stroop.add_linear_processing_pathway(
    pathway=[
        words_input_layer,
        word_input_weights,
        words_hidden_layer,
        word_response_weights,
        response_layer,
        response_word_weights,
        words_hidden_layer
    ],
    name='WORDS_RESPONSE_PROCESS'
)

Bidirectional_Stroop.add_linear_processing_pathway(
    pathway=[
        task_input_layer,
        task_input_weights,
        task_layer,
        task_color_weights,
        colors_hidden_layer,
        color_task_weights,
        task_layer
    ]
)

Bidirectional_Stroop.add_linear_processing_pathway(
    pathway=[
        task_input_layer,
        task_layer,
        task_word_weights,
        words_hidden_layer,
        word_task_weights,
        task_layer
    ]
)
