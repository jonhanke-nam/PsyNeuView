# PsyNeuLink Model File
# Format Version: 1.0
# PsyNeuLink: 0.21.0.0
# Model: iscci_model

import random

import numpy as np
import psyneulink as pnl

# ===========================================================
# The ISC-CI model: inferring a context from what occurs together
# From the Cognitive Neuroscience Course, Module 8, "Integration,
# Attention, Context, and Control":
# docs/source/tutorials/cognitive_neuroscience_course/
#   8_integration_attention_context_and_control/notebooks/
#   1_iscci_model.ipynb
# on the PrincetonUniversity/PsyNeuLink docs/refactor-documentation
# branch. Same layers, names, functions and connections as the
# notebook's create_model().
#
# Two objects seen together (the support set) are averaged into one
# representation, from which the model infers a context (which
# feature the objects share) and names it (context_label). A third
# object (the query) is seen through that context, and the model
# answers whether it belongs there too (response: yes, no).
#
# What differs from the notebook, and why:
#
# - The data is a slice. The notebook downloads the Leuven Concepts
#   Database from NEU-PSY-502 at run time: 293 objects, 385 features,
#   and a 64-number embedding per object. A model file opened in
#   PsyNeuView can't count on a download, so this demo carries 24 of
#   the objects (their embeddings, to 3 decimals) and 10 of the
#   features, with each feature's members as the database lists them
#   (among the 24). context_label has 10 units, not 385.
# - The episodes are generated here, by the notebook's own recipe
#   (get_random_episode), with a fixed seed. The notebook trains on
#   20,000 of them and says that is not enough to converge. The Learn
#   tab shows every value of a training set as a box, and an episode
#   is 204 numbers, so the demo declares 24 episodes: enough to see
#   the network train, not enough to learn the world. With so few, the
#   learning rate is 0.1 rather than the notebook's 0.01, so 30
#   epochs bring the loss from about 0.34 to about 0.08.
# - Starting weights are drawn as RandomMatrix(0, .01) draws them, but
#   from a seeded generator, so every load starts the same.
# ===========================================================

N_EMBEDDING = 64
HIDDEN_CONTEXT = 128
LEARNING_RATE = 0.1  # 0.01 in the notebook; see above

# Data: a slice of the Leuven Concepts Database
# ===========================================================
# Each feature with the objects (of the 24 below) that have it. A
# context is one feature: the things that eat mice, the things that
# can fly, and so on.

FEATURES = [
    ('eats mice', ['owl', 'falcon', 'cat', 'viper']),
    ('is a bird', ['owl', 'falcon', 'penguin', 'eagle', 'sparrow', 'robin', 'chicken', 'duck', 'swan', 'parrot']),
    ('can fly', ['owl', 'falcon', 'eagle', 'sparrow', 'robin', 'parrot', 'butterfly', 'bee', 'fly']),
    ('has feathers', ['owl', 'falcon', 'eagle', 'sparrow', 'robin', 'chicken', 'duck', 'swan', 'parrot']),
    ('builds nests', ['owl', 'falcon', 'eagle', 'sparrow', 'robin', 'parrot']),
    ('is a pet', ['cat', 'parrot', 'dog', 'hamster']),
    ('mammal', ['cat', 'dog', 'rabbit', 'hamster', 'horse', 'dolphin', 'mouse']),
    ('has four paws', ['cat', 'dog', 'rabbit', 'hamster', 'horse', 'frog', 'mouse']),
    ('lives in water', ['salmon', 'shark', 'dolphin']),
    ('is an insect', ['butterfly', 'bee', 'fly']),
]

