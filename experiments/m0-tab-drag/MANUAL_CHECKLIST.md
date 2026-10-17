# M0 Windows native input checklist

The original M0 checklist/blank ledger below is retained as historical evidence.
The owner has since reported native HTML attachment/occlusion passes and pointer
occlusion failure; see [M0.5 evidence](../../docs/MULTI_WINDOW_M0_5_FEASIBILITY.md#evidence-carried-forward).
Every **new M0.5** native case is **REQUIRES OWNER VERIFICATION**. No personally
verified native pass is recorded by Codex. The automated smoke is separate
evidence. Use physical mouse input, not DevTools dispatch, CDP, scripts,
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

## M0.5 VS Code-inspired guarded probe A-K

This is the new strategy's bounded test plan; earlier M0 observations do not count
as its native pass. Status for every row: **REQUIRES OWNER VERIFICATION**.

1. Run `node experiments/m0-tab-drag/launch.cjs` without `--smoke`. Confirm A/B
   visible and available; use V01–V05 if necessary. Select **VS Code-inspired
   guarded probe (M0.5)**, and verify the warning that no third window will open.
   Arrange both strips side by side and fully visible. Keep the printed owned
   run directory; record Electron/Chromium/Windows and real display scales.
2. Reset before each trial. Press primary mouse on A-1 and pause about 250ms to
   allow token preparation, then drag. Repeat A→B and B→A where applicable.
   Emptying/moving fake tabs is volatile; there is never reader data. Relaunch
   after a participant closes. Existing pointer/HTML modes remain available for
   targeted comparison; do not switch strategies during a trial.
3. Record **ground truth separately**: what physical button/key was pressed or
   released, which app owned keyboard focus, cursor surface, trial ID, direction
   and real monitor scales. Do not feed a ground-truth label into the detector.
   Preserve raw `events.ndjson`; identify seq ranges and dragId. The log's seq/ms
   is main receipt order, not an OS-global event order. Record any lost/not-delivered
   keys or stalled dragend as missing evidence, not successful cancellation.
4. Record native outcome and detector classification separately. No transfer or
   new window on an outside end is expected safety behavior, **not a successful
   desktop-detachment implementation**. `upstreamWouldOpen=true` only reports the
   inspected guard result, never proof of release or where Windows dropped.
5. Bound the run: interleave **20 C and 20 D trials**, then **10 E trials**. For A,
   B and F–K, use five repetitions per available direction/configuration. Missing
   equipment or an OS operation that cannot be performed gets **Not tested**.
   Preserve failures; do not keep retrying until only passing samples remain.

| Case | Exact physical test | Evidence / expected safe behavior |
| --- | --- | --- |
| A — Reorder | Drag A-1 after A-3 and release in the strip; drag back before A-2. | One `APPLICATION_DROP_COMMITTED` per recipient drop; each fake ID appears once, no new window. Record native ghost/cursor as visuals only. |
| B — Attach | Drag from A to B's visible strip, hover for one second, release; reverse. Repeat end/middle slots. | Capture-phase `vscode-window-track` over/drop, eligible `drop-evidence`, then one `vscode-html-target-drop`. Token is consumed once. Source node remains until native dragend; late dragend must not detach. |
| C — Desktop release | With source keyboard focus, drag onto clearly empty exposed desktop, hold one second, release primary mouse **without Escape**. | Record source `dom-drag`, app leave/global/per-window hints, `dom-dragend`, main cursor/focus and `vscode-detach-assessment`. Source stays put. Record whether candidate=true or a guard suppresses it; neither proves release. |
| D — Escape over desktop | Use the same desktop spot/path as C. Keep primary held, press Escape, wait one second, then release primary. Do not click elsewhere until evidence is recorded. | Compare with paired C. If Escape is delivered, expect terminal `CANCELLED_ESCAPE_OBSERVED`; no later button release/end may move anything. If Escape is not delivered, record the actual assessment/missing terminal, especially a candidate identical to C. |
| E — Escape with external keyboard focus | Begin the same drag, Alt+Tab to Notepad/Explorer so it owns keyboard focus, move/keep cursor over desktop, press Escape while primary remains held, wait one second, then release. Return only after the trial. | Record actual focus/Alt/Tab/key/capture/end delivery. A silent Escape is not a release. If Windows cancels drag during Alt+Tab before Escape, record that sequence rather than calling the intended Escape scenario a pass. |
| F — External surface | Drag over File Explorer client area and release. Repeat over Notepad client area and title bar, including prohibited-cursor areas. | No app recipient drop, no transfer/new window. Record if `upstreamWouldOpen` matches C despite a different surface. External dropEffect none/move cannot prove desktop release. |
| G — Covered destination | Cover B's strip fully with Notepad; keep A visible. Drag A-1 and release at covered B strip coordinates. | No B recipient drop or ownership move. Compare real window tracking with `eligibleWindowRects` hints. A rectangle hit is not actual z-order evidence. If tracker says no app over but rectangle includes B, retain both observations. |
| H — Taskbar | Drag from source and release over empty Windows taskbar space, then over a taskbar app button if acceptable. | No transfer/new window. Record any taskbar preview/focus changes and whether end guards look identical to C/F. |
| I — Alt+Tab | Hold drag, Alt+Tab away and back without Escape; repeat releasing while external app is focused. | Main/DOM focus signals and eventual terminal classification; blur is uncertainty, not release/cancel proof. A later explicit app drop may commit if the token remains valid; lifecycle cancellation is terminal. |
| J — Displays/DPI | Repeat C/D and B in both directions across available physical 100/125/150/200% display pairs; include a negative-origin display if already configured. | Record DOM screen/client data, cursor DIP/physical/roundtrip, focused native bounds, matching display and exact terminal sequence. Browser zoom/emulation is not mixed-DPI evidence. Unavailable pairs get Not tested. Wrong slot/target or mismatched cancellation is Failed. |
| K — Lifecycle | From A schedule Close other, promptly drag from A and hold past three seconds. Relaunch; schedule Close this from A and repeat. For target minimize schedule Minimize other in A. For source minimize, schedule Minimize other in B, then immediately start the drag in A. | Compare scheduled/fired timestamps with native drag termination. Closing/minimizing either participant cancels; no phantom tab/window. If the OS drag loop delays the scheduled action until after termination, mark concurrent lifecycle scenario Not tested. Peer remains usable; relaunched windows remain equal. |

For C/D/E the primary question is whether **all** runs expose an independent,
reliable cancellation/release distinction, including delayed button release after
Escape. `dragend none`, source `drag` buttons, missing keydown, timeout, lost
capture and cursor movement alone are not that distinction. If traces overlap,
record **Failed as a desktop-detachment discriminator**, while also recording
that preserving ownership passed its safety requirement.

Record each result using:

| Date / observer | Run / seq range / dragId | Case / repetition / mode | Ground truth / keyboard focus / surface | Monitors/scales | Exact delivered event sequence | Classification / upstreamWouldOpen | Ownership/window result | Native status / safety status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | New A–K pending | — | — | — | — | — | REQUIRES OWNER VERIFICATION |

Use **Personally verified native pass** only for behavior you physically
observed; **Owner-reported native pass** records the earlier findings supplied
to Codex. Other statuses remain Automated pass, Failed, Not tested and Requires
owner/manual verification. Never promote a synthetic result to a native pass.

Stop after the bounded matrix. If ambiguous cases remain, return the trace ranges
for a platform/UX decision. Do not treat continued heuristic tuning, timed detach,
phantom auxiliary windows or a native move loop as an automatically authorized
next step. No production data, Setup.exe or new native dependency is involved.
