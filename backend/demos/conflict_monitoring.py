# PsyNeuLink Model File
# Format Version: 1.0
# PsyNeuLink: 0.19.0.0
# Model: conflict_monitoring

import numpy as np
import psyneulink as pnl

# ===========================================================
# Conflict monitoring: a Stroop model that measures its own conflict
# From the Cognitive Neuroscience Course, Module 7, "Conflict
# Monitoring, Effort, and Control":
# docs/source/tutorials/cognitive_neuroscience_course/
#   7_conflict_monitoring_effort_and_control/notebooks/
#   1_conflict_monitoring.ipynb
# on the PrincetonUniversity/PsyNeuLink docs/refactor-documentation
# branch.
#
# The notebook builds a Stroop model and computes "decision energy"
# afterwards, in numpy, as the product of the two response units'
# activity. This demo is PsyNeuLink's own model of the same idea:
# psyneulink/library/models/Botvinick_conflict_monitoring_model.py,
# Figure 1 of Botvinick, Braver, Barch, Carter & Cohen (2001),
# Conflict monitoring and cognitive control. Psychological Review,
# 108, 624-652. Here the energy is computed INSIDE the model, by a
# second output port on the RESPONSE layer (DECISION ENERGY), so the
# app can show it. The mechanisms, names, weights and biases are the
# library model's.
#
# Two things differ from the library model, both so a run fits in
# the app:
#
# - RATE is 0.1, not 0.01. The library model settles for 500 cycles
#   and then shows the stimulus for 1000 more. At ten times the rate
#   the same curves take a tenth of the cycles: 50 to settle, 100 of
#   stimulus, 150 trials in the Run tab.
# - The settle period keeps the response weights. The library model
#   zeroes them while the task cue settles and restores them for the
#   stimulus, which a run from the Run tab can't do. With the weights
#   kept, nothing reaches the response layer during the settle period
#   anyway (there is no colour or word yet), so the curves differ
#   only a little: at the end of the stimulus the energy is about
#   1.9 on incongruent trials against 1.2 congruent and 1.1 control,
#   where the library model gives 1.9, 1.0 and 0.9.
#
# Each input set is one trial type of the colour-naming task, in the
# shape Composition.run takes: 50 trials of the task cue alone, then
# 100 trials with the stimulus. The ink is always red; the word is
# GREEN (incongruent), RED (congruent) or XXXX (control).
# ===========================================================

RATE = 0.1  # Integration rate (0.01 in the library model; see above)
INHIBITION = -2.0  # lateral inhibition
BIAS = 4.0  # In contrast to the paper this is negative, since the logistic function's x_0 already includes a negation

SETTLE_TRIALS = 50
STIMULUS_TRIALS = 100

# Mechanisms
# ===========================================================
# Input layers (Linear). These don't appear in the original paper;
# they are just a way to feed inputs into the model.

# Colors: ('red', 'green', 'black')
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

# Hidden layers: Logistic, with recurrent connections for the lateral
# inhibition between units described in the paper (hetero). auto
# defaults to 0, so there is no self-excitation.

color_hidden_layer = pnl.RecurrentTransferMechanism(
    input_shapes=3,
    function=pnl.Logistic(x_0=BIAS),
    integrator_mode=True,
    hetero=INHIBITION,
    integration_rate=RATE,
    name='COLOR HIDDEN'
)

word_hidden_layer = pnl.RecurrentTransferMechanism(
    input_shapes=3,
    function=pnl.Logistic(x_0=BIAS),
    hetero=INHIBITION,
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

# Response layer, responses: ('red', 'green'). Its second output port,
# DECISION ENERGY, is the conflict monitor: the energy of the two
# response units, highest when both are active at once.
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

# Projections
# ===========================================================

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

# Pathways
# ===========================================================

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

# Composition
# ===========================================================

conflict_monitoring = pnl.Composition(
    pathways=[color_response_pathway,
              word_response_pathway,
              task_color_response_pathway,
              task_word_response_pathway],
    reinitialize_mechanisms_when=pnl.Never(),
    name='conflict_monitoring')

# Inputs
# ===========================================================
# One trial type each, in the shape Composition.run takes. The app
# offers them in the Run tab by these names (#1216). The task cue
# (colour naming) is on throughout; the colour and word arrive after
# the settle period.

_no_stimulus = [[0, 0, 0]] * SETTLE_TRIALS
_red_ink = [[1, 0, 0]] * STIMULUS_TRIALS
_color_naming = [[1, 0]] * (SETTLE_TRIALS + STIMULUS_TRIALS)

# Red ink, the word GREEN
incongruent = {
    color_input_layer: _no_stimulus + _red_ink,
    word_input_layer: _no_stimulus + [[0, 1, 0]] * STIMULUS_TRIALS,
    task_input_layer: _color_naming,
}

# Red ink, the word RED
congruent = {
    color_input_layer: _no_stimulus + _red_ink,
    word_input_layer: _no_stimulus + [[1, 0, 0]] * STIMULUS_TRIALS,
    task_input_layer: _color_naming,
}

# Red ink, the word XXXX
control = {
    color_input_layer: _no_stimulus + _red_ink,
    word_input_layer: _no_stimulus + [[0, 0, 1]] * STIMULUS_TRIALS,
    task_input_layer: _color_naming,
}
