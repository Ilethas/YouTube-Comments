# M0 fake-tab drag laboratory

This standalone entry imports no production modules. It opens **two** sandboxed
Electron windows, owns only six in-memory fake tabs, and puts Chromium files and
bounded event evidence under a newly created OS-temp `youtube-comments-m0-*`
directory. There is no ReaderService, SQLite, production renderer, saved workspace,
application profile, installer, global hook, native addon or new dependency.

From the repository in PowerShell, using the already installed dependencies:

```powershell
node experiments/m0-tab-drag/launch.cjs
```

Do not use `npm start`, Forge, the packaged reader EXE or Setup.exe for this spike.
The launcher prints the disposable directory and `events.ndjson` path. Both windows
show that path and recent events. Close both windows to exit. Relaunch after closing
either participant; Reset restores six tabs only while both windows remain open.
Run directories are retained for evidence; the experiment does not delete them.

Both windows now start hidden, with lifecycle listeners installed before loading.
Main waits for each page's load and first validated renderer layout (a 10-second
deadline per window), shows A using `showInactive()`, then shows/focuses B. This is
the same startup path in manual and smoke launches. `ready-to-show` is recorded
but is not a required event that could leave startup waiting forever. Failure,
renderer death or closure before readiness records diagnostics and exits with an
error rather than leaving hidden windows running indefinitely.

Use **Show/focus Window A** in either window while idle if A is missing or
minimized. Main resolves its existing A reference, restores it if minimized and
calls show/focus; it never creates a replacement. The fixed intent uses the same
sender/frame/document validation as every other harness action and accepts no
window ID, handle or bounds. It rejects active drag sessions and an unavailable A.

Expand **Native window diagnostics (main-owned)** to see both windows' current
`isVisible`, `isMinimized`, `isFocused`, `isDestroyed`, `getBounds`,
`getContentBounds`, renderer readiness and matching display. The same fields are
in each lifecycle event's `nativeState` and IPC snapshots' `nativeWindows`.
Destroyed windows have null bounds/display and false readiness; native getters
are not called after destruction. `window-created` captures the initial hidden
state; `window-show-request`, `window-show`/`window-hide`, readiness events and
post-show snapshots establish the sequence. **Native visibility is not proof of
an Alt+Tab entry or unobscured desktop pixels.** See checklist V01–V05 before drag
testing, and the report's missing-A follow-up for the unresolved original cause.

Select the technique in either window (shared across the harness), then use the
primary mouse button on a fake tab. In HTML mode, allow a moment after pressing for
the token to arrive. A fast drag with no token cancels safely. Tokens are written
synchronously into a custom MIME format; no labels, paths, files or content are
included. Pointer mode captures the source strip and main samples cursor DIP at
10 Hz for diagnostics and again when processing a delivered release.

Pointer cross-window placement is intentionally an **experimental geometric
transfer**. Its outcome explicitly says `unverified-occlusion`: another application's
covering window is invisible to this test's hit test. Overlapping app strips are
ambiguous and do not move anything. Blur taints pointer release; lost capture,
Escape when delivered, minimize, participant closure and display changes cancel.
Outside release is recorded as destination unknown. **Neither technique creates a
third window**, even on an apparent desktop release. M0 measures release evidence;
new-window placement/transfer belongs to later milestones.

The Manual use controls can schedule closing this window, closing its peer or
minimizing its peer after three seconds. Click one, promptly begin dragging and
keep holding. Main logs scheduling and actual firing times; an OS drag loop may
delay timer delivery, which must be recorded rather than assumed concurrent.
These fixed actions affect only the harness windows and accept no native handle.

Automated checks (separate from the unchanged production test discovery):

```powershell
node --test experiments/m0-tab-drag/model.test.cjs
node experiments/m0-tab-drag/launch.cjs --smoke
```

The smoke opens the same two sandboxed BrowserWindows briefly. It uses synthetic
DOM DragEvents and Electron-injected pointer events with a stubbed cursor. It may
report `isTrusted=true` for injected Chromium input; **that is still automation**.
It never certifies OS mouse release, native HTML/OLE drag, Escape outside the app,
occlusion or mixed-DPI behavior. Its evidence header says
`automated-synthetic-only`. It exits with 0 only after all smoke assertions pass.
Normal launches are labeled `owner-manual-session-unclassified`, not native PASS.
Before any smoke recovery action, it checks that both windows are alive, loaded,
independent and report native `isVisible() === true`. It checks initial hidden
snapshots, listener/show ordering and main-owned diagnostics, then exercises the
Show/focus A control from B against hidden/minimized A. It does **not** inspect or
certify OS task-switcher visibility.

The filesystem/process sandbox used by a coding agent may prevent Electron child
process startup. Run normally from your Windows shell; do not disable Electron's
renderer sandbox. A restricted-agent failure is not a native input test result.

Execute the [manual checklist](MANUAL_CHECKLIST.md), and record results in its
ledger format. Read the [feasibility report](../../docs/MULTI_WINDOW_M0_FEASIBILITY.md)
for the current comparison and recommendation. This laboratory is not a reusable
production WindowCoordinator or M7 transfer implementation.

## Files

| File | Role |
| --- | --- |
| `launch.cjs` | Host-Node launcher, unique owned temp directory, separate Electron entry |
| `main.cjs` | Two windows, exact sender/frame/document IPC guard, bounded diagnostics, DIP sampling |
| `preload.cjs` | Frozen named harness intents and stripped subscription events |
| `model.cjs` | Deterministic fake-placement/token/outcome logic, validation and geometry |
| `model.test.cjs` | Node test runner coverage without Electron or production modules |
| `index.html`, `renderer.js`, `style.css` | Fake strips, the two gesture adapters, recent evidence |
| `smoke.cjs` | Explicitly automated Electron wiring checks, loaded only with `--smoke` |
| `MANUAL_CHECKLIST.md` | Native Windows procedure and blank evidence ledger |
