# ADR 0031: Independent duplicate discussion tabs (M5)

Date: 2026-10-18. Status: implemented, awaiting owner review. Schema **13**.
Production still creates exactly **one native reader window**.

## Commands and local resume policy

Discussion tabs expose **Duplicate Tab** through their context menu: right-click,
the context-menu key, or Shift+F10 on the focused tab. English and Polish labels,
tooltips and menu accessibility use the existing compact menu and outline icons.
Library and Settings remain per-window singletons and have no duplication action.
When several open tabs reference an item, their unchanged content title receives
a presentation-only ordinal in current strip order. Reordering can change ordinals;
opaque tab/view identities remain stable.

Duplicate always allocates a new main-owned UUID, used as BOTH tabId and viewId,
references the existing item, inserts immediately after the specified source view,
activates it and focuses its tab. It never searches for or merges another view.
The authenticated M1 document supplies the owning window; neither a renderer
windowId nor a renderer-allocated destination ID is accepted. The source must be
an open discussion owned by that window. Topology CAS and both acknowledged source
intent/collapse revisions must match before any copy is written.

Library Open first activates this window's `item_resume_view` when that instance
is open. If that last-used instance is dormant while other local copies are open,
the first such tab in current strip order is the deterministic fallback. If none
is open, Open resumes the retained pointer, creating an initial instance only when
no pointer exists. Activating a discussion, including opening/duplicating it and
choosing the successor of a closed active tab, updates its item/window pointer in
the same structural transaction. Reordering retains the active instance. This is
one durable last-used pointer per local item, not a complete MRU history among all
dormant copies. Library Open never activates a different native window.

Close removes placement only. Other copies and all saved dormant instances remain.
Closing all discussions leaves Library content intact. Item removal deletes every
open and dormant instance, placement, resume pointer and private state through M4's
existing transaction/cascades.

## Semantic copying and fresh evaluation

The renderer temporarily makes its shell inert while preparing duplication. It
waits for the source's accepted worker evaluation, captures its useful logical
anchor and flushes BOTH its serialized intent and collapse queues. Failed saves
stop duplication with existing localized save feedback; retry preserves the draft.
An unvisited source has no unsent session state and uses its acknowledged seed.
Main checks the source's two resulting lane revisions again, closing the race
between the flush acknowledgment and structural dispatch. M3 can fence the command
at any time; a rejected command cannot produce a partial destination.

One SQLite transaction allocates identity, copies the optional semantic intent
and collapse/default/override rows, places/activates the new tab, increments the
window's topology revision and updates its resume pointer. Missing optional rows
stay missing. The source rows are unchanged. The new required view identity starts
with independent zero intentRevision/collapseRevision counters. Failure during any
copy statement or COMMIT rolls back identity, optional rows, placement, activation
and resume changes, and publishes no M2 notification.

Copied fields are draft query, applied query, sort, logical comment anchor/offset,
navigation selection, collapse default and sparse exceptions. The duplicate gets
its own session, executor/generation, queues and reconstruction. It evaluates its
applied semantic criteria against CURRENT shared comments/seen/NEW with a fresh
normal evaluation clock/system zone. Its initial evaluated result can therefore
differ from the source's frozen result if shared values changed since Apply.

No frozen result IDs/roles, numeric date bounds, workers/promises, DOM/virtualizer
objects, bulk selection/range anchor, native selection, menus/portals, pending/error
state or thumbnail/description expansion is copied. Existing mounted panels retain
their local expansion on tab switches. Closing/unmounting retains semantic session
state; ephemeral header expansion follows its established mounted lifetime.

## Dynamic hydration and M2 ordering

`getDiscussionView({viewId})` is a narrow, main-authorized read of one owned open
or dormant view's instance/counters and optional semantic/collapse records. Its
response has the repository epoch/commit revision and contains no comments.
Duplicate also returns this authoritative seed and its versioned workspace.

Before publishing a metadata/item change that introduces unknown local instances,
ReaderReplica reads only those instances' seeds and requires the same epoch and
commit revision as the reconciled event. Changed versions trigger the established
snapshot recovery; removed or obsolete responses never publish partial topology.
Other windows with no newly owned views do not fetch any new seed or Library-wide
comments for an ordinary duplicate notification. The registry receives seeds BEFORE
the workspace React update can construct a session. Acknowledgments never rehydrate
an existing live session. Ordinary full epoch/gap recovery still uses M2 snapshots.

The command callback uses replica-authoritative topology in production; delayed
replies cannot reopen removed tabs. The non-replica test transport installs the
returned seed before accepting its topology. Per-view queues retain their own
acknowledged CAS counters, including M3 sealed checkpoints.

## Private sessions, shared content and DOM ownership

ViewId owns query controls/results/workers/generations, sort/collapse, viewport and
logical anchor, navigation/match position, bulk selection, errors/save queues,
menus and mounted header expansion. ItemId owns comments/metadata, seen revisions,
NEW/history, source identity and exactly one durable Undo. Shared seen acknowledgments
update all copies' checkboxes/counts/live unseen navigation without changing their
frozen membership/order. Bulk matching/selected/prefix commands freeze the initiating
view's IDs. Undo, including Ctrl+Z, still requires the displayed expectedOperationId.

Accepted Refresh fans out to EVERY instantiated same-item session, each using its
own applied criteria and retaining its own draft. Worker generations prevent an
older completion from replacing a newer Apply. Removal disposes every instantiated
same-item executor/queue and its panels/interactions; late saves fail ownership
checks. Close does not dispose a sibling or replace its semantic state.

App passes explicit viewId and active state to each panel. Comment article DOM IDs
encode both view and real comment identity; final virtual reveal also verifies the
article belongs to its owning panel. Domain/database comment IDs never change.
Video description IDs/aria-controls use viewId. Existing tab/panel IDs use the tab
instance; query help IDs use React useId, labels wrap their own controls, and bulk
confirmation title/description use independent useIds. Context portals retain their
origin and dismiss on hide/invalidation with guarded focus restoration. Scroll
dismissal follows ancestors of that origin: sibling reader reflow cannot close an
active comment menu or a tab menu. Profiling
counters identify the view instead of conflating copies by itemId.

Hidden panels retain their virtual range and cached measurements. Active-only
thumbnail checks, scroll-idle writes, virtual reveal/focus and layout-restoration
work stop while hidden; a pending data-resolved reveal is handled on activation.
Explicit shared Refresh remains allowed to evaluate instantiated hidden views.
Library/Settings startup still avoids evaluating unvisited discussions. No new
continuous worker loop or unbounded mounted comment list is introduced.

## Lifecycle, verification and remaining milestones

Schema 13 already represents this feature; no migration or historical schema
change is needed. Backups preserve ordered duplicate placements, active identity,
all independent semantic/collapse rows and dormant resume pointers while shared
content/seen/Undo/history remain stored once. M3 enumerates every instantiated view
for dirty checkpoints. Duplication is an ordinary tracked structural command,
excluded from drain capabilities and rejected during a global barrier, including
after participant manifests are sealed. Terminal offline restore fencing remains.

Repository rollback/backup tests, simultaneous same-item React tests and the real
preload/IPC/worker Electron workflow are recorded with executed counts in
[TESTING](../TESTING.md). The M3 production-entry Quit harness also checkpoints
both same-item views. Test-only extra authorized renderers remain test infrastructure.

M6 owns public native windows, restore-set/close policy, geometry and physical
monitor validation. M7 owns atomic transfer and generation handoff; M8 owns native
dragging/detachment and real input evidence. M9 owns aggregate multi-window scale
and release verification. None of those features, installer execution, publication
or public release is included in M5.
