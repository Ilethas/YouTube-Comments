# ADR 0032: Equal native windows and safe session restoration (M6)

Date: 2026-10-18. Verified: 2026-10-19. Status: implemented, awaiting owner review. Schema **14**.

## Native windows and authority

File > **New Window** / **Ctrl+N** (**Cmd+N** on macOS) creates an empty workspace,
independently of the initiating window's tabs. The native menu uses the startup
profile locale for its English/Polish command. Every window uses the same secured
factory, WindowCoordinator, ReaderService and SQLite connection. There is no
primary reader, parent window, secondary service or production test seam.

Main first allocates a durable opaque **dormant** window identity, constructs the
hidden native window with validated bounds, registers its identity/lifetime
listeners, then atomically publishes the live restore set before loading the exact
trusted document. Crash before native construction/registration cannot add an
invisible intended reader; the provisional row is not a restore member.
Constructor/registration/load failure compensates restore membership; the empty
logical row can remain dormant. Failed restored loading stops startup while
preserving the intended session for recovery/retry. A failed new window cannot
leave an invisible restore member. If New Window is used with no live windows on
macOS, membership replaces the retained dormant last-window session; construction
failure restores the previous intended set.

Each committed trusted top-level document receives a fresh runtime lease. IPC
derives its window from M1's registry; no renderer-provided window ID routes an
operation. M4/M5 tab/view ownership, topology CAS and separate intent/collapse CAS
remain. Renderer bootstrap/snapshots contain only its own workspace, instances,
semantic intent and collapse. Library/Settings are singletons **per window**.
Content, comments, preferences, helper configuration, seen/Undo, acquisition and
progress are shared through M2's existing ordered commits/reconciliation.

The added reader intent is payload-free `windowReady()`. It can reveal only
the authenticated caller's registered native window, is idempotent, and grants no
identity, geometry or window-construction authority. App sends it after its own
bootstrap/error UI mounts. Startup waits for all intended shells, shows them with
focus suppressed, restores native state and focuses the intended last-active window
once. A new user-requested window focuses once after its own shell is ready.
The app-owned startup recovery acknowledgment opens only after this complete
show batch, parented to the intended focused window. It cannot interfere with
initial hidden native widgets or leave peers disabled/hidden on Windows.
Native dialogs keep their captured origin; a dead origin never selects a peer.
Preload also routes the existing window.close() affordance through a private,
payload-free authenticated close intent to the originating BrowserWindow.close.
This prevents Chromium's direct WebContents destruction from bypassing M3. No
window ID, native handle or generic renderer capability is introduced.

## Durable session policy

`window_restore` is the explicit ordered intended set, independent of historical
`app_windows` rows. `window_session` contains contract version 1, a separate safe
integer CAS revision and a required last-focused member. Focus changes debounce
with native metadata and flush before lifecycle/profile operations.

- Explicit Quit drains all participants, settles pending native document construction
  with a bounded failure/retry guard, flushes native metadata and atomically captures
  every remaining live window **before** service/native teardown. Native
  destruction during Quit does not shrink that captured set.
- Ordinary native Close drains accepted intent and commits final native metadata
  and membership **before** allowing the final close. With other members it removes
  the closing window; the last member is retained for next launch. Later native
  cancellation re-enrolls the same window and restores usability. No Library data
  or retained tab/view rows are deleted.
- Crash/uncontrolled termination restores the last durably acknowledged set and
  committed intent. Uncommitted renderer drafts and debounce intervals cannot be
  recovered. Dormant historical windows are never enumerated as startup readers.
  Direct uncontrolled native/WebContents destruction is not an acknowledged Close.
  The ordinary window.close() affordance is routed through M3 by preload; forced
  destruction/crash still retains only committed data.
- A restored workspace remains exactly empty when its persisted tab list is empty.
  IDs, placements/order, active tab, duplicate identities and optional state survive.

On Windows/Linux last close enters ordinary application shutdown. On macOS the
service can remain without native readers; Activate reopens the retained session.
A second instance obtains no repository: after lock rejection it exits, and the
existing owner restores/focuses its intended current window without creating a
second SQLite owner.

