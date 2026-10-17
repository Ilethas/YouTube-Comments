# M0 Windows native input checklist

Current status of **every native case below: Requires owner/manual verification**.
No personally verified native pass is recorded by Codex. The automated smoke is
separate evidence. Use physical mouse input, not DevTools dispatch, CDP, scripts,
Electron sendInputEvent, remote input automation or the `--smoke` option.

## Setup and evidence

1. From the repository, run `node experiments/m0-tab-drag/launch.cjs` in PowerShell.
   Record its temp directory. Confirm both titles say **M0 fake tabs** and each
   strip has A-1/A-2/A-3 or B-1/B-2/B-3. No reader should start.
2. Record Windows version, physical mouse type, local/remote session, monitor
   arrangement, primary monitor, OS scale on each display, and harness runtime
   values. `events.ndjson` records Electron/Chromium/Node/OS plus display IDs,
   bounds/work areas/scales. Do not infer a native pass from that inventory.
3. Arrange A and B side by side, their strips fully visible. Start with the current
   display configuration; do not change OS settings unless you want to perform the
   optional topology tests. Use Reset before each case. Changing technique cancels
   an active gesture. Relaunch for two fresh windows after closing either.
4. Run each basic case **five times per technique**, A→B and B→A. For desktop
   release and Escape-outside, run **twenty times each per technique**, including
   quick and slow crossing. Record all runs, not just successes. Physical human
   observation is required to label which run used release versus Escape.
5. Preserve each `events.ndjson` and record the relevant sequence range. At 100,000
   records the log explicitly caps; relaunch instead of treating missing evidence
   as success. Never edit the raw log. Record expected action, actual placement,
   termination sequence, duplicates, stalls and visual/focus effects separately.

Signals of interest: `dom-pointerup`, `release-evidence`, `dom-pointercancel`,
`dom-lostpointercapture`, `main-key`, `dom-keydown-escape`, `window-blur`,
`dom-dragend`, `drop-evidence`, `outcome`, `cursor-sample-not-button-state`.
The `trusted` field is supporting telemetry, not proof that input was human.
Cursor samples report position only; neither silence nor a timeout means release.

## Window A startup/visibility follow-up (before dragging)

All cases remain **Requires owner/manual verification**. Automated native-state
queries do not establish which windows Windows shows in Alt+Tab.

| ID | Exact action | Expected result and evidence to preserve |
| --- | --- | --- |
| V01 | Launch normally with the command above, without `--smoke`. Wait for startup; repeat three fresh launches, closing both windows between runs. | A and B both appear; A is shown without activation, then B is brought forward. Record any startup error. Main waits at most 10 seconds per window for page load and first validated layout; no indefinite hidden startup is expected. Preserve `window-created`, readiness, both `window-show-request`/`window-show`, and `startup-windows-shown` events. |
| V02 | Press Alt+Tab after a fresh launch and inspect the entries, including an app group if Windows groups them. Switch to A, then B. | Verify both independent windows are available in the OS task switcher. Record what Windows actually shows, not just the native diagnostic booleans. This is owner-only evidence. |
| V03 | In B expand Native window diagnostics. While idle, click **Show/focus Window A**. Repeat after minimizing A via its native button. | A is visible and focused; minimized A is restored. The button uses the existing A and creates no third window. Record `diagnostic-show-a`, `window-show`/`window-restore`/focus events and post-action snapshots; inspect both bounds, renderer readiness and current displays. |
| V04 | If only B appears again, capture its Native window diagnostics before using the recovery control, then click **Show/focus Window A** and check Alt+Tab again. | Keep the complete NDJSON from this owned run and report whether A was visible/minimized/destroyed, where its bounds were, whether its renderer was ready, and whether recovery changed desktop/task-switcher visibility. A native visible=true value alone does not resolve the symptom. Do not open any application profile/database. |
| V05 | Close A intentionally, then click **Show/focus Window A** from B. Close B and relaunch for normal drag testing. | An unavailable-A message; no replacement window. Closing either existing window must continue to leave its peer usable. Repeat N02 and N03 in both techniques after relaunch to check dragging remains intact. |