EMBEDDINGS = {
    'owl': [0.948, 0.069, 0.934, 0.080, 0.031, 0.214, 0.944, 0.756, 0.043, 0.043, 0.088, 0.441, 0.089, 0.983, 0.031, 0.687, 0.035, 0.673, 0.147, 0.756, 0.270, 0.191, 0.117, 0.908, 0.095, 0.462, 0.979, 0.039, 0.049, 0.945, 0.766, 0.144, 0.967, 0.932, 0.018, 0.038, 0.318, 0.504, 0.083, 0.312, 0.101, 0.140, 0.078, 0.150, 0.727, 0.223, 0.961, 0.988, 0.360, 0.161, 0.144, 0.036, 0.870, 0.960, 0.444, 0.989, 0.018, 0.080, 0.033, 0.119, 0.043, 0.286, 0.045, 0.941],
    'falcon': [0.368, 0.221, 0.909, 0.038, 0.016, 0.033, 0.975, 0.974, 0.034, 0.891, 0.068, 0.054, 0.115, 0.886, 0.124, 0.038, 0.321, 0.350, 0.058, 0.878, 0.196, 0.415, 0.967, 0.980, 0.528, 0.052, 0.962, 0.060, 0.041, 0.865, 0.038, 0.516, 0.962, 0.122, 0.019, 0.798, 0.981, 0.110, 0.986, 0.294, 0.322, 0.053, 0.168, 0.516, 0.300, 0.038, 0.980, 0.979, 0.206, 0.759, 0.074, 0.025, 0.587, 0.016, 0.970, 0.989, 0.076, 0.249, 0.093, 0.060, 0.358, 0.221, 0.018, 0.985],
    'cat': [0.913, 0.045, 0.992, 0.992, 0.938, 0.103, 0.518, 0.037, 0.020, 0.711, 0.479, 0.024, 0.010, 0.031, 0.036, 0.990, 0.116, 0.073, 0.053, 0.246, 0.048, 0.011, 0.912, 0.993, 0.065, 0.050, 0.025, 0.973, 0.992, 0.991, 0.058, 0.051, 0.047, 0.575, 0.021, 0.051, 0.020, 0.266, 0.023, 0.020, 0.155, 0.031, 0.125, 0.974, 0.273, 0.028, 0.019, 0.207, 0.967, 0.434, 0.023, 0.022, 0.018, 0.314, 0.274, 0.696, 0.451, 0.019, 0.825, 0.057, 0.072, 0.921, 0.090, 0.145],
    'viper': [0.833, 0.196, 0.036, 0.110, 0.145, 0.989, 0.094, 0.901, 0.982, 0.969, 0.301, 0.070, 0.950, 0.035, 0.044, 0.978, 0.873, 0.071, 0.063, 0.219, 0.215, 0.862, 0.922, 0.114, 0.507, 0.406, 0.066, 0.026, 0.962, 0.040, 0.543, 0.051, 0.181, 0.843, 0.070, 0.054, 0.982, 0.080, 0.702, 0.292, 0.286, 0.055, 0.300, 0.187, 0.096, 0.151, 0.970, 0.259, 0.121, 0.982, 0.984, 0.713, 0.990, 0.054, 0.923, 0.018, 0.903, 0.211, 0.860, 0.931, 0.331, 0.034, 0.050, 0.976],
    'penguin': [0.343, 0.978, 0.989, 0.032, 0.089, 0.959, 0.110, 0.299, 0.745, 0.037, 0.809, 0.302, 0.306, 0.273, 0.215, 0.133, 0.239, 0.914, 0.074, 0.099, 0.974, 0.154, 0.056, 0.798, 0.100, 0.975, 0.023, 0.609, 0.084, 0.975, 0.422, 0.050, 0.979, 0.077, 0.028, 0.979, 0.034, 0.926, 0.987, 0.106, 0.986, 0.979, 0.374, 0.503, 0.970, 0.039, 0.852, 0.052, 0.022, 0.949, 0.068, 0.031, 0.021, 0.311, 0.700, 0.983, 0.993, 0.672, 0.171, 0.963, 0.074, 0.280, 0.041, 0.985],
    'eagle': [0.970, 0.029, 0.923, 0.035, 0.030, 0.052, 0.801, 0.129, 0.078, 0.286, 0.567, 0.141, 0.121, 0.026, 0.089, 0.052, 0.079, 0.979, 0.175, 0.980, 0.241, 0.170, 0.981, 0.939, 0.306, 0.290, 0.853, 0.037, 0.041, 0.330, 0.033, 0.936, 0.989, 0.941, 0.036, 0.988, 0.957, 0.079, 0.477, 0.061, 0.601, 0.044, 0.088, 0.075, 0.059, 0.024, 0.972, 0.983, 0.960, 0.836, 0.152, 0.847, 0.154, 0.263, 0.989, 0.970, 0.045, 0.128, 0.804, 0.193, 0.014, 0.125, 0.044, 0.971],
    'sparrow': [0.044, 0.095, 0.976, 0.870, 0.698, 0.254, 0.987, 0.279, 0.039, 0.047, 0.880, 0.102, 0.066, 0.037, 0.258, 0.380, 0.528, 0.898, 0.511, 0.068, 0.334, 0.099, 0.141, 0.971, 0.112, 0.232, 0.529, 0.144, 0.032, 0.962, 0.987, 0.048, 0.986, 0.193, 0.989, 0.395, 0.040, 0.950, 0.535, 0.860, 0.781, 0.080, 0.143, 0.043, 0.739, 0.114, 0.930, 0.987, 0.944, 0.975, 0.089, 0.229, 0.986, 0.200, 0.034, 0.955, 0.214, 0.478, 0.058, 0.025, 0.979, 0.933, 0.954, 0.039],
    'robin': [0.044, 0.565, 0.975, 0.284, 0.960, 0.033, 0.915, 0.594, 0.761, 0.061, 0.111, 0.079, 0.070, 0.068, 0.037, 0.054, 0.228, 0.137, 0.945, 0.179, 0.215, 0.445, 0.060, 0.988, 0.193, 0.057, 0.357, 0.130, 0.030, 0.933, 0.987, 0.021, 0.619, 0.148, 0.972, 0.045, 0.527, 0.984, 0.340, 0.072, 0.432, 0.312, 0.709, 0.083, 0.213, 0.259, 0.970, 0.983, 0.900, 0.980, 0.304, 0.089, 0.986, 0.025, 0.019, 0.984, 0.889, 0.984, 0.024, 0.055, 0.842, 0.145, 0.616, 0.732],
    'chicken': [0.120, 0.987, 0.982, 0.411, 0.452, 0.169, 0.890, 0.297, 0.092, 0.107, 0.072, 0.506, 0.097, 0.425, 0.348, 0.978, 0.025, 0.930, 0.561, 0.475, 0.643, 0.050, 0.061, 0.031, 0.699, 0.139, 0.061, 0.100, 0.061, 0.974, 0.082, 0.454, 0.088, 0.987, 0.983, 0.107, 0.052, 0.386, 0.843, 0.467, 0.511, 0.041, 0.705, 0.084, 0.435, 0.041, 0.725, 0.386, 0.977, 0.047, 0.041, 0.032, 0.990, 0.977, 0.965, 0.032, 0.985, 0.123, 0.091, 0.023, 0.327, 0.015, 0.035, 0.983],
    'duck': [0.043, 0.993, 0.979, 0.033, 0.270, 0.976, 0.988, 0.028, 0.166, 0.096, 0.759, 0.351, 0.080, 0.130, 0.307, 0.986, 0.017, 0.901, 0.041, 0.978, 0.055, 0.225, 0.064, 0.265, 0.193, 0.046, 0.873, 0.077, 0.548, 0.991, 0.961, 0.022, 0.337, 0.758, 0.264, 0.986, 0.332, 0.207, 0.038, 0.077, 0.066, 0.075, 0.773, 0.393, 0.162, 0.035, 0.930, 0.054, 0.037, 0.843, 0.116, 0.073, 0.069, 0.137, 0.337, 0.179, 0.994, 0.884, 0.684, 0.032, 0.951, 0.064, 0.020, 0.277],
    'swan': [0.148, 0.977, 0.664, 0.153, 0.050, 0.058, 0.992, 0.078, 0.068, 0.473, 0.085, 0.279, 0.365, 0.490, 0.989, 0.027, 0.092, 0.978, 0.055, 0.130, 0.250, 0.124, 0.288, 0.092, 0.053, 0.330, 0.959, 0.232, 0.082, 0.970, 0.049, 0.043, 0.034, 0.030, 0.020, 0.990, 0.036, 0.976, 0.158, 0.145, 0.028, 0.392, 0.028, 0.807, 0.963, 0.082, 0.955, 0.027, 0.930, 0.995, 0.977, 0.232, 0.020, 0.592, 0.981, 0.577, 0.801, 0.822, 0.892, 0.059, 0.122, 0.069, 0.202, 0.975],
    'parrot': [0.604, 0.965, 0.706, 0.030, 0.294, 0.072, 0.939, 0.037, 0.514, 0.024, 0.371, 0.552, 0.572, 0.063, 0.027, 0.170, 0.021, 0.857, 0.031, 0.044, 0.027, 0.473, 0.709, 0.749, 0.068, 0.118, 0.058, 0.369, 0.089, 0.959, 0.096, 0.227, 0.964, 0.049, 0.975, 0.991, 0.039, 0.114, 0.168, 0.403, 0.276, 0.029, 0.122, 0.044, 0.034, 0.126, 0.978, 0.926, 0.428, 0.028, 0.045, 0.153, 0.988, 0.530, 0.347, 0.988, 0.991, 0.815, 0.883, 0.086, 0.049, 0.434, 0.079, 0.056],
    'dog': [0.323, 0.077, 0.991, 0.992, 0.108, 0.269, 0.942, 0.193, 0.027, 0.027, 0.185, 0.946, 0.030, 0.070, 0.889, 0.994, 0.184, 0.082, 0.029, 0.040, 0.543, 0.025, 0.991, 0.350, 0.762, 0.024, 0.016, 0.992, 0.993, 0.971, 0.085, 0.059, 0.636, 0.224, 0.038, 0.145, 0.046, 0.020, 0.112, 0.311, 0.046, 0.981, 0.112, 0.237, 0.253, 0.033, 0.041, 0.309, 0.023, 0.057, 0.263, 0.029, 0.032, 0.269, 0.243, 0.057, 0.781, 0.022, 0.990, 0.078, 0.232, 0.018, 0.019, 0.095],
    'rabbit': [0.018, 0.016, 0.910, 0.977, 0.988, 0.035, 0.950, 0.055, 0.857, 0.015, 0.363, 0.371, 0.896, 0.033, 0.008, 0.854, 0.037, 0.069, 0.107, 0.022, 0.122, 0.905, 0.931, 0.983, 0.051, 0.689, 0.979, 0.990, 0.975, 0.972, 0.089, 0.068, 0.442, 0.069, 0.340, 0.028, 0.031, 0.044, 0.178, 0.030, 0.094, 0.095, 0.031, 0.012, 0.994, 0.091, 0.023, 0.028, 0.016, 0.256, 0.033, 0.030, 0.381, 0.020, 0.029, 0.023, 0.013, 0.101, 0.007, 0.020, 0.092, 0.695, 0.030, 0.032],
    'hamster': [0.024, 0.096, 0.991, 0.984, 0.989, 0.249, 0.946, 0.042, 0.979, 0.256, 0.158, 0.531, 0.125, 0.015, 0.090, 0.992, 0.026, 0.109, 0.904, 0.409, 0.031, 0.058, 0.976, 0.963, 0.021, 0.547, 0.027, 0.118, 0.992, 0.468, 0.203, 0.071, 0.107, 0.041, 0.420, 0.083, 0.134, 0.077, 0.966, 0.644, 0.144, 0.070, 0.904, 0.365, 0.052, 0.026, 0.072, 0.061, 0.044, 0.055, 0.031, 0.046, 0.065, 0.577, 0.046, 0.028, 0.377, 0.854, 0.177, 0.050, 0.082, 0.028, 0.968, 0.020],
    'horse': [0.033, 0.981, 0.081, 0.937, 0.881, 0.061, 0.949, 0.046, 0.114, 0.210, 0.048, 0.102, 0.040, 0.567, 0.068, 0.247, 0.987, 0.474, 0.331, 0.023, 0.053, 0.469, 0.967, 0.817, 0.041, 0.413, 0.062, 0.988, 0.975, 0.952, 0.082, 0.066, 0.043, 0.876, 0.038, 0.051, 0.107, 0.039, 0.292, 0.229, 0.022, 0.107, 0.042, 0.291, 0.059, 0.977, 0.055, 0.268, 0.047, 0.055, 0.618, 0.043, 0.040, 0.499, 0.985, 0.106, 0.059, 0.765, 0.032, 0.037, 0.850, 0.042, 0.039, 0.100],
    'salmon': [0.797, 0.979, 0.291, 0.053, 0.183, 0.836, 0.972, 0.037, 0.432, 0.023, 0.973, 0.086, 0.407, 0.626, 0.950, 0.980, 0.061, 0.810, 0.126, 0.943, 0.375, 0.979, 0.047, 0.160, 0.056, 0.897, 0.702, 0.966, 0.976, 0.955, 0.090, 0.987, 0.267, 0.426, 0.931, 0.871, 0.894, 0.037, 0.248, 0.110, 0.112, 0.963, 0.063, 0.032, 0.038, 0.965, 0.050, 0.025, 0.052, 0.055, 0.941, 0.242, 0.146, 0.960, 0.041, 0.142, 0.056, 0.985, 0.902, 0.538, 0.972, 0.084, 0.195, 0.238],
    'shark': [0.085, 0.944, 0.979, 0.191, 0.129, 0.935, 0.952, 0.083, 0.052, 0.094, 0.957, 0.060, 0.980, 0.065, 0.839, 0.977, 0.015, 0.119, 0.204, 0.026, 0.029, 0.987, 0.026, 0.069, 0.081, 0.781, 0.082, 0.938, 0.989, 0.671, 0.070, 0.228, 0.573, 0.930, 0.035, 0.158, 0.228, 0.036, 0.083, 0.034, 0.976, 0.987, 0.028, 0.984, 0.104, 0.676, 0.054, 0.987, 0.131, 0.189, 0.959, 0.980, 0.581, 0.979, 0.286, 0.360, 0.031, 0.983, 0.987, 0.993, 0.173, 0.988, 0.285, 0.323],
    'dolphin': [0.186, 0.325, 0.950, 0.019, 0.294, 0.866, 0.145, 0.368, 0.159, 0.033, 0.974, 0.992, 0.102, 0.057, 0.959, 0.806, 0.028, 0.338, 0.361, 0.037, 0.072, 0.067, 0.046, 0.036, 0.920, 0.812, 0.047, 0.966, 0.970, 0.969, 0.076, 0.111, 0.094, 0.108, 0.160, 0.844, 0.199, 0.115, 0.199, 0.972, 0.328, 0.971, 0.293, 0.984, 0.218, 0.644, 0.968, 0.844, 0.115, 0.081, 0.181, 0.973, 0.085, 0.910, 0.114, 0.983, 0.232, 0.819, 0.968, 0.990, 0.620, 0.579, 0.991, 0.041],
    'butterfly': [0.956, 0.983, 0.017, 0.304, 0.984, 0.994, 0.074, 0.901, 0.084, 0.012, 0.238, 0.978, 0.019, 0.074, 0.019, 0.128, 0.017, 0.537, 0.098, 0.041, 0.018, 0.952, 0.975, 0.067, 0.972, 0.041, 0.138, 0.382, 0.076, 0.213, 0.903, 0.084, 0.048, 0.042, 0.960, 0.156, 0.045, 0.090, 0.023, 0.126, 0.036, 0.027, 0.027, 0.200, 0.213, 0.062, 0.085, 0.026, 0.076, 0.032, 0.721, 0.028, 0.036, 0.066, 0.091, 0.982, 0.086, 0.791, 0.015, 0.022, 0.229, 0.136, 0.954, 0.041],
    'bee': [0.993, 0.326, 0.016, 0.035, 0.046, 0.042, 0.358, 0.989, 0.030, 0.019, 0.023, 0.981, 0.035, 0.322, 0.093, 0.110, 0.049, 0.966, 0.016, 0.252, 0.067, 0.910, 0.970, 0.029, 0.993, 0.136, 0.656, 0.236, 0.028, 0.967, 0.963, 0.165, 0.772, 0.126, 0.981, 0.431, 0.990, 0.036, 0.995, 0.162, 0.040, 0.022, 0.020, 0.018, 0.545, 0.165, 0.279, 0.050, 0.125, 0.026, 0.077, 0.024, 0.058, 0.026, 0.116, 0.216, 0.077, 0.024, 0.153, 0.102, 0.044, 0.073, 0.816, 0.026],
    'fly': [0.025, 0.437, 0.022, 0.028, 0.068, 0.171, 0.024, 0.891, 0.969, 0.012, 0.107, 0.984, 0.668, 0.048, 0.057, 0.816, 0.099, 0.951, 0.192, 0.040, 0.449, 0.040, 0.070, 0.036, 0.988, 0.963, 0.976, 0.113, 0.379, 0.055, 0.971, 0.053, 0.059, 0.991, 0.969, 0.133, 0.349, 0.980, 0.967, 0.591, 0.076, 0.112, 0.927, 0.171, 0.699, 0.371, 0.032, 0.375, 0.060, 0.990, 0.174, 0.453, 0.036, 0.246, 0.113, 0.165, 0.126, 0.072, 0.098, 0.157, 0.074, 0.076, 0.884, 0.061],
    'frog': [0.989, 0.329, 0.937, 0.480, 0.295, 0.046, 0.329, 0.982, 0.990, 0.916, 0.086, 0.190, 0.022, 0.989, 0.984, 0.307, 0.104, 0.060, 0.020, 0.991, 0.051, 0.988, 0.990, 0.118, 0.752, 0.063, 0.048, 0.323, 0.126, 0.660, 0.933, 0.046, 0.073, 0.047, 0.942, 0.875, 0.976, 0.031, 0.041, 0.364, 0.034, 0.231, 0.978, 0.726, 0.019, 0.883, 0.050, 0.100, 0.092, 0.030, 0.980, 0.173, 0.335, 0.480, 0.034, 0.144, 0.986, 0.036, 0.976, 0.016, 0.027, 0.049, 0.504, 0.037],
    'mouse': [0.947, 0.386, 0.763, 0.980, 0.972, 0.790, 0.990, 0.069, 0.084, 0.255, 0.018, 0.107, 0.052, 0.617, 0.154, 0.987, 0.042, 0.069, 0.129, 0.964, 0.811, 0.130, 0.956, 0.939, 0.055, 0.240, 0.982, 0.046, 0.990, 0.942, 0.029, 0.059, 0.018, 0.035, 0.021, 0.022, 0.129, 0.218, 0.129, 0.091, 0.027, 0.015, 0.968, 0.084, 0.010, 0.089, 0.018, 0.012, 0.036, 0.047, 0.165, 0.025, 0.018, 0.246, 0.051, 0.026, 0.030, 0.973, 0.014, 0.021, 0.172, 0.803, 0.919, 0.043],
}

