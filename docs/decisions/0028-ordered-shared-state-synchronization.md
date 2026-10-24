# ADR 0028: Ordered shared-state synchronization (M2)

Date: 2026-10-18. Status: implemented, awaiting owner review. Scope: M2 only.
Production still opens exactly one reader. Schema remains **12**.

## Commit authority

One ReaderRepository/ReaderService owns the opened profile. Each repository open
generates a random `profileEpoch`; `commitRevision` starts at zero and advances
once after each successful existing outer SQLite transaction. Successful no-op
transactions also advance. Failed actions and failed COMMITs do not publish or
advance. Helper configuration now uses an outer transaction too. A changed explicit
helper-status observation uses an empty outer transaction to order its runtime
invalidation; identical checks do not publish or cause recheck loops. There is no nested BEGIN.
Repository observers run only after COMMIT, with each observer exception isolated.
WindowCoordinator separately isolates each authenticated recipient/send failure.
Neither failure can turn committed SQL into a rollback or failed mutation reply.

The counter is deliberately process-local rather than durable: revisions are
comparable **only inside their random epoch**, no notification history is replayed
after restart, and every new incarnation reconstructs authoritative SQLite state.
A crash between COMMIT and publication therefore requires a fresh epoch/snapshot,
never replay of an assumed revision. Persisting this counter would add a schema
upgrade without providing cross-epoch ordering in this milestone. This is a
departure from the design's preference for a transactional durable counter, not
a promise of a durable commit log. MAX_SAFE_INTEGER is the bound; exhaustion
rejects before BEGIN instead of wrapping/reusing a revision. Existing durable
comment revisions still govern Undo ownership. Existing workspace revisions
still govern workspace ordering. No topology/view revisions are added.

## Transport and reconciliation

The existing exact M1 sender/top-frame/document/current-lease guard protects the
new payload-free metadata query and optional item-identity snapshot query. No
renderer-supplied window identity or revision is accepted as authority. Main
sends one exact `SharedCommit` envelope to every live authorized document; there
is no arbitrary topic/subscription IPC. Preload exposes only the fixed listener,
validates exact keys, IDs, numbers, kinds and bounds, and owns listener cleanup.

Seen transitions of at most 256 rows carry only IDs/boolean assignments and the
current compact Undo descriptor. Larger seen/Undo changes invalidate one item;
Acquire/Refresh invalidate their committed item, including its metadata and
workspace. Removal invalidates that identity. Preferences/workspace invalidate
small metadata. Helper configuration invalidates Settings evidence. Saved view,
collapse and history-only transactions send watermarks, preserving local reading
intent while keeping every subscriber's revision sequence contiguous. No checkbox
broadcast contains full comments or a Library snapshot.

ReaderReplica installs its listener **before** requesting its revisioned full
snapshot. Events already included in that snapshot are discarded; subsequent
events must be consecutive. Duplicate/older events are ignored. A reordered gap,
invalid envelope, or overflow of the 64-envelope queue requests full recovery.
One serialized drain coalesces recovery and replaces the listener before fetching.
Normal large-content retrieval is scoped to one item; metadata retrieval includes
no comments. If a scoped response has moved past its triggering revision, it
cannot cover unknown intervening changes: the replica fetches a full snapshot.
Full recovery may legitimately clone the complete profile; paging remains Q-21.
Accepted command reconciliation waits through the existing DATA_BUSY preflight,
using one coalesced 200 ms retry timer, instead of declaring a committed acquisition
failed when snapshot reads are temporarily barred. This adds no M3 participant
barrier or new main capability.

A two-second small metadata watermark detects a lost final event/subscription,
even without a subsequent mutation. Timers may be throttled in background windows;
recovery completes when the renderer runs again. Failed/busy reads retain current
acknowledged state and retry through the watermark. Event buffers remain bounded.
Reload creates a fresh replica/listener under M1's new document lease. Obsolete
epoch events are rejected; epoch replacement is confirmed by a live query and
authoritative snapshot. Stopped incarnations discard outstanding snapshot work.

