import psyneulink as pnl
import numpy as np

# Same simple_stroop model as v1, but declaration order is deliberately
# scrambled across mechanisms, projections, and composition members. Every
# axis the converter touches has its source order broken:
#   - mechanisms: response → words_input → colors_input (reverse alpha)
#   - projections: words_to_response → colors_to_response (reverse alpha)
#   - composition add_node calls: response → words_input → colors_input
#   - composition add_projection calls: words_to_response → colors_to_response
# The canonicalizer must normalize all of these to the same output as v1.

response = pnl.TransferMechanism(
    input_shapes=[2],
    function=pnl.Logistic(gain=1.0),
    name='response',
)

words_input = pnl.TransferMechanism(
    input_shapes=[3],
    function=pnl.Linear(intercept=0.1),
    name='words_input',
)

colors_input = pnl.TransferMechanism(
    input_shapes=[3],
    function=pnl.Linear(),
    name='colors_input',
)

words_to_response = pnl.MappingProjection(
    sender=words_input,
    receiver=response,
    matrix=np.array([
        [2.5, -1.5],
        [-1.5, 2.5],
        [0.0, 0.0],
    ]),
    name='words_to_response',
)

colors_to_response = pnl.MappingProjection(
    sender=colors_input,
    receiver=response,
    matrix=np.array([
        [1.5, -1.0],
        [-1.0, 1.5],
        [0.0, 0.0],
    ]),
    name='colors_to_response',
)

stroop_model = pnl.Composition(name='stroop_model')
stroop_model.add_node(response)
stroop_model.add_node(words_input)
stroop_model.add_node(colors_input)
stroop_model.add_projection(words_to_response)
stroop_model.add_projection(colors_to_response)
