# Post-M9.2 tab keyboard behavior

Date: 2026-10-19. Narrow renderer usability fix; schema remains **14**.
Changes are uncommitted for owner review.

## Reproduced cause

Before the fix, `WorkspaceTabs` mouse activation invoked `workspaceAction` even
for an already-active tab. That action temporarily disabled all tab buttons.
If the pending state survived to Chromium paint, the focused button blurred to
body. Mouse activation requested no focus restoration, and reorder did not
restore focus either. A fast acknowledgement could mask the problem by avoiding
disabled paint, explaining why a direct synthetic tab keydown missed it.

`node scripts/smoke-tab-keyboard.cjs --baseline` was run against the original
built renderer. Native Chromium mouseDown/mouseUp clicked an inactive tab; a
main-only gate held activation before the production handler until two animation
frames observed disabled controls. Focus was body both during the wait and after
acknowledgement. Native Alt+Left reached the renderer with body as its target and
left tab order unchanged. Explicitly focusing the tab made the same native key
reorder successfully. Alt interception and a workspace revision rejection were
not the cause. The baseline mode intentionally expects the old behavior; use the
normal command for regression verification of fixed builds.

The extended native pending test also exposed unconsumed Ctrl+W falling through
to native window Close during a workspace write. The renderer now consumes that
chord during the wait without submitting a second operation.

## Behavior

- Clicking an active tab avoids a redundant activation write and keeps focus.
- Temporarily disabled focused tabs regain focus after the acknowledged DOM is
  enabled. Later focus/pointer intent or native blur revokes implicit restoration;
  acknowledgement cannot reclaim focus even if the user later leaves it on body.
  Failed writes recover tab focus under the same guard.
- Alt+Left/Right remains focused-tab-only, with exact modifiers, composition,
  disabled and repeat checks. Successive presses remain usable after a move.
- Ctrl+Shift+PageUp/PageDown moves the active identity one position without wrap,
  including from the discussion panel or editing controls. Ordinary editing keys
  retain their behavior. Live panel/query/selection state is retained.
- Both shortcuts use existing `api.moveTab`, the acknowledged workspace revision
  and the existing busy/CAS lane. No queued repeat requests or new persistence.
- Menus, dialogs, composition, disabled/inert states, workspace actions, profile
  barriers, duplication and transfers block active-tab reordering. Existing
  Ctrl+Tab/Shift+Tab, Ctrl+W and native window shortcuts retain their roles.
- Settings help derives both new bindings and EN/PL action labels from the shared
  shortcut registry.

## Verification

Automated native mouse/key delivery uses Electron `webContents.sendInputEvent`
through actual production windows/preload/IPC/SQLite in newly created OS-temp
profiles. Main-only delay gates make pending states observable. React tests model
disabled blur explicitly because jsdom does not implement Chromium's paint-time
focus loss. Neither form is owner-operated physical keyboard verification.

| Check | Result |
| --- | --- |
| Focused App/WorkspaceTabs/shortcut Vitest | **127 tests / 3 files PASS**, explicit process exit 0 |
| Full final Vitest | **1,219 tests / 96 files PASS**, 146.46 s, explicit process exit 0 |
| Typecheck / ESLint | **PASS**, explicit process exits 0, no lint warnings |
| Native keyboard harness | **PASS**, original failure reproduced before the fix; fixed standalone and aggregate runs pass |
| Aggregate Electron | **All 20 harnesses completed successfully**, including M3/M5/M6/M7/M8/M8.2 and the added keyboard harness |
| Fresh Windows x64 application / ZIP | **PASS**, verified 73 runtime files, ASAR/runtime/fuses and archive |
| Unmodified extracted EXE | **PASS**, native dialogs, backup/restore/safety and real relaunch, explicit process exit 0 |
| Presentation integrity | **PASS**, 17 README links/anchors, six existing decoded PNGs, seven ICO frames |
| Whitespace review | `git diff --check` **PASS** |

The initial aggregate stopped at its old 27-row keyboard-help assertion; it was
updated to 29 rows with both new binding assertions. The final aggregate reached
all three final M8.2 phases. Its PowerShell redirect wrapper returned 1 because
expected failure-injection diagnostics use stderr; no harness assertion failed.
A separate `node` probe explicitly exiting 0 reproduced wrapper status 1 when
writing a diagnostic to redirected stderr, and returned 0 with explicit exit handling.
The final Vitest/typecheck/lint/extracted-EXE commands explicitly returned
`$LASTEXITCODE` to distinguish native-process status from that shell behavior.
Existing optional Copy checks preserved clipboard contents when formats could
not be safely snapshotted. No physical keyboard or installed-Squirrel claim is
made by these automated checks.

Owner physical verification remains pending: click an inactive tab, wait for
activation, then press Alt+Left/Right repeatedly; repeat after clicking the active
tab. From a focused discussion, try both Ctrl+Shift+Page shortcuts and the first/
last boundaries, then confirm ordinary text editing, Ctrl+Tab/Shift+Tab and Ctrl+W.
During a pending activation, moving focus elsewhere must retain that later focus.

No Setup execution, production-profile access, schema/identity/version change,
licensing/notice edits, publication, commit or push is part of this task. Existing
M7/M8 authority, M3 barriers and M9.1 performance boundaries remain unchanged.