Shared command replies carry the same bounded commit envelope (or a watermark
when no commit exists). The repository retains only its latest envelope, never a
log. A reply arriving before its notification enters the event queue directly,
avoiding a full-profile fetch for ordinary local checkbox/view saves. Both enter
this same reconciler, which waits for events or recovers state. Reply counts/feedback remain
useful, but seen/Undo/preferences/workspace/content values come from the reconciled
current state. Production App shared fields update through the replica
subscription; command callbacks retain feedback without reinstalling a response
body after a later commit. Stable displayed-state refs capture checkbox and Undo
intents without invalidating unrelated mounted discussion callbacks. A late reply
cannot reinstall its historical state. Old snapshots
cannot regress an accepted newer revision. Missing items remain missing, and
removal disposes view workers/queues before their old results can return.

## Checkbox and Undo policy

The historical `toggleSeen` channel now requires an explicit `seen` boolean.
The renderer captures the opposite of the acknowledged displayed value **at the
gesture**, before any FIFO wait. Two stale windows choosing Seen both assign
Seen; they never invert each other's stored result. Ctrl+checkbox applies that
desired value to the currently stored subtree. Target ownership and actual-change
comment revision increments remain atomic. Frozen matching/selected/prefix IDs
remain exact; publication/date/DST resolution is unchanged. Compatibility is
intentional: old request shapes reject INVALID_REQUEST, rather than retaining
an unsafe implicit-toggle fallback. Pure domain fixture toggling is unchanged.

Undo requires `{itemId, expectedOperationId}` captured from the displayed recovery
descriptor, including Ctrl+Z before a queue wait. Inside the existing transaction,
main compares that ID with the current operation **before any restoration or
consumption**. A missing/replaced descriptor returns `UNDO_CONFLICT` with a current
watermark. No comment/operation/revision changes, notification or consumption
occurs. The requesting renderer reconciles and retains the current descriptor.
Successful recovery preserves ADR 0013's revision-owned partial/away-and-back,
later-edit-wins, durable single-use behavior. There is still one recovery per item.

## Reader behavior and acquisition

Shared seen changes update actual checkboxes/counts, live unseen navigation/ruler,
stale indications and Undo. They never re-evaluate frozen applied membership or
order. Existing draft, sort, collapse, scroll, logical and temporary selection
remain session-owned. A peer accepted Refresh re-evaluates the instantiated
session's own applied criteria and retains its draft, matching the established
one-view-per-item Refresh contract. New content props commit before refreshed
worker results are promoted, preventing a projection cached with old identities.
Local Refresh retains Updating view until that worker settles. Hydration remains
once per session; peer saved-view/collapse acknowledgments do not overwrite it.
Mounted Settings follows committed preferences; an edited custom-code draft stays
local until explicit Save. Helper invalidations discard stale status replies.

This milestone originally kept one global AcquisitionService. [ADR 0042](0042-concurrent-download-manager.md)
now schedules independent executors under one profile-owned Download Manager;
revisioned bounded job snapshots hydrate every window. The original progress stream
described here remains a compatibility facade. Progress fans out to all current authorized
documents, and its existing query supplies the current operation to newcomers.
Progress settlement is ephemeral and does not acknowledge replica synchronization.
The repository publishes the committed ingest independently of the initiating
renderer's response/lifetime. Existing source/helper/thumbnail security is intact.

## Safety boundary and verification

No migration or new table is required. Historical schema/backup validation,
pre-migration safety, staged upgrades and offline restore recovery remain intact.
Restored/restarted services use a fresh epoch. Tests use owned temporary profiles.
The existing single-renderer data-operation drain remains; **M3's all-participant
backup/restore, close/reload and shutdown barriers are still missing**. M2 therefore
does not authorize production additional windows or claim multi-window backup
queue-drain safety. M4 view/topology identity migration, duplicates and M5-M9 UI,
transfer, geometry and dragging remain unimplemented.

Deterministic tests cover transaction order/rollback/recipient failure, compact
patches, independent replicas, stale/late replies, duplicate/reorder/gap/overflow,
bootstrap races, polling/reload/epoch changes, guarded and partial Undo, frozen
views, preferences and notification validation. The two-renderer Electron harness
uses the real built UI, preload and IPC with one service/repository. It delays actual
checkbox replies and a Ctrl+Z request, tests mounted custom preferences/reload,
progress fanout, removal versus a delayed UI Refresh reply and accepted acquisition
after origin destruction. Existing actual-entry M1 coverage still asserts exactly
one production reader. Executed counts and evidence are in [Testing](../TESTING.md).