There is no automatic focus/show polling after startup that can raise A during a
drag or fight the minimize/close experiments. A diagnostic show request during an
active drag is rejected as `DRAG_ACTIVE`. Only the explicit idle recovery control
changes A's visibility after startup.

## Basic input matrix (run in both modes)

| ID | Exact physical action | Safe outcome and observation to record |
| --- | --- | --- |
| N01 | Click A-1 without moving; then move less than 6 CSS px and release | No reorder/transfer. Record whether a drag started; HTML uses Chromium's native threshold, pointer uses 6 CSS px. |
| N02 | Drag A-1 after A-3, release in strip; then drag it back before A-2 | Exactly one reorder per release; all fake IDs occur once. Record pointer capture and terminal event order, or native HTML drop/dragend order. |
| N03 | Drag A-1 over the middle and both end slots of B's visible strip; hold for one second, release | One B insertion and A removal, no duplicate. Pointer outcome must retain its geometry-only warning. HTML requires a target `drop-evidence`; dropEffect alone is insufficient. Repeat reverse direction. |
| N04 | Drag out to a clearly exposed, empty desktop area, hold one second, release primary button; do not press Escape | No third window is created in M0. Record whether pointerup actually reaches source, release button/buttons, cancellation/capture/focus signals, and HTML dragend. A pointer outside-release outcome has **unknown destination**; the observer's record identifies desktop. |
| N05 | Drag over empty desktop, keep primary button held, press Escape, wait one second, then release primary button | No transfer/window. Record whether Escape reaches DOM/main, lost capture, dragend and any later pointerup. Compare N04 with N05. A later release must not be mistaken for successful detach after Escape. |
| N06 | Start drag inside source strip, press Escape while primary stays held, then release | No placement mutation. Escape/lost-capture cancellation remains terminal even if release arrives later. |
| N07 | Drag onto a blank area of B below its strip and release; repeat over source body | No transfer. Record whether it is misclassified as a strip drop. Outside an eligible strip is not synonymous with desktop. |
| N08 | Drag over Notepad (or another ordinary app), release on its client area; repeat over its title bar and Windows taskbar | No application tab transfer/detach. Record external acceptance/dropEffect and pointer release. Compare with desktop: can the harness distinguish them? Do not enter private text into the experiment. |
| N09 | While holding a drag over desktop, Alt+Tab to another ordinary app; return to A before release; repeat releasing while that app is focused | Pointer blur makes release inconclusive and preserves placement. HTML may continue OS drag or terminate; require target-delivered drop for an app move. Record keys delivered, blur, capture, and eventual outcome. |
| N09b | Start a drag, Alt+Tab so another app has keyboard focus, press Escape while primary stays held, then release | No detach/transfer. Record whether the harness sees Escape, capture loss, another terminal or only expiry. This distinguishes outside keyboard focus from N05's outside cursor position. |
| N10 | Start a pointer drag, then cause focus loss by clicking another app with a second operator/device if available; HTML: repeat ordinary focus switches | No mutation from focus loss alone. If unavailable mark Not tested. Record actual sequence rather than assuming blur equals release. |
| N11 | In pointer mode open Manual use controls, click **Release source pointer capture after 3 seconds**, promptly start a drag and hold past 3 seconds; then release | Cancellation, no move. Record lostpointercapture and later release. This is a deliberate in-app capture-loss stimulus, not a native OS cancellation pass. HTML: observe natural pointercancel at dragstart; it must not itself abort the independent HTML adapter. |
| N12 | Try right-button-only and middle-button-only dragging; then start a left drag, press/release right or middle while left stays held, finally release left | No secondary-button initiation; chords cancel pointer path. Record any native context menu/HTML drag behavior. No transfer from a stale earlier preparation. |

## Window visibility and lifetime (both modes)

