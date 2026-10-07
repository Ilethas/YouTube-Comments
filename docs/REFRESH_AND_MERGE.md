# Refresh and merge

The SQLite library is an accumulating local history. Pure normalized observation
planning and transactional ingestion are implemented in
[ADR 0004](decisions/0004-durable-observation-merge.md), using the adapters from
[ADR 0003](decisions/0003-extractor-observations-and-normalization.md).
Live public helper execution, acquisition/refresh IPC and minimal renderer UI are implemented in [ADR 0005](decisions/0005-live-helper-execution-and-acquisition-ipc.md).

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
during extraction cannot be lost. ADR 0005 selects a temporary global single-live-operation lock and bounded helper retries/deadlines; local seen/preference writes remain available. User cancellation, final scheduling and crash-interrupted attempts remain unresolved.

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
define durable NEW presentation under ADR 0011: exactly the first-discovery cohort of the latest accepted post-baseline attempt.

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

## Active-view and NEW integration

Remote Refresh remains separate from Apply changes / Update view. Apply recomputes
using local data and performs no extraction. A successful explicit Refresh must
commit its merge then automatically recompute the active applied-filter matching
set. ADR 0008 reevaluates last applied criteria against committed comments while preserving draft. ADR 0012 resolves applied publication criteria against a fresh captured now/current system zone and projects the committed latest NEW cohort for discovery filtering; failed source Refresh preserves the applied result. ADR 0011 also advances the durable NEW cohort. Partial/unknown accepted outcomes show a compact localized coverage notice. Richer reporting remains open.

Seen edits alone preserve displayed membership/order and the last applied matching
set. Matching bulk actions use that set rather than raw matches or contextual rows.
ADR 0010 supplies session scroll reconciliation; ADR 0011 supplies ruler categories and NEW lifetime. Broader inactive-tab notification and styling remain separate choices. Discovery, publication and manual
unseen state retain distinct meanings. Explicit trustworthy remote deletion would
need a future policy; absence never supplies one.

## Verification

[Offline tests](TESTING.md) exercise real-style normalized fixtures, scoped identity,
authority, baseline/later discoveries, missing comments, missing/cyclic relationships,
later resolution, conflicts, true coverage, schema-1 preservation, migration and
merge rollback, local-state protection and reopen. ADR 0005's injected execution/UI
tests cover lifecycle and acknowledged unfiltered view updates without making
ordinary tests depend on YouTube or installed helpers. ADR 0008 tests applied-result recomputation; ADR 0011 adds cohort/ruler refresh and restart tests.

## Latest accepted discovery cohort (ADR 0011)

Main projects the accepted attempt with greatest durable `attempt_order` for each item. Schema 5 freezes existing row insertion order and assigns a new ordinal transactionally at attempt insertion; UTC timestamps and UUID lexicographic order do not select latest. The domain compares this attempt to the baseline and each comment's first-discovery attempt. No mutable NEW flag is stored.

Baseline imports are never NEW. Accepted partial/unknown acquisitions, reacquisition, empty/unavailable collections and zero-insert refreshes all replace the cohort. Failed history does not advance it; a database failure rolls back the ordinal/history and merge together. An existing comment updated in the latest attempt is not NEW. Publication age, seen edits, closing/reopening and process restart cannot change eligibility. The current cohort survives until the next accepted post-baseline attempt. No manual dismissal is added.
