# ADR 0033: Atomic cross-window tab transfer (M7)

Date: 2026-10-19. Status: implemented and verified, awaiting owner review.
Schema **14**, unchanged. M8 gestures and M9 aggregate scale/release are excluded.

## Explicit movement and endpoints

Every tab's existing context menu provides **Move to Window...** and **Move to
New Window**, in English and Polish, alongside discussion-only Duplicate Tab.
Right-click, the context-menu key and Shift+F10 use the same focus-managed menu.
The destination dialog starts on Cancel, lists main-owned numbered live windows
excluding the source, and always offers a new window. Numbers distinguish windows
for this selection; neither numbers nor persistent window IDs authorize a command.
The public chooser appends. The protocol also supports a destination neighbor ID
with expected topology CAS, so later gesture adapters can choose insertion.

M8.1 polishes this chooser with a source-title summary, selectable native radio
rows, bounded main-owned active-tab labels and tab counts, a separate plus-icon
New Window option, and an explicit Cancel/Move footer. Selection alone never
begins a reservation. Display hints are captured with the destination revision;
the same M7 validation rejects stale destinations at confirmation. The responsive
dialog retains native modality, initial Cancel focus, Escape and focus restoration,
English/Polish strings and theme tokens. Dirty Settings still gates selection on
explicit discard; an already offered drag destination stays fixed, including its
exact neighbor/revision. There is no new transfer authority or persistence.

Main excludes destroyed, unauthenticated, not-ready, restoring and provisional
readers from ordinary destinations. M3 excludes all transfers during preparation,
draining, execution and unreconciled release; terminal offline fencing is retained.
The exact source and destination document contexts are captured, not rediscovered
from whichever window is focused when a reply arrives.

An unsaved custom translation editor blocks a Settings move. **Keep editing**
preserves the draft and cancels; **Discard draft and continue** explicitly permits
the move. It does not save or activate that draft. Failed movement leaves the
source editor intact. A merged destination keeps its own editor/draft and local
Library filter. Committed preferences remain shared. The ordinary Library/Settings
interaction state is local; moving a singleton into a window without one starts
that window's ordinary local controls. Discussion reading state has the stronger
live handoff contract below.

## Main-owned lifecycle and tokens

`TabTransferCoordinator` owns a bounded rendezvous:

`IDLE -> PREPARING -> SOURCE_FROZEN -> TARGET_READY -> COMMITTING -> COMMITTED`.

`begin` reserves the authenticated source, exact placed tab, profile epoch,
ownership generation, source/destination topology revisions and current intended
destination document. Main returns a random UUID token before source checkpointing.
The 30-second reservation deadline includes source preparation and target loading;
a separate 15-second local source hang guard bounds its preflight. The total allows
the previously measured roughly 18-second large-profile shell startup without
turning timeout into successful readiness. New-window creation is delayed
until the source snapshot is acknowledged. The target lease is then captured once
the secured provisional document is ready. Overlapping transfers involving either
reserved window reject, including simultaneous opposite-direction requests.

`move` submits that exact token and a validated checkpoint/handoff once. A token
cannot retarget endpoints, authorize a peer, cross an epoch, survive expiry or
repeat submission/readiness/COMMIT. Cancellation names the exact token, so a late
old Cancel cannot cancel a newer transfer. Readiness accepts only the captured
destination context. All six fixed request channels use M1's registered
WebContents, exact top frame/document and current renderer lease checks. Preload
exposes a frozen narrow namespace and validates the fixed notification union;
there is no arbitrary event bus, handle, path, URL or process capability.

Cancellation, sender death, target lease loss, readiness refusal, stale topology,
save failure, bound/validation failure or deadline before COMMIT returns the source
to usable ownership and disposes provisional target state. M3 synchronously
cancels reservations and removes hidden provisional natives **before** capturing
participants. An already committed transfer settles under authoritative M2 order.
No SQLite transaction spans renderer IPC, native loading, workers or other awaits.

## Final source checkpoint and live reading state

The source panel/tab remains mounted until COMMIT. The shell becomes inert and
keyboard commands stop. Native text selection and transient menus/unsubmitted
confirmation surfaces are dismissed. Accepted shared commands settle in FIFO order;
accepted evaluation completes under its existing deadline. The session captures
the current logical anchor/offset, flushes both intent and collapse queues, and
requires successful acknowledgment of their separate final CAS sequences. A final
full semantic intent save also establishes an explicit acknowledged record for an
otherwise untouched session. Failed persistence aborts; stale SQL is never cloned
as a substitute for current reading state.

`LiveViewHandoff` version 1 carries view/item IDs, authoritative epoch/revision,
durable semantic intent, actual runtime applied criteria/error/restoration flags,
frozen result membership/preorder/parents/roles, retained sorted order, stale flag,
temporary bulk IDs/range anchor, selection mode and discovery identity. Logical
anchor and navigation selection use the semantic intent. It contains no comments,
source text/evidence, numeric date bounds, workers, promises, functions, DOM nodes,
native text ranges or native handles. Exact fields, unique bounded IDs, parent-before-
child order, item ownership, semantic shape and snapshot versions are validated.
Main reads only comment IDs to validate ownership, not comment text or the Library.