OBJECTS = list(EMBEDDINGS)
CONTEXTS = [name for name, _ in FEATURES]
N_CONTEXT = len(CONTEXTS)
MEMBERS = dict(FEATURES)


def embedding(name):
    return EMBEDDINGS[name]


def get_random_episode(rng):
    """The notebook's recipe: pick a context, two objects that share
    it (the support), and a query that does (answer yes) or doesn't
    (answer no), with even odds."""
    feature = rng.choice(CONTEXTS)
    context_label = [0] * N_CONTEXT
    context_label[CONTEXTS.index(feature)] = 1
    included = MEMBERS[feature]
    excluded = [o for o in OBJECTS if o not in included]
    support = rng.choices(included, k=2)
    choice = rng.choice([0, 1])
    query = rng.choice(included if choice else excluded)
    return {
        'context_label': context_label,
        'support_1': embedding(support[0]),
        'support_2': embedding(support[1]),
        'query': embedding(query),
        'response': [1, 0] if choice else [0, 1],
    }


# Mechanisms
# ===========================================================

# Two support objects, each as its embedding: a context-independent
# representation of what the object is.
support_1 = pnl.TransferMechanism(name='support_1', input_shapes=N_EMBEDDING)
support_2 = pnl.TransferMechanism(name='support_2', input_shapes=N_EMBEDDING)

