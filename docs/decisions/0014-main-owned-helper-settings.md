# ADR 0014 - Main-owned external helper Settings

Date: 2026-10-08. Status: accepted.

## Context

Startup environment overrides and safe direct PATH lookup already permit pinned
yt-dlp/post-archiver acquisition, but desktop users cannot choose installed helpers
from Settings. Q-19 also covers distribution; this increment resolves user-selected
executable configuration without selecting bundled artifacts or an update policy.

## Decision

Schema 7 adds a separate `helper_settings(kind, executable_path)` SQLite table in
the current profile. No rows means automatic detection. It has no discussion
foreign keys, is excluded from ReaderState/Preferences, and survives discussion
removal independently. The ordered transactional migration adds the table without
rewriting schema-6 content, seen revisions, history, workspace, preferences or Undo.
Environment overrides are never persisted as selections.

Resolution is startup environment override > current saved selection > safe direct
PATH > HELPER_UNAVAILABLE. Environment variables are snapshotted when the main
service initializes. An explicitly set value, including empty/invalid, is
authoritative and disables Browse/reset in UI and main. Missing, relative,
directory, non-executable or incompatible higher-priority paths fail closed; no
fallback. Clearing a saved selection changes only that helper, immediately
re-resolves PATH and leaves startup environment untouched.

Three typed IPC intents accept exactly `{ kind: 'yt-dlp' | 'post-archiver' }`:
query/recheck status, choose executable, and clear selection. Existing sender,
top-frame and exact-document checks apply. Main opens a window-parented native
single-file Electron dialog with a Windows .exe convenience filter. The renderer
never supplies/receives a picker path for subsequent execution: the path goes
directly from dialog to privileged validation/probe/persistence. Cancellation is a
successful null acknowledgment with no write or error. Rejected selections retain
the previous saved selection and return existing localized helper error codes.

Validation requires an absolute regular executable; Windows requires .exe and
rejects root/drive-relative paths. .bat/.cmd and shell execution remain excluded.
One shared bounded probe is used for selection acceptance, status and every
acquisition: yt-dlp `--ignore-config --no-plugin-dirs --version` must report exactly
2026.08.19; post-archiver `--version` must report `post-archiver 0.4.0`.
The maximum probe duration remains ten seconds, stdout 4096 bytes; raw stdout,
stderr, environment and process diagnostics never cross IPC. Status contains only
fixed helper/source/state enums, display-only path, recognized version and required
version. Existing acquisition deadlines, retries, commands, output limits and
single-live-acquisition scheduling remain unchanged.

The acquisition resolver reads the current main-owned saved selection per later
operation; changing configuration requires no restart. An already-running
acquisition retains its resolved executable. Selection/status/reset requests are
serialized in main to prevent a late chooser/probe overwriting a later reset.
Normal quit aborts probes and awaits queued configuration/acquisition work before
closing SQLite; aborted acceptance cannot persist a selection.

Status checks are lazy once per mounted Settings section, when first active, with
explicit per-helper Recheck thereafter. Bootstrap and ordinary reading do not
probe helpers. Choose/reset return their resulting status directly. A subsequently
removed/replaced helper is detected by Recheck or by the mandatory acquisition
probe; status is evidence from the last check, not continuous monitoring.

English/Polish Settings shows two compact helper entries, resolution mode, full
wrapping path with title, detected/required versions and localized state. Controls
remain disabled while pending; environment-controlled helpers allow only Recheck.
No renderer filesystem, Node, process launcher, arguments or shell text is added.

## Reasons and alternatives

Native main-owned selection makes desktop configuration usable without adding an
arbitrary renderer path/execution interface. A separate table keeps machine paths
apart from source content and ordinary preferences while inheriting profile
isolation and durable SQLite writes. Explicit rechecking bounds process launches
and avoids coupling helper availability to Reader rendering. Persisting only a
validated, probed selection protects a previously working setting from rejected
choices; acquisition still probes because files can change after acceptance.

## Consequences and validation

Deterministic tests cover precedence, fail-closed paths, exact versions, cancellation,
retained selections, profile/restart persistence, preserving schema-6 migration and
rollback/retry, immediate acquisition/Refresh changes, exact IPC guards and localized
UI. Built Electron verification uses disposable profiles and main-only native-dialog
and child-process test seams, exercising actual preload/IPC, no-shell commands and
real restarts; it does not certify live upstream availability or actual native
dialog interaction. See [Testing](../TESTING.md).

Helpers must still be installed by the user. Download, bundling, auto-update,
Python/runtime management, broader compatibility, licenses/notices, integrity and
distribution ownership remain Q-19/release work. This is not release-ready helper
distribution or packaging finalization.
