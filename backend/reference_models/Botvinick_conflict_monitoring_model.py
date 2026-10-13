# Vendored from PsyNeuLink — PrincetonUniversity/PsyNeuLink
# Source: psyneulink/library/models/Botvinick_conflict_monitoring_model.py
# Pinned commit: 83cc4165b7 (v0.19.1.0-10-g83cc4165b7, 2026-08-01)
# Vendored: 2026-08-04 for PsyNeuView reference-model seamless load (Refs #806, #808)
#
# Curated extract: the composition construction only. The upstream file's
# module-level run driver (argparse, the settle/stimulus .run() loop with
# response-weight zeroing, and matplotlib plotting) is stripped so PsyNeuView
# loads the model without side effects — no "module-level driver raised" warning
# and no convert prompt. The Composition construction below is otherwise
# verbatim upstream. Drift-tracked — re-vendor to update; do NOT hand-edit the
# construction.
# -----------------------------------------------------------------------------
import numpy as np
import psyneulink as pnl

# This script implements Figure 1 of Botvinick, M. M., Braver, T. S., Barch, D. M., Carter, C. S., & Cohen, J. D. (2001).
# Conflict monitoring and cognitive control. Psychological Review, 108, 624–652.
# http://dx.doi.org/10.1037/0033-295X.108.3.624

# Figure 1 plots the ENERGY computed by a conflict mechanism. It is highest for incongruent trials,
# and similar for congruent and neutral trials.

# DIFFERENCES FROM ORIGINAL FIGURE -----------------------------------------------------------------------------------

# Noise is turned off and for each condition we ran one trial only. A response threshold was not defined. Responses were
# made at the marked * signs in the figure.

# This produces slightly different values compared to the original figure. In the original simulations,
# the run stopped when a response threshold was reached, and the energy values after that point
# were held constant at the value at the response time. This caused the “leveling off” seen in the original figure.
# In contrast, the simulations in this script always run for a fixed number of time steps, so they do not show that
# post-response flattening.

# Throughout the code, there are commented out sections that can be uncommented to more closely approximate the
# original simulations. However, running with those sections uncommented will be considerably slower and also
# not produce the exact same results since we couldn't determine all the original parameters and how noise
# was applied.

# Define Parameters ---------------------------------------------------------------------------------------------------
RATE = 0.01  # Integration rate
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
    # noise=pnl.NormalDist(mean=0.0, standard_deviation=.01),  # <-- Uncomment to add noise as in the original paper
    integration_rate=RATE,
    name='COLOR HIDDEN'
)

word_hidden_layer = pnl.RecurrentTransferMechanism(
    input_shapes=3,
    function=pnl.Logistic(x_0=BIAS),
    hetero=INHIBITION,
    # noise=pnl.NormalDist(mean=0.0, standard_deviation=.01),  # <-- Uncomment to add noise as in the original paper
    integrator_mode=True,
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

# Output Layer
#   Response layer, responses: ('red', 'green')
response_layer = pnl.RecurrentTransferMechanism(
    input_shapes=2,
    function=pnl.Logistic(),
    hetero=INHIBITION,
    integrator_mode=True,
    integration_rate=RATE,
    output_ports=[
        pnl.RESULT,
        {pnl.NAME: 'DECISION ENERGY',
         pnl.VARIABLE: (pnl.OWNER_VALUE, 0),
         pnl.FUNCTION:
             pnl.Stability(
                 default_variable=np.array([0.0, 0.0]),
                 metric=pnl.ENERGY,
                 matrix=np.array([[0.0, -4.0],
                                  [-4.0, 0.0]])
             )
         }
    ],
    name='RESPONSE')

# Log -----------------------------------------------------------------------------------------------------------------
response_layer.log.set_log_conditions('DECISION ENERGY')

# Mapping projections--------------------------------------------------------------------------------------------------
color_input_weights = pnl.MappingProjection(
    matrix=np.array([[1.0, 0.0, 0.0],
                     [0.0, 1.0, 0.0],
                     [0.0, 0.0, 1.0]]))

word_input_weights = pnl.MappingProjection(
    matrix=np.array([[1.0, 0.0, 0.0],
                     [0.0, 1.0, 0.0],
                     [0.0, 0.0, 1.0]]))

task_input_weights = pnl.MappingProjection(
    matrix=np.array([[1.0, 0.0],
                     [0.0, 1.0]]))

color_task_weights = pnl.MappingProjection(
    matrix=np.array([[4.0, 0.0],
                     [4.0, 0.0],
                     [4.0, 0.0]]))

task_color_weights = pnl.MappingProjection(
    matrix=np.array([[4.0, 4.0, 4.0],
                     [0.0, 0.0, 0.0]]))

response_color_weights = pnl.MappingProjection(
    matrix=np.array([[1.5, 0.0, 0.0],
                     [0.0, 1.5, 0.0]]))

response_word_weights = pnl.MappingProjection(
    matrix=np.array([[2.5, 0.0, 0.0],
                     [0.0, 2.5, 0.0]]))

color_response_weights = pnl.MappingProjection(
    matrix=np.array([[1.5, 0.0],
                     [0.0, 1.5],
                     [0.0, 0.0]]))

word_response_weights = pnl.MappingProjection(
    matrix=np.array([[2.5, 0.0],
                     [0.0, 2.5],
                     [0.0, 0.0]]))

word_task_weights = pnl.MappingProjection(
    matrix=np.array([[0.0, 4.0],
                     [0.0, 4.0],
                     [0.0, 4.0]]))

task_word_weights = pnl.MappingProjection(
    matrix=np.array([[0.0, 0.0, 0.0],
                     [4.0, 4.0, 4.0]]))

# Create Pathways -----------------------------------------------------------------------------------------------------
color_response_pathway = [
    color_input_layer,
    color_input_weights,
    color_hidden_layer,
    color_response_weights,
    response_layer,
    response_color_weights,
    color_hidden_layer]

word_response_pathway = [
    word_input_layer,
    word_input_weights,
    word_hidden_layer,
    word_response_weights,
    response_layer,
    response_word_weights,
    word_hidden_layer]

task_color_response_pathway = [
    task_input_layer,
    task_input_weights,
    task_layer,
    task_color_weights,
    color_hidden_layer,
    color_task_weights,
    task_layer]

task_word_response_pathway = [
    task_input_layer,
    task_layer,
    task_word_weights,
    word_hidden_layer,
    word_task_weights,
    task_layer]

# Create Composition -------------------------------------------------------------------------------------------------------
System_Conflict_Monitoring = pnl.Composition(
    pathways=[color_response_pathway,
              word_response_pathway,
              task_color_response_pathway,
              task_word_response_pathway],
    reinitialize_mechanisms_when=pnl.Never(),
    name='CONFLICT MONITORING_SYSTEM')

