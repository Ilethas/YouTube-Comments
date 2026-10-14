# ADR 0017: Persistent discussion view restoration

Date: 2026-10-14. Status: accepted. Resolves Q-10 for the implemented uncollapsed reader.

## Context and decision

The inbox needs independent reading intent across process restarts and closed tabs.
Schema 8 adds one optional `discussion_view_state` row per stored discussion:
separate draft/applied semantic query JSON, one of five whole-conversation sorts,
nullable anchor comment application ID with row-relative offset, and nullable selected
comment application ID. Null anchor means header/top and stores offset zero. No row
means current defaults. Content deletion cascades the row; closing never deletes it.
Helper configuration and comment seen/revision/Undo records remain separate.

Only the explicit current query fields are trusted: text (at most 16,384 UTF-16
code units), unique selected fields, text/regex mode, case sensitivity, seen,
semantic publication and discovery criteria. Runtime validation rejects extra keys,
unknown enums, result IDs, resolved dates, oversized strings and nonfinite/out-of-range
offsets. Optional calendar strings use YYYY-MM-DD; semantic validity remains the
existing resolver's responsibility so an invalid draft can still be saved. Offsets
are bounded to ±100,000 pixels. Main validates comment ownership; same-item foreign
keys also protect writes. Persisted JSON is size-bounded before parsing and validated
again on read. Corrupt presentation rows are ignored independently with a fixed,
once-per-connection/item diagnostic, preserving all discussion data.

The only new renderer capability is typed `saveDiscussionView` full-intent upsert.
Validated bootstrap records initialize a session once; later acquisition/Refresh
acknowledgments never rehydrate an already-live session. Library/Settings get no records.

## Restart reconstruction boundary

Restart restores **applied semantics**, not a frozen result snapshot. First activation
of a saved discussion resolves that query against current durable comments/seen/NEW
with the existing resolver and cancellable worker, including its 1000 ms deadline.
Relative Today/Last 24 hours/Last 7 days resolve using fresh now and current system
IANA zone. Custom calendar dates also resolve in that zone. No numeric date bounds,
regex objects or result/visible/matching ID arrays are stored.

The draft remains separate. Applied `camera` with draft `microphone` displays rebuilt
`camera` results while controls still show `microphone` and the existing draft indication.
Failed Apply never replaces durable applied intent; its draft remains eligible for saving.
Successful Apply promotes and saves applied intent. Successful explicit Refresh retains
applied criteria, draft and sort, resolving again with a fresh clock/zone and saving the
settled anchor.

In-session seen edits intentionally keep frozen membership until Apply/Refresh. If an
Unseen match A is marked seen and the application quits before Apply, restart evaluates
Unseen against durable seen=true; A ceases to match. The result can still contain A as
context if another comment in its tree matches. Successful reconstruction starts with
`seenStale=false`. Restart is an explicit view reconstruction boundary.

## Presentation and failure

Loading replaces the discussion while its saved query is reconstructed, avoiding an
unrestricted flash. Other discussions initialize lazily on first activation; previously
mounted panels retain ADR 0009 isolation. Existing virtual rows, sorting, navigation and
three-lane ruler use one shared projection of the freshly reconstructed complete trees.
Most liked remains the selected preference even if all current root like keys are unknown.

After sorting: restore a displayed anchor at its row offset; otherwise a displayed selected
comment at offset zero; otherwise the first restrictive applied match in current sort
order; otherwise beginning. An explicit null/header anchor always restores top. Current
variable-height measurements reconcile the target; no measurement cache is persisted.
An offset larger than the current row is clamped to its measured height, so shortened
content cannot send restoration into another conversation.
Selection survives only if displayed and never requests browser focus. F3/Shift+F3 and
live-unseen navigation continue from it in current sorted preorder. Restoration never
writes seen state. Close/reopen also restores the session's last settled anchor instead
of replaying an obsolete navigation request.

If valid saved applied criteria fail resolution/evaluation or time out, only that session
shows a localized restoration message and a safe unrestricted result, retaining sort.
Saved **applied** criteria become the draft for inspection/retry (replacing any separately
saved draft in this fallback session); displayed applied criteria become defaults,
selection clears and scroll starts at top. The original durable applied intent is retained
until a successful explicit Apply/Refresh; automatic anchor/sort saves do not silently
replace it with defaults. The fixed diagnostic contains only a query error code. No
database reset, content loss or startup-wide failure occurs.

## Saving and consequences

Each discussion owns a serialized asynchronous full-intent save queue. Draft bursts wait
400 ms; Apply, sort and selection save after 50 ms. Scroll capture waits 250 ms idle and
then coalesces after 50 ms. Explicit navigation also schedules settled capture. Before
switch/close, the reader captures its current data anchor and flushes queued intent; it
does not wait for every process-termination pixel. Each actual dispatch reads the latest
complete state, so delayed scroll callbacks cannot replay old query/sort snapshots. A
failed acknowledgment stays dirty, shows localized feedback, and retries on the next
edit/flush without blocking reading or creating a retry loop. Removal cancels queued
follow-ups; main rejects saves for missing discussions. No synchronous quit IPC is added.

Transient results, worker state, errors, seenStale, pending state, focus, DOM identities,
hover/details, scrollTop, ruler geometry and virtualizer measurements remain in memory.
Expansion is absent because reply collapse is not implemented. Q-10 retains only future
collapse expansion persistence and optional tab badge details. Q-21 full bootstrap/clone/
memory/database scaling and release/helper distribution/backup/export remain separate.

Additive migration is transactional and creates no fake state rows. Deterministic domain,
IPC, temporary SQLite, session and actual-virtualizer tests cover reconstruction and save
ordering. Disposable real-Electron restarts and 10k/50k observations are recorded in
[Testing](../TESTING.md); no arbitrary wall-clock CI threshold is selected.
