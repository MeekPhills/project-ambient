# Resource-budget fixtures

These fixtures bind Project Ambient's resource ceilings to an exact reference tier. They are contract fixtures, not evidence that a runtime has qualified. The validator fails closed if a partial fixture is presented as qualified or if required metric coverage is omitted.

The sibling settled-static wakeup qualification schema and plan freeze one
future evidence protocol without changing the resource fixture: five fresh
process instances of one exact candidate artifact, each with a 300-second
warm-up and a 900-second signposts-off window, 901 absolute-deadline samples,
and nearest-rank P95 rank five against the unchanged two-wakeup-per-minute
ceiling. The plan is
protocol-only; it contains no candidate, windows, result, coverage advance, or
tracker credit. A collector, public preflight, fixed non-personal still, and
complete reviewed run are separate prerequisites. Future sanitized windows must
retain timing extrema and closed continuity/stability proof after temporary raw
rows are deleted.

The current schema's active artifact branches are plan and incomplete result;
the validator pins the frozen plan bytes, and the current incomplete-result
branch binds that plan's exact producer revision and byte digest. The complete-
result definition remains reserved and inactive while the plan's fixed-still
digest is null. A later reviewed plan must freeze that digest and activate
exact result bindings before any complete evidence can validate.

Settled RSS and physical footprint are independent rows. RSS retains its 40 MiB
maximum, while public `RUSAGE_INFO_V3.ri_phys_footprint` is sampled as a gauge
with a separate 40 MiB nearest-rank P95 ceiling. Passing either row never
compensates for failing the other. Gauge movement does not count as process
activity, and incomplete sampling leaves physical-footprint coverage
`unmeasured` rather than inferring a value.
