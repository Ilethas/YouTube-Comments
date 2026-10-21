# ADR 0039: Configurable notification dismissal

Status: accepted for the requested implementation; uncommitted owner review.

## Context

Tab-transfer feedback remained indefinitely and its normal-flow footer reduced
the reader viewport. The preceding scrollbar fix established that feedback must
not increase document scroll height. Dismissal must preserve important errors,
pending work and contextual form validation.

## Decision

Settings adds English/Polish Automatic (default) and Manual modes. Automatic
success feedback lasts 3, 5 (default), 10, 15 or 30 seconds of unpaused time.
Hover and contained keyboard focus independently pause the remaining time.
Changing mode or duration gives the current success message a fresh duration,
without rewriting its live-region text. Errors never time out; pending work
remains until settlement or explicit dismissal. Dismissing pending feedback does
not cancel the operation; its eventual outcome gets fresh feedback.

A small renderer controller owns one session-only notification slot. Each
replacement gets a monotonically increasing identity. Dismissal and operation
settlement compare that identity, so stale timers and completions cannot hide or
overwrite a newer message. Manual feedback survives tab changes until dismissed
or superseded; notification history is neither persisted nor synchronized.

The initial scope is source pending/success/failure and destination committed
tab-transfer feedback, including native drag transfers through the same protocol.
Acquisition progress, contextual errors, seen/Undo feedback and persistent warnings
retain their existing semantics.

A bounded fixed overlay sits above the top-center chrome, outside the inert
reader shell and wallpaper/virtual-row ancestors. It never changes reader height,
and leaves the right ruler and bottom floating controls clear. Context menus and
native dialogs remain above it. During a pending source transfer the blocking
surface and notification share one modal accessibility boundary, with the close
control reachable above that surface. Cancel remains separate. One stable polite
atomic status region contains only the message; the localized visible close
button is its sibling. Dismissal clears text without moving focus.

Schema 16 only adds checked `notification_dismissal` and
`notification_duration_seconds` preference columns. Migrations 1–15 are unchanged.
Both narrow preference intents pass exact IPC validation and the existing FIFO
acknowledged save queue, M3 mutation fencing, main-owned SQLite commit and M2
replica reconciliation. Independent field updates avoid overwriting a peer's
other notification choice. Backups include preferences; older backups are
validated against their exact schema and upgraded on staged copies. Pre-migration
safety snapshots retain the original schema and data.

## Verification

`Notification.test.tsx`, Settings integration tests and persistence tests cover
both modes, all durations, keyboard close, overlapping hover/focus pauses, pending
settlement, persistent failures, stale callbacks, live-region mutation semantics,
schema-15 safety/rollback, reopened settings and backup/restore.

After a verified Forge build, `npm.cmd run test:notifications` extends the real
production-entry scroll regression with two native windows, authenticated tab
transfers, every actual timeout, injected ownership rollback, pending close and
settlement, native hover/key input, shared mounted Settings, reload and fixed
document/reader geometry. It uses disposable OS-temp profiles and offline fixtures.
DOM and Chromium accessibility-tree assertions verify semantics; spoken output from a particular
screen reader and physical OS dragging remain owner manual checks.

Version, release/identity, Setup execution and publication are unchanged.
