# ADR 0013: Atomic bulk seen actions and durable safe Undo

Date: 2026-10-08. Status: accepted; implements the owner's Q-09 recovery policy.

## Decision

Each discussion retains at most one durable recoverable multi-comment seen
operation. It survives restart, tab close/reopen, Apply and Refresh without expiry.
A later successful multi-target bulk command with actual changes replaces it.
Ctrl+click replaces it only when more than one comment actually changes. Ordinary
single-comment changes, single-target bulk commands, no-ops and failures preserve
the prior operation. Other discussions have independent recovery. Undo consumes
the operation once; no redo, stack, application history or history browser exists.

Schema 6 adds `comment_state.revision`, initialized to zero without changing seen
values, plus `seen_operations` and `seen_operation_entries`. Each actual transition
increments its revision. A unique item constraint bounds operations to one per
discussion; entries contain only changed comment IDs and the revisions written by
the operation. The operation stores its uniform target value, so the previous
state is its opposite; previous seen values need not be duplicated per entry.
Composite foreign keys bind entries to both their operation and discussion-owned
comment. Removal cascades operation/entry deletion. Revisions remain main-only.

Undo restores a recorded row only if its current revision equals the recorded
written revision AND its state still equals the assigned target. Restoration
increments revision normally. Later edits win, including edits away and back to
the same value. Stale/missing rows count as skipped; a fully stale operation
succeeds with zero restored and is consumed. All conditional restores and
consumption commit together. Failure rolls back them all and retains recovery.

## Scopes and date reuse

The narrow `bulkSeen({itemId, seen, target})` intent supports All, frozen Matching,
and Publication with From and/or To calendar dates. Every scope covers only that
discussion. All includes every stored row. Matching captures precisely the last
applied `activeMatchIds`, even when later seen edits made that result stale. Main
validates all IDs, duplicates and ownership without evaluating query text or adding
context/raw-only matches. The exact runtime guard allows up to 100,000 IDs of at
most 256 characters; the 50k case is exercised without a generic arbitrary-ID API.

Publication resolution runs in main inside the transaction and uses ADR 0012's
`resolvePublication`, `ownPublicationInstant` and `publicationMatches`. Query
projection shares that same instant conversion, which rejects label/calendar-only
values. On/after maps to custom From, on/before to custom To (whole day), between
to both. Fresh system IANA zone, inclusive local start and exclusive next local
day preserve DST semantics. Approximate/coarse usable instants participate;
missing instants fail; no parent/item/discovery substitution exists. Invalid dates
or reversed ranges fail before writes. No rolling or discovery bulk presets exist.

## Atomicity and ordering

Main's synchronous SQLite connection establishes transaction order. Target
resolution, actual transitions, previous operation replacement and recovery entry
creation share one `BEGIN IMMEDIATE` transaction with FULL synchronization and
foreign keys enabled. Prepared update/entry statements do linear row work. A late
write/log failure cannot publish a partial state or destroy previous recovery.
Success is returned only after commit. Schema/version changes are transactional.

Renderer local saves use a FIFO acknowledgment queue, including checkbox,
subtree, bulk and Undo, so a later accepted intent is not silently dropped.
Remote extraction remains asynchronous; its merge transaction never updates
existing comment_state/revisions. A comment inserted before an All/date transaction
can qualify; one inserted afterward belongs to neither that operation nor its
Undo. Matching always uses its captured explicit identities. Overlapping remote
snapshots reconcile acknowledged seen states and undo descriptors, while retaining
new comments and remote field changes. Removed discussions cannot be resurrected.

## Reader behavior

Compact closed-by-default Bulk actions controls choose seen/unseen and scope.
Current matches names the APPLIED set/count and is disabled when unrestricted.
Date controls appear only for publication scopes. Native localized confirmation
states active-discussion scope, action, scope and current preview count. Cancel
starts focused; Escape cancels; pending writes cannot close the dialog. All/date
always confirm, including small previews that may grow through a concurrent
Refresh. Matching with at most one frozen target needs no multi-comment dialog.
The dialog names its captured discussion and lives outside hidden tab panels, so
parallel acquisition activating another tab cannot hide or retarget confirmation.

Main resolves All/date again at execution, so their confirmation count is explicitly
a current preview, not an authority over concurrent discoveries. Recovery help
explains replacement and later-edit protection. Ctrl+click keeps its established
gesture without confirmation. Committed status reports changed counts, no-ops
retain existing Undo, and recovery reports restored/skipped counts. Errors retain
acknowledged data and prior recovery. Undo remains beside the compact controls
whenever bootstrap or acknowledgment provides a descriptor.

Ctrl+Z is in the centralized shortcut registry and Settings reference. It means
the latest recoverable multi-comment seen change for the active discussion.
Editable controls retain native text Undo. Missing recovery, non-discussion tabs,
composition/handled keys and any confirmation dialog leave the shortcut unconsumed.

Bulk and Undo update live checkboxes, counts, unseen navigation and the ruler's
UNSEEN lane only. Applied IDs, membership/order, roles/counts, query criteria,
selection/navigation, publication/discovery and NEW remain untouched. An applied
Seen/Unseen query gets the existing saved-but-stale Apply indication. Undo does
not revert Apply or Refresh or recompute the view.

## Consequences and validation

Storage is bounded by one operation and its changed rows per discussion, not by
elapsed time or an accumulating stack. A 50k-change operation legitimately keeps
50k small recovery entries. SQLite indexes serve composite ownership/cascades;
replacement and consumption reclaim rows for later reuse without automatic VACUUM.
Full bootstrap and acknowledgment remain O(N); Q-21 paging/clone/memory/backend
worker choices remain open. No release, backup/export, sorting, collapse, persistent
view state, redo or Library-wide mutations are introduced.

Deterministic temporary SQLite tests cover migration preservation/rollback,
all/matching/publication scopes, revisions, supersession/no-op/failure, partial
and fully stale Undo, restart, subtree mixture, Refresh/new rows and removal.
Generated 10k/50k tests inject a late failure and verify complete rollback before
measuring real commands and isolated transactional state/entry replay. Renderer
tests cover localized compact controls, modal ownership, exact IDs, acknowledged
feedback, Ctrl+Z ownership, FIFO saves and frozen views/live ruler updates. Built
Electron tests exercise the actual bridge, worker and disposable process restarts.
Measurements and executed check results are recorded in [Testing](../TESTING.md).
