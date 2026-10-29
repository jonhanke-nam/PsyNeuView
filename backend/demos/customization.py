# PsyNeuLink Model File
# Format Version: 1.0
# Model: wave_comp

import psyneulink as pnl
import numpy as np

# ===========================================================
# Customization: a Python function as a mechanism's function
# From PsyNeuLink's Basics and Primer, "Customization"
# (docs/source/BasicsAndPrimer.rst), with the Primer's own code
# and names.
#
# my_sinusoidal_fct is plain Python: the amplitude of a sine wave
# of a given frequency at a given time. Assigned as a
# ProcessingMechanism's function, PsyNeuLink wraps it as a
# UserDefinedFunction: its first argument becomes the mechanism's
# input (two values, frequency and time, matching the
# default_variable [[0], [0]]), and its other arguments, phase and
# amplitude, become parameters of the function, which can be set
# and modulated like any other.
# ===========================================================

# The function
# ===========================================================

def my_sinusoidal_fct(input=[[0], [0]],
                      phase=0,
                      amplitude=1):
    frequency = input[0]
    time = input[1]
    return amplitude * np.sin(2 * np.pi * frequency * time + phase)

# Mechanisms
# ===========================================================

my_wave_mech = pnl.ProcessingMechanism(default_variable=[[0], [0]],
                                       function=my_sinusoidal_fct,
                                       name='my_wave_mech')

# Composition
# ===========================================================
# The Primer gives my_wave_mech its two values directly. Here two
# input nodes, FREQUENCY and TIME, feed its two input ports, one
# each, so the Run tab can set them; my_wave_mech is the Primer's.

frequency = pnl.ProcessingMechanism(name='FREQUENCY')
time = pnl.ProcessingMechanism(name='TIME')
frequency_in = pnl.MappingProjection(sender=frequency, receiver=my_wave_mech.input_ports[0], name='frequency_in')
time_in = pnl.MappingProjection(sender=time, receiver=my_wave_mech.input_ports[1], name='time_in')

wave_comp = pnl.Composition(name='wave_comp')
wave_comp.add_nodes([frequency, time, my_wave_mech])
wave_comp.add_projection(frequency_in)
wave_comp.add_projection(time_in)

# Inputs
# ===========================================================
# Frequency 1 (one cycle per unit of time), at a quarter, a half
# and three quarters of the cycle: the peak, the zero crossing and
# the trough. The Run tab offers it by this name, and opens with it.

quarter_cycles = {frequency: [1, 1, 1], time: [0.25, 0.5, 0.75]}
