# Vendored from PsyNeuLink — PrincetonUniversity/PsyNeuLink
# Source: psyneulink/library/models/Nieuwenhuis2005Model.py
# Pinned commit: b0a750db14 (jonhanke-dev, 2026-07-29 sync)
# Vendored: 2026-07-31 for PsyNeuView reference-model runnability (Refs #800, #777)
#
# Curated extract: the composition construction only. The upstream file's
# module-level run driver (argparse, .run() calls, matplotlib plotting,
# show_graph) is stripped so PsyNeuView loads the model with no side effects
# (no graph PDFs / windows). Construction below is verbatim upstream.
# Drift-tracked — re-vendor to update.
# -----------------------------------------------------------------------------
# Import all dependencies.

import numpy as np
import psyneulink as pnl
# from scipy.special import erfinv # need to import this to make us of the UniformToNormalDist function.


# --------------------------------- Global Variables ----------------------------------------
# Now, we set the global variables, weights and initial values as in the paper.
# WATCH OUT !!! In the paper the weight "Mutual inhibition among response units" is not defined, but needs to be set to
# 0 in order to reproduce the paper.
SD = 0.15       # noise determined by standard deviation (SD)
a = 0.50        # Parameter describing shape of the FitzHugh–Nagumo cubic nullcline for the fast excitation variable v
d = 0.5         # Uncorrelated Activity
k = 1.5         # Scaling factor for transforming NE release (u ) to gain (g ) on potentiated units
G = 0.5         # Base level of gain applied to decision and response units
dt = 0.02       # time step size
C = 0.90        # LC coherence (see Gilzenrat et al. (2002) on more details on LC coherence

initial_hv = 0.07                     # Initial value for h(v)
initial_w = 0.14                      # initial value u
initial_v = (initial_hv - (1 - C) * d) / C  # get initial v from initial h(v)

# Weights:
inpwt = 1.5       # inpwt (Input to decision layer)
crswt = 1 / 3       # crswt (Crosstalk input to decision layer)
inhwt = 1.0       # inhwt (Mutual inhibition among decision units)
respinhwt = 0     # respinhwt (Mutual inhibition among response units)  !!! WATCH OUT: this parameter is not mentioned
# in the original paper, most likely since it was set 0
decwt = 3.5       # decwt (Target decision unit to response unit)
selfdwt = 2.5     # selfdwt (Self recurrent conn. for each decision unit)
selfrwt = 2.0     # selfrwt (Self recurrent conn. for response unit)
lcwt = 0.3        # lcwt (Target decision unit to LC)
decbias = 1.75    # decbias (Bias input to decision units)
respbias = 1.75   # respbias (Bias input to response units)
tau_v = 0.05    # Time constant for fast LC excitation variable v
tau_u = 5.00    # Time constant for slow LC recovery variable (‘NE release’) u
trials = 1100   # number of trials to reproduce Figure 3 from Nieuwenhuis et al. (2005)

# Setting seed (if noise is applied)
# np.random.seed(22)    # Set noise with seed generator to 22 to use the UniformToNormalDist function to have a python
# seed compatible with MATLAB random seed generator (rsg=22)
# Please see https://github.com/jonasrauber/randn-matlab-python for further documentation

# Create mechanisms ---------------------------------------------------------------------------------------------------

# Input Layer --- [ Target 1, Target 2, Distractor ]

# First, we create the 3 layers of the behavioral network, i.e. INPUT LAYER, DECISION LAYER, and RESPONSE LAYER.
input_layer = pnl.TransferMechanism(
    input_shapes=3,                      # Number of units in input layer
    initial_value=[[0.0, 0.0, 0.0]],     # Initial input values
    name='INPUT LAYER'                  # Define the name of the layer; this is optional,
)                 # but will help you to overview your model later on

# Create Decision Layer  --- [ Target 1, Target 2, Distractor ]
decision_layer = pnl.LCAMechanism(
    input_shapes=3,                            # Number of units in input layer
    initial_value=[[0.0, 0.0, 0.0]],    # Initial input values
    time_step_size=dt,                 # Integration step size
    leak=1.0,                         # Sets off diagonals to negative values
    self_excitation=selfdwt,           # Set diagonals to self excitate
    competition=inhwt,                 # Set off diagonals to inhibit
    function=pnl.Logistic(x_0=decbias),   # Set the Logistic function with bias = decbias
    # noise=pnl.UniformToNormalDist(standard_deviation = SD).function, # The UniformToNormalDist function will
    integrator_mode=True,               # set the noise with a seed generator that is compatible with
    name='DECISION LAYER'               # MATLAB random seed generator 22 (rsg=22)
)

# decision_layer.set_log_conditions('RESULT')  # Log RESULT of the decision layer
decision_layer.set_log_conditions('value')  # Log value of the decision layer

for output_port in decision_layer.output_ports:
    output_port.parameters.value.set(output_port.value * 0.0, override=True)  # Set initial output values for decision layer to 0

# Create Response Layer  --- [ Target1, Target2 ]
response_layer = pnl.LCAMechanism(
    input_shapes=2,                                        # Number of units in input layer
    initial_value=[[0.0, 0.0]],                    # Initial input values
    time_step_size=dt,                             # Integration step size
    leak=1.0,                                     # Sets off diagonals to negative values
    self_excitation=selfrwt,                       # Set diagonals to self excitate
    competition=respinhwt,                         # Set off diagonals to inhibit
    function=pnl.Logistic(x_0=respbias),          # Set the Logistic function with bias = decbias
    # noise=pnl.UniformToNormalDist(standard_deviation = SD).function,
    integrator_mode=True,
    name='RESPONSE LAYER'
)

