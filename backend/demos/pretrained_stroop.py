# PsyNeuLink Model File
# Format Version: 1.0
# Model: stroop_model

import psyneulink as pnl
import numpy as np

# ===========================================================
# Pre-trained Stroop: Cohen, Dunbar and McClelland (1990), with
# its learned weights written in
# From PsyNeuLink's Tutorial notebook, "Pre-trained Complete Stroop
# Model" (tutorial/PsyNeuLink Tutorial.ipynb), with the notebook's
# own code and names.
#
#   Ink_Color, Word, Task   two units each, Linear
#   Hidden                  four units, Logistic(bias=-4): two for
#                           the ink color, two for the word
#   Output                  two units, Linear: the responses
#
# The weights are the ones the network would have learned: ink to
# its two hidden units 2.2, word to its two 2.6 (reading is more
# practised), task 4 to the pair it selects, hidden to output 1.3
# for the color pair and 2.5 for the word pair.
# ===========================================================

# Mechanisms
# ===========================================================

ink_color = pnl.TransferMechanism(default_variable=[0, 0], function=pnl.Linear(), name="Ink_Color")
word = pnl.TransferMechanism(default_variable=[0, 0], function=pnl.Linear(), name="Word")
task_demand = pnl.TransferMechanism(default_variable=[0, 0], function=pnl.Linear(), name="Task")

hidden_layer = pnl.TransferMechanism(default_variable=[0, 0, 0, 0],
                                     function=pnl.Logistic(bias=-4), name="Hidden")

output_layer = pnl.TransferMechanism(default_variable=[[0, 0]], function=pnl.Linear(), name="Output")

# Projections: the learned weights
# ===========================================================

color_mapping_matrix = np.asarray([[2.2, -2.2, 0, 0], [-2.2, 2.2, 0, 0]])
color_projection = pnl.MappingProjection(sender=ink_color, receiver=hidden_layer,
                                         matrix=color_mapping_matrix)
word_mapping_matrix = np.asarray([[0, 0, 2.6, -2.6], [0, 0, -2.6, 2.6]])
word_projection = pnl.MappingProjection(sender=word, receiver=hidden_layer,
                                        matrix=word_mapping_matrix)
task_mapping_matrix = np.asarray([[4, 4, 0, 0], [0, 0, 4, 4]])
task_projection = pnl.MappingProjection(sender=task_demand, receiver=hidden_layer,
                                        matrix=task_mapping_matrix)
output_mapping_matrix = np.asarray(
    [[1.3, -1.3], [-1.3, 1.3], [2.5, -2.5], [-2.5, 2.5]])
output_projection = pnl.MappingProjection(sender=hidden_layer, receiver=output_layer,
                                          matrix=output_mapping_matrix)

# Composition
# ===========================================================

stroop_model = pnl.Composition(name="stroop_model")
stroop_model.add_linear_processing_pathway(pathway=[ink_color, color_projection, hidden_layer, output_projection, output_layer])
stroop_model.add_linear_processing_pathway(pathway=[word, word_projection, hidden_layer, output_projection, output_layer])
stroop_model.add_linear_processing_pathway(pathway=[task_demand, task_projection, hidden_layer, output_projection, output_layer])

# Inputs
# ===========================================================
# The notebook's run: ink [1, 0], word [0, 1], task [1, 0]. And all
# eight combinations the notebook asks you to try, task first: the
# first four name the ink color, the last four read the word.

notebook_input = {ink_color: [[1, 0]], word: [[0, 1]], task_demand: [[1, 0]]}

all_eight = {
    task_demand: [[1, 0]] * 4 + [[0, 1]] * 4,
    word: [[1, 0], [1, 0], [0, 1], [0, 1]] * 2,
    ink_color: [[1, 0], [0, 1], [1, 0], [0, 1]] * 2,
}
