# A pipeline (sensor -> processor -> output) plus monitor and logger nodes,
# carrying scheduler conditions (basic + graph-structure) that the
# canonicalizer does not currently preserve. Used only by the
# scheduling_demo gap test, NOT by the equivalence matrix (#222, #85).

import psyneulink as pnl

sensor = pnl.TransferMechanism(function=pnl.Linear(slope=1.0), name='sensor')
processor = pnl.TransferMechanism(function=pnl.Logistic(gain=1.0, bias=0.0), name='processor')
output = pnl.TransferMechanism(function=pnl.Linear(slope=1.0), name='output')
monitor = pnl.TransferMechanism(function=pnl.Linear(slope=0.5), name='monitor')
logger = pnl.TransferMechanism(function=pnl.Linear(slope=1.0), name='logger')

sensor_to_processor = pnl.MappingProjection(sender=sensor, receiver=processor, name='sensor_to_processor')
processor_to_output = pnl.MappingProjection(sender=processor, receiver=output, name='processor_to_output')

comp = pnl.Composition(name='scheduling_demo')
comp.add_node(sensor)
comp.add_node(processor)
comp.add_node(output)
comp.add_node(monitor)
comp.add_node(logger)
comp.add_projection(sensor_to_processor)
comp.add_projection(processor_to_output)

# Graph-structure conditions
comp.scheduler.add_condition(sensor, pnl.BeforeNode(output))
comp.scheduler.add_condition(monitor, pnl.AddEdgeTo(processor))
comp.scheduler.add_condition(output, pnl.AfterNode(processor))
comp.scheduler.add_condition(logger, pnl.WithNode(monitor))

# Basic (timing) conditions
comp.scheduler.add_condition(processor, pnl.EveryNCalls(sensor, 2))
comp.scheduler.add_condition(output, pnl.All(
    pnl.EveryNCalls(processor, 1),
    pnl.AfterNCalls(sensor, 3),
))
