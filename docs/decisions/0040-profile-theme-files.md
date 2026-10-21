# 0040: Profile-owned editable theme files

Status: implemented for owner review; physical/release gates remain pending.

## Decision

Keep schema 16, exact migrations 1–16, the version-1 JSON contract (including
optional `unseen-surface`), the 16-theme snapshot limit, wallpaper handling and
M2/M3 preference ownership. Main alone manages `themes/` beside the profile's
SQLite database. No application version or identity changes.

Settings offers Open themes folder, Refresh themes, native import/export and
Save editable copy. A single Appearance selector contains built-ins and named
custom themes. Selection is an atomic revision-checked preference write, including
reselecting a custom ID after switching to a built-in. Imports select their copy;
starter/current copies leave selection unchanged. Duplicate names are allowed,
with short ID suffixes in Settings. Delete themes by removing files and refreshing.

## Synchronization rules

- Startup scans once before granting reader documents; subsequent scans are
  explicit Refresh actions. Files are never watched. Existing SQLite-only themes
  materialize with their original IDs and definitions; selection survives.
- `themes/examples/` contains Light, Dark, Charcoal and Warm Graphite JSON. Missing
  examples are created exclusively; existing files, including invalid or edited
  examples, are never replaced. Only immediate `themes/*.json` files are scanned.
- A profile-private `theme-files.json` associates filenames, filesystem identities
  and validated-definition digests with theme IDs. JSON palette files have no new
  metadata or format fields. IDs are independent of names and filenames.
- An existing filename keeps its ID through edits. A missing filename transfers
  its ID to one unambiguous new file with the same filesystem identity, or the
  same last-valid definition (copy/delete rename). Ambiguous copy/delete renames
  are removals plus additions; equal names never merge themes. Ordinary renames
  retain invalid-file snapshots through filesystem identity where available.
- Valid edits replace only their validated SQLite snapshot. Invalid/unreadable,
  oversized, non-UTF-8, directory or linked entries are individually rejected.
  Associated invalid files retain their previous valid snapshot and selection;
  new invalid files are ignored. Other valid files still load.
- A tracked file absent after a complete scan deletes its snapshot. If selected,
  its custom ID clears; active Custom falls back to System. Missing tracked files
  are never recreated from stale SQLite data. A missing entire themes directory
  with an intact registry has the same deletion meaning after it is recreated.
- Known files have priority at the 16-theme limit; other valid additions load in
  deterministic filename order up to the remaining slots. Excess files receive
  individual limit reports. Names may duplicate built-in or custom names.
- Directory iteration reads at most 257 entries (256 accepted, one overflow
  check), with no recursion. Every theme read is bounded to 16 KiB. Scan overflow,
  directory or registry failure aborts reconciliation and retains SQLite intact;
  startup still opens the reader using its last validated snapshot. Refresh
  reports the failure. No file is executed or interpreted as CSS or a URL.
- Theme/example directories reject symlinks and junction escapes. Reads reject
  links/devices, check real paths and file-handle identity, and bound allocation.
  The association journal is also bounded and validated. Renderer IPC accepts
  only fixed actions and allowlisted export-source names, never paths or JSON.
  Rejection reports expose basenames, never full native paths or palette contents.
- Bounded synchronous file publication plus SQLite CAS runs in one main turn,
  without an asynchronous gap between the authority check and commit. Mutations
  use normal post-COMMIT M2 preferences notifications and main lifecycle fences.
  Import rechecks its captured revision/document after the native picker/read.
  Preload tracks Refresh/copy promises for M3 drains. Wallpaper is unchanged.

## Backups, conflicts and crashes

SQLite stores complete validated definitions, IDs and selection. Backups therefore
need no theme-file attachment; only edits accepted by a successful scan are backed
up. The association journal and raw rejected edits are not part of SQLite backups.

When a restored database has IDs absent from the destination registry, materialize
them using exclusive UUID filenames. Adopt an existing UUID file only if its
validated definition is identical. A conflict creates a bounded free suffix,
preserving both the backed-up ID/definition and the existing file. An existing
valid conflicting file may then load as an independent theme within the limit.
No normal startup or Refresh overwrites an edited JSON file with a SQLite copy.

For IDs still tracked in a destination profile, current files remain authoritative
on startup/Refresh, even after restoring an older database. A restore changes
SQLite selection/settings but does not rewind external edits or pending file deletions.
An already accepted deletion removed its association, so restoring that ID follows
the absent-ID recovery rule and can recreate its backed-up palette. Recover
historical definitions into a new profile when needed. A missing registry is treated
as file-association recovery from SQLite; conflicting files are preserved as above.
A corrupt registry fails closed instead of guessing destructive associations.

Before SQLite COMMIT, publish an atomic, flushed journal containing the old
association plus the proposed association and a hash of the proposed theme
snapshot. After COMMIT finalize it. After an interrupted commit, select the
pending association only when the database's theme snapshot matches that hash;
otherwise retain the old association and rescan. This prevents a crash during
deletion from resurrecting stale files. An interrupted initial materialization
may leave an untracked copy; identical canonical copies are adopted safely.
Failed imports remove only their unchanged new copy; externally edited leftovers
remain available to the next Refresh. Failed journal finalization is recovered
from the pending record on the next operation/startup.

## Verification

`theme-directory.test.ts` uses disposable SQLite/filesystem profiles for migration,
examples, edits/additions/renames/deletions, duplicate names, invalid/oversized
files, scan limits, conflicts, backup recovery, profile isolation, startup failure,
directory escapes, interrupted commits, authenticated intents and shared commits.
Renderer/preload tests cover the unified selector, revision-owned selection,
individual reports, folder/copy intents and wallpaper draft fencing.

`npm.cmd run test:appearance` after `npm.cmd run package` uses production main,
preload and two actual Electron windows with real JSON edits, shared active palette
updates, renames, invalid files, duplicate names, deletion, copies, SQLite upgrade,
backup/restore/restart and missing-asset recovery. Native folder opening reaches
the production shell adapter with the fixed temporary profile directory; the
test intercepts `shell.openPath` to avoid leaving Explorer windows open. It does
not certify a physical Explorer interaction. Existing wallpaper decode, contrast,
scrolling, virtualization and geometry checks remain. Leave changes uncommitted;
all existing owner physical/release/licensing gates remain pending.