## Geometry contract and monitor policy

`window_geometry` has one required row per logical window, an independent CAS
revision and nullable bounded JSON. JSON version **1** contains integer normal
`{x,y,width,height}`, separate maximized/fullscreen booleans, and optional last-known
display ID, scale factor and work-area rectangle. `null` means unrecorded. There
is no minimized restart state. Main captures **getNormalBounds()**, including
when minimized/maximized/fullscreen; expanded bounds never replace normal intent.
When minimized, it retains the last observed maximize/fullscreen flags because
Electron can report isMaximized=false for a minimized maximized Windows reader.

All coordinates are [Electron **DIP**](https://www.electronjs.org/docs/latest/api/screen), including negative desktop origins. Scale
factor/work area are evidence, not coordinate multipliers. The pure validator
rejects nonfinite, fractional, excessively large/invalid coordinates or dimensions,
invalid version/state/scale evidence. It chooses a still-connected recorded display,
otherwise greatest overlap of normal bounds with current work areas, otherwise
primary. It clamps the **entire** normal rectangle into that display's current
work area, preserving 1240x900 default and 720x520 minimum intent where possible.
Smaller work areas lower the minimum and size, keeping title bar and usable area
reachable. Missing/corrupt geometry uses the centered default; it cannot change tabs.

Display added/removed/metrics changes recheck normal windows without focusing them.
Expanded native windows retain the OS's maximize/fullscreen handling; persisted
normal geometry is validated again at restart. macOS's asynchronous fullscreen
transition retains the requested state until the enter-full-screen event. A hidden,
not-yet-shown restored window cannot overwrite its saved expanded state with the
factory's temporary normal state. Physical unplug/Space/Wayland behavior needs the
manual matrix in TESTING; deterministic monitor examples are not physical evidence.

Geometry events coalesce for 250 ms. Writes use the existing main repository commit
stream as watermarks, without changing topology or view counters. A stale geometry
or session CAS fails without writes or notifications. There is no global DPI factor.

## M3 and backup/migration protection

M3's conservative **all-participant** drain remains for individual Close and Reload.
This brief global pause is accepted for correctness in M6; it is not service
shutdown. Shared acquisition/helpers continue through a peer Close. An unavailable
renderer can be reloaded from committed state or closed through a main-only native
path that still drains healthy peers. Timed-out/failed drains keep the window open;
they never authorize loss of acknowledged work.

Main-owned geometry buffers do not bypass profile fencing. Ordinary writes stop
behind M3. Explicit native checkpoints run after QUIESCENT, before execution,
again immediately before backup/independent restore safety, and before Close/Quit.
Provisional creation failure has a narrow main-only membership compensation even
during preparation/dialogs; it changes no renderer reading data. Offline
RESTARTING/stopping fences that compensation and **every** native write. Old native
events cannot mutate replacement storage. Quit during offline restore skips old
session capture, preserving the backup's complete intended topology for relaunch.

Migration 14 only adds the three session/geometry tables and new-window geometry
trigger. Migrations **1–13 are unchanged**. Since v13 recorded no live-set evidence,
the one-time migration retains its prior single-window startup choice, preserves
all other windows as dormant, and records no invented geometry. v12 first takes
the exact M4 mapping before this additive step. Pre-migration safety, exact
historical schema validation, staged-only older-backup upgrades, independent
safety and offline rename-gap recovery remain. Version-14 backup validation checks
the exact schema, required session/nonempty set, focused membership, every required
geometry row and versioned geometry data, plus all existing shared/view invariants.
Full backups include every session, topology and dormant view row. Existing/restored
empty profiles do not reseed.

## Verification and boundaries

[TESTING](../TESTING.md) records exact executed counts, production-entry/native
scenarios, extracted-EXE relaunch evidence and connected display/scaling metadata.
All tests use independently owned disposable profiles. No production profile,
Setup.exe, installation, commit or push is part of M6.

M7 owns atomic cross-window tab transfer and generation handoff. M8 owns native
HTML DnD/reorder/detachment and real native input outcomes. M9 owns aggregate
multi-window scale, performance/release verification. M6 adds none of those features.
