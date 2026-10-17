# M0: native tab-dragging feasibility

2026-10-17, Europe/Warsaw. Experimental companion to the
[audit](MULTI_WINDOW_AUDIT.md) and [proposed design](MULTI_WINDOW_DESIGN.md).
This is a feasibility report, not a production architecture ADR or M1 implementation.

## Finding and acceptance status

**Full browser-like dragging using ordinary Electron on Windows remains unproven.**
The isolated harness and automated checks are complete. Native release/cancel,
external destination, focus, occlusion and mixed-DPI acceptance remains **Requires
owner/manual verification**. M0 has not cleared M8's native feasibility gate.
No personally verified native pass is claimed.

Pointer capture with main coordination remains a plausible candidate if real
outside pointerup/cancellation behavior proves dependable. Even then, ordinary
window rectangle tests do not establish OS z-order or distinguish empty desktop
from another application's surface. Native HTML DnD supplies a target-delivered
app drop, but its source terminal outcome does not provide reliable desktop-detach
intent. **An HTML-only `dragend none → detach` implementation cannot meet the
requirement.** These are evidence limits, not proof that a native bridge is required.

M1 **can proceed independently in a separately requested task**, retaining one
visible production window and testing authenticated caller context. Its safety
foundation does not depend on selecting M8's input adapter. M1 or later work was
not started here.

## Isolated experiment

Source: [experiments/m0-tab-drag](../experiments/m0-tab-drag/README.md).
Launch from the repository with installed dependencies:

```powershell
node experiments/m0-tab-drag/launch.cjs
```

Two equal, framed BrowserWindows, six fake tabs, no parent/primary relationship.
Only in-memory placement exists. Every run creates its own OS-temp
`youtube-comments-m0-*` directory; the launcher records an ownership marker and
main verifies the location before readiness. appData/userData/sessionData/logs/
crashDumps point inside that directory before Chromium starts. No production
profile path is resolved. No ReaderService, SQLite, real discussion, production
renderer state, real workspace, Forge build or application entry is imported.

The renderer has sandbox=true, contextIsolation=true, nodeIntegration=false and
webSecurity=true. The frozen preload exposes named harness intents only. Main
requires a registered live WebContents, exact mainFrame and exact expected document
URL, validates arity and exact bounded payloads, derives source/target from caller,
and checks fake ownership and tokens. No arbitrary filesystem, process, URL, SQL,
window-handle or channel bridge exists. CSP, an ephemeral session request allowlist,
denied permissions/downloads/navigation/popups/webviews keep the lab self-contained.
Smoke-only execution uses main-owned executeJavaScript; this is not a renderer API.

Tokens have 192 random bits, 120-second expiry, one active gesture and one
consumption. HTML prepares a token asynchronously on primary pointerdown and
serializes it synchronously at dragstart using only a namespaced custom MIME type.
A too-fast unprepared start cancels. The source DOM node is retained through the
HTML terminal event, including after an accepted fake transfer. Target reads the
token only at drop, never during protected dragover. No files, comment text, labels
or URLs enter OS drag data. Logs omit the bearer token.

Pointer capture belongs to the source strip. Main samples cursor DIP at 10 Hz and
on delivered pointerup, routes geometric candidate slots and performs the fake
move once. A six-CSS-pixel threshold is separate from Chromium's HTML threshold.
Hidden/minimized targets and layouts with stale content size/zoom are excluded;
multiple intersecting app strips are ambiguous. Single-target cross-window moves
are labeled `pointer-geometric-transfer-unverified-occlusion`, deliberately exposing
the incomplete target-selection assumption to falsification. They are not safe
production ownership transfers. Blur taints pointer termination; a later pointerup
is inconclusive. Capture loss, Escape when delivered, participant close/crash,
minimize/hide, reset/mode change and display topology changes invalidate the gesture.

