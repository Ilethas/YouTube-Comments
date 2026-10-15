# ADR 0019 — Consistent SQLite backup and safe restore

Date: 2026-10-15. Status: accepted. Narrows Q-18; schema stays 8.

## Context

The SQLite profile contains valuable library, discovery/history, seen/revisions,
durable Undo, workspace, preferences, view intent and helper selections. JSON
discussion export cannot preserve that complete authority. Copying an open main
database file ignores SQLite journals and is unsafe. Windows cannot be assumed to
support an atomic overwrite rename with the desired failure semantics.

## Decision

Use the runtime's asynchronous `node:sqlite.backup(DatabaseSync, destination)`.
It wraps SQLite's online backup API and works with committed WAL data as well as
DELETE journaling. Verified against installed Electron 44.4.5 / Node 24.21.0;
runtime tests exercise the function, rather than inferring availability from types.
See [Node API](https://nodejs.org/api/sqlite.html#sqlitebackupsourcedb-path-options)
and [SQLite backup API](https://sqlite.org/backup.html).

Settings exposes only payload-free create/restore intents. Main owns native Save
and Open dialogs. Filenames use the local calendar:
`youtube-comments-backup-YYYY-MM-DD_HH-mm.sqlite`. A private sibling `.partial` is
backed up, validated, flushed and exclusively hard-linked to the chosen destination.
Existing destinations are retained, including races/aliases; choose a new name.
Filesystems without hard-link support fail safely. Internal profile destinations,
including resolved parent junctions, are rejected. Incomplete siblings/sidecars
are cleaned. No user-visible success precedes validation/publication.

Restore means complete replacement. Main first copies the selected standalone
snapshot into `<profile>/recovery/restore-<UUID>/candidate.sqlite`. The live database
itself and hard-link aliases cannot be selected. Source sidecars are never read or
copied. All subsequent checks/migrations use the staged copy. Read-only validation
checks the version, exact known tables/indexes/triggers/constraints, full
`integrity_check`, foreign keys, required singletons/local state, evidence/source/
history ownership, positive attempt order, Undo entry counts/revision bounds and
semantic view intents. Unknown application structures, version 0, corrupt data and
newer schemas reject. Source SQL is never executed as a migration. Schemas 1–7 are
recognized against reference schemas made by the known migration chain; only the
staged copy migrates, then validates and bootstraps again. There is no downgrade.

After validation, main presents the localized explicit replacement warning. The
native message box has Cancel as both default and Escape action. Cancellation
creates no safety snapshot and changes no current data. Staged preflight artifacts
are conservatively retained; no retention/pruning policy is introduced.

Renderer opens an inert progress modal before flushing its FIFO seen/preferences
queue and every visited view's pending evaluation/save. Failed view saves abort.
Main rejects new/stale IPC mutations for the entire data operation. Earlier helper
selections drain before backup. Create backup reports busy during acquisition;
confirmed restore aborts/awaits acquisition and helper shutdown before snapshot.
Shutdown awaits outstanding data operations. Restore never reuses ReaderState.
Acquisition results arriving during the data operation wait in the old renderer;
cancelled/invalid preflight releases them for normal reconciliation, whereas
committed replacement/recovery retains the barrier through process exit.

## Offline replacement and recovery

1. Create and verify `safety.sqlite` from the quiescent CURRENT connection in the
   restore directory. Failure leaves that connection/profile available.
2. Checkpoint/truncate WAL if present, switch to DELETE, close the sole connection,
   and require no journal/WAL/SHM files before installation.
3. Flush and exclusively publish immutable `intent` before changing live paths.
4. Rename the closed original to `previous.sqlite` (an absent destination), record
   `previous-moved`, then rename the candidate into the now-absent live path.
5. Flush, record `installed`, validate and open through the existing migration/
   repository/bootstrap boundary, then record `accepted`. Close the probe.
6. Relaunch through Electron; startup handles recovery before any opener or seed.
   It validates/reopens an accepted candidate, records `complete`, and acknowledges
   success. Any unaccepted restore rolls back from the independent verified safety
   snapshot, preserving the original and quarantining failed database/sidecars.

Markers publish via flushed temporary files plus exclusive links, not overwriting
phase files. Directory fsync is used where supported; Node has no portable Windows
directory fsync. Recovery tolerates rename/marker gaps and repeated crashes during
rollback. If accepted data cannot reopen, safety recovery is attempted. Missing or
corrupt safety, multiple pending transactions, or missing live data with ambiguous
recovery artifacts stops startup with a recovery message and path; no empty fallback
is created. A single-instance lock prevents competing application writers. External
SQLite editors are not supported concurrent profile writers.

Safety snapshots, previous files, staged/cancelled candidates and abandoned files
are never automatically pruned. Keep the recovery directory until the owner decides
to remove redundant artifacts. Recovery files are separate from the live database;
the only recovery copy is never consumed. Profile identity/path selection remains
strict; no failure can fall back to production. Development fixtures seed only a
genuinely new profile, never an existing/restored empty library.

## Migration policy and limitations

Before any released application modifies an existing schema, preserve a verified
recoverable pre-migration snapshot. Async startup now implements this before the
existing synchronous transactional opener, for recognized older schemas. Snapshots
are `<profile>/recovery/pre-migration-vN-<UUID>.sqlite`; failure aborts startup.
Current/newer profiles are not migrated by this step. Newer rejection remains in
the opener. Each future released migration still needs populated preservation and
failure tests and recognition updates; no released upgrade matrix is claimed.

Backup page copying is asynchronous in batches. Full integrity/application
verification, migration and bootstrap remain synchronous on main during a clear
modal lifecycle stage; the separate renderer can paint progress. Measurements and
the resulting responsiveness limitation are recorded in [TESTING](../TESTING.md).
This milestone does not redesign Q-21 paging/queries or introduce a worker system.

Backups contain personal discussion metadata and machine-specific helper paths.
They exclude Chromium caches/session data, helper binaries and process temporaries,
which are not authoritative application data. Restored helper paths still obey
startup environment > saved path > safe PATH and fail closed if unavailable.
No cloud, schedule, compression, encryption, export/import, portable mode, installer,
helper bundling, format envelope or automatic retention is implemented. Backup
portability across future schema/SQLite/platform changes remains a release concern.

## Validation

Deterministic SQLite tests compare all authoritative table rows across complete
round trips, including remote fixtures, history/NEW, partial Undo ownership, views,
workspace/preferences/helpers and subsequent Undo/removal. Tests cover WAL,
exclusive publication/cleanup, wrong/corrupt/newer/foreign-key-invalid snapshots,
known older staging, safety failures, shutdown and stale IPC. Failure injection
covers each phase, rename/marker gaps, reopening and interrupted rollback. Real
built-entry Electron tests restart a disposable profile and forcibly exit immediately
after each critical rename. All performance/restore verification uses owned temporary
profiles. See [TESTING](../TESTING.md) for measured results and remaining release work.
