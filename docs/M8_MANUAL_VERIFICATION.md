# M8 physical native verification

Status on 2026-10-19: **NOT PERFORMED**. Automated M8 DragEvents are category A.
This checklist establishes separate category B (authentic OS drag loop) and category
C (physically performed mouse/keyboard) evidence. Never infer B/C from A results.
M9.2 retains this status: real-app README screenshots, injected native key events,
cursor samples and Electron compositor captures do not complete this matrix.

## Disposable launch

Build first with `npm.cmd run make:zip`. From this repository run:

```powershell
node scripts/manual-tab-drag.cjs
```

This launches the real production entry with a new marked OS-temp demo profile,
isolated Chromium paths and three equal readers. It supplies offline thumbnail
fixtures, never selects the owner's profile, never executes Setup and installs
nothing. Use Library to open the demo video/post in B/C; duplicate a video in B.
Retain the printed root and `native-evidence.ndjson`. The ledger records only runtime,
display/window and safe transfer-intent outcomes, without bearer tokens or content.
It does not certify physical ground truth; record that separately below.

After File > Quit, resume the **same marked temporary root** using the command
printed by the launcher:

```powershell
node scripts/manual-tab-drag.cjs --resume "C:\Users\YOUR-NAME\AppData\Local\Temp\reader-m8-manual-XXXXXX"
```

Only a marked root created by this launcher directly under OS temp is accepted.
Keep it until results are reviewed. Backup destinations, if testing backup/restore,
must be within that root. No production-profile files or live extraction are needed.

## Physical matrix

Record observed result, timestamp range, window identities and environment for each
row. Mark unavailable displays/actions **Not tested**. Failed assertions are failures,
not native passes. Repeat directions A -> B, B -> A and C -> B where appropriate.

| ID | Physical action | Expected result / evidence to record |
| --- | --- | --- |
| P01 | Click tabs quickly, use right/middle buttons, close and context menus | Ordinary click activates once; no accidental drag/window. Only primary mouse begins dragging. Middle/secondary behavior remains unchanged. |
| P02 | Drag each discussion, Library and Settings left/right; drop in every gap and both end slots | One final reorder, same identities/active discussion/scroll. Drop back at original slot has no topology change. Native ghost is present; insertion indicator follows current slot. |
| P03 | Overflow a strip using Duplicate Tab; hover at left/right edges; wheel horizontally/vertically | Strip auto-scroll reaches far slots; no reader-panel scroll/focus jump or duplicate reorder. Release after scrolling chooses the displayed slot. |
| P04 | Drag video then post from A to populated B, before a middle tab and at both ends | Original instance attaches at exact recipient-local position, activates after COMMIT; no duplicate/restart query. Reverse move works. |
| P05 | Attach beside an independent same-item duplicate in B | Both original identities survive independently, no normal-tab merge. Shared seen/Undo still updates both. |
| P06 | Apply Unseen, change a comment's seen state from another copy, leave an unsubmitted search draft, collapse replies, navigate/scroll and bulk-select | Move preserves frozen matches/order/stale flag, draft/applied, sort/collapse, logical anchor/navigation and bulk/range selection. No query reevaluation or seen write merely from dragging. |
| P07 | Transfer Library and Settings to windows containing those tabs; edit custom translation source/target drafts first | Singleton merge retains target filter/draft. Dirty source offers Keep editing or explicit discard. Keep editing retains source exactly. Discard moves only to the already offered window/slot. |
| P08 | Drag outside to exposed desktop and release | Guarded detach creates one normal equal window near cursor, clamped to current work area. Original view remains, source stays open even when empty. Record observed hotspot/focus/ghost/cursor visuals. |
| P09 | While held inside source/recipient app press Escape, then release | Delivered cancellation keeps source with no transfer/window. Record whether native Escape delivery actually occurred; do not infer it from absence of a move. |
| P10 | Interleave 20 desktop releases with 20 Escape-outside endings; repeat after Alt+Tab to another app | Record physical ground truth and actual detach/no-detach for every trial. **Escape-outside detach is accepted ambiguity**, never label it correct Escape detection. |
| P11 | Cover B's strip with Notepad; release at covered coordinates | No attachment to covered B. A new detached window may result from outside heuristic; record it accurately. Geometry must never choose B as target. |
| P12 | Minimize/hide B before and during drag; release where its strip was | No B attachment. Record source retention or guarded new-window outcome; no phantom restore member. |
| P13 | Release over another application's body/title bar and taskbar | No attachment to a reader selected by geometry. Record whether heuristic detached; desktop/foreign/taskbar are not reliably distinguished. No content/path/text is exported. |
| P14 | Alt+Tab during drag, return before release; then release with another app focused | Record actual native termination/drop/hover behavior and outcome. Blur alone should not prematurely cancel valid attachment; no guaranteed native-loop claim from automation. |
| P15 | Close source or destination while held; use second operator if necessary | Precommit cancellation retains committed source topology (or its ordinary acknowledged Close state); no duplicate/hidden reader leak. Record if OS deferred Close until drag ended. |
| P16 | Reload/crash recipient during held drag or transfer preflight; begin backup/restore or Quit during drag | Cancel before COMMIT; source usable after cancelled operation. Restore fences all old gestures. Quit/relaunch recovers exactly committed membership/owners. |
| P17 | Rapid repeated drags, double release, Escape then immediate second drag | No stale token/end/hover can move or cancel the next gesture. No second detach after accepted attachment. |
| P18 | Repeat at 100%, 125%, 150%, 200% Windows scaling where available | Report each actual scale/display. Ghost, slot, cursor/hotspot and new window remain sensible/reachable; no global DPI multiplier. |
| P19 | Drag both directions across displays with different scaling; repeat with source maximized/fullscreen | Exact recipient slot; detached reader opens normal near release cursor and focuses once. Report actual display IDs/work areas/scales. |
| P20 | Negative/above-primary monitor coordinates; taskbar moved; small work area; remove display between drag and new-window loading | New reader remains wholly reachable within a current work area; no restore-member leak on failure. Mark unavailable topology changes Not tested. |
| P21 | Source and target at different app zoom levels | Recipient-local insertion remains exact; source hotspot is approximate and correctly converted from source zoom to DIP. |
| P22 | File > Quit after moves/detach, resume same temp root, backup, mutate topology, restore and relaunch | Exact final committed windows/IDs/order/active state/private semantics survive. Transient selection/results reconstruct normally after process restart. |
| P23 | Home/End/Arrow, Alt+Arrow, Shift+F10, Duplicate and both explicit Move commands; type in Library/search/Settings between drags | Keyboard alternatives remain usable. No tab gesture steals editing focus during ordinary typing; no focus ends on hidden old panels. English/Polish announcements convey start/drop/cancel/moved. |
| P24 | After transfers, Close one window with peers remaining (menu and Ctrl+Shift+W); Quit with Ctrl+Shift+Q, then resume the same temporary root. Repeat with last-window Close. | Ctrl+W closes only a tab. The deliberately closed peer is absent after restart; Quit preserves every window still open with exact tab order/active view. Last Close retains its one window. Repeat after backup/mutation/restore. |
| P25 | With a populated surviving reader visible, physically Close a peer repeatedly using its X, menu and Ctrl+Shift+W; record the desktop at the display's normal frame rate in light/dark and EN/PL. | No former black/full-screen Close overlay flicker or survivor reload. Keep before/during/after frames, runtime, display scale and refresh rate. A long drain may legitimately show themed progress; a failure must retain the window and usable error/Retry. Automated M8.2 compositor equality is separate evidence. |

