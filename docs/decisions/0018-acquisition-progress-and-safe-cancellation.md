# ADR 0018: Acquisition progress and safe cancellation

Date: 2026-10-15. Status: accepted. Narrows Q-14 and Q-16; Q-21 remains separate.

## Context and decision

Anonymous helper operations take seconds with no trustworthy total comment count.
Retain one global live Acquire/Refresh operation and main-only helper execution.
Give each run a fresh opaque UUID, independent of source/comment/process identity.
Show an indeterminate global operation surface, localized operation/stage, elapsed
time and explicit Cancel while pre-commit work remains cancellable. No percentage,
automatic refresh, concurrency, new shortcut, extraction optimization or schema
migration is introduced. Reading, local seen writes, queries and tabs remain usable.

`AcquisitionProgress` contains only operationId, acquire/refresh kind, sourceKind,
optional application itemId for Refresh, stage, stable wall-clock startedAt and
cancellable. Stages are checking-helper, preparing, fetching, processing and saving.
One narrow main-to-preload channel also carries `{operationId, settled: true}`.
Main validates its application-owned payload before sending only to the owning
window's expected application document. Preload validates exact keys/enums before
calling a listener and never forwards Electron events. The subscription returns
exact listener removal; StrictMode setup/cleanup retains one subscription.

The existing typed command boundary adds `cancelAcquisition({operationId})` and
payload-free `getAcquisitionProgress()`. They retain exact arity/payload and
sender/frame/document guards. The read-only snapshot hydrates a reloaded window
after subscription; any notification supersedes a pending snapshot. Settled IDs
are retired in renderer memory, so late progress cannot resurrect an operation or
replace a newer one. No paths, arguments, stderr, environment, PID, AbortController
or general event/process capability crosses this progress/cancellation boundary.

## Cancellation and transaction ordering

Each operation owns a fresh AbortController. `AbortSignal.any` combines its signal
with the service's application-shutdown signal; cancelling one run does not poison
later runs. Main accepts Cancel only for the exact active, still-cancellable ID.
Completed, stale, missing, already-cancelling and saving IDs return NOT_FOUND with
no effect on any newer operation. A successful Cancel command acknowledges intent;
the original acquire/refresh promise remains pending until child close and cleanup.

Signals reach identity probes and helper execution. Checkpoints surround resolution,
preparation, file reading and normalization. Processing yields once before parsing;
the service yields once after extraction/cleanup to admit queued cancellation before
merge. Synchronous parsing itself is not interruptible; no records stream to SQLite.
The existing monotonic remaining 180-second extraction deadline and bounded ten-second
probe remain. Windows still uses no-shell `taskkill /T /F` for the owned tree; other
process behavior is unchanged. The process executor resolves on child close before
the extractor's awaited workspace `finally` cleanup. Quit aborts/awaits the same
cleanup before closing the database, without a user-visible cancelled attempt.

The **linearization point** is setting Saving/cancellable=false immediately before
the synchronous repository ingest. There is no await between that transition and
the atomic transaction. Cancellation processed first substitutes failed history
and prevents accepted merge. Saving processed first completes normally; a queued
Cancel cannot interrupt, roll back or partly apply that accepted transaction.

## Cancelled history and preserved state

After user cancellation and cleanup, ingest a normalized failed observation with
sanitized reason `user-cancelled`, existing safe provenance, no item/content and no
issues. Reuse the existing target-associated failed-attempt transaction, with
openTab=false. Existing sources associate with their item; a never-ingested source
has target-only failed history and creates no item/tab. No duplicate failure write
follows a storage rollback. A failure to save history reports STORAGE_UNAVAILABLE.

Cancellation never advances latest accepted attempt or NEW, writes existing
comments/seen/revisions/Undo, or changes applied/persisted reading intent. Legitimate
local actions made during a fetch still persist. The original operation returns
ACQUISITION_CANCELLED, rendered as neutral localized feedback. Ordinary failures
retain stable localized errors and coverage behavior.

## View transition and timing evidence

Accepted results still return acknowledged ReaderState, inserted/updated/warning
counts and coverage. Renderer awaits the existing session Refresh reevaluation
under Updating view, without Cancel, preserving draft/sort/identity anchoring.
Query evaluation failure stays the existing view error after a successful remote
commit; it is not remote cancellation. Unvisited discussions remain lazy.

Main injects a monotonic clock and ID factory for deterministic testing. Every
successful result includes operationId and compact nonpersisted timings:
targetMs (including the existing pre-Refresh repository bootstrap), helperMs
(resolution/probe), preparationMs, fetchMs, processingMs (read/normalize, cleanup
and pre-merge checkpoint), savingMs (atomic ingest), bootstrapMs (result ReaderState
construction), and totalMs. Electron's internal serialization/IPC transfer is not
separately instrumented; bootstrapMs is construction, not a serialization claim.
The global clock initializes from startedAt once and advances renderer-side with
performance.now; main sends only transitions, never per-second clock events.
Normal completion shows total main time; detailed timings stay diagnostic evidence.

Every operation still probes its helper, Refresh still reads before extraction and
accepted ingestion still builds a full ReaderState. Measurements justify no redesign
in this milestone. Single live samples and their limits are in [Testing](../TESTING.md).
Broader scheduling, crash-temp recovery and retention remain Q-16. Bootstrap/clone/
memory/query scaling remains Q-21. Backup/restore, distribution and packaging remain
their own work.

## Validation

Deterministic temporary-SQLite, executor, bridge, session and component tests cover
ordered stages, IDs, stale Cancel, exact payload validation, race ordering, failed
history, preservation, cleanup, shutdown, sequential operations, injected timing,
StrictMode subscriptions and local elapsed updates. A real Windows parent/descendant
test verifies process-tree termination. Disposable built-Electron smoke/restart and
anonymous live video/Community cancellation checks are recorded in Testing.
