# PsyNeuLink Model File
# Format Version: 1.0
# Model: Stroop_model

import psyneulink as pnl
import numpy as np

# ===========================================================
# Dynamics of Execution: the Stroop model, decided step by step
# From PsyNeuLink's Basics and Primer, "Dynamics of Execution"
# (docs/source/BasicsAndPrimer.rst), with the Primer's own code
# and names. The model is the one in "More Elaborate
# Configurations" (the Elaborate Configurations demo), with the
# decision changed as the Primer changes it.
#
# There, DECISION used DriftDiffusionAnalytical, which computes
# the chance of each answer and the mean decision time in one go.
# Here it uses DriftDiffusionIntegrator: it adds up the evidence
# one step at a time, with noise, until it reaches the threshold,
# +20 for red or -20 for green. Its two values are where it
# stopped and how many steps it took.
#
# The Primer passes termination_processing={TimeScale.TRIAL:
# WhenFinished(decision)} to run(). A model file has no run()
# call, so the same condition is the scheduler's termination_conds
# below: a trial ends when DECISION has finished.
# ===========================================================

# Mechanisms
# ===========================================================

# Construct the color naming pathway:
color_input = pnl.ProcessingMechanism(name='COLOR INPUT', input_shapes=2)  # note: default function is Linear
color_input_to_hidden_wts = np.array([[2, -2], [-2, 2]])
color_hidden = pnl.ProcessingMechanism(name='COLOR HIDDEN', input_shapes=2, function=pnl.Logistic(bias=-4))
color_hidden_to_output_wts = np.array([[2, -2], [-2, 2]])
output = pnl.ProcessingMechanism(name='OUTPUT', input_shapes=2, function=pnl.Logistic)
color_pathway = [color_input, color_input_to_hidden_wts, color_hidden, color_hidden_to_output_wts, output]

# Construct the word reading pathway (using the same output_layer)
word_input = pnl.ProcessingMechanism(name='WORD INPUT', input_shapes=2)
word_input_to_hidden_wts = np.array([[3, -3], [-3, 3]])
word_hidden = pnl.ProcessingMechanism(name='WORD HIDDEN', input_shapes=2, function=pnl.Logistic(bias=-4))
word_hidden_to_output_wts = np.array([[3, -3], [-3, 3]])
word_pathway = [word_input, word_input_to_hidden_wts, word_hidden, word_hidden_to_output_wts, output]

# Construct the task specification pathways
task_input = pnl.ProcessingMechanism(name='TASK INPUT', input_shapes=2)
task_color_wts = np.array([[4, 4], [0, 0]])
task_word_wts = np.array([[0, 0], [4, 4]])
task_color_pathway = [task_input, task_color_wts, color_hidden]
task_word_pathway = [task_input, task_word_wts, word_hidden]

# Construct the decision pathway:
# Modify construction of decision Mechanism:
decision = pnl.DDM(name='DECISION',
                   input_format=pnl.ARRAY,
                   reset_stateful_function_when=pnl.AtTrialStart(),
                   function=pnl.DriftDiffusionIntegrator(noise=0.5, threshold=20))
decision_pathway = [output, decision]

# Composition
# ===========================================================

# The Primer adds the color and word pathways, then the two task
# pathways. Here the color task pathway comes second, so TASK INPUT
# is drawn between the two inputs and no arrows cross; the model
# is the same.
Stroop_model = pnl.Composition(name='Stroop Model')
Stroop_model.add_linear_processing_pathway(color_pathway)
Stroop_model.add_linear_processing_pathway(task_color_pathway)
Stroop_model.add_linear_processing_pathway(word_pathway)
Stroop_model.add_linear_processing_pathway(task_word_pathway)
Stroop_model.add_linear_processing_pathway(decision_pathway)

# A trial ends when the decision is finished.
Stroop_model.scheduler.termination_conds = {pnl.TimeScale.TRIAL: pnl.WhenFinished(decision)}

# Inputs
# ===========================================================
# The Primer's stimuli, and its run: one color naming trial,
# incongruent (red ink, the word green). The Run tab offers it by
# this name, and opens with it.

red = [1, 0]
green = [0, 1]
word = [0, 1]
color = [1, 0]

primer_trial = {color_input: [red], word_input: [green], task_input: [color]}
