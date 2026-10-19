# ADR 0029: Global profile and window lifecycle safety (M3)

Date: 2026-10-18. Status: implemented and verified, awaiting owner review.
Scope: M3 only. Schema stays **12**, with exactly **one production reader**.

## Authority and transitions

`ProfileOperationCoordinator` is main-owned, alongside one ReaderService and one
repository. It captures current WindowCoordinator context objects, not renderer
identity claims. One operation has a random operation ID, the repository profile
epoch and the captured document incarnations. Legal phases are IDLE → PREPARING →
DRAINING → QUIESCENT → EXECUTING → RELEASED; confirmed offline replacement instead
ends in RESTARTING. Failure may release preparation/draining/quiescence/execution.
RESTARTING is terminal. RELEASED remains observable until the next operation.

New ordinary commands and ticket reservations stop synchronously at `begin`, before
PREPARING is published. Read-only bootstrap/M2 metadata/snapshots remain available
until storage goes offline, so command acknowledgments cannot deadlock waiting for
replica reconciliation. No DATA_BUSY bypass is accepted on ordinary reader IPC.

Every live authorized document receives the fixed validated lifecycle protocol.
It immediately freezes pointer/keyboard/form input, makes the reading surface
inert, and shows a localized accessible operation status. It freezes view/collapse
timers, captures the active logical anchor while retaining hidden anchors, lets accepted deadline-bounded query workers
settle, and waits submitted seen/preferences/workspace/helper operations. It never
uses beforeunload or unmount to guarantee persistence.

M8.2 [ADR 0035](0035-reader-menu-selection-and-lifecycle-presentation.md) retains
that synchronous freeze and the complete drain protocol while delaying only the
full-screen visual progress layer by 180 ms. Fast operations keep content visible;
long operations show themed feedback, and errors/reconciliation Retry remain
immediate. This supersedes the original always-immediate visual overlay only.

## Bounded drain authorization and FIFO

The existing seen/preferences/bulk/Undo queue keeps FIFO dispatch and acknowledgment
order. An intent queued behind a pending acknowledgment registers its exact command
with main while editing is still allowed. Main issues a one-use opaque ticket bound
to that context object and profile epoch. Registration validates a fixed command
union; there is no arbitrary operation, SQL or invoke field. At most 4096 outstanding
tickets and 8 Mi UTF-16 units of serialized intent are allowed per incarnation.
Normal execution consumes the ticket. Tickets cannot be created during preparation;
forged, changed, replayed, cross-window and old-incarnation tickets reject.

After freezing, a participant supplies an exact ordered manifest: remaining
registered mutation tickets plus final semantic reading checkpoints. Every outstanding
ticket must be included. View checkpoints are at most one full intent per existing
discussion. Collapse is one default assignment plus at most one opposite-default
override assignment per existing discussion. This compacts accepted collapse queues
without expanding descendants or changing their final state. Main validates the
checkpoint vocabulary, existing discussion identity and bounded manifest (4096
commands / 8 Mi serialized units), seals an independent copy, then issues a drain
lease with an exact sequence bound. The lease is bound to operation, profile epoch,
captured window identity and document incarnation. Each drain command must equal
the sealed command at the next sequence. Main validates persisted item/comment
ownership through the existing service/repository validation as well.

An ACK must come from that exact context with its grant, after all sequences have
committed successfully. Main records the final sequence, rejects early/replayed ACKs,
and checks there are no omitted registered intents. A participant can explicitly
refuse preparation without claiming success. The 15-second preparation deadline is
a hang guard: it fails the operation and never implies successful draining.

Only after every enrolled participant succeeds does main revoke drain authority by
entering QUIESCENT. EXECUTING settles main-owned work using the existing backup/
restore phases. Ordinary saves cannot use a ticket to bypass the hard barrier.

## Release, M2 and failures

Each drain commit uses the existing post-COMMIT M2 epoch/revision stream. Failed
COMMITs publish nothing. Explicit seen assignments, expected-operation Undo,
revision-owned partial recovery and frozen applied query membership remain intact.
Acquisition progress remains independent of content synchronization.

