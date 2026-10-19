# ADR 0036: Measured reader snapshot hardening (M9.1)

Date: 2026-10-19. Status: implemented, awaiting owner review. Schema **14**, unchanged.

## Evidence and choice

The serial 60k-profile, 2/4-window [M9.1 measurements](../M9_1_PERFORMANCE.md)
showed large bridge-copy costs, redundant synchronous bootstrap reads and expensive
full comment mutation replies. A complete snapshot was 116 MB of JSON-equivalent
data per native. Pruning alone exposed early cold worker-file loading behind later
windows' synchronous bootstrap materialization; the existing one-second query
deadline correctly rejected those delayed reconstructions.

Make two bounded corrections within the existing main-owned architecture:

- Omit the redundant optional full comment `remote` tree from reader projections.
  Keep every consumed field, including truthful publication/relationship evidence
  and usable avatars. Complete normalized evidence stays in SQLite and merge.
  Content-item evidence used by headers/thumbnails stays available.
- Reuse only `items`, `comments` and `seenUndo` materialized by bootstrap for the
  current repository commit revision. The repository object supplies the epoch.
  Private workspace, instances, intent, collapse and preferences are read afresh
  for each caller. Nothing in the cache grants window/view/document authority.

Clear reuse before **every** transaction and again on exit, including failure,
before post-COMMIT observers run. Disable reuse inside transactions, so a removal
return cannot expose pre-delete rows. Closing clears it; profile reopen/restore
creates a new repository/epoch. Even private/watermark commits invalidate it: this
conservative rule avoids a second invalidation protocol. Main callers honor the
existing readonly snapshot contract; IPC/contextBridge still copies to independent
renderers. No shared mutable renderer memory or process-global cache is introduced.

## Costs and boundaries

The cache can retain one complete shared snapshot until the next commit or close.
Compare main memory as well as latency; it is neither a bounded-by-DOM memory claim
nor an item-level cache selected for all queries. Scoped item/mutation reads still
use the existing path. Full-profile loading, complete mutation reply arrays,
SQLite/merge/validation stalls and per-view query/result memory remain Q-21.

Do not relax the 1000 ms whole-query deadline, M2 ordering/recovery, M3 barriers,
M4–M6 restoration or M7/M8 live-result/authority fences for benchmark numbers.
No migration, worker/paging/index architecture, broad IPC redesign or new feature
is selected. The report records successful runs, intermediate failures, noise,
retained-data equality and remaining limits. M9.2 requires owner review.
