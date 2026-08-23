# Base-M4 display-topology observation

**Issue:** [#28](https://github.com/MeekPhills/project-ambient/issues/28)
**Captured:** 2026-08-23
**Qualification:** partial topology evidence only

The public `system_profiler SPDisplaysDataType -json` path was reduced to
resolution plus online, main, mirrored, and asleep booleans. Display serials,
display IDs, product IDs, and vendor IDs are intentionally excluded.

The observed host exposed one online display at `1920 x 1080 @ 120.00Hz`.
Therefore the required two-display fixture—`3008x1692 @ 240 Hz` plus
`2560x1440 @ 60 Hz`, HDR off—was **not present** and no dual-display or M4
qualification is claimed.

`powermetrics` was also probed without privilege and refused execution because
it requires superuser access. No wakeup or energy value was inferred from that
failure; those metrics remain unmeasured pending an approved public-tool path.