On cancellation, failed drain, validation/snapshot failure or completed backup,
main releases the barrier with a current watermark. A participant reconciles M2
before acknowledging release and accepting input. Failed reconciliation keeps it
inert with an explicit Retry control. A participant that has not acknowledged
release cannot reserve/submit mutations or join a new profile operation. Main's
intentional lifecycle wait also fails after its deadline; it never closes a live
undrained document as an implied timeout decision.

View/collapse failures stay dirty for explicit retry. Ordinary failed writes retain
the acknowledged UI state and existing visible save error; preparation fails rather
than representing those writes as saved. Unexecuted queued tickets survive a
cancelled preflight and resume through the normal FIFO queue after reconciliation.
A renderer crash/uncontrolled reload cannot return unsent memory: only committed
SQLite state is recoverable. Loss of any enrolled incarnation aborts unconfirmed
preflight conservatively. Replacement documents bootstrap through M2; no old ticket
or drain grant transfers to them.

## Native Close, Reload and Quit

WindowCoordinator intercepts the first native Close before M1 revocation. It retains
the usable document authority while main drains, suppresses duplicate requests,
then permits one final native close. A failed save leaves the window open and
authorized, with a visible error and the ability to retry. If a later native close
listener cancels even the final close, the same trusted document is restored to
usable authority and receives the current release event. It is never left FORBIDDEN.

Ctrl/Cmd+R, F5 and native menu Reload use the same drain before actual reload.
Uncontrolled `webContents.reload`, navigation and renderer crashes revoke immediately;
their replacement document receives a new lease. Close/Reload/Quit requests serialize
on a small main-only queue; no persisted close set or geometry is introduced.

For this safety milestone, intentional Close and Reload briefly drain **all** live
participants, rather than only the target. This conservative departure avoids
overlapping per-window and profile barriers before M4 introduces independent view
identities. Only the target closes/reloads. No window is primary, and closing one
does not shut down the shared service while a peer survives. Explicit application
Quit drains all participants, then waits acquisition/helper/cache/data settlement
before closing SQLite. Repeated Quit joins the existing request. Last-window Close
still follows the existing Windows quit policy. macOS retains activation behavior.

## Backup, restore and origin ownership

Both operations globally drain before native selection/snapshot readiness. Backup
retains acquisition-busy rejection. Existing destination exclusions, verified online
SQLite snapshots, exact historical schema validation, staged migration, Cancel-first
native restore confirmation, independent safety, offline journaling/close, immutable
recovery phases and rollback tests remain unchanged.

Native dialog results belong only to the captured current origin; no peer becomes
their parent. Origin loss before selection/confirmation cancels preflight. A requested
native Close may defer destruction while the native dialog settles. Once a validated
backup destination is accepted or restore is affirmatively confirmed and accepted,
work is app-owned and origin death cannot abandon it. Restore aborts/settles acquisition
only after confirmation, before independent safety creation, as previously.

Before the first offline storage action, main sets restartPending and publishes
terminal RESTARTING. All ordinary commands, checkpoint capabilities and saved callbacks
are fenced from storage. Old windows remain inert through successful installation
or offline failure; both require relaunch. No old database connection is reused.
Startup recovery opens a new repository epoch and preserves existing-empty/no-seed
rules. Terminal lifecycle events retain the last old-profile watermark, never a
fabricated replacement epoch.

## Limits and evidence

See [TESTING.md](../TESTING.md) for exact deterministic and real Electron results.
The M3 harness uses two authorized real Apps and actual preload/IPC/native window
lifetimes. Its dialog answers and stalls are test-only main injections; the existing
packaged/native-dialog/relaunch and forced rename-gap recovery harnesses provide
separate evidence. No installer or valuable profile is used.

M4 must introduce durable independent view/window identities before public duplicate
views/windows: schema-12 still has one workspace and one saved view/collapse slot per
discussion, so conflicting test-renderer checkpoints use final commit order. M3 does
not promise independent persisted test-window reading views. M5/M6 own duplicate
sessions, full restore sets, native geometry, monitor/DPI policy and public windows.
No tab transfer, drag adapter, topology persistence or schema migration is included.
OS forced termination can retain only the last committed data. Cross-platform native
lifecycle behavior and physical multi-monitor restoration require their later scope.
