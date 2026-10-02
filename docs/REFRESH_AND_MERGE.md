# Refresh and merge

The SQLite library is an accumulating local history. Pure normalized observation
planning and transactional ingestion are implemented in
[ADR 0004](decisions/0004-durable-observation-merge.md), using the adapters from
[ADR 0003](decisions/0003-extractor-observations-and-normalization.md).
Live helper execution, acquisition/refresh IPC and renderer UI are not implemented.

## Accepted identity and field rules

- Item identity is source/content kind plus opaque source item ID. Comment identity
  is scoped to its item plus opaque source comment ID; it is never globally unique.
  Internal IDs remain separate and stable across reacquisition.
- Existing comments keep internal identity, seen and first-discovery facts. Accepted
  observations advance last-observed time/attempt; missing or skipped comments get
  no writes at all. Absence never means deletion, reparenting or detachment.
- Only `observed` fields update remote values. Unknown, unavailable, lossy-default,
  unreliable, invalid and unsupported variants cannot erase useful values.
  Trustworthy empty/zero/false values may update. Author and attachment subfields
  preserve the same authority rule. Mutable text/likes are current values, without
  per-value historical versioning.
- Newly accepted identities start unseen and receive first/last attempt/time facts.
  Remote merge updates never write existing local comment state.

Publication instants, precision/estimatedness and source labels are retained, with
separate evidence for an instant and a label when both have been observed. Missing
instants stay absent; discovery time never substitutes. Publication-date query
boundaries/timezones and handling coarse evidence remain open.

## Planning and transaction

`src/domain/observation-merge.ts` accepts current durable evidence, one normalized
batch, attempt ID/time and an internal-ID factory. It plans item insertion/update,
comment inserts/remote updates, discoveries, last observations and structured history.
It has no SQLite, Electron, React, raw backend schema or seen-state dependency.

The main repository receives an already normalized result. External execution and
parsing must precede its write transaction. Inside `BEGIN IMMEDIATE`, it reads the
current discussion, plans, inserts history, applies remote writes and creates unseen
state for new comments. These commit atomically. Any failed database write rolls
back the entire attempt and preserves the prior snapshot/history. A normalized
failure can commit failed history without discussion changes; there is no automatic
second failure-history write after a database rollback.

The clock and ID factory are injected; main defaults to UTC time and UUIDs. Existing
seen state is neither read into the plan nor written back, so manual edits completed
during future extraction cannot be lost. Process scheduling, overlapping refresh
ordering, cancellation, retries and crash-interrupted attempts remain unresolved.

## Coverage, conflicts and relationships

Usable unknown or partial batches are accepted non-destructively, retaining their
true coverage/evidence. Complete remains reserved for affirmative evidence; process
success/count equality cannot establish it. Failed observations commit history only.
Collection unavailable, present-empty and coverage are separate facts.

Every occurrence of a duplicate/conflicted comment identity is skipped, including
identical duplicates. Such candidates neither insert nor overwrite stored remote
data or observation facts. Independent unambiguous candidates can still commit.
History records skipped occurrences, conflicted identities and structured issues.
Invalid required raw shapes still fail normalization as specified in ADR 0003;
invalid optional fields become unknown. No global tree repair rule is introduced.

Source relationship evidence distinguishes top-level, true direct parent and
Community thread containment. Missing targets do not discard children: their
opaque relationship IDs persist. The reader resolves relationships within the
accumulated discussion and uses missing targets/every cycle member as display roots,
retaining other descendants. It never rewrites source truth. Later targets can
improve display placement without changing comment ID, seen, first discovery or
last observation. `directParentId` supplies usable true reply evidence only;
Community containment can supply `parentId` for display but never replied-to-author
search evidence. Ctrl+click applies to the complete projected display subtree.

## Baseline and durable history

The first successfully accepted acquisition of a new item establishes its baseline,
including accepted unknown/partial batches and empty/unavailable collections. All
imported comments receive discovery information and start unseen. Baseline imports
are not visually NEW. Later first discoveries have later attempt identities and
can support future NEW presentation; badge/marker lifetime remains unresolved.

History stores attempt ID, optional item/target association, UTC acceptance time,
backend/version and fixture provenance, actual coverage/evidence, accepted/failed
outcome, collection availability, counts and sanitized structured issues. Counts
mean candidate occurrences, inserts, accepted existing-comment observations
(`updated`, including unchanged fields), skipped occurrences and conflicted
identities. No historical text/like versions or raw public dumps are retained.
Failed normalization can receive a caller target when it publishes no item.

Schema-1 demo discovery labels become explicitly synthetic history in migration;
IDs/metadata/seen/preferences/order remain intact. Demo initialization seeds only
an empty library and never resets an existing library. See [Database](DATABASE.md).

## Future active-view integration

Remote Refresh remains separate from Apply changes / Update view. Apply recomputes
using local data and performs no extraction. A successful explicit Refresh must
commit its merge then automatically recompute the active applied-filter matching
set. That orchestration/UI is future scope. Partial/unknown accepted outcomes must
remain visible as such in the eventual reporting; presentation details remain open.

Seen edits alone preserve displayed membership/order and the last applied matching
set. Matching bulk actions use that set rather than raw matches or contextual rows.
Scroll reconciliation, inactive-tab handling, styling, supplementary live indicators
and final NEW lifetime remain separate choices. Discovery, publication and manual
unseen state retain distinct meanings. Explicit trustworthy remote deletion would
need a future policy; absence never supplies one.

## Verification

[Offline tests](TESTING.md) exercise real-style normalized fixtures, scoped identity,
authority, baseline/later discoveries, missing comments, missing/cyclic relationships,
later resolution, conflicts, true coverage, schema-1 preservation, migration and
merge rollback, local-state protection and reopen. Future execution/UI tests must
cover lifecycle and automatic active-view recomputation without making ordinary
tests depend on YouTube or installed helpers.
