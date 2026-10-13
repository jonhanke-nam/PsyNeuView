# PsyNeuLink Model File
# Format Version: 1.0
# Model: td_learning

import numpy as np
import psyneulink as pnl

# ===========================================================
# Temporal-difference (TD) learning of a reward prediction
# From the Cognitive Neuroscience Course, Module 3, "Reinforcement
# learning": docs/source/tutorials/cognitive_neuroscience_course/
#   3_reinforcement_learning/notebooks/1_reinforcement_learning.ipynb
# on the PrincetonUniversity/PsyNeuLink docs/refactor-documentation
# branch (PsyNeuView #52). Same construction as the bundled
# MontagueDayanSejnowski96 reference model, scaled down.
#
# Each trial is 10 timesteps, one vector element per timestep. A
# cue is on throughout the trial and a reward arrives at timestep
# 7. add_td_learning_pathway builds the learning machinery: a
# TARGET mechanism that receives the reward, a
# PredictionErrorMechanism that computes the TD error
#   delta(t) = reward(t) + value(t) - value(t-1)
# and a LearningMechanism that adjusts the cue -> value weights.
#
# The Learn tab reports the *prediction error* each epoch: delta,
# squared and averaged over a trial's timesteps and the epoch's
# trials. At first the reward is a surprise; as the value estimate
# learns to anticipate it, the prediction error falls to zero.
#
# Why the cue is on from the first timestep: if it came on part-way
# through the trial (as in Montague, Dayan & Sejnowski 1996, Fig. 5),
# its arrival would itself be unpredictable. The prediction error
# would not vanish; it would move back from the reward to the cue
# onset (the classic dopamine result), and its size would stay the
# same. The course walkthrough has the learner try exactly that, by
# zeroing the cue's first three timesteps in the Learn tab: the
# chart falls, then climbs back to about 0.1 (one error of 1 in ten
# timesteps, now at the cue). tests/test_demo_td_learning.py pins it.
#
# This is a plain Composition, not an AutodiffComposition: it trains
# under ExecutionMode.Python, through PsyNeuLink's own learning
# mechanisms.
# ===========================================================

timesteps = 10
reward_time = 7

# Mechanisms
# ===========================================================

cue = pnl.TransferMechanism(
    name='cue',
    input_shapes=timesteps,
)

# The small intercept keeps every unit slightly active: PsyNeuLink's
# reinforcement rule only changes weights onto active units, so from
# an all-zero start nothing would ever learn.
value_estimate = pnl.TransferMechanism(
    name='value_estimate',
    input_shapes=timesteps,
    function=pnl.Linear(slope=1.0, intercept=0.01),
)

cue_to_value = pnl.MappingProjection(
    name='cue_to_value',
    sender=cue,
    receiver=value_estimate,
    matrix=np.zeros((timesteps, timesteps)),
)

# Composition
# ===========================================================

td_learning = pnl.Composition(name='td_learning')
td_learning.add_td_learning_pathway(
    [cue, cue_to_value, value_estimate],
    learning_rate=0.2,
    name='td_pathway',
)

# Training set
# ===========================================================
# Five identical conditioning trials per epoch, in the shape
# Composition.learn takes. The target is the reward, given for the
# node whose value is being learned; the Learn tab opens with it.

cue_on = [1.0] * timesteps
reward = [1.0 if t == reward_time else 0.0 for t in range(timesteps)]

conditioning = {
    "inputs": {cue: [cue_on] * 5},
    "targets": {value_estimate: [reward] * 5},
    "epochs": 20,
}
