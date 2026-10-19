# ADR 0035: Reader menu, selection alignment and lifecycle presentation (M8.2)

Date: 2026-10-19. Status: implemented, awaiting owner review.
Schema **14**, unchanged. M9 performance/release work is excluded.

## Row geometry

Selection circles use the virtual row's existing `--reader-indent`, which already
includes deep-level compaction and the current width budget. Their left edge is
that indent plus row padding; the avatar remains in the established selection
gutter. The resulting gap is 10 CSS pixels at every depth and zoom. The gutter is
reserved even when on-demand circles are hidden, avoiding text reflow, row-height
changes and scroll-anchor movement solely from toggling selection mode. This
supersedes ADR 0026's fixed outer selection column.

Avatar-based rail/elbow expressions, row backgrounds and depth projection are
unchanged. A small opaque surround keeps neutral connectors out of the control's
hit target; the control paints above rails without intercepting adjacent rows.
No second depth calculation, virtualizer change or new selection/seen semantics.

## Discoverable application commands

The toolbar's decorative symbol becomes a localized application-menu button. It
reuses the existing focus-managed portal menu, outline icons, keyboard traversal,
outside/Escape dismissal and viewport clamping. New/Close/Quit show native shortcut
hints; Quit is visually separated. Trigger toggling and opening on ArrowUp/Down
are explicit. Composing keys cannot activate a command. Freeze dismisses the menu.

Two payload-free preload methods, `newWindow()` and `quitApplication()`, join the
existing `closeWindow()`. Main authenticates the exact registered current top-frame
document, requires an eligible ready/nonprovisional reader, rejects extra arguments
and respects terminal fencing and native creation barriers. The callbacks reuse
the same M6 factory and app Quit entry point as the native menu. Close still calls
the origin BrowserWindow's native Close path. IPC acceptance is not a claim that a
later drain/checkpoint succeeded; the existing M3 failure/retry presentation owns it.
There is no generic window, Electron, filesystem or process capability.

Native File keeps New Window (Ctrl/Cmd+N), explicit Close Window
(Ctrl/Cmd+Shift+W) and Windows/Linux Quit (Ctrl+Shift+Q). Ctrl/Cmd+W is not registered
as a native window-close accelerator; the reader retains its active-tab command.
Alt+F4 is not bound to Quit. macOS retains the app menu's single standard Cmd+Q
Quit item; File does not duplicate it. Window command composition guards run at
the native input boundary; the renderer displays these chords but does not execute
them a second time. Windows is the verified native platform.

## Freeze immediately, present progress after 180 ms

Before changing code, a disposable production-entry experiment held native Close
at drain acknowledgment. The surviving renderer received Close PREPARING/DRAINING,
became inert immediately and mounted the black Canvas-colored full-screen overlay.
Its document time origin did not change. The captured frame reproduced the reported
appearance: this was lifecycle presentation, not a renderer reload.

M3 continues to freeze synchronously, capture anchors, block input, seal and drain
queues, await acknowledgments and reconcile before release. Only the progress
overlay waits 180 ms. A presentation-only hook fences the timeout by profile epoch
and operation ID, cancels it on release/identity change/unmount, and never renders
an overlay after logical release. The pending status remains accessible. A long
operation presents the existing dialog with app theme colors and a loading ring.
Failed reconciliation immediately displays/focuses Retry, independent of the timer;
failed drains retain the existing immediate error and usable native window.
Successful release restores the captured focus. New operations cannot reuse old
timers. No save, Close, Quit, checkpoint, authorization or restore-set work waits
for presentation.

## Evidence limits

See [testing](../TESTING.md) and [UI](../UI_AND_NAVIGATION.md) for exact commands,
results and ignored Electron screenshots. Frame sampling and Electron compositor
captures accompany actual native Close operations and controlled slow/failing
drains. They do not constitute a physical desktop recording or prove all OS/window
manager presentation paths. M7/M8 authority, atomic transfer, outside-drop heuristic,
historical migrations and M0/M0.5 evidence remain unchanged.