Neither technique creates a third window. An outside primary pointerup records
`outside-release-observed-destination-unknown`, preserving all fake placements.
HTML dragend without a committed app drop records
`html-ended-without-app-drop-ambiguous` regardless of dropEffect. Expiry is also
ambiguous, never release evidence. Closing a fake window discards its volatile
tabs; this does not implement or test M7 durability or recovery.

Fixed three-second controls let a solo tester close the source, close the peer or
minimize the peer during a held drag. Main derives both participants; no window ID
or handle is accepted. Scheduling/firing timestamps expose any OS drag-loop delay,
so a timer firing after drag termination is not mistaken for concurrent-close
evidence. A deliberately released pointer-capture control covers the separate
capture-loss branch.

## Techniques and comparison

| Capability / evidence | Pointer capture + main coordination | Native HTML DnD + opaque token |
| --- | --- | --- |
| In-strip reorder | Threshold/capture/main insertion logic: **Automated pass**; physical gesture pending | Token/drop/insertion logic: **Automated pass**; actual native data-store/drag loop pending |
| Across two renderers | Geometry-only fake placement: **Automated pass** in core tests; occlusion unverified | Target-delivered synthetic drop through both real preloads: **Automated pass**; physical attach pending |
| Actual desktop release | Explicit pointerup could be useful if capture survives. Destination is still unknown. **Requires owner/manual verification** | A failed drag terminal alone is insufficient to distinguish release from cancellation. **Failed as a sole desktop-detach discriminator** (spec/API reasoning, not a native trial) |
| Escape inside app | Main/DOM cancellation routing and terminal-token tests: **Automated pass**; real delivery pending | OS should cancel drag, but DOM/main key delivery during OS loop is unverified; no-drop outcome preserves source |
| Escape outside app | No global key authority. Need actual cancellation/capture/late-release traces. **Requires owner/manual verification** | Escape and no accepted target can share `dropEffect=none`; no inference of desktop release |
| Alt+Tab/focus loss | Conservative ambiguity after blur; no detach/transfer. Ability to preserve a valid browser-like gesture pending | Source blur is logged; an authenticated recipient drop may still complete. Native event sequence pending |
| Lost pointer capture | Terminal cancel in pointer adapter; pointerup cleanup does not self-cancel a completed release | Pointercancel at HTML dragstart does not abort the separate HTML adapter |
| Source/target closes | In-memory token invalidation: **Automated pass**; target-close wiring passes smoke | Same; native closing during an active OS loop pending |
| Secondary/middle/chords | Primary mouse-only initiation; nonprimary/chord termination preserves placement. Core checks **Automated pass**, physical behavior pending | Preparation gates primary mouse; native button behavior/context menus pending |
| Minimized/hidden target | Excluded in deterministic candidate tests. **Automated pass**, physical tests pending | A target must be visible/nonminimized and receive a local strip drop; physical tests pending |
| Occluded target / z-order | A single geometrically matching but externally covered target may incorrectly accept: **known limitation**, N14 intentionally seeks failure | OS targeting should route to top surface; native verification required |
| DIP / scales | Negative origin/zoom/slot arithmetic **Automated pass**. Main uses per-point screen conversion; native scales pending | Recipient-local CSS insertion avoids source-to-target DOM screen conversion; cross-display drag image/targeting pending |
| Outside external app accepts drag | Outside strip cannot be identified as desktop; no detach | External move/copy/dropEffect cannot commit an app placement; no detach |

**Personally verified native pass: none.** All physical scenarios, including those
with automated coverage above, remain **Requires owner/manual verification**.
Pen/touch, remote sessions, assistive announcements, OS virtual desktops, actual
detach-window positioning/focus and native bridge integration are **Not tested**.

## Why the evidence cannot certify desktop detach