# The mean of the two supports: the simplest integration, adding them
# and multiplying by .5.
mean = pnl.TransferMechanism(name='mean', input_shapes=N_EMBEDDING, function=pnl.Linear(slope=.5))

# The inferred context.
context = pnl.TransferMechanism(name='context', input_shapes=HIDDEN_CONTEXT, function=pnl.ReLU())

# The context, named: one unit per feature, as probabilities.
context_label = pnl.TransferMechanism(name='context_label', input_shapes=N_CONTEXT, function=pnl.SoftMax())

# The object asked about.
query = pnl.TransferMechanism(name='query', input_shapes=N_EMBEDDING)

# The query, seen through the context.
context_dependent = pnl.TransferMechanism(name='context_dependent', input_shapes=HIDDEN_CONTEXT,
                                          function=pnl.ReLU())

# Does the query belong in this context? Unit 1 is yes, unit 2 no.
response = pnl.TransferMechanism(name='response', input_shapes=2, function=pnl.SoftMax())

# Projections: small random starting weights, learned
# ===========================================================

_weights = np.random.RandomState(0)


def _random_matrix(rows, cols):
    """RandomMatrix(0, .01): uniform between -0.005 and 0.005."""
    return (_weights.rand(rows, cols) - 0.5) * .01


projection_mean_to_context = pnl.MappingProjection(
    name='projection_mean_to_context',
    matrix=_random_matrix(N_EMBEDDING, HIDDEN_CONTEXT),
    learnable=True,
)
projection_query_to_context_dependent = pnl.MappingProjection(
    name='projection_query_to_context_dependent',
    matrix=_random_matrix(N_EMBEDDING, HIDDEN_CONTEXT),
    learnable=True,
)
projection_context_to_context_label = pnl.MappingProjection(
    name='projection_context_dependent_to_context_out',
    matrix=_random_matrix(HIDDEN_CONTEXT, N_CONTEXT),
    learnable=True,
)
projection_context_dependent_to_response = pnl.MappingProjection(
    name='projection_query_dependent_to_response',
    matrix=_random_matrix(HIDDEN_CONTEXT, 2),
    learnable=True,
)

