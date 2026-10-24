# ADR 0042: Profile-owned concurrent Download Manager

Status: Implemented, uncommitted for owner review (2026-10-24).

## Context

The single acquisition lock prevented independent discussions from downloading
together and kept a renderer IPC request pending throughout extraction. Progress
already had safe numeric observations, 250 ms throttling, exact cancellation,
Windows descendant cleanup and a transactional Saving boundary. M2 already
reconciles committed discussion data across independent native windows.

## Decision

`DownloadManager` belongs to `ReaderService`, for one profile. It schedules the
existing `AcquisitionService` as an independent executor for each job. The latter
retains helper resolution/probes, bounded requests/output, per-job cancellation,
normalization, child/temp cleanup, failed-attempt recording and atomic ingestion.
There is no extraction-wide or inactivity deadline. JavaScript main-thread SQLite
ingestion stays synchronous and serialized; extraction can overlap.

Schema **17** adds only `preferences.maximum_concurrent_downloads`, checked to
1/2/3/4, default 3. Migrations 1–16 are unchanged. Existing pre-migration safety,
exact historical validation and staged backup upgrades apply. The preference
uses the existing acknowledged save lane and M2 shared preference commits.

Jobs move from Queued through Checking helper, Preparing, Fetching, Processing
and Saving to Completed, Failed or Cancelled. The opaque UUID stays constant for
one attempt. Slots include processing, saving and awaited cleanup. FIFO starts
are scheduled in a guarded microtask. Raising the limit fills slots immediately;
lowering it lets current jobs finish and waits until below the new limit. User
cancellation of a queued job never starts a helper or records an extraction
attempt. Active cancellation retains its slot until the executor settles. Saving
is non-cancellable. Retry submits a fresh UUID/attempt at the queue tail, or joins
an already pending job for that source. Old UUIDs never cancel a retry.

Canonical `(sourceKind, sourceId)` deduplicates queued and active jobs, including
URL variants. The first accepted intent remains the job's displayed kind. A
Refresh joining Acquire shares its extraction; an Acquire joining Refresh shares
its extraction and registers its requesting document for Open on success. Every
Acquire requester can open the committed item in its own still-current document;
no requester lifetime owns execution. Expired documents never cause another
window to open a tab. Tab Close, native Close and Reload leave jobs alive. Library
removal rejects any source with a pending job, including queued acquisitions.
Closing the last application window still follows the platform's ordinary app
shutdown policy, which cancels/drains downloads before exiting.

`reader.downloads` exposes small validated Submit, Current, Cancel and Retry
intents plus Changed notifications through the authenticated IPC registry.
Changed carries a full bounded safe snapshot with the repository profile epoch
and a separate main-service download revision. This revision never resets when
an aborted pre-offline restore rebuilds the manager. Preload validates exact
notification shapes and strips Electron events. Renderer subscribes before
Current and accepts increasing revisions only; a delayed snapshot cannot replace
a newer event. M2 remains the authority for committed content, seen/NEW/Undo and
workspace/view synchronization; job snapshots contain no comments or private
helper information. Per-executor numeric progress remains coalesced at 250 ms.

At most **128 pending jobs** and **32 recent settled jobs** are retained. Snapshots
therefore contain at most 160 small projections. Full compatibility completion
results are released after delivery, rather than retained by recent-job promises.
The old acquisition/progress methods remain a completion facade for existing
callers and test harnesses; production UI uses prompt submission and M2 results.
Job queue, recent results, timestamps and progress are session-only. Restart does
not resume downloading. Durable acquisition attempts remain the history source.

Backup rejects while any queued or running job exists, preserving its previous
busy policy. Restore preflight/confirmation retains M3 fencing; confirmed restore
stops scheduling, cancels queued jobs and aborts/drains all active executors before
the verified safety snapshot and offline replacement. Shutdown/Quit uses the same
stop-and-drain path before closing SQLite. Shutdown creates no user-cancelled
attempts. Cancelling restore before confirmation leaves downloads alive. Recovery
from a failure before offline replacement creates a fresh accepting manager.

## Presentation and consequences

Every window has a Downloads button beside Library/Settings. Its badge counts
running slots, excluding queued and settled jobs. A bounded scrolling nonmodal
panel groups Active, Queued and Recent jobs, exposes Cancel/Remove from queue,
Retry and Open, and shows safe labels, intent, stage, elapsed time and estimates.
It floats without resizing the reader. Escape, outside pointer/focus dismissal
and focus return support keyboard use. English/Polish strings and semantic theme
tokens cover standard/custom themes and wallpaper readers.

Discussion status matches source identity, so duplicates share status and suppress
duplicate Refresh while pending. The former global single-operation strip is
unused by production UI. Percentages remain estimates capped below 100 while
fetching; only validated ingestion establishes success/coverage.

Concurrent helpers increase peak memory/CPU/network use. The 1–4 limit bounds this
without selecting a database worker, streaming ingest or paging redesign. Main
normalization/ingestion may still pause UI/IPC delivery. No crash-resumable queue,
persistent completed-job list, priorities, pausing, automatic retry or public
release/installer execution is added. Physical keyboard/mouse and full visual
review remain owner checks. See [testing](../TESTING.md).