The [HTML drag processing model](https://html.spec.whatwg.org/multipage/dnd.html#drag-and-drop-processing-model)
has unsuccessful drag paths for cancellation and no accepted target. Thus a source
`dragend` with operation none does not identify the physical reason. The automated
state machine deliberately gives no-drop endings the same ambiguous result. A
human must label ground truth in the manual run; synthetic DragEvents do not enter
the Windows OS drag loop or its protected data-store lifecycle.

[Pointer capture](https://www.w3.org/TR/pointerevents3/#pointer-capture) retargets
pointer events within a browsing context. It supplies no general desktop hit-test
or global cancellation authority. A delivered primary pointerup is stronger
release evidence than dragend none, but it is not proof of an empty desktop
destination, nor does capture loss prove release. Actual Windows event delivery
outside native window bounds remains the decisive experiment.

The installed `node_modules/electron/electron.d.ts` (44.4.5) exposes
getCursorScreenPoint, screenToDipPoint/dipToScreenPoint, getContentBounds,
before-input-event and before-mouse-event. The
[screen API](https://www.electronjs.org/docs/latest/api/screen) documents cursor DIP
and per-point physical conversion. It supplies position, not global button state
or which external HWND is under the point. The
[WebContents events](https://www.electronjs.org/docs/latest/api/web-contents)
observe input dispatched to that WebContents; they are not global hooks.
Latest online documentation is supporting API/spec evidence, not a newer runtime
claim. Installed types and the recorded runtime establish the version tested.

All coordinates are explicitly distinguished: DOM client CSS, DOM screen telemetry
(recorded without assuming its scale), main content bounds/cursor DIP, converted
physical and roundtrip DIP. No global scale multiplier is used. Cursor position
sampled during IPC processing can lag the actual release; this race is another
manual limitation. Geometry alone cannot resolve external occlusion or desktop
identity, regardless of coordinate accuracy.

No global input hooks, native modules, addon rebuilds, extra dependencies,
global Escape registration, fullscreen/always-on-top capture overlays, file-drag
exports or hidden provisional windows were introduced. Ordinary APIs have not yet
been experimentally ruled out; any Windows integration would require a separately
explained and authorized increment after the focused native trials.

## Automated execution ledger

Commands from the repository, 2026-10-17:

| Check | Result and exact evidence boundary |
| --- | --- |
| `node --test experiments/m0-tab-drag/model.test.cjs` | **Automated pass: 22/22**, Node's test runner. Threshold/insertion, token ownership/expiry/replay, stale source, cancellation/ambiguous none, focus, participant closure, hidden/minimized/overlapping candidates, negative origins/zoom, exact authorization and malformed payloads. |
| `node experiments/m0-tab-drag/launch.cjs --smoke` | **Automated pass, exit 0.** Two real sandboxed windows; isolated Chromium paths; no Node/reader globals; prepared opaque MIME payload; synthetic cross-renderer drop; replay rejection; no-drop termination creates no phantom window; injected Chromium pointer capture/reorder with an explicitly stubbed cursor; popup denial; timed active target-close invalidation. No actual native drag pass. |
| `npm.cmd run typecheck` | **Automated pass, exit 0**, unchanged production source. Harness CJS/JS is outside the production TS include; its behavior is covered by the separate checks. |
| `npm.cmd run lint` | **Automated pass, exit 0**, unchanged `.ts/.tsx` scope. |
| `npm.cmd test` (broader-access retry) | **Automated pass: 928/928 tests, 74/74 files, exit 0**, 122.54s. Existing discovery/config/tests unchanged; separate M0 tests do not enter production Vitest discovery. |

Runtime from the successful Electron smoke: **Electron 44.4.5**, Chromium
**152.0.7977.130**, embedded Node **24.21.0**, Windows **10.0.26300**, x64.
Display inventory observed two 1920×1080 DIP displays at 100% and one 1280×720 DIP
display at 150%. **Inventory is not mixed-DPI native test evidence.** No windows
were physically dragged between those displays by Codex.

Restricted-agent Electron attempts failed before the smoke because Chromium child
processes could not start/load the page (GPU/process-access diagnostics). The same
entry passed with broader process access while retaining renderer sandboxing.
Restricted Vitest similarly failed before discovery because esbuild ancestor-directory
traversal was denied; broader-access result is reported separately. These failures
are infrastructure attempts, not failed native-input cases. An intermediate smoke
exit 0 also emitted non-failing GPU shutdown diagnostics; the later smoke passed
without them.

Per-run raw NDJSON lives only in retained owned temp directories (printed by the
launcher). Final successful evidence included `youtube-comments-m0-IEKI8W`; its header
explicitly classifies input as automation. Raw files are optional local diagnostics,
not repository artifacts or acceptance prerequisites. `.m0-regression-tests.log`
is an ignored local regression log. No production profile or Setup.exe was opened.
Existing built-entry production Electron smokes, packaging/ZIP/installer tests and
live extraction were not rerun for this isolated source addition; no new evidence
is claimed for those layers. Production files and build inputs are unchanged.

## Manual work and smallest next experiment

Complete the [window visibility follow-up](../experiments/m0-tab-drag/MANUAL_CHECKLIST.md#window-a-startupvisibility-follow-up-before-dragging)
first if investigating the owner's missing Window A; the drag feasibility trials
below remain pending independently.

Execute [the exact Windows checklist](../experiments/m0-tab-drag/MANUAL_CHECKLIST.md).
It covers reorder, attach, desktop release, Escape inside/outside, external apps,
Alt+Tab/focus, deliberate/natural capture loss, closing either participant,
secondary/middle/chords, occluded/minimized/overlapping targets, resize, physical
100/125/150/200% scales, negative origins and optional topology changes. It includes
a blank observer/sequence-range ledger and requires explicit Not tested entries
where equipment/actions are unavailable.

Smallest next experiment: interleave **20 genuine desktop releases and 20
Escape-outside cancellations per technique on one display**, recording ground
truth alongside raw termination traces. No broader implementation is needed.
If pointer evidence separates those reliably, immediately test external-app
release, Alt+Tab and the covered-target case before accepting it. A later release
after Escape must not detach. Overlapping traces/missing release/false target
commits block M8; keep those logs and decide whether to investigate a narrowly
scoped Windows capture/cancellation and window-hit-test bridge. No such bridge
or changed UX is assumed successful or approved here.

## Recommendation for M8

Keep the future M7 tokenized ownership protocol independent of gesture input.
Use pointer capture as the **first experimental candidate** for local reorder and
possible outside release; consider HTML DnD for explicit cross-window recipient
drops if native tests support it. Do not combine streams within one gesture
without a tested state transition. Do not ship this harness's geometric transfer
as production target authorization, and never detach from HTML dragend none.

Full browser-like dragging **might** be achievable without native Windows
integration, but current evidence does not justify promising it. HTML-only desktop
detach is insufficient; the pointer route remains conditional on native release,
cancellation and target-discrimination evidence. A required Windows bridge is a
possible result, not an established dependency. Explicit Move/Detach commands can
remain useful later but do not satisfy the original drag requirement.

## Change scope

Created only the standalone `experiments/m0-tab-drag/` files listed in its README
and this report. Updated the documentation map to link the experiment. Production
modules/UI, schema/migrations, reader IPC service, saved workspace, dependencies,
package scripts and lockfile are unchanged. No M1–M9 implementation, installer
execution, commit, push or publishing was performed.

## Follow-up: Window A missing on the owner's desktop

2026-10-17. The owner reports only B on the desktop and in Alt+Tab, while both
renderers produced layouts and the evidence contains no A hide/close/renderer-gone
event. **The original root cause remains uncertain.** The supplied observation
does not establish whether A was initially natively visible. A loaded renderer
can exist in a hidden BrowserWindow; no later hide event is necessary in that case.
Electron also documents that page visibility with `backgroundThrottling:false`
does not track actual native hiding/minimization. See
[BrowserWindow visibility and showing](https://www.electronjs.org/docs/latest/api/browser-window#page-visibility).
Native isVisible itself does not prove an OS task-switcher entry or lack of occlusion.

Source inspection establishes two blind spots in the earlier experiment:

- Manual startup requested `show:true` during construction, installed visibility
  listeners afterward, and never explicitly showed A again after page readiness.
  Initial show behavior/state could therefore be missing from the log. This is a
  lifecycle/instrumentation weakness, not proof that construction-time showing failed.
- The old smoke used hidden construction and called `showInactive()` itself while
  setting up drag assertions. It did not check that the normal startup path had
  already made both windows visible. A passing drag smoke could mask this symptom.

The experiment now creates both ordinary independent windows hidden, attaches
listeners before setMenu/load/show, and records initial main-owned native state.
Both pages load concurrently. Each must complete `did-finish-load` and submit a
validated first layout within 10 seconds. Main then explicitly calls A.showInactive,
followed by B.show and B.focus. `ready-to-show` is separately observed, not an
unbounded first-paint dependency. Load failure, early close, renderer death or
deadline expiry rejects startup with evidence and exits with an error. Both manual
and smoke launch use this same readiness/show sequence.

Every native lifecycle entry now contains `nativeState` with isVisible,
isMinimized, isFocused, isDestroyed, getBounds, getContentBounds, rendererReady,
separate DOM/load/layout/paint/process/loading observations and the matching
display's ID/bounds/work area/scale. Closed/destroyed records retain safe false/null
state without calling invalid native getters. Snapshots expose both records as
`nativeWindows`, rendered in a diagnostic details panel. Initial creation,
load/readiness, explicit show requests, actual show/hide events, immediate post-show
and delayed startup snapshots are recorded. These observations replace inference
from renderer layout alone.

The fixed **Show/focus Window A** control uses the existing authenticated IPC
boundary and main's A reference, with no renderer-selected ID/handle/position. It
restores minimized A, shows and focuses it while idle. Unavailable A or an active
drag rejects; no replacement window, automatic refocusing loop, parent relationship
or special lifetime authority was introduced. Both drag adapters and their
cancellation/placement rules remain the same.

Follow-up automated results:

| Check | Result / evidence limit |
| --- | --- |
| `node --test experiments/m0-tab-drag/model.test.cjs` | **Automated pass, 22/22, exit 0**. Exact show-A request validation and extra-window-ID rejection extend the existing validator case. |
| `node experiments/m0-tab-drag/launch.cjs --smoke` | **Automated pass, exit 0**, owned run `youtube-comments-m0-aeruVI`. Before any recovery action, both native windows are alive, loaded, independent and visible; initial-hidden/readiness/show ordering and main diagnostics match native getters. The DOM control shows hidden A, restores minimized A, and rejects during a drag. Existing synthetic HTML transfer, pointer-capture/reorder, replay/none and target-close checks still pass. **OS task-switcher visibility was not verified.** |
| `npm.cmd test -- src/renderer/WorkspaceTabs.test.tsx src/renderer/shortcuts.test.tsx src/preload/reader-bridge.test.ts src/main/reader-ipc.test.ts` | **Automated pass, 30/30 tests, 4/4 files, exit 0**. Relevant unchanged tab/input/bridge/authorization regressions use mocks/jsdom; no database/profile access. Broader process access permits esbuild configuration resolution. |
| `npm.cmd run typecheck`; `npm.cmd run lint` | **Automated pass, exit 0** for both. Their existing TS/TSX scope is unchanged. |
| `node --check` for every experiment CJS/JS file | **Automated pass**. |
| Actual desktop / Alt+Tab appearance and physical dragging | **Requires owner/manual verification**, no personally verified native pass claimed. Execute V01–V05, then N02/N03 in both modes. |

Only `experiments/m0-tab-drag/` and this relevant M0 report changed in the follow-up.
No production source, dependency or schema changed. No reader database/application
profile was accessed, no installer ran, and no M1 implementation, commit or push
was performed. The full SQLite suite
and production Electron/profile smokes were deliberately not run for this follow-up;
the targeted regressions above satisfy its database-free scope. Earlier full-suite
results elsewhere in this report remain historical M0 evidence, not a new run.
