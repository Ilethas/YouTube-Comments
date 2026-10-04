# ADR 0009: Isolated discussion rendering and stable tab input

Date: 2026-10-04. Status: accepted for this bounded renderer milestone.

## Context and evidence

Reader previously projected every open discussion, allocated maps/sets, built its
forest and recursively rendered CommentTree on every update. Workspace saving and
acknowledgment, as well as query-session notifications, caused unrelated work.

A development Electron profile used a consistent SQLite backup of the existing
154-comment video and all five stored discussions. Counters recorded four panel,
forest and root-tree executions **per discussion per switch** under StrictMode.
Nine Video/Library/Settings switches took 515–597 ms (median 557 ms). Direct
activation IPC mostly took 2–6 ms, with an 18 ms sample. The reported three-second
delay was not reproduced; unrelated renderer work was.

## Decision

- Keep visibility wrappers in Reader and keep content mounted. Memoized
  DiscussionPanel receives stable item/comments/callbacks and one session;
  activation and workspaceSaving do not enter its props.
- Sessions expose stable snapshot/subscription functions. useSyncExternalStore
  subscribes only that panel; the registry no longer notifies Reader. Session
  close/reopen lifetime, workers and query promotion semantics are unchanged.
- Memoized DiscussionForest projects live comments through frozen applied
  placement. Only comments/results rebuild the forest. Draft/pending/error updates
  skip recursive rendering; selection renders rows without rebuilding placement.
  Seen-save busy presentation is scoped to the saving discussion; Reader retains
  its existing serialization guard.
- A focused hook captures on the stable strip and owns matching-pointer motion
  and primary release. Release commits one final move. Escape, pointercancel,
  actual strip capture loss, blur, pagehide, document hiding, unmount or stale
  workspace revision cancel. Child capture-loss events do not cancel ownership.
  Click suppression survives delayed release after cancellation and resets on a
  fresh press; keyboard/programmatic clicks work. Since capture retargets ordinary
  pointer-up to the strip, the hook activates the pressed tab once on that release.
- Edge auto-scroll runs per animation frame. A nonpassive strip wheel listener
  selects the dominant horizontal/vertical delta, normalizes line/page units and
  updates scrollLeft immediately. It consumes only motion that actually moves an
  overflowing strip; Ctrl-wheel stays native. Wheel during dragging updates preview
  geometry and never commits a move.

No domain comparisons, IPC, schema, durable scroll or virtualization are added.
Isolation retains existing mounted-panel scroll and description state. Relative
publication time updates with item/comment snapshots rather than incidental
tab/draft renders; a periodic presentation clock remains open.

## Validation and consequences

The same final profile measured 23–73 ms (median 28 ms), with **zero** discussion
panel, forest or root-tree executions during all nine switches. Deterministic tests
cover three discussions, unrelated draft/Apply/seen changes and held workspace
saves. Timing is evidence, not a wall-clock CI threshold.

`node scripts/profile-tabs-dev.cjs --interactions` runs native DevTools Protocol
mouse/key/wheel checks in a disposable development copy: dragging down into the
reader, far left/right and back, stationary edge scrolling, release with one
revision increment, Escape with delayed release, ordinary clicks, mixed switching,
tab wheel and vertical discussion wheel. These are automated development UI checks,
not a claim of human physical-mouse testing. Component tests cover ownership,
cancellation and overflow/edge/horizontal wheel behavior.

Capture covers movement inside the document outside the original button/strip.
Delivery beyond the native Electron window depends on Chromium/OS behavior; no
native global hook or cross-window guarantee is added. Lifecycle loss cancels.

Full initial DOM mounting and changed-discussion recursive rendering remain.
Later virtualization should measure those costs, variable-height layout/avatars
and many mounted panels, retaining application-data navigation and applied-query
semantics. Activation itself no longer justifies a SQLite/IPC redesign.