response_layer.set_log_conditions('RESULT')     # Log RESULT of the response layer
for output_port in response_layer.output_ports:
    output_port.parameters.value.set(output_port.value * 0.0, override=True)  # Set initial output values for response layer to 0

# Connect mechanisms --------------------------------------------------------------------------------------------------
# Weight matrix from Input Layer --> Decision Layer
input_weights = np.array([
    [inpwt, crswt, crswt],                    # Input weights are diagonals, cross weights are off diagonals
    [crswt, inpwt, crswt],
    [crswt, crswt, inpwt]
])

# Weight matrix from Decision Layer --> Response Layer
output_weights = np.array([
    [decwt, 0.0],  # Weight from T1 and T2 but not distractor unit (row 3 set to all zeros) to response layer
    [0.0, decwt],  # Need a 3 by 2 matrix, to project from decision layer with 3 units to response layer with 2 units
    [0.0, 0.0]
])

decision_pathway = pnl.Pathway(
    pathway=[
        input_layer,
        input_weights,
        decision_layer,
        output_weights,
        response_layer
    ],
    name='DECISION PATHWAY'
)

# Abstracted LC to modulate gain --------------------------------------------------------------------

# This LCControlMechanism modulates gain.
LC = pnl.LCControlMechanism(
    integration_method="EULER",       # We set the integration method to Euler like in the paper
    threshold_FitzHughNagumo=a,                  # Here we use the Euler method for integration and we want to set the parameters,
    uncorrelated_activity_FitzHughNagumo=d,      # for the FitzHugh–Nagumo Composition.
    time_step_size_FitzHughNagumo=dt,
    mode_FitzHughNagumo=C,
    time_constant_v_FitzHughNagumo=tau_v,
    time_constant_w_FitzHughNagumo=tau_u,
    a_v_FitzHughNagumo=-1.0,
    b_v_FitzHughNagumo=1.0,
    c_v_FitzHughNagumo=1.0,
    d_v_FitzHughNagumo=0.0,
    e_v_FitzHughNagumo=-1.0,
    f_v_FitzHughNagumo=1.0,
    a_w_FitzHughNagumo=1.0,
    b_w_FitzHughNagumo=-1.0,
    c_w_FitzHughNagumo=0.0,
    t_0_FitzHughNagumo=0.0,
    base_level_gain=G,                # Additionally, we set the parameters k and G to compute the gain equation
    scaling_factor_gain=k,
    initial_v_FitzHughNagumo=initial_v,          # Initialize v
    initial_w_FitzHughNagumo=initial_w,          # Initialize w
    objective_mechanism=pnl.ObjectiveMechanism(
        function=pnl.Linear,
        monitor=[(
            decision_layer,  # Project output of T1 and T2 but not distractor from decision layer to LC
            np.array([[lcwt], [lcwt], [0.0]])
        )],
        name='Combine values'
    ),
    modulated_mechanisms=[decision_layer, response_layer],  # Modulate gain of decision & response layers
    name='LC'
)

# Log value of LC
LC.set_log_conditions('value')

# Set initial gain to G + k*initial_w, when the Composition runs the very first time,
# since the decison layer executes before the LC and hence needs one initial gain value to start with.
for output_port in LC.output_ports:
    output_port.parameters.value.set(output_port.value * (G + k * initial_w), override=True)

task = pnl.Composition()
task.add_linear_processing_pathway(decision_pathway)
task.add_node(LC)

# Create Stimulus -----------------------------------------------------------------------------------------------------

# In the paper, each period has 100 time steps, so we will create 11 time periods.
# As described in the paper in figure 3, during the first 3 time periods input to distractor units is fixed to 1.
# Then T1 gets turned on during time period 4 with an input of 1.
# T2 gets turns on with some lag from T1 onset on, in this example we turn T2 on with Lag 2 and an input of 1
# Between T1 and T2 and after T2 the distractor unit is on.
# We create one array with 3 numbers, one for each input unit and repeat this array 100 times for one time period
# We do this 11 times. T1 is on for time4, T2 is on for time7 to model Lag3
num_time_steps = 100  # Each stimulus is presented for two units of time which is equivalent to 100 time steps
stimulus_T1 = np.repeat(np.array([[0, 0, 1]]), num_time_steps, axis=0)
stimulus_T2 = np.repeat(np.array([[0, 0, 1]]), num_time_steps, axis=0)
stimulus_T3 = np.repeat(np.array([[0, 0, 1]]), num_time_steps, axis=0)
stimulus_T4 = np.repeat(np.array([[1, 0, 0]]), num_time_steps, axis=0)    # Turn T1 on
stimulus_T5 = np.repeat(np.array([[0, 0, 1]]), num_time_steps, axis=0)
stimulus_T6 = np.repeat(np.array([[0, 1, 0]]), num_time_steps, axis=0)    # Turn T2 on --> example for Lag 2
stimulus_T7 = np.repeat(np.array([[0, 0, 1]]), num_time_steps, axis=0)
stimulus_T8 = np.repeat(np.array([[0, 0, 1]]), num_time_steps, axis=0)
stimulus_T9 = np.repeat(np.array([[0, 0, 1]]), num_time_steps, axis=0)
stimulus_T10 = np.repeat(np.array([[0, 0, 1]]), num_time_steps, axis=0)
stimulus_T11 = np.repeat(np.array([[0, 0, 1]]), num_time_steps, axis=0)

# Concatenate the 11 arrays to one array with 1100 rows and 3 columns.
time = np.concatenate((stimulus_T1, stimulus_T2, stimulus_T3, stimulus_T4, stimulus_T5, stimulus_T6,
                       stimulus_T7, stimulus_T8, stimulus_T9, stimulus_T10, stimulus_T11), axis=0)

# assign inputs to input_layer (Origin Mechanism) for each trial
stim_list_dict = {input_layer: time}

# show the Composition

# run the Composition
