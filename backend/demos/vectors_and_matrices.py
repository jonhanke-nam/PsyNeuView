# PsyNeuLink Model File
# Format Version: 1.0
# Model: vectors_and_matrices

import psyneulink as pnl

# ===========================================================
# Vectors and matrices, as PsyNeuLink holds them
# From the Cognitive Neuroscience Course, Module 0, "Scalars,
# Vectors, and Matrices": docs/source/tutorials/
#   cognitive_neuroscience_course/0_primer/notebooks/
#   1_scalars_vectors_and_matrices.ipynb
# on the PrincetonUniversity/PsyNeuLink docs/refactor-documentation
# branch (PsyNeuView #45).
#
# The notebook does this lesson in numpy. This is the same
# arithmetic as a PsyNeuLink model, with the notebook's numbers:
#
#   vector_b  a mechanism with three units. Its input and output
#             are vectors of three numbers. Linear, slope 1, so it
#             passes its input through unchanged.
#   matrix_A  the projection from vector_b to vector_c. Its matrix
#             holds the notebook's A = [[1, 2, 3], [4, 5, 6]].
#   vector_c  a mechanism with two units, also Linear: its output is
#             exactly what arrives through matrix_A.
#
# So vector_c = A b. With b = [7, 8, 9], vector_c is [50, 122]:
# 1*7 + 2*8 + 3*9 = 50 and 4*7 + 5*8 + 6*9 = 122. Each output unit
# is one dot product, a weighted sum of the input.
#
# PsyNeuLink writes a projection's matrix with one row per *sending*
# unit and one column per *receiving* unit, and multiplies the
# input on the left (b @ matrix). That is the transpose of how the
# notebook writes A, so the matrix below is A transposed: the
# notebook's first row [1, 2, 3] is the first *column* here.
# ===========================================================

# Mechanisms
# ===========================================================

vector_b = pnl.TransferMechanism(
    name='vector_b',
    input_shapes=3,
    function=pnl.Linear(slope=1),
)

vector_c = pnl.TransferMechanism(
    name='vector_c',
    input_shapes=2,
    function=pnl.Linear(slope=1),
)

# Projection: the notebook's A, transposed (rows = vector_b's units)
# ===========================================================

matrix_A = pnl.MappingProjection(
    name='matrix_A',
    matrix=[[1, 4],
            [2, 5],
            [3, 6]],
)

# Composition
# ===========================================================

vectors_and_matrices = pnl.Composition(name='vectors_and_matrices')
vectors_and_matrices.add_linear_processing_pathway(
    pathway=(vector_b, matrix_A, vector_c)
)

# Inputs
# ===========================================================
# The notebook's examples, in the shape Composition.run takes. The
# Run tab offers them by these names, and opens with the first.

# A times one vector: b = [7, 8, 9] gives [50, 122].
b_is_7_8_9 = {vector_b: [[7, 8, 9]]}

# A times a matrix: two trials, one per column of the notebook's
# B = [[7, 10], [8, 11], [9, 12]]. Each trial's output is one column
# of C = A B = [[50, 68], [122, 167]].
columns_of_B = {vector_b: [[7, 8, 9], [10, 11, 12]]}

# The identity matrix, one row per trial. Each output is one row of
# matrix_A (one column of the notebook's A): [1, 4], [2, 5], [3, 6].
identity = {vector_b: [[1, 0, 0], [0, 1, 0], [0, 0, 1]]}
