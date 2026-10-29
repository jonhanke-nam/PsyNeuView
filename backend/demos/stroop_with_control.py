# PsyNeuLink Model File
# Format Version: 1.0
# Model: Stroop_model

import psyneulink as pnl
import numpy as np

# ===========================================================
# Stroop With Control: the Stroop model regulating itself
# From PsyNeuLink's Basics and Primer, "Control"
# (docs/source/BasicsAndPrimer.rst), and its script
# Scripts/Examples/Basics And Primer/Stroop Model - Conflict
# Monitoring.py, with their code and names.
#
# The Stroop model of lessons 8 and 9, with a TASK layer between
# TASK INPUT and the hidden layers: an LCAMechanism that settles
# for 10 executions before they run. A ControlMechanism, CONTROL,
# watches OUTPUT through an ObjectiveMechanism, the Conflict
# Monitor, whose Energy function measures how much red and green
# are active together. CONTROL sets the gain of TASK on the next
# trial: the more conflict, the stronger the instruction.
# ===========================================================

# Mechanisms
# ===========================================================

# Construct the color naming pathway:
color_input = pnl.ProcessingMechanism(name='COLOR INPUT', input_shapes=2)  # Note:  default function is Linear
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
task = pnl.LCAMechanism(name='TASK', input_shapes=2, initial_value=[0.5, 0.5])
task_color_wts = np.array([[4, 4], [0, 0]])
task_word_wts = np.array([[0, 0], [4, 4]])
task_color_pathway = [task_input, task, task_color_wts, color_hidden]
task_word_pathway = [task_input, task, task_word_wts, word_hidden]

# Construct the decision pathway:
decision = pnl.DDM(name='DECISION', input_format=pnl.ARRAY)
decision_pathway = [output, decision]

# Construct control mechanism
control = pnl.ControlMechanism(name='CONTROL',
                               objective_mechanism=pnl.ObjectiveMechanism(name='Conflict Monitor',
                                                                          function=pnl.Energy(input_shapes=2,
                                                                                              matrix=[[0, -2.5], [-2.5, 0]]),
                                                                          monitor=output),
                               default_allocation=[0.5],
                               control_signals=[(pnl.GAIN, task)])

# Composition
# ===========================================================

# The script adds the color and word pathways, then the two task
# pathways. Here the color task pathway comes second, so the task
# is drawn between the two inputs and no arrows cross; the model
# is the same.
Stroop_model = pnl.Composition(name='Stroop Model - Conflict Monitoring')
Stroop_model.add_linear_processing_pathway(color_pathway)
Stroop_model.add_linear_processing_pathway(task_color_pathway)
Stroop_model.add_linear_processing_pathway(word_pathway)
Stroop_model.add_linear_processing_pathway(task_word_pathway)
Stroop_model.add_linear_processing_pathway(decision_pathway)
Stroop_model.add_controller(control)

# Assign conditions:
settling_time = 10
Stroop_model.scheduler.add_condition(color_hidden, pnl.EveryNCalls(task, settling_time))
Stroop_model.scheduler.add_condition(word_hidden, pnl.EveryNCalls(task, settling_time))
Stroop_model.scheduler.add_condition(output, pnl.All(pnl.EveryNCalls(color_hidden, 1),
                                                     pnl.EveryNCalls(word_hidden, 1)))
Stroop_model.scheduler.add_condition(decision, pnl.EveryNCalls(output, 1))

# Inputs
# ===========================================================
# The script's run: four incongruent color naming trials, red ink
# and the word green. The Run tab offers it by this name, and opens
# with it.

red = [1, 0]
green = [0, 1]
word = [0, 1]
color = [1, 0]

num_trials = 4
stimuli = {color_input: [red] * num_trials,
           word_input: [green] * num_trials,
           task_input: [color] * num_trials}
