# ADR 0034: Native HTML tab gestures over atomic transfer (M8)

Date: 2026-10-19. Status: implemented, awaiting owner review and physical input
verification. Schema **14**, unchanged; migrations 1-14 remain exact.

## Gesture adapter and preparation

`WorkspaceTabs` / `useTabStrip` use native HTML DnD for mouse reorder and attachment.
The old pointer-capture machine is replaced, never run alongside HTML dragging.
Primary mouse pointer-down asynchronously calls `prepareDrag`; ordinary clicks
still activate through the normal click handler. Pen/touch dragging is not
established. Secondary/middle buttons cannot prepare a drag. Close buttons,
context menus, Home/End/Arrow focus, Alt+Arrow reorder, Shift+F10, Duplicate and
explicit Move remain available. Wheel overflow behavior is retained.

Renderer states are `idle -> preparing -> ready -> dragging -> ended`, or cancelled.
A monotonic local generation and exact gesture object fence preparation and start
replies. A too-fast dragstart prevents the native drag and cancels any late ticket.
During dragstart, and synchronously before returning, the adapter clears standard
data and writes **only** a UUID bearer token to
`application/x-youtube-comments-tab-v1`. It sets effectAllowed=move and uses the
browser's native drag ghost. No text, item contents, file, URL or path is exported.
Hover examines types only; recipients read tokens at drop. The source may compare an
exposed dragend token for late-store fencing; a protected empty end store is allowed. Forged/external data cannot
create source authority. Preload exposes five added fixed authenticated intents,
not a generic event or native-input bridge.

Preview is a recipient-local insertion marker beside the current neighboring tab,
with an end slot and horizontal edge scrolling. It does not reorder React keys or
activate panels during hover. Only insertion changes update React state; a single
animation-frame loop scrolls an overflowing strip. Same-window drop excludes the
source from slot calculation and uses the existing topology-CAS reorder command
once, after main acknowledges a current unexpired local end token. Late replies from
an earlier local gesture cannot reorder a later one. A no-op invokes no SQL reorder. It preserves active identity and session,
and never enters the ownership transfer transaction.

M8.1 keeps the same adapter and protocol. Empty strips now retain a labeled,
full-width drop area with a supported-hover highlight and ordinary terminal cleanup.
Tab-title keyboard focus paints around the whole tab instead of the inner title
button, removing the vertical focus edge beside the close control seen after drag.
The explicit Move chooser gains selectable destination rows and a confirmation
footer (see ADR 0033). These are presentation changes, not new native outcome rules.

## Source-only reservation and one target offer

Main extends the existing M7 reservation, retaining its exact authenticated source
document, tab, topology, epoch, ownership generation and 30-second deadline. The
unbound gesture flag prevents the initial internal new-destination placeholder
from authorizing `move`. This stage does not freeze input, flush reading queues,
construct a native window or capture results.

`startDrag` announces a separate random gesture ID to registered eligible readers;
the announcement is **not** the transfer bearer token. Main allows one active
native gesture. A genuine recipient strip drop reads the token and calls
`offerDrag(token, expectedRevision, beforeTabId)`. Main derives that exact recipient
from M1's authenticated caller, rejects hidden/minimized/ineligible windows, checks
target topology and neighbor, and binds the destination once. Covered-window
geometry never selects a destination. Duplicate/forged/expired/replayed offers,
wrong documents and attempts to change endpoints reject.

Both the one-use target binding and source dragend must precede the `offered`
notification. Thus a fast application drop cannot remove the native source node
while its OS drag loop is active. The source retains its mounted tab/panel through
terminal delivery and ownership COMMIT. Source dragend may precede peer drop IPC;
when the outside guards refuse detachment, an unbound ended ticket can still accept
the genuine recipient offer until its original deadline. It cannot later retry the
outside heuristic. A new press cancels the previous outstanding ticket.

The `offered` notification enters **the existing App transfer function**, reusing
the reserved token rather than beginning another transfer. Only now does M7 freeze
input, settle accepted work, flush/acknowledge both save lanes, validate the bounded
live handoff, construct/prepare its exact destination, await readiness and execute
`ReaderRepository.transferTab`. No second commit path, durable owner or schema is
introduced. All frozen query results/order, draft/applied criteria, stale/error
state, sort/collapse, logical anchor/offset, navigation and temporary bulk/range
selection retain M7 behavior. Movement never evaluates the query. The 50k fixture
and 100k-ID / 32-Mi-unit handoff bounds remain unchanged.

Library/Settings use M7 singleton merging. Dirty source Settings opens the existing
preserve/discard dialog with the **already-bound destination fixed**. Keep editing
cancels its token; explicit discard permits that original move. The destination's
own editor/filter survives. Expiry/M3 cancellation dismisses the pending dialog.

