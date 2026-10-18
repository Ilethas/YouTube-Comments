# ADR 0030: Persistent window topology and discussion view instances (M4)

Date: 2026-10-18. Status: implemented, awaiting owner review. Schema **13**.
Production opens exactly **one** reader. No Duplicate, New Window, transfer,
native drag, geometry or monitor behavior is introduced.

## Identity and relational ownership

`itemId` continues to own content/comments, seen values and comment revisions,
one durable Undo, extraction/discovery history and NEW. Preferences, custom
translation and helper configuration remain shared profile data.

`app_windows` stores opaque persistent logical window IDs, active membership and
`topology_revision`. `tab_instances` stores opaque instance IDs, kind, owning
window and optional shared item reference. A discussion's tabId **is** its viewId.
There is no second interchangeable instance key or unique constraint on itemId.
`window_tabs` stores placement and order. Its unique tabId prevents double
placement; `(window_id,position)` prevents duplicate positions. Composite foreign
keys bind placements to the instance's owner and kind and bind each window's
nullable active tab to its own placement. A partial index on the instance table's
own columns enforces Library/Settings singletons per owner, including dormant ones.

`discussion_views` is the required identity/revision row for a discussion
instance. Composite kind/item foreign keys exclude singleton or cross-item views.
An insert trigger creates it with the tab; a delete guard retains it until its
tab is deleted. A separate immutable-identity trigger forbids retargeting id, kind
or item (including a dormant singleton-to-discussion update). Owner changes remain
representable for the future M7 transaction. `discussion_view_intent` is an optional semantic record with
same-item anchor/selection foreign keys. `view_collapse` is independently optional;
`view_collapse_overrides` binds both its view/item and its comment/item. No query
record is required for collapse. Content deletion cascades all discussion instances,
intent, collapse, placements and resume pointers. An instance-deletion trigger
clears active references; repository removal also chooses the existing right/left
successor transactionally in every affected window.

An unplaced discussion instance is dormant, with its owner retained. The explicit
`item_resume_view(window_id,item_id,view_id)` pointer binds that owner, view and
item through composite foreign keys. Close only removes placement; Open activates
an existing local discussion or resumes that window's retained instance. It never
implicitly activates another window. M5 must decide selection among duplicates;
M4 exposes no duplicate command and introduces no new duplicate policy.

## Exact schema-12 preservation

The existing recovery and verified pre-migration safety snapshot run before the
production opener. Migration 13 runs inside the existing single atomic forward
transaction. It generates one legacy window and a random unique discussion
instance for **every** stored item. It copies the original workspace positions,
relative order, active mapping and revision. Only originally open tabs receive
placements. Existing Library/Settings tabs become opaque singleton instances in
those exact positions; an empty workspace remains empty.

Every item receives its explicit resume pointer, including closed items without
query state. SQL copies raw draft/applied JSON, sort, anchor ID, exact offset and
navigation selection without parsing, evaluating or normalizing them. Missing
intent/default rows remain missing. Collapse defaults and all sparse overrides
copy independently, including collapse-only discussions. The required view row
contains identity and zero initial CAS counters, not manufactured reading intent.

No unrelated authoritative parent table is rebuilt. Content, comments, seen and
revisions, complete Undo entries, attempts/order/baselines, source/author evidence,
preferences/custom target and helpers are untouched. Ownership and copied row
counts are checked before old child tables and workspace tables are dropped.
Any unmappable reference or failed statement/COMMIT rolls back data, DDL and
user_version; no fallback database or reseeding occurs. Tests inject failures
after DDL, during intent/override copying, after old table removal and at COMMIT,
checking exact original rows and closed-file bytes before a successful retry.

Historical migrations 1–12 retain their original meaning. Backup validation uses
their exact prefixes and old table shapes, while schema 13 validates the new
relational model, required identity and resume records. Old supported backups
upgrade only on isolated staged candidates; selected source bytes and independent
safety/recovery artifacts remain intact. Unsupported newer and modified schemas
reject. An executable supporting only migrations 1–12 rejects schema 13.

## Authorization, versions and renderer state

Before constructing/loading a production reader, WindowCoordinator obtains its
persistent identity from the service/repository. Each trusted document still gets
a fresh runtime lease. IPC derives the caller's window from that registry; no
renderer-supplied window ID routes a read or write. Scoped bootstrap, metadata,
item snapshots, acquisition completion and workspace results use that window.
View writes check its retained owner and all comment ownership inside the same
transaction. A view ID alone grants no authority. Origin loss prevents acquisition
from opening a tab in an arbitrary peer; its shared content may still commit.

Structural requests require the displayed topology revision. Intent and collapse
each require their own `expectedRevision` and increment their own durable CAS
counter on success. Stale commands return `STATE_CONFLICT` without writes. This
deliberate departure from one shared viewRevision lets the existing two queues
serialize independently without racing for identical versions. Their per-view
transport tracks acknowledgments; acknowledgments never rehydrate live controls.
Exhausted/invalid transport revisions reject rather than wrapping.

React panel keys, activation/close/focus, session registry, saved intent and
collapse queues now use the instance ID. An item-to-session relation fans seen
and Refresh changes to every instantiated local view; comments remain shared.
Semantic queries reconstruct lazily with the existing worker, clocks, virtualization,
navigation and frozen membership. Temporary bulk selection is never persisted.

M2's runtime profileEpoch and ordered post-COMMIT commitRevision are unchanged.
Private saves remain contiguous watermarks; scoped metadata returns each caller's
own workspace. M3 checkpoints are authenticated and deduplicated by view ID,
with separate expected counters for intent and collapse (and increasing collapse
counters for default/override checkpoint steps). Paused queues settle before the
manifest is sealed; accepted checkpoints advance their transport lanes. Runtime
document leases fence old incarnations. Global barriers, FIFO mutation tickets,
expected-operation Undo, release reconciliation and terminal offline fencing remain.
The two-renderer lifecycle harness now owns separate persistent windows/views and
checks independent same-item drafts in its verified backup.

## Deliberate boundaries

No geometry evidence is invented, and no geometry columns are needed yet. M6 can
add nullable bounds/restore-set metadata without rebuilding the topology. M4
startup uses the existing first persistent window; it does not restore additional
native windows or choose a last-focused session policy. Test-only extra windows
use newly persisted, independently scoped workspaces.

M5 owns public duplicate commands and the remaining per-panel descendant DOM ID
namespaces/interaction coverage. M6 owns public equal windows, restore-set policy,
native geometry and monitor validation. M7 owns atomic ownership transfer and its
handoff generations. Native drag input remains M8. See [TESTING](../TESTING.md)
for executed evidence and limits; none of these later milestones is claimed here.