| ID | Exact physical action | Safe outcome and observation to record |
| --- | --- | --- |
| N13 | Minimize B **before** starting A drag; release at the desktop location where B's strip used to be | No B transfer. Main candidates must exclude minimized B. No automatic unminimize/focus. |
| N14 | Cover B's strip completely with Notepad, keeping A visible; drag from A and release at covered strip coordinates | HTML should have no B drop. Pointer may incorrectly transfer using B's rectangle: record **Failed** for reliable target selection if it does. This is a deliberate falsification test of geometry-only targeting. Do not accept the warning as a native pass. |
| N15 | Overlap A's and B's strips, start a drag, release in the overlap; then reverse their z-order and repeat | Pointer must preserve placement as overlapping-strip ambiguity. HTML follows whichever surface actually receives drop; verify target matches the visible top surface. |
| N16 | In A's Manual controls click **Minimize other window after 3 seconds**, promptly start A drag and hold past 3 seconds; release | Cancellation/no move from a stale target. Compare scheduled/fired times to drag events. If the OS loop delays firing until drag ends, record Not tested for the concurrent path. Also try Alt+Tab to B and minimize if permitted. |
| N17 | In A click **Close other window after 3 seconds**, promptly start dragging from A and hold past 3 seconds | Active token invalidates when B actually closes. No peer insertion. A stays responsive. Relaunch afterward. Compare scheduled/fired times; an action delayed until after the drag does not verify concurrent closure. Alt+Tab/Alt+F4 is an additional physical alternative. |
| N18 | In A click **Close this window after 3 seconds**, promptly start A drag and hold past 3 seconds | Source's volatile fake tabs disappear with that window; no spontaneous B insertion. B remains usable; closing B exits. Relaunch and reverse roles. Record actual firing versus termination times. This does not test durable M7 recovery. |
| N19 | Start drag, resize/move target before release if physically possible (second operator), then release near its old/new strip edges | Old geometry must not transfer. Log bounds/layout updates and candidate point. Repeat after maximizing/restoring target. |

## Coordinates and physical display scales

Do not substitute browser zoom, emulated device scale or mocked screen APIs for
these checks. Unavailable monitors/settings get **Not tested**, not pass.

1. Repeat N02–N06, N08, N13–N15 with A and B on different physical displays at
   100%↔125%, 100%↔150%, 100%↔200%, then reverse direction. Include displays left
   of/above the primary (negative origin), if your existing layout supports it.
   Record actual available pairs; changing owner desktop settings is optional.
2. Release just inside and outside each strip edge/insertion midpoint after crossing
   a display seam. Compare `release-evidence.dip`, physical and roundtripDip with
   DOM client/screen telemetry and main content bounds. Roundtrip differences of
   a pixel from scale rounding are diagnostic; wrong target/slot is a failure.
   Never multiply DOM screen coordinates by a global scale to manufacture a pass.
3. Move each window between displays while idle, then repeat reorder/attach/drop.
   Record renderer `dpr`, strip layout, content bounds, display scale and focus.
4. Optional, only if acceptable to you: change primary monitor/OS scale or
   disconnect/reconnect a display during a held drag. The harness cancels on
   display changes. Verify no move from stale geometry, then relaunch/retest.
   Record unavailable cases as Not tested. There is no geometry restoration test
   in this milestone.
5. Pen/touch, screen-reader drag announcements, remote desktop, trackpad-specific
   gestures and Windows virtual-desktop switching are **Not tested** unless you
   deliberately characterize them separately. Pointer initiation is mouse-only
   in this spike, so it does not claim pen/touch support.

## Ledger to complete

Allowed status labels: **Automated pass**, **Personally verified native pass**,
**Requires owner/manual verification**, **Failed**, **Not tested**. A deliberate
capture-loss button can be recorded as a manual stimulus pass, but does not prove
OS cancellation. Only the person executing a physical native case may record a
Personally verified native pass for it. Preserve observer identity/date.

| Date / observer | Run directory / seq range | Case / repetition / technique | Windows / monitor scales | Ground truth action | Observed terminal events and placement | Status / limitation |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | All native cases pending | — | — | No native input executed by Codex | Requires owner/manual verification |

## Decision after the run

The smallest first experiment is N04 versus N05 on one display, twenty interleaved
repetitions each per mode. If pointerup survives genuine desktop release and cannot
be confused with Escape or a later button release, continue with N08/N09/N14.
Those test external destinations, focus loss and occlusion. Only then broaden DPI.

If indistinguishable traces, missing terminals or false target commits remain,
retain the failure logs. Do not convert `dragend none`, lost capture, cursor
position or timeout into detach. The next decision is a separately authorized
narrow Windows input/window-hit-test investigation versus an owner-approved change
in drag UX. No native bridge or reduced requirement is authorized by this checklist.
