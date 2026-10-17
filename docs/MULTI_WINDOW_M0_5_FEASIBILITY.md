# M0.5 — VS Code-inspired detachable-tab investigation

2026-10-17 (Europe/Warsaw). Isolated follow-up to [M0](MULTI_WINDOW_M0_FEASIBILITY.md)
and the [proposed multi-window design](MULTI_WINDOW_DESIGN.md). No M1 implementation.

## Decision

**Use native HTML drop as the attachment candidate. The inspected VS Code
detachment heuristic does not supply proof of desktop release or distinguish an
external application from the desktop.** Its mechanics are implementable with
ordinary Electron/browser APIs, but directly adopting its decision rule would
weaken the requested cancellation guarantee. No new native success is claimed.

The third harness option, **VS Code-inspired guarded probe (M0.5)**, performs real
fake-tab attachment through the existing authenticated token drop. For outside
endings it records whether upstream-style guards *would* permit a new window, and
classifies the remaining uncertainty. It **preserves source ownership and opens
no third window**. A speculative preview window adds no missing release evidence;
we deliberately stop at this bounded probe. This is an investigated limitation,
not a working desktop-detachment implementation.

## Evidence carried forward

The owner explicitly reports genuine Windows M0 tests in the task initiating
M0.5. These observations are accepted as **owner-reported native evidence**:

| Original M0 behavior | Owner evidence / status |
| --- | --- |
| Pointer transfer with a destination covered by Notepad | **Failed:** geometric targeting incorrectly transfers. Retain as a comparison, not a production attachment approach. |
| Native HTML transfer between the two app windows | **Owner-reported native pass** for the tested cases. |
| Native HTML with an externally occluded destination | **Owner-reported native pass:** no transfer. |
| Native ghost image / prohibited cursor over File Explorer | Owner accepts these visuals. They are not release/cancellation evidence. |
| HTML dragend none | Remains ambiguous between outside release and cancellation. |

No raw native run directory, repetition count or monitor coverage was supplied
with these observations, so none is invented. The earlier M0 automated/manual
ledgers remain historical. Codex has no personally verified native pass. Every
new M0.5 physical case is **REQUIRES OWNER VERIFICATION**.

## Upstream source actually inspected

Repository: `microsoft/vscode`. `git ls-remote` resolved current `main` to
**`60541952313cbc2728cab30dacddf4154e5b10c9`** during this investigation; GitHub's
commit metadata reports **2026-10-17T15:28:02Z**. The links below pin that commit,
not a moving branch or an installed VS Code release. Targeted files were downloaded
to an owned temporary research directory, not copied into this repository. Cached
web `main` excerpts had different line numbers; the pinned files are authoritative.
No upstream app was built or physically drag-tested.

