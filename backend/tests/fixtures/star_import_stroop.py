# A Stroop model using star imports (common in user code)
# Tests: star import conversion, multi-mechanism, multi-projection

from psyneulink import *
import numpy as np

# Color pathway
color_input = TransferMechanism(input_shapes=2, name='color_input')
color_hidden = TransferMechanism(
    input_shapes=2,
    function=Logistic(bias=-4),
    name='color_hidden'
)

# Word pathway
word_input = TransferMechanism(input_shapes=2, name='word_input')
word_hidden = TransferMechanism(
    input_shapes=2,
    function=Logistic(bias=-4),
    name='word_hidden'
)

# Output
output = TransferMechanism(input_shapes=2, function=Logistic(), name='output')
decision = DDM(name='decision')

# Projections
color_to_hidden = MappingProjection(sender=color_input, receiver=color_hidden)
word_to_hidden = MappingProjection(sender=word_input, receiver=word_hidden)
color_hidden_to_output = MappingProjection(sender=color_hidden, receiver=output)
word_hidden_to_output = MappingProjection(sender=word_hidden, receiver=output)
output_to_decision = MappingProjection(sender=output, receiver=decision)

# Composition
stroop = Composition(name='stroop')
stroop.add_node(color_input)
stroop.add_node(word_input)
stroop.add_node(color_hidden)
stroop.add_node(word_hidden)
stroop.add_node(output)
stroop.add_node(decision)
stroop.add_projection(color_to_hidden)
stroop.add_projection(word_to_hidden)
stroop.add_projection(color_hidden_to_output)
stroop.add_projection(word_hidden_to_output)
stroop.add_projection(output_to_decision)