## Observation ledger (copy a row per actual trial)

M8.1 follow-up within P02/P04/P17/P23: after drag/reorder and after keyboard menu
dismissal, check that keyboard focus surrounds the whole tab without a vertical
edge immediately left of Close. Drag into a completely empty reader's labeled
drop area, leave it, cancel and repeat in both directions. Check its hover
highlight clears. In English/Polish, open Move to Window, compare source title and
destination tab counts/active titles, select rows with arrows/Space, cancel with
Escape, then confirm separately with Move. Repeat with long titles, a narrow
window/app zoom and dirty Settings preserve/discard. These remain pending physical
checks; the M8.1 Electron regressions do not establish a native OS drag-loop pass.

| Date/runtime/OS | Category B/C | ID/repetition and physical ground truth | Source/target + display/work area/scale/zoom | Ledger timestamp range | Actual result and failure details |
| --- | --- | --- | --- | --- | --- |
| Not performed | Not performed | P01-P25 pending | Inventory below only | None | No physical pass claimed |

For the owner review, begin with P02/P04/P08/P09–P14 (authentic drag outcomes),
P18/P19 (available mixed DPI), and P24/P25 (session policy and former flicker).
Use the remaining rows for the full acceptance pass. Record failed and ambiguous
trials as well as successful ones. P10's unobserved Escape-outside detachment
remains accepted policy; this checklist does not change it into a cancellation
guarantee. Record the tested artifact/source revision and exact launch command in
the ledger. Leave unavailable monitor configurations pending.

Original M8 automated inventory: work areas (0,0) 1920x1032 at 100%;
(1920,0) 1920x1032 at 100%; (3840,0) 1280x672 at 150%. This establishes
availability only. 125%, 200%, negative/above-primary layouts, unplug/reconnect,
physical ghost/cursor and mouse-loop behavior have not been exercised.
