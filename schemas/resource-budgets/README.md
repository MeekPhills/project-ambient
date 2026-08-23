# Resource-budget fixtures

These fixtures bind Project Ambient's resource ceilings to an exact reference tier. They are contract fixtures, not evidence that a runtime has qualified. The validator fails closed if a partial fixture is presented as qualified or if required metric coverage is omitted.

Settled RSS and physical footprint are independent rows. RSS retains its 40 MiB
maximum, while public `RUSAGE_INFO_V3.ri_phys_footprint` is sampled as a gauge
with a separate 40 MiB nearest-rank P95 ceiling. Passing either row never
compensates for failing the other. Gauge movement does not count as process
activity, and incomplete sampling leaves physical-footprint coverage
`unmeasured` rather than inferring a value.
