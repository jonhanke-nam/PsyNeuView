# Vendored from PsyNeuLink — PrincetonUniversity/PsyNeuLink
# Source: psyneulink/library/models/MontagueDayanSejnowski96.py
# Pinned commit: b0a750db14 (jonhanke-dev, 2026-07-29 sync)
# Vendored: 2026-07-31 for PsyNeuView reference-model runnability (Refs #800, #777)
#
# Curated extract. Upstream this model is function-based: figure_5a/5b/5c() each
# build a TD-learning composition, call .learn(), and plot. We lift the figure_5a
# *construction only* to module scope — the .learn() call, all matplotlib
# plotting, argparse, and the module-level figure_5*() driver calls are dropped —
# so PsyNeuView loads the model with no side effects (no focus-stealing graph
# PDFs / plot windows, and no expensive learning run on import).
#
# The construction below (mechanisms, projection, composition, td-learning
# pathway) is verbatim from upstream figure_5a(). ``build_stimulus_dictionary``
# is kept verbatim (a pure input-builder) so a regression test can exercise the
# model's actual purpose — TD learning — on demand.
# Drift-tracked — re-vendor to update.
# -----------------------------------------------------------------------------

import numpy as np
import psyneulink as pnl


def build_stimulus_dictionary(sample_mechanism, target_mechanism, no_reward_trials):

    stimulus_onset = 41
    reward_delivery = 54

    samples = []
    targets = []
    for trial in range(120):
        target = [0.] * 60
        target[reward_delivery] = 1.
        if trial in no_reward_trials:
            target[reward_delivery] = 0.
        targets.append(target)

        sample = [0.] * 60
        for i in range(stimulus_onset, 60):
            sample[i] = 1.
        samples.append(sample)

    return {sample_mechanism: samples,
            target_mechanism: targets}


# --- construction lifted from upstream figure_5a() -----------------------------

# Create Processing Components
sample_mechanism = pnl.TransferMechanism(default_variable=np.zeros(60),
                                         name=pnl.SAMPLE)

action_selection = pnl.TransferMechanism(default_variable=np.zeros(60),
                                         function=pnl.Linear(slope=1.0,
                                                             intercept=0.01),
                                         name='Action Selection')

sample_to_action_selection = pnl.MappingProjection(sender=sample_mechanism,
                                                   receiver=action_selection,
                                                   matrix=np.zeros((60, 60)))
# Create Composition
composition_name = 'TD_Learning_Figure_5A'
comp = pnl.Composition(name=composition_name)

# Add Processing Components to the Composition
pathway = [sample_mechanism, sample_to_action_selection, action_selection]

# Add Learning Components to the Composition
learning_related_components = comp.add_td_learning_pathway(pathway, learning_rate=0.3).learning_components

# Unpack Relevant Learning Components
prediction_error_mechanism = learning_related_components[pnl.OBJECTIVE_MECHANISM]
target_mechanism = learning_related_components[pnl.TARGET_MECHANISM]

# NB: no .learn() call here — construction only. Downstream (tests / PsyNeuView)
# drives learning explicitly with build_stimulus_dictionary(...).