The per-handoff limit is 100,000 IDs per list and 32 Mi UTF-16 serialized units;
unadopted main-held handoffs together are limited to 64 Mi units. Oversize fails
explicitly with the source retained. The existing 50k fixture fits this contract;
this is not an M9 aggregate memory/latency acceptance claim.

The target reconciles to the source watermark, verifies that the needed IDs are
present and constructs a provisional runtime session before readiness. It receives
no save authority then. Shared item/seen/Refresh/removal commits during the frozen
rendezvous cancel movement. A Refresh deferred by a frozen source replays against
its own criteria after cancellation/release. Transfer cancellation cannot unpause
a concurrent M3 freeze: profile and transfer pauses are distinct. Aborted async
checkpoints are generation-fenced and cannot refreeze a later source session.

After COMMIT, the ordinary scoped M2 seed/snapshot carries the transient handoff
before publishing new topology. The destination creates its own worker/queues and
adopts the frozen result **without query evaluation**. Shared seen changes retain
membership and mark restrictive-seen results stale. If a genuinely newer accepted
Refresh arrived after COMMIT, discovery comparison triggers the established shared
Refresh behavior; movement alone never reevaluates. The registry disposes former
ownership generations rather than reviving an old same-ID session. Adoption releases
main and replica handoff seeds. A lost document discards transient state; reload or
restart uses the established fresh durable semantic reconstruction.

## One ownership transaction

`ReaderRepository.transferTab` executes one synchronous outer transaction. Its
main-only guard rechecks live contexts, token, epoch, deadline and M3 eligibility
inside the transaction, along with source ownership/placement, both topology CAS
versions, final intent/collapse counters and the destination neighbor.

The operation removes both affected placement lists and the moved view's resume
reference before changing the composite owner key. Active membership already uses
M4's deferred FK; ownership and private child FKs are never disabled. It updates
the instance's `owner_window_id`, advances both discussion save counters, rotates
runtime authority, repairs a source resume pointer when another retained local
view exists, rebuilds both ordered lists, selects the source's established
right/left/empty successor and activates the destination instance. Both topology
revisions advance exactly once. Target activation updates its local resume pointer.
Optional intent/collapse/default/override rows are retained untouched. Shared
content/comments/seen/Undo/history never duplicate or merge.

Discussion tabId **is** viewId and remains unchanged. Another destination view of
the same item is independent. Library/Settings without a destination singleton
move with their stable identity. If a destination singleton exists, including a
dormant one, the transaction deletes the source singleton and activates the existing
destination, returning `mergedIntoTabId`; no destination local state is overwritten.

A new provisional native has a dormant logical identity, no restore membership and
no visibility/focus. Its restore-set enrollment occurs **inside this same ownership
transaction**, using the existing session store without nesting a transaction.
Only after COMMIT does M6 promote/show/focus it. An empty source stays open, visible
and equal. Failed constructor/loading/readiness/SQL removes the hidden native and
leaves no intended restore member; the empty logical row may remain dormant.

Statement or COMMIT failure rolls back ownership, placements, active IDs, topology/
save counters, resume pointers, restore membership and runtime authority, and emits
no M2 change. Success publishes one ordered workspace commit. Observer/send failure
cannot turn committed success into rollback. After COMMIT, source death cannot
undo destination ownership; target death reconstructs that ownership from SQLite.
No recovery path duplicates the tab back into its source.

## Ownership generation, ABA and schema compatibility

Each successful discussion transfer issues a new random runtime owner generation
before post-COMMIT publication, rolling it back if SQL fails. Main checks that token
plus retained window ownership, current authenticated document and the relevant
save CAS lane for every intent/collapse write and M3 checkpoint. The initial,
never-transferred generation is absent; M1/M4 lease/owner/CAS checks apply as before.
After any transfer the issued token is required. A -> B -> A issues a third
authority, so an old A request fails even if it guesses the current counter. Old
renderer incarnations additionally fail M1. Async checkpoint/worker/session and
transfer generations prevent late callbacks from restoring former placements.

No persistent owner-generation column is needed. A process/profile reopen has a
fresh epoch and document leases and no old JS/IPC authority. Durable counters still
advance at transfer boundaries. Schema remains **14**, migrations 1-14 are unchanged,
and exact historical validation, verified safety backups, staged upgrades,
offline restore/recovery and existing-empty/no-reseed rules remain unchanged.
Full SQLite backup includes all committed topology, private view state and intended
windows; transient tokens/results/temporary selection never enter backups.

## Evidence and remaining milestones

[TESTING](../TESTING.md) records exact deterministic, React, native and packaged
results, failure injections and evidence limits. All profiles are independently
owned OS-temp data. No owner profile, Setup, installation, commit, push or publication.

M8 may transport the opaque reservation token through a gesture adapter and use
the existing neighbor/ownership transaction. M7 chooses its destination up front;
M8's source-only drag preparation will need a one-use target-offer stage that binds
the destination before readiness, without rewriting durable ownership. M7 adds no dragstart/dragover/drop/
dragend or desktop-detachment heuristic. Native gesture outcomes and physical
manual monitor testing remain M8. M9 owns aggregate multi-window memory, IPC,
large-profile latency and release verification. Neither is started here.