## Guarded outside outcome policy

`tab-drag-outcome.ts` is a pure, replaceable decision adapter inspired by the pinned
M0.5 VS Code research. An authentic source dragend without an accepted recipient
can bind `new` only once, before expiry, while source identity/topology/epoch remain
valid and profile operations permit transfers. Main samples Electron cursor DIP,
source native visibility/minimization, native window rectangles/visibility/focus,
and recent authenticated app hover. A recent inside hint or containment in a visible,
nonminimized app native suppresses detachment. The focused-window guard is retained;
unfocused peer containment conservatively also blocks creation while a recipient
offer is crossing processes. Even an occluded app rectangle only suppresses detach;
it never selects a destination. Geometry does not discover
an underlying HWND or authorize a peer. `dropEffect=none` is never used as proof.

Window-wide capture listeners account for nested enter/leave and report entry,
final leave, drop and at most one dragover heartbeat per 250ms. Drop retains recent
in-app evidence rather than clearing it before its recipient offer reaches main,
closing the ordinary source-dragend versus target-drop IPC race. Evidence is keyed
by exact current caller and gesture ID, monotonically sequenced, bounded to current
registered window incarnations, and expires after 800ms. Stale ID/sequence reports
cannot alter another gesture. Missed leaves cannot block future gestures forever.
The recipient's actual drop remains authoritative for attachment. The 800ms period
is a stale-evidence bound, **not** a mouse-release/cancellation classifier; event
latency and missed hover can still affect the heuristic.

Delivered DOM Escape cancels the exact source token or the current authenticated
hover correlation. Main also routes actually delivered `before-input-event` Escape
from the source/recent hovered peer to cancellation. These are local observations,
not a global hook. Native pointercancel at HTML dragstart and source blur do not
abort an otherwise valid native cross-window drag. Hidden source/pagehide, stale
topology, failures, lifecycle barriers and explicit cancellation revoke authority.

**Accepted owner limitation:** Escape while outside may create a detached reader
when dependable cancellation evidence is not delivered. Desktop release, unseen
Escape, external-app release and taskbar release can satisfy the same guards.
This adapter does not distinguish them or claim positive desktop mouse release.
An external app covering a reader cannot become an attachment target through
coordinates; the outside heuristic may still detach into a new window. An eventual
native cancellation adapter can replace this policy without changing M7 persistence.
No native addon, global input hook, overlay or fake filesystem drag is added.

## Native position, readiness and lifecycle

Only accepted terminal intent can request a hidden provisional equal M6 reader.
Main subtracts the bounded source tab hotspot, source WebContents zoom and native
content inset from the sampled cursor in DIP. It selects the currently connected
display nearest the **cursor** at creation and reuses `restoreWindowGeometry` to
clamp the entire default normal window to its current work area. Negative origins,
small displays, removed displays and taskbars use M6 policy. Scale factors are
metadata, never one global coordinate multiplier. New detached readers start normal,
regardless of source maximize/fullscreen. Cursor sampling follows IPC delivery and
can lag physical release; hotspot placement is approximate.

Creation/loading/readiness finishes before ownership COMMIT. Restore membership
joins that same transaction. Failure disposes hidden natives without enrollment.
After success the new native is shown/focused once; source focus is not reclaimed
by its completed transfer callback. Empty source windows remain open.

M3 synchronously revokes gestures/reservations and disposes uncommitted natives
before sealing drain participants. Source/target close, reload, crash, Quit,
backup/restore and epoch changes retain M7 exact-incarnation/CAS/deadline fences.
Transfer cancellation never resumes an M3-paused queue. After COMMIT SQLite target
ownership is final, including when either renderer dies. Owner generation rotates
and both save lanes advance, retaining A -> B -> A rejection and sealed checkpoint
fencing. Tokens/hover/cursor/results never enter SQLite or backups.

## Verification and boundaries

[TESTING](../TESTING.md) records executed counts, final-artifact/native/package
results and failures corrected during verification. Existing M1-M7, historical
migration and M0/M0.5 tests remain available. The new `test:m8` production-entry
harness uses real React/preload/IPC/SQLite and three then four native readers,
but **synthetic DOM DragEvents and controlled cursor samples (category A)**.
It does not prove protected native data-store behavior, OS ghost/cursor rendering,
or authentic Windows drag event ordering. Categories B (actual OS drag loop) and
C (physical mouse/keyboard verification) are unperformed in this task.

The [owner manual matrix](../M8_MANUAL_VERIFICATION.md) includes an OS-temp-only
launcher, resume instructions, exact expected outcomes and an observation ledger.
Original M0/M0.5 research/ledgers are preserved without rewriting historical results.
M9 aggregate memory/IPC/input-latency and release hardening remain future work;
no M9 optimizations or release claims are made here.
