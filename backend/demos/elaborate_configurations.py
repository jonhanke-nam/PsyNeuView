# PsyNeuLink Model File
# Format Version: 1.0
# Model: Stroop_model

import psyneulink as pnl
import numpy as np

# ===========================================================
# More Elaborate Configurations: the Stroop model from pathways
# From PsyNeuLink's Basics and Primer, "More Elaborate
# Configurations" (docs/source/BasicsAndPrimer.rst), with the
# Primer's own code and names. A simplified version of Cohen,
# Dunbar and McClelland (1990).
#
#   color naming   COLOR INPUT -> COLOR HIDDEN -> OUTPUT
#   word reading   WORD INPUT  -> WORD HIDDEN  -> OUTPUT
#   task           TASK INPUT  -> COLOR HIDDEN, and -> WORD HIDDEN
#   decision       OUTPUT -> DECISION, a drift diffusion (DDM)
#
# Each pathway is a list: mechanisms, with the matrix of the
# projection between two of them written in between. Five
# pathways share mechanisms, so they join into one network.
#
# Two units throughout: index 0 is red, index 1 is green. The
# word weights (3) are stronger than the color weights (2): word
# reading is the more practised process. The hidden layers'
# Logistic has a bias of -4, so they stay nearly off unless the
# task input adds its 4: the task says which pathway to use.
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
decision = pnl.DDM(name='DECISION', input_format=pnl.ARRAY)
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

# Inputs
# ===========================================================
# The Primer's stimuli, and its run: a color naming congruent
# trial (red ink, the word red), then a color naming incongruent
# one (red ink, the word green). The Run tab offers it by this
# name, and opens with it.

red = [1, 0]
green = [0, 1]
word = [0, 1]
color = [1, 0]

primer_trials = {
    color_input: [red, red],
    word_input: [red, green],
    task_input: [color, color],
}