# Composition
# ===========================================================

iscci_model = pnl.AutodiffComposition(
    name='embedding',
    pathways=[
        [support_1, pnl.IDENTITY_MATRIX, mean],
        [support_2, pnl.IDENTITY_MATRIX, mean],
        [query, projection_query_to_context_dependent, context_dependent],
        [mean, projection_mean_to_context, context],
        [context, pnl.IDENTITY_MATRIX, context_dependent],
        [context, projection_context_to_context_label, context_label],
        [context_dependent, projection_context_dependent_to_response, response],
    ],
    learning_rate=LEARNING_RATE,
)

# Inputs
# ===========================================================
# The notebook's test, in the shape Composition.run takes: an owl and
# a falcon seen together, then a cat or a penguin asked about.

owl_falcon_test = {
    support_1: [embedding('owl'), embedding('owl')],
    support_2: [embedding('falcon'), embedding('falcon')],
    query: [embedding('cat'), embedding('penguin')],
}

# Training set
# ===========================================================
# 24 episodes by the notebook's recipe, in the shape
# AutodiffComposition.learn takes.

_rng = random.Random(0)
_episodes = [get_random_episode(_rng) for _ in range(24)]

episodes = {
    'inputs': {
        support_1: [e['support_1'] for e in _episodes],
        support_2: [e['support_2'] for e in _episodes],
        query: [e['query'] for e in _episodes],
    },
    'targets': {
        context_label: [e['context_label'] for e in _episodes],
        response: [e['response'] for e in _episodes],
    },
    'epochs': 30,
}