| Exact source / function | Inspected mechanism and limits |
| --- | --- |
| [editorTabsControl.ts, L436–556](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/browser/parts/editor/editorTabsControl.ts#L436), `onGroupDragStart`, `onGroupDragEnd`, `isNewWindowOperation`, `maybeCreateAuxiliaryEditorPartAt` | New-window intent is configured `dragToOpenWindow` inverted by Alt. Group end checks origin/intent/global hover, then samples cursor, refuses a point inside the visible focused active window, offsets by half element width and approximately 30px titlebar plus half element height, clamps left/top to display bounds, and creates an auxiliary editor part. No positive desktop-release or external-HWND test appears here. |
| [multiEditorTabsControl.ts, L1296–1400](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts#L1296), tab `DragAndDropObserver` callbacks | Saves selected-editor transfer and last drag event. Tab end reads/clears the transfer; requires new-window intent, no global app hover and remaining editor data; creates the auxiliary part, then moves/copies editors and focuses the target group. `dropEffect` is not a desktop classifier in this branch. |
| [workbench/browser/dnd.ts, L724–787](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/browser/dnd.ts#L724), `GlobalWindowDraggedOverTracker`, `isWindowDraggedOver` | Capture-phase window `dragover` sets one boolean true; `dragleave` clears it. Listeners cover the main window and registered auxiliary DOM windows. Changes broadcast across workbenches. This observes app drag events, not external windows or desktop identity; last-writer/nested-leave/stale-state limitations remain. |
| [base/browser/broadcast.ts, L11–70](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/base/browser/broadcast.ts#L11), `BroadcastDataChannel` | Uses browser BroadcastChannel with a storage-event/localStorage fallback. These are transport mechanisms, not native input hooks. Our experiment uses authenticated IPC instead; no durable localStorage is added. |
| [platform/dnd/browser/dnd.ts, L408–451](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/platform/dnd/browser/dnd.ts#L408), `LocalSelectionTransfer` | In-memory singleton keyed by prototype identity, holding editor/group objects. Not a cross-process authority. Our independent sandboxed renderers use main-issued one-use opaque tokens instead. |
| [workbench/browser/dnd.ts, L230–410](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/browser/dnd.ts#L230), `fillEditorsDragData` | Serializes editor/UI state into a custom editor transfer for cross-window DnD. `disableStandardTransfer` suppresses selected standard text/download/URI formats for new-window drags, not all custom data. We exchange only an opaque fake-tab token. |
| [base/browser/dom.ts, L2098–2164](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/base/browser/dom.ts#L2098), `DragAndDropObserver.registerListeners` | Handles nested enter/leave bookkeeping and drag duration. The dragend listener resets counters and invokes its callback; no Escape-versus-release discrimination is added to that callback. This is distinct from the global tracker's simpler capture listeners. |
| [host/electron-browser/nativeHostService.ts, L180–182](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/services/host/electron-browser/nativeHostService.ts#L180) and [nativeHostMainService.ts, L404–409](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/platform/native/electron-main/nativeHostMainService.ts#L404), `getCursorScreenPoint` | Renderer host delegates to native-host IPC. Main calls Electron `screen.getCursorScreenPoint()` and `screen.getDisplayNearestPoint()`, returning point and display bounds. The “native host” name does not mean a Win32 release/cancellation API is used in this path. |
| [browserHostService.ts, L584–586](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/services/host/browser/browserHostService.ts#L584), `getCursorScreenPoint` | Browser-only host returns undefined. The editor helper falls back to drag event screen coordinates. This fallback provides no additional outcome guarantee. |
| [editorParts.ts, L164–176](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/browser/parts/editor/editorParts.ts#L164), `createAuxiliaryEditorPart`; [auxiliaryEditorPart.ts, L126–202](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/browser/parts/editor/auxiliaryEditorPart.ts#L126), `create` | Instantiates the auxiliary part, awaits auxiliary-window service opening, builds the editor DOM and registers it. This happens after the drag-end guards, not by handing an ongoing drag to a native move loop. |
| [browser auxiliaryWindowService.ts, L276–428](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/services/auxiliaryWindow/browser/auxiliaryWindowService.ts#L276), `open`, `openWindow`, `createContainer` | Opens about:blank with size/position/features, registers the Window, and supplies DOM/styles from the owning workbench context; even element creation is constrained to the owning JS context. This opener-controlled workbench architecture is unlike our independently loaded sandboxed pages and cannot be transplanted as a dependency-free singleton object transfer. |
| [electron-browser auxiliaryWindowService.ts, L161–187](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/services/auxiliaryWindow/electron-browser/auxiliaryWindowService.ts#L161), `resolveWindowId`, `createContainer` | Registers the auxiliary through a dedicated IPC/preload path and applies zoom before delegating container construction. Useful lifecycle pattern, not input-outcome evidence. |
| [code/electron-main/app.ts, L593–615](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/code/electron-main/app.ts#L593) and [auxiliaryWindowsMainService.ts, L50–104](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/platform/auxiliaryWindow/electron-main/auxiliaryWindowsMainService.ts#L50) | `setWindowOpenHandler` permits about:blank with main-computed BrowserWindow options. Main claims created windows through browser-window-created/did-create-window and registration IPC. These are ordinary Electron APIs with workbench-specific authorization/preload/options code. Our popup denial remains intact. |

The inspected path uses HTML drag events, browser window registries/transports,
Electron IPC/screen/window creation, and application editor state. **No Win32
WindowFromPoint, global key/button hook, QueryContinueDrag outcome or native move
loop was found in this detach decision path.** This is a bounded source conclusion,
not a claim about every native facility elsewhere in VS Code.

There is no affirmative “left onto desktop” signal: absence of current workbench
hover plus the focused-window containment guard is a heuristic for permitting
creation. No explicit Escape/cancel flag guards the inspected editor-end branch.
Whether actual Chromium/Windows event sequencing happens to suppress a particular
Escape case in VS Code is **unverified here**. We do not label VS Code itself a
native failure from source inspection. External apps, taskbar and empty desktop
are not distinguished by those guards.

## Implemented guarded probe

Launch `node experiments/m0-tab-drag/launch.cjs`, then select **VS Code-inspired
guarded probe (M0.5)** in either window. Pointer and ordinary HTML modes remain
available. The two sandboxed windows, fake IDs, startup visibility diagnostics,
temp isolation, close/minimize timers and original cancellation rules remain.

The implementation is intentionally small and documented:

- `renderer.js`: native HTML adapter for both HTML strategies; capture-phase
  window-wide dragover/dragleave/drop reports, source drag and window pointerup
  telemetry. Body hover does not accept a drop. No token is read during hover.
- `model.cjs`: monotonic dragId for correlation, per-window hover hints, and the
  upstream last-over/last-leave boolean. `trackDrag` cannot authorize transfer.
  `finishVscode` evaluates no-global-hover/not-in-focused-window, reports the
  candidate, invalidates the token and preserves source. Actual app drop uses the
  same exactly-once ownership move as HTML mode. Wrong-source, expired, stale
  generation and replay requests reject.
- `main.cjs`: derives reporting window from the exact sender/frame/document guard;
  samples main cursor DIP and native focused-window bounds at end, logs intersecting
  eligible app rectangles as **hints**, not topmost-surface evidence. Correlates
  evidence with dragId and a monotonic sequence/time. No foreign ID or native
  handle bridge, native addon or extra dependency is exposed.
- `vscode.test.cjs` and `vscode-smoke.cjs`: deterministic ambiguity/safety tests and
  disposable integration of the real preloads/DOM with explicitly artificial input.

This adapts the ideas, not the upstream workbench implementation. Main IPC replaces
BroadcastChannel; a per-window set accompanies the simple upstream boolean to
expose disagreement. All registered app windows contribute regardless of focus.
Our focused native-window DIP containment avoids mixing DOM screen units with
Electron DIP. New-window intent is implicit only while the explicitly named third
mode is selected; VS Code's Alt/config/move-copy policies are not reproduced.
There is no persistent reading-state handoff or third-window readiness protocol.

All forwarded M0.5 drag/track/terminal signals are recorded without dragover/drag
sampling, subject to the existing explicit 100,000-record cap. Main order is IPC
receipt order; it is not a total order over OS input across processes. DOM event
delivery may stop during an OS drag loop. Source events and window tracking can
interleave; nested leaves can clear hints, or a missing leave can leave stale true.
Cursor samples still run at 10 Hz for diagnostics and are **position only**. End
sampling happens after IPC latency. None of these gaps can be filled by inference.

Outcome classifications:

| Classification | Meaning / action |
| --- | --- |
| `APPLICATION_DROP_COMMITTED` | Authenticated eligible strip drop consumed the opaque token once. |
| `CANCELLED_ESCAPE_OBSERVED` | App received Escape; cancellation is terminal, subsequent end/drop cannot detach. No claim that all Escape presses are observable. |
| `AMBIGUOUS_OUTSIDE_CANDIDATE` | Upstream-style guards would permit creation, but actual release/destination is unproven. Preserve source, create no window. |
| `AMBIGUOUS_OUTSIDE_AFTER_FOCUS_LOSS` | Same uncertainty plus recorded source focus loss. Preserve source. |
| `WORKBENCH_GUARD_SUPPRESSES_CANDIDATE` | Tracker/focused containment blocks the heuristic. This does not identify release versus cancellation. |
| `CANCELLED_OR_AMBIGUOUS_NO_TRANSFER` | Lifecycle, expiry, reset/mode/capture/other terminal invalidation. No release proof. |

`upstreamWouldOpen` is a prediction of the selected inspected guards with valid
local transfer and new-window intent assumed. It is **not** a prediction of all
VS Code behavior, nor a desktop-release classifier. External dropEffect move is
also insufficient. No ambiguous result consumes ownership into another window.

## Executed evidence and comparison

Final automated run `youtube-comments-m0-ToIj38`, Electron **44.4.5**, Chromium
**152.0.7977.130**, embedded Node **24.21.0**, Windows **10.0.26300**, x64.
The raw NDJSON is retained in that owned OS-temp run; no real desktop gesture was
performed by Codex. Exact selected sequences from that **synthetic** run:

| Run event range / dragId | Delivered sequence / result |
| --- | --- |
| Ends seq 117 / dragId 4 | prepared → started → peer capture dragover → peer strip drop → `APPLICATION_DROP_COMMITTED`; replay rejected, source removed once. |
| seq 135–136 / dragId 5 | prepared → started → app over → app leave → dragend none; stub cursor (-10000,-10000), no hover, focused A does not contain it → `upstreamWouldOpen=true`, `AMBIGUOUS_OUTSIDE_CANDIDATE`, source retained, still two windows. |
| seq 146 / dragId 6 | prepared → started → synthetic DOM Escape → `CANCELLED_ESCAPE_OBSERVED`; later dragend token rejected, no assessment/new window. |
| seq 154 / dragId 7 | prepared → started → real BrowserWindow minimize called by automated harness → terminal no-transfer; native input during an OS drag loop was not tested. |

The unit test giving identical observations to four different ground-truth
labels (desktop, unseen Escape, Notepad, taskbar) is an **information/safety test**,
not an assertion that Windows actually emits identical traces in every case.
Physical paired tests are needed to determine whether another reliable signal is
consistently delivered. An isolated native success would not make the heuristic
proof in untested focus/destination cases.

| Technique | Attachment | Outside termination | External occlusion |
| --- | --- | --- | --- |
| Original pointer | Works in owner's ordinary cases; geometry cannot authorize a safe target | Positive pointerup, when delivered, still does not identify desktop | **Owner-reported failure** under Notepad |
| Original HTML | **Owner-reported native pass** in tested cases | dragend none ambiguous, no detach | **Owner-reported native pass**: no incorrect transfer |
| M0.5 guarded HTML | **Automated pass**, native variant **REQUIRES OWNER VERIFICATION** | Upstream-style candidate logged; all ambiguous endings preserve source | OS-targeted recipient drop retained; no geometric transfer; native variant **REQUIRES OWNER VERIFICATION** |

Automated commands/results:

| Command | Result |
| --- | --- |
| `node --test experiments/m0-tab-drag/model.test.cjs experiments/m0-tab-drag/vscode.test.cjs` | **Automated pass: 32/32**, comprising original 22 plus 10 focused tests. Token/ownership/replay, tracker generations/disagreement, containment, ambiguity, focus, Escape and lifecycle safety. |
| `node experiments/m0-tab-drag/launch.cjs --smoke` | **Automated pass, exit 0.** Existing two-window visibility/recovery and original drag checks plus new peer tracking, explicit attachment/replay, ambiguous guard assessment, observed synthetic Escape and participant minimize. Cursor injection explicitly logged; no native drag certification. |
| `npm.cmd test -- src/renderer/WorkspaceTabs.test.tsx src/renderer/shortcuts.test.tsx src/preload/reader-bridge.test.ts src/main/reader-ipc.test.ts` | **Automated pass: 30/30, four files, exit 0**, unchanged tab/input/IPC/preload regressions without opening reader data. |
| `npm.cmd run typecheck`; `npm.cmd run lint` | **Automated pass, exit 0** for both; existing TS/TSX scope unchanged. |
| `node --check` for all experiment JS/CJS | **Automated pass**. |

The coding-agent network restriction required broader read access for pinned
public GitHub research; Electron/esbuild checks used the established broader
process access with renderer sandboxing intact. No database suite, production
entry, live extractor, packaged/installer smoke or owner profile was run/accessed.
Original full-suite results in the M0 report are historical, not rerun here.

## Acceptance answers and bounded next step

| Question | Decision and practical limit |
| --- | --- |
| 1. Can HTML attachment be used reliably? | **Yes as the preferred candidate for the owner's tested cases.** Preserve tokenized explicit recipient drop. New mode/lifecycle/mixed-DPI coverage still needs native tests; this is not a blanket product acceptance. |
| 2. Can desktop release be distinguished from Escape? | **Not established by these mechanisms.** Delivered Escape is cancellable; absence of Escape is not positive release. M0.5 physical comparison is **REQUIRES OWNER VERIFICATION**. |
| 3. Can external surface, desktop and eligible window be distinguished? | A genuine recipient drop identifies an eligible app strip. The inspected outside heuristic cannot distinguish desktop from Notepad/Explorer/taskbar. Rectangle intersection does not establish occlusion/z-order. |
| 4. Is VS Code directly adaptable? | Ordinary APIs and tracking ideas: yes. Full editor/opener/auxiliary architecture and heuristic correctness: no direct transplant. No special native release oracle was found. |
| 5. Is a Windows bridge necessary? | **Still unproven as a dependency**, potentially beneficial for explicit release/cancel and actual topmost destination. This investigation does not rule out every ordinary Electron design. No bridge, addon or global hook is authorized or added. |
| 6. Is a provisional window/native move loop more appropriate? | **Unproven, not the current recommendation.** It would be a different gesture adapter needing genuine move-loop completion/Escape/ownership evidence. Opening an auxiliary after HTML dragend does not implement it, and ordinary moved/move events are not release proof. Do not combine an OS HTML drag and native move loop speculatively. |

Execute the [M0.5 A–K Windows plan](../experiments/m0-tab-drag/MANUAL_CHECKLIST.md#m05-vs-code-inspired-guarded-probe-a-k)
starting with twenty interleaved desktop releases and twenty Escape-over-desktop
cancellations; then repeat Escape with another app focused. Stop after this
bounded comparison plus the listed external/taskbar/lifecycle/DPI cases. Preserve
actual sequences and classify each result. If the two actions remain ambiguous,
do not add timing thresholds, global shortcuts or phantom windows as workarounds.

**Next engineering step:** owner runs the new guarded strategy and supplies the
paired trace ranges. If ambiguity remains, make an explicit platform/UX decision:
a separately authorized narrow Windows release/cancel/topmost-hit-test spike, or
an owner-approved change to desktop-detach interaction. A native move-loop study
is another separately scoped option, not an assumed fix. Full browser-like desktop
detachment remains unproven without native integration. M1 can proceed independently
when separately requested; it was not begun here.

Changes are limited to `experiments/m0-tab-drag/` plus relevant M0/M0.5 documentation.
No production reader architecture/UI, schema, profile, dependencies, installer,
commit, push or publication changed. No upstream code blocks or workbench libraries
were imported into the implementation.
