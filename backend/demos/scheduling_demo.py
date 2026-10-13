# PsyNeuLink Model File
# Format Version: 1.0
# PsyNeuLink: 0.18.0.0
# Model: scheduling_demo
#
# Demonstrates GraphStructureConditions:
# A pipeline (sensor → processor → output) plus monitor and logger nodes,
# with scheduling conditions that modify the execution graph at runtime.

import psyneulink as pnl

# ============================================================
# Mechanisms
# ============================================================

sensor = pnl.TransferMechanism(
    function=pnl.Linear(slope=1.0),
    name='sensor'
)

processor = pnl.TransferMechanism(
    function=pnl.Logistic(gain=1.0, bias=0.0),
    name='processor'
)

output = pnl.TransferMechanism(
    function=pnl.Linear(slope=1.0),
    name='output'
)

monitor = pnl.TransferMechanism(
    function=pnl.Linear(slope=0.5),
    name='monitor'
)

logger = pnl.TransferMechanism(
    function=pnl.Linear(slope=1.0),
    name='logger'
)

# ============================================================
# Projections
# ============================================================

sensor_to_processor = pnl.MappingProjection(
    sender=sensor,
    receiver=processor,
    name='sensor_to_processor'
)

processor_to_output = pnl.MappingProjection(
    sender=processor,
    receiver=output,
    name='processor_to_output'
)

# ============================================================
# Compositions
# ============================================================

comp = pnl.Composition(name='scheduling_demo')
comp.add_node(sensor)
comp.add_node(processor)
comp.add_node(output)
comp.add_node(monitor)
comp.add_node(logger)
comp.add_projection(sensor_to_processor)
comp.add_projection(processor_to_output)

# ============================================================
# Scheduling
# ============================================================

# Ensure sensor always runs before output (even without direct projection)
comp.scheduler.add_condition(sensor, pnl.BeforeNode(output))

# Add a dynamic dependency edge from monitor to processor
comp.scheduler.add_condition(monitor, pnl.AddEdgeTo(processor))

# Ensure output runs after processor
comp.scheduler.add_condition(output, pnl.AfterNode(processor))

# Co-schedule logger with monitor (same execution dependencies)
comp.scheduler.add_condition(logger, pnl.WithNode(monitor))

# Basic conditions: control WHEN nodes execute (not graph structure)
comp.scheduler.add_condition(processor, pnl.EveryNCalls(sensor, 2))
comp.scheduler.add_condition(output, pnl.All(
    pnl.EveryNCalls(processor, 1),
    pnl.AfterNCalls(sensor, 3),
))
