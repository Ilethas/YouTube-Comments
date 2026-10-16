# Testing strategy

## Windows Squirrel artifacts and identity (2026-10-16, ADR 0021)

Non-destructive artifact verification passes for fresh Squirrel and existing ZIP.
The full deterministic suite passes **711 tests across 55 files** (113.64 s).
`test:electron` also passes real process persistence, view restoration, the large
backup/restore round trip and recovery after both forced rename-gap crashes.
Deliberate invalid-backup/view failures emit expected diagnostics; they are not
installer operations. Final focused artifact tests pass after TypeScript narrowing.
The final Squirrel-only build runs the configured MakerSquirrel, not a default
instance accidentally selected by module name. Tests cover that exact Forge
selection regression, fixed identity, lifecycle startup gating with inert process
dependencies, malformed PE/sections/architecture, missing installer output and
incoherent NuGet/RELEASES metadata. No lifecycle test invokes Update.exe.

Verified generated outputs (ignored, never committed or published):

| Artifact | Path | Bytes |
| --- | --- | ---: |
| Setup | `out/make/squirrel.windows/x64/Setup.exe` | 155,667,456 |
| Full NuGet | `out/make/squirrel.windows/x64/youtube_comments-1.0.0-full.nupkg` | 154,971,653 |
| Release metadata | `out/make/squirrel.windows/x64/RELEASES` | 87 |
| ZIP | `out/make/zip/win32/x64/youtube-comments-win32-x64-1.0.0.zip` | 158,300,924 |
| Complete app folder (73 files) | `out/youtube-comments-win32-x64/` | 385,857,495 |

Measured verified command durations: package **5.15 s**, ZIP make **20.42 s**,
Squirrel make **48.06 s**, each make including packaging and structural verification.
These are observations with warm local tooling, not thresholds. NuGet bookkeeping
can vary between builds. Version 1.0.0 is inherited metadata, not a stable release.

`verify:artifacts -- --squirrel` passes for all current outputs. Setup's x86 PE
has valid bounded sections and an embedded DATA/131 ZIP containing the exact full
NuGet, identical RELEASES, known x86 vendor updater, setup icon and default animation.
Every compressed entry passes size/CRC checks. RELEASES matches package identity,
SHA1 and length. NuGet XML title is YouTube Comments, ID is youtube_comments, version
is 1.0.0, author/description match, and all 73 x64 runtime files match SHA-256 against
the independently checked package, plus the two expected Squirrel helper/stub files.
The application/Setup/helper/stub contain the seven original ICO frames. ZIP byte
comparison, ASAR/runtime/worker assets and restrictive fuses pass unchanged.

Standalone renderer build passes (437.76 kB JS / 136.06 kB gzip, 14.84 kB CSS,
2.60 kB worker). Typecheck and lint pass. The sandbox initially denied esbuild's
configuration lookup; approved reruns outside it passed. This did not involve
installer execution or changes to Windows installation state.

The extracted unmodified ZIP smoke passes with disposable demo and production
profile environments. It verifies fresh-empty schema 8 and populated state, native
helper-picker cancellation, EN/PL and appearance, worker/virtual navigation,
seen/Undo/NEW/history, restored view intent, native SQLite backup and confirmed
restore, exact all-table restoration, independent pre-restore safety, completion
marker and real `app.relaunch()` into the extracted EXE at a different PID. The
original out/ copy then reopens the same disposable production profile. Observed
shell-ready samples: demo 798 ms, fresh production 221 ms, populated 621 ms,
restart 610 ms, actual restore relaunch 2109 ms, copied app 666 ms. These include
external CDP/native-dialog instrumentation overhead. Evidence is retained in
`.packaging-diagnostics/packaged-smoke.json` and its printed owned temporary root.
No optional live helper acquisition was requested for this milestone.

### Explicit installation verification boundary

**No Setup.exe was run. No real install, upgrade, uninstall or reinstall occurred.**
The owner account is not disposable. Read-only discovery found no Sandbox EXE,
checked VM command or running VM; no disposable Windows account was designated.
No separate account/VM/Sandbox was used, created, enabled or provisioned. Redirected
application-profile environments are not evidence of installer isolation.

Fresh per-user/no-admin installation, installed shortcuts and AppUserModelID/taskbar
grouping, installed native dialogs, installed backup/restore/relaunch, uninstall
data retention, reinstall/profile reuse, local upgrades, installation time and
installed footprint are **UNVERIFIED**. Static metadata, default Electron relaunch
and the unchanged fixed production profile support the intended design, not a
claim of genuine installation success. See [ADR 0021](decisions/0021-windows-squirrel-installer-and-application-identity.md)
and the [installation safety policy](PACKAGING.md#installer-lifecycle-and-safe-testing).

Read-only manifest inspection confirms Setup requests `asInvoker`. Authenticode
inspection reports `NotSigned` for Setup and the application EXE.
Artifacts are unsigned; SmartScreen warnings are possible and protection must not
be bypassed. Programs and Features icon behavior remains unverified/generic because
no hosted iconUrl is provided. Acquisition still requires separately installed
helpers; signing, final branding, helper distribution/licensing, Windows compatibility
and public release remain outstanding. No commit, push or publish was performed.

## Windows x64 application and ZIP (2026-10-16, ADR 0020)

Final deterministic verification: **701 tests across 54 files pass**, including three
artifact checks. Typecheck/lint pass; standalone renderer, real Forge package/ZIP,
artifact verification, existing `test:electron`, extracted `test:packaged` and explicit
packaged helper live acquire/Refresh all pass. No commit, push or publish was performed.

This supersedes historical notes below saying Forge finalization has no output.
The actual Windows command reproduced exit 0 with no `out` app; debug logging stopped
in cached Electron ZIP extraction. Standalone `extract-zip` left the first ja.pak
partially written (814,127 bytes) and reached Node `beforeExit` with its promise pending.
The old yauzl/fd-slicer streams conflict with Node 26. A scoped yauzl 3.4.0 override
fixed extraction without changing Forge/fuses/ASAR. Windows make then exposed removed
recursive fs.rmdir in cross-zip 4.0.1; pinning only the ZIP maker to compatible 3.1.0
fixed it. No completed artifact was briefly created/removed, and no evidence implicated
antivirus/file locks or an unexpectedly terminating packaging child. See
[ADR 0020](decisions/0020-windows-packaged-application-and-zip-distribution.md).

Verified outputs (not committed):

| Artifact | Actual output | Size |
| --- | --- | ---: |
| Application | `out/youtube-comments-win32-x64/youtube-comments.exe` plus 72 adjacent files | 385,857,588 bytes (368.0 MiB), entire folder |
| ZIP | `out/make/zip/win32/x64/youtube-comments-win32-x64-1.0.0.zip` | 158,320,053 bytes (151.0 MiB) |

Observed warm-cache verified package took 4.99 s; make including packaging, compression
and complete ZIP-byte verification took 20.71 s (an earlier make was 18.62 s).
These are local samples, not performance budgets. Main/preload/renderer/worker production
bundles complete; standalone renderer remains 437.76 kB JS / 136.06 kB gzip, CSS 14.84 kB,
worker 2.60 kB. Runtime is Electron 44.4.5, built-in Node 24.21.0 / SQLite 3.53.4;
host tooling is Node 26.7.0 / npm 11.19.0 on Windows 10.0.26300 x64.

The parent wrapper clears only previous target output and rejects zero-exit/no-artifact
builds. `verify:artifacts` checks the x64 PE, Electron runtime resources/locales,
ASAR main/preload/renderer/CSS/worker, relative asset references and six fuse values.
Every ZIP entry is decompressed and SHA-256 compared with the full folder. Three
deterministic tests reject missing/empty/package-only/incomplete/changed output.

### Unmodified extracted executable

`test:packaged` launches the real fused EXE from an ordinary temporary extraction
directory, with a temporary working directory and no npm start, IDE or Vite server.
The runner uses explicit loopback CDP and real native Windows dialog controls, not a
modified main/preload/ASAR, mocked dialogs or intercepted relaunch. Normal startup
does not enable CDP. Separate preload/renderer contexts exist, neither has ambient
Node globals, the bridge is frozen/allowlisted, and extra executable-path/URL intent
fields reject. ASAR/integrity/ASAR-only, cookie encryption and restrictive Node fuses
are inspected directly in the executable; sandbox/context isolation/Node integration
settings are also checked in the packaged main.

Both explicit packaged demo mode and ordinary production mode are exercised. Production
has no demo override and uses independently owned Windows profile environment directories
(APPDATA/LOCALAPPDATA/USERPROFILE and shell folders). A prior path-only Electron probe
proved this host resolves the disposable appData path. This is a profile environment
on the current account, not a new Windows account/VM. Owner development/production
databases are never opened. Fresh production is empty; a populated schema-8 database
is reopened with no reseeding/replacement.

The fixture-backed production smoke checks Library/Settings/workspace, source headers,
English/Polish, System/Light/Dark, Ctrl+Shift subtree marking, atomic failed matching
mutation, persistent usable Undo, durable latest discovery/NEW and source history.
A restrictive text search invokes the real ASAR worker, publication uses the bundled
Temporal resolver, discovery filtering selects the new comment, and sorting/ruler/
virtual navigation work over 250 additional variable-height fixture roots with bounded
mounted DOM. Saved query/sort/selection/anchor intent survives fresh restart.

Settings creates a native-dialog-selected verified complete SQLite snapshot. After
Undo changes current data, native Open plus actual Cancel-first confirmation restores
the snapshot. The old process quits, `app.relaunch()` starts a different PID pointing
at the extracted `youtube-comments.exe`, startup recovery records complete, and every
authoritative table equals the snapshot. Independent safety equals the pre-restore
tables. No ADR 0019 protocol or app startup/profile source was changed. The existing
Electron suite additionally passes large-profile round trips and both forced rename-gap
crash/restart recovery scenarios. Expected invalid-backup/unowned-target diagnostics
are emitted by deliberate negative tests; occasional Chromium GPU shutdown diagnostics
remain non-failing.

Startup samples from process spawn through externally observed rendered app shell:
demo 798 ms; fresh empty production 208 ms; populated 656 ms; restart 611 ms; actual
restore relaunch 640 ms. CDP polling/connection adds measurement overhead. Built-entry
small-profile checks typically reported about 170–235 ms through their internal ready
point; these are different instrumentation/fixture sizes. No material startup regression
was observed, and no permanent latency budget follows from these samples. Large 60k
built-entry backup tests still show the previously documented synchronous bootstrap cost.

A separate same-data/same-instrumentation `--compare-startup` run observed packaged
existing/restart/copied-folder starts at 612/610/621 ms and the built-entry development
runtime at 841 ms. This sample does not show a packaging startup penalty; cache/order
and machine load prevent treating it as a universal performance claim.

The final combined run (including explicit checkbox-only marking and actual fresh
renderer view reconstruction) passed with existing/restart/copied starts 609/612/626 ms
and development 640 ms. Fresh empty startup varied up to 3,210 ms in that run, versus
208–239 ms in earlier samples. Restore/relaunch observation was 2,081 ms including
Windows PID discovery and native acknowledgement automation. The test driver now
dismisses the startup acknowledgement before attaching CDP, avoiding an observed
attachment race; application startup/recovery code is unchanged. Windows process
inspection also observed the actual packaged renderer's `--enable-sandbox` argument.

### Optional actual helpers

The packaged smoke selected both installed EXEs through real native pickers, validated
and persisted them, checked configured status after restart and included settings in
backup/restore. yt-dlp **2026.08.19** and post-archiver **0.4.0** both reported tested.
An explicit separate `--live` run performed acquisition and Refresh through each:

| Helper | Comments after Refresh | Coverage acquire / Refresh | Refresh insertions | Acquire + mark seen + Refresh |
| --- | ---: | --- | ---: | ---: |
| yt-dlp | 173 | partial / partial | 0 | 18.09 s |
| post-archiver | 34 | partial / partial | 0 | 8.52 s |

Both retained an explicitly marked comment's seen state. These anonymous network
checks use the public video/post already documented below, log counts rather than
content and remain outside deterministic tests. No helper/Python bundling, download
or updater was added. Untested-version confidence remains covered by the existing
deterministic/built-entry helper suites.

No-install means extract the whole folder and run; data remains in the established
application-data profile. The smoke also launches the original `out` EXE with the
same disposable production environment to check copied-folder profile reuse and clean
shutdown. The harness leaves its owned temporary data and ignored JSON/log report for
review. [Packaging](PACKAGING.md) documents commands and current release limitations.
The last combined run's full JSON report is
`.packaging-diagnostics/packaged-smoke.json`, with process paths, timing samples,
runtime/context evidence and helper counts; command/debug logs share that ignored
directory. The final process check found no remaining application/harness processes.

Squirrel/MSI, signing/SmartScreen, updates, helper bundling/licensing distribution,
public hosting, final branding/icons, released upgrade matrix, Windows version matrix,
portable data and other platforms remain unverified/outside this milestone.

## Complete SQLite backup and safe profile restore (2026-10-15)

[ADR 0019](decisions/0019-consistent-sqlite-backup-and-safe-restore.md) keeps schema
8 and adds complete snapshots, staged validation/migration, confirmed offline full
replacement, retained safety/previous artifacts, startup crash recovery and automatic
pre-migration snapshots. All destructive checks use newly owned temporary profiles;
the owner's development/production data is never opened by these tests.

SQLite integration compares every authoritative table across round trips, including
video/Community adapter fixtures and synthetic content, discovery/failed/accepted
history and NEW, seen and row revisions, revision-owned partial Undo, tabs/order/
active state, language/appearance, both helper selections, distinct draft/applied
queries, sort and anchor/selection. Subsequent Undo and real-item removal still work.
WAL tests prove committed data appears in standalone snapshots and offline transition
settles sidecars. Source bytes remain unchanged by backup/invalid restore. Tests cover
cancelled dialogs/confirmation, existing destinations, write/permission/disk failures,
verification failure and partial cleanup, internal/live aliases, text/corrupt/wrong-app/
newer/foreign-key-invalid data, missing state/history, unknown triggers and invalid
views. All known schemas 1–7 stage/migrate without changing source; populated schema
7 preservation and verified pre-migration snapshots are covered explicitly.

Failure injection covers preflight, safety failure, intent, both immediate rename
gaps and their markers, installed/reopened/accepted phases, candidate reopen failure,
accepted-candidate corruption, missing intent metadata and repeated crashes during
rollback quarantine/installation. Unrecoverable safety failure leaves previous files
available and no empty database. Main-service tests cover acquisition settlement,
pending earlier seen/view commits, stale IPC rejection, operation exclusivity and
shutdown while dialogs/data work are pending. Renderer tests cover EN/PL explanations,
destination acknowledgement, localized failures, query/save draining and failed-save
abort. Native dialog tests assert defaultId=cancelId=0 and exact replacement warning.
Four renderer races additionally cover an acquisition accepted during cancelled,
invalid, committed and failed-offline restore: only the first two release the old
result for reconciliation; the others remain inert until the new process takes over.

### Generated SQLite measurements

Generated 10k and 50k discussions include long Polish/English text, shallow reply
trees, full normalized metadata and durable bulk Undo for every comment. Separate
profiles hold approximately 27.8/138.3 MB databases. The following observed samples
are milliseconds, rounded; they are evidence, not CI latency thresholds:

| Comments | SQLite page copy | Backup incl. verification/publication | Independent full verification | Restore preflight | Safety incl. verification | Offline install/startup acceptance | Fresh open/bootstrap |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | 101 | 310 | 192 | 541 | 310 | 1,067 | 124 |
| 50,000 | 5,961 | 7,787 | 1,608 | 5,576 | 4,451 | 8,857 | 946 |

Other samples showed 50k safety at 4.2 s and backup at 2.9–9.7 s, illustrating local
filesystem/antivirus/load variability. The ordinary suite runs other workloads in
parallel. No storage optimization or arbitrary performance pass/fail budget follows
from these samples. Page copy yields asynchronously; full integrity/application
verification and bootstrap remain synchronous on main. A 50k full verification can
delay main IPC for roughly 1.4–2.5 s across these samples. The separate renderer paints an inert
progress modal; repeated controlled verification/reopen stages account for the longer
restore interval. Moving verification/bootstrap to an internal worker is future
responsiveness work, not a Q-21 paging/FTS redesign in this milestone.

### Built-entry disposable-profile verification

`scripts/smoke-backup-restore.cjs` drives the actual Forge main/preload/renderer.
Only its harness substitutes native dialog responses and Electron relaunch, then
launches the next real process. No shipped environment/test bridge is added. It
checks a Cancel-first confirmation, cancelled Save, invalid-source preservation,
Settings backup/destination feedback, full table restoration after seen/Undo/workspace/
appearance changes and local removal, restored helper/view intent, and independent
safety snapshot contents. Test-side saved video/Community adapters seed real-source
fixtures alongside synthetic content; no live YouTube dependency is introduced.

It also forcibly exits the process immediately after moving the original and after
installing the candidate, before the following phase marker. Fresh startup recovers
the exact pre-restore table contents in both cases. Recovery files remain valid.
The runtime reports Electron 44.4.5 / Node 24.21.0 / SQLite 3.53.4 and exercises the
actual `node:sqlite.backup` function. The initial small-profile samples completed
backup, restore and fresh-process verification phases in about 0.36–0.42 s each.

The expanded round trip holds both 10k and 50k discussions plus ordinary fixtures.
The final measured Settings backup call took **2.41 s**; confirmed restore including
preflight/safety/offline installation/reopen took **15.07 s**. The restarted process
reached the actual reader shell in **19.01 s**; an earlier sample was 15.94 s.
These startup measurements include the existing full bootstrap/IPC/clone path,
which remains Q-21 work. Whole harness phases take longer because they also compare
every SQLite row, serialize checkpoints and verify later Undo/removal. Timing logs
separate operation/readiness milestones from those checks. Metadata assertions avoid
an additional 60k-comment clone across the executeJavaScript test boundary while
retaining the complete production main-to-renderer IPC.

Final verification: **698 tests across 53 files pass**; typecheck and lint pass
without warnings; standalone renderer and Forge main/preload/renderer/worker bundles
pass. Renderer JS is 437.76 kB / 136.06 kB gzip; the query worker is 2.60 kB. The full
`test:electron` chain passes existing IPC/helper/bulk/Undo tests, seven view restart
phases and the backup/restore/crash scenarios. Forge still stops at Finalizing
package with exit 0 and no completed `out` artifact; no packaging repair was made.
Vite's existing CJS warning and occasional non-failing Chromium GPU shutdown messages
remain. Restricted sandbox configuration/GPU startup required broader-access reruns.

Intermediate runs exposed the closed backup-dialog DOM regression and acquisition
acknowledgment race; both have regression tests and fixes. Real filesystem tests now
use 30 s hang guards after observed Windows I/O stalls exceeded Vitest's 5 s default;
there are no latency assertions. One parallel run also returned pre-commit
`RESTORE_FAILED` in the acquisition/restore test. Its privileged cause was not captured
in that run; focused and subsequent full reruns with diagnostic assertions passed.
The failure path did not replace current data. This intermittent result is retained
as a verification limitation rather than attributed to an unverified cause.

Native dialog interaction is automated with main-side response stubs; this is not a
claim of a separate hands-on native Windows dialog session. The full disposable
scenario and table/safety checks are automated and repeatable. No valuable profile
was used. OS power loss itself is not simulated; phase loss and actual process exits
exercise the conservative protocol. Node cannot portably fsync Windows directory
metadata, so ambiguous artifacts fail closed rather than creating an empty profile.

Pre-migration protection is implemented; each future released upgrade still needs
its own compatibility/failure matrix. Retention management, future format/platform
portability and export remain open. Installer/portable packaging, signing, helper
distribution and the existing Forge finalization problem are unchanged release work.

## Acquisition progress, cancellation and timing (2026-10-15)

[ADR 0018](decisions/0018-acquisition-progress-and-safe-cancellation.md) adds safe
global operation progress and explicit user cancellation without changing extractor
commands, coverage policy, schema, helper distribution or persistence design.

Deterministic coverage includes ordered video/Community stages, stable per-run and
distinct later IDs, exact safe notification/cancel payloads, stale/completed Cancel,
pre-save race ordering and non-cancellable Saving, failed target-associated cancelled
history, no item/tab on cancelled initial acquire, real nonempty NEW cohort preservation,
comments/seen/Undo/persisted-view preservation, active probe/fetch cancellation,
Community cleanup after child close, shutdown without user-cancelled history, next
successful operation, injected stage/target/merge/bootstrap timing and no timing sleeps.
The real Windows process test starts a parent and descendant, waits for readiness,
cancels through the existing executor, and verifies the descendant no longer exists.

Bridge/component tests cover exact payload rejection and unsubscribe, StrictMode's
single live subscription, snapshot/event races, completed-ID retirement, local
monotonic elapsed ticking across a wall-clock change, indeterminate progress without
a value, Cancel disappearing at Saving/Updating view, global progress through Settings
navigation with interactive seen writes, EN/PL neutral cancellation, and query failure
remaining a view error after committed Refresh. Existing helper confidence, seen,
query, view-restoration and sequential-operation regressions remain covered.

### Anonymous live evidence

Expanded `scripts/verify-live-reader.cjs` uses real Forge-built main/preload/renderer,
the existing installed direct helpers and an owned disposable profile. It logs only
safe timings/counts/issue patterns. No raw comment text/helper output is logged or
retained. A test-only main IPC wrapper observes acknowledged timing summaries; it
adds no shipped capability. Both public targets remain the same repository fixtures:
[video IFPKfypw2CQ](https://www.youtube.com/watch?v=IFPKfypw2CQ) and
[post UgkxLEL8EllifRA8ZLoEkkTXSJaa0s_cWf6n](https://www.youtube.com/post/UgkxLEL8EllifRA8ZLoEkkTXSJaa0s_cWf6n).

Observed durations in milliseconds, rounded to one decimal:

| Operation | Target read | Helper/probe | Prepare | Fetch | Process/cleanup | Merge | Bootstrap | Total main |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Video acquire, 173 comments | 0.6 | 517.1 | 0.2 | 12959.3 | 5.6 | 27.1 | 5.6 | 13515.5 |
| Video Refresh, 173 observations | 4.7 | 230.3 | 0.1 | 10945.1 | 4.3 | 29.2 | 8.0 | 11221.7 |
| Video Refresh after cancellation | 3.4 | 264.4 | 0.1 | 9930.3 | 4.4 | 23.9 | 6.7 | 10233.3 |
| Community acquire, 34 comments | 0.1 | 125.2 | 1.6 | 4443.1 | 12.7 | 6.9 | 6.2 | 4595.9 |
| Community Refresh, 34 observations | 4.8 | 127.1 | 1.2 | 4187.4 | 14.4 | 7.2 | 6.3 | 4348.3 |
| Community Refresh after cancellation | 4.0 | 127.8 | 1.1 | 6911.2 | 8.0 | 6.1 | 5.0 | 7063.2 |

Fetch accounts for approximately 96–98% of these samples. These intervals identify
time inside helper execution, including its network work; they do not isolate network
from helper internals. Pre-Refresh full repository reads were 3–5 ms; video merge plus
bootstrap was 31–37 ms; Community 11–14 ms. No version-probe cache, query/persistence
redesign or extraction optimization is justified by these individual observations.
The slower final Community sample also demonstrates variability rather than a budget.
Bootstrap measures ReaderState construction, not Electron's internal serialization.
Automation's video acquire/Refresh totals were 13.692/11.303 s and Community acquire
4.687 s; their difference from main includes IPC, rendering/view work and polling, so
it cannot be attributed precisely to any one of those costs.

For both targets, Acquire and Refresh succeeded, then a Refresh was explicitly
cancelled during fetching after switching to Settings. Global progress remained
visible, no percentage was present, and comments/items (including latest accepted
NEW identity), seen/Undo and persisted views were unchanged at cancellation. Both
then refreshed successfully. The Community cancellation window was long enough;
no newly created acquisition workspace remained. Completed IDs returned harmless
NOT_FOUND. Both cancelled attempts appear as failed history, never accepted empty
or partial results. Existing coverage/warnings remain: video partial helper-warning
evidence with zero adapter issues; Community partial configured limits with one
protocol-relative post-author avatar warning. 173/34 commenter avatars were retained.
Real restart restored stored items, workspace and seen state. The disposable profile
and temporary acquisition files were removed. The earlier 12.47/11.94/4.09 s hands-on
observations remain individual samples, not performance targets.

### Verification

`npm.cmd test`: **638 tests across 49 files pass**, including the actual Windows
process-tree check. `npm.cmd run typecheck` and `npm.cmd run lint` pass without
warnings. Renderer build passes (431.47 kB JS / 133.57 kB gzip, separate 2.60 kB
same-origin query worker). Forge main/preload/renderer/worker bundle checks pass.
`npm.cmd run test:electron` passes the real built entries, persisted seen/workspace,
helper Settings, bulk/Undo and seven view-restoration phases/restarts, including
10k/50k saved-view reconstruction and fallback. Live acquire/Refresh/cancellation/
restart evidence is above. Sandbox esbuild configuration access and Electron GPU
startup required the normal broader-access reruns; the final checks passed there.
Vite's existing CJS deprecation and occasional Electron GPU shutdown messages remain
non-failing. Forge still exits 0 at Finalizing package without an `out` artifact;
this milestone only checks its bundles. It does not repair or deliver packaging.

## Persistent discussion view restoration (2026-10-14)

[ADR 0017](decisions/0017-persistent-discussion-view-restoration.md) implements
schema-8 semantic view storage and resolves Q-10 for the current uncollapsed reader.
**617 offline tests across 47 files pass**. Typecheck and lint pass without warnings.
Renderer build and Forge main/preload/renderer/worker bundle checks pass. Forge still
stops at finalization without an `out` artifact despite exit 0; packaging/release
completion remains outside this milestone. Vite's existing CJS warning and occasional
Electron shutdown GPU diagnostics remain non-failing.

Temporary SQLite tests cover populated 7→8 preservation of comments/seen/revisions,
history, workspace/order/active ID, preferences, durable Undo and helper selections;
transaction rollback/retry; absent defaults; exact bounded JSON/IPC validation;
same-discussion anchor/selection ownership; distinct draft/applied round trips;
all five sorts; row-offset/selection; close/restart/Library reopen; independent
discussions, reacquisition identity and removal cascade; corrupt convenience records
and failed upserts preserving content and prior acknowledgment.

Session, component and actual-virtualizer tests cover text/selected fields/regex/case,
seen, custom dates, Today/24h/7d and NEW through the existing evaluator; fresh restart
clocks/day/zones and no numeric bounds in intent; stale Unseen reconstruction with
seenStale false; draft/applied divergence and failed Apply; sort/navigation/ruler
projection; top/header, displayed/hidden/missing anchor and selection fallback;
selection without focus and sorted F3 continuation; variable heights and row-offset
clamping; 10k/50k bounded distant mounting; per-view restore failures; debounced typing
and scroll; serialized/coalesced full-state saves, failed acknowledgment retry and
flush during promise finalization; close/reopen and detached Refresh anchors;
Library startup without hidden render/evaluation; later ReaderState copies never
rehydrating live sessions; and Refresh arriving while initial restore is pending.

`npm run test:electron` passes both built-entry suites in newly created disposable
profiles: four legacy startup phases plus seven view-restoration phases (seed/write/
read/Library/reopen/shifted-clock/failure), each using a separate real Electron process.
The view harness seeds two synthetic 10k/50k discussions with checked relationships/
history, uses real query worker/control/ruler/navigation paths, quits only after useful
save acknowledgments and verifies workspace, distinct drafts/results/sorts, anchor
offsets, selection without focus, sorted F3, stale Unseen changing 10,000→9,999 matches,
closed-tab restart/reopen, Library startup with zero discussion render work, local
removal of content/view state, Polish/dark preferences, rolling-date reconstruction
with an injected clock advanced by two days, corrupt-row fallback and invalid-regex
restore isolation. Startup clock/zone injection is registered on a blank test page
before the real application document; the harness verifies the clock explicitly.
English/light and Polish/dark reading captures were visually inspected at
`.vite/view-restoration-en-light.png` and `.vite/view-restoration-pl-dark.png`.
These are automated Chromium runs of the requested manual scenarios; no valuable
profile, live YouTube access or separate human walkthrough was used.

`node scripts/profile-discussions.cjs --50k` passes with offline generated flat,
shallow/broad and mixed trees. Observed reconstruction below excludes SQLite/bootstrap
and uses a newly created session plus the real worker. Paint totals include the
harness's eight double-animation-frame stabilization passes; they are observations,
not a hardware budget or CI threshold.

| Comments | Worker reconstruction | Reconstruction + stabilized paint | Mounted rows | Ruler child nodes | Largest anchor drift |
| --- | --- | --- | --- | --- | --- |
| 10,000 | 29–30 ms | about 299 ms | 19 | 4 | 0.422 px |
| 50,000 | 128–138 ms | 466–499 ms | 19 | 4 | 0.422 px |

Real built-application startup was measured separately: a profile containing 60k
generated comments with the saved 50k view active reached its reconstructed controls
about **6.865 seconds** after the application document's initial test script. The
offline suite was running concurrently, so this is a single observational sample,
not an unloaded startup claim. Full bootstrap/clone/library memory and database/query
scale remain Q-21. Real restart restored both distant views with 19 rows/four ruler
nodes; saved offsets of 123.375/52 px were retained. Initial bootstrap and fresh worker
reconstruction remain separate costs. No paging/FTS/worker/database redesign or
acquisition performance optimization was introduced.

Only future reply-collapse expansion persistence and optional tab badge details remain
in Q-10. Backup/export, helper distribution and Windows release/Forge finalization
remain separate. Historical milestone results below describe their original scopes;
ADR 0017 supersedes prior session-only/default-on-restart view statements.

## Whole-conversation sorting (2026-10-14)

[ADR 0016](decisions/0016-whole-conversation-sorting.md) resolves Q-08 with five
immediate session-only modes. **563 offline tests across 44 files pass**. Typecheck
and lint pass without warnings. Renderer and Forge main/preload/renderer/worker
bundles build successfully. Forge still exits at finalization without a completed
executable; no packaging fix or release readiness is claimed. The existing Vite
CJS deprecation and occasional Electron shutdown GPU diagnostic remain non-failing.

Pure tests verify exact Original preorder, root-only Newest/Oldest publication,
root-only Most liked (known zero, descendant likes ignored), tree-wide Latest
activity, usable coarse/estimated instants, unknown-last in both directions and
Original ties. Complete filtered trees retain parent-before-child, reply order,
root/depth, roles, ancestry and sibling metadata. Deep chains, broad trees,
Community containment and unresolved/cyclic safe roots preserve source evidence.
Temporary SQLite tests use normalized Community fixtures to prove rejected/lossy
backend counts remain unknown through reader projection; all-unknown roots disable
Most liked and effectively use Original without forgetting the selected mode.

Session/component tests cover immediate no-worker sorting, independent discussions,
close/reopen, removal/reset and a fresh Reader lifetime; retained mode on Apply and
successful/failed Refresh; rekeying committed publication/likes/new replies; seen
and NEW independence; draft/result/count stability; sorted next/previous match,
F3/Shift+F3, unseen wrapping/context resolution and X/N; and exact frozen matching
bulk payloads after display order changes. Ruler category identities remain fixed
while sorted positions/targets change. Pointer/keyboard reveal reaches unmounted
targets. An all-unknown retained Most liked selection has localized accessible
explanation in both languages.

Deterministic 10k/50k checks use the actual virtualizer and controlled geometry,
including anchor identity/offset restoration, bounded mounted rows/ruler DOM,
distant navigation and correct rails. Property-read counters verify exactly one
publication read per displayed comment and one like read per root during key
preparation, including a 50k-deep chain; no wall-clock CI budget is used. Live seen
joins reuse accepted ordering. A metadata-changing Refresh retains the old order
until successful query promotion, so it cannot move the reading context ahead of
anchor capture. Tests also cover capture after header reflow but before a
ResizeObserver notification, using the known list origin rather than row scanning.
Hidden panels retain their positive cached geometry instead of display-none zeros.

`node scripts/profile-discussions.cjs --50k` passes in offline Electron/Chromium
with generated disposable data and actual select/worker/layout/scroll paths.
Flat, shallow/broad and mixed trees at both sizes each mounted **19 rows** after
sorting and metadata-changing Refresh; the ruler retained **four descendant DOM
elements / three category paths**, with 277 occupied pixel bands in this viewport.
Sort-anchor drift was at most **0.703125 px**; Refresh-anchor drift relative to
the documented worker-completion capture point was at most **0.375 px**. Pending
status can reflow the header; capture uses the actual current list origin even
before the cached margin updates. A 10k chain probe reached its distant target
with 13 mounted rows. Selective Apply and Refresh worker evaluation succeeded at
50k; all five small semantic mode checks passed. These are local observations,
not supported-hardware or memory budgets. Full bootstrap/query/storage/memory
scaling remains Q-21.

The built-entry `npm.cmd run test:electron` passes all four disposable-profile
phases, on Electron 44.4.5 / Node 24.21.0 / SQLite 3.53.4. Added checks prove sort
does not mutate the persisted snapshot, survives successful Refresh and same-session
close/reopen, and resets to Original after a real process restart. Existing public
fixture acquisition/Refresh, failed-refresh preservation, security, helper,
seen/Undo, NEW and workspace durability checks remain passing.

Scripted/visual walkthrough coverage uses disposable generated data and saved
extractor fixtures, not live YouTube or valuable profiles:

| Requested check | Evidence |
| --- | --- |
| Original, Newest, Oldest, old root plus recent reply, known root likes | Five-mode Chromium semantic checks plus pure expected-order tests. |
| Community unknown likes and containment | Normalized fixtures through temporary SQLite and pure safe-root projection tests. |
| Search/filter, seen, Apply, successful/failed Refresh | Session/component suites, actual worker harness and built-entry smoke. |
| F3/unseen, X/N, ruler, distant reveal | Component/actual virtualizer checks, real Chromium ruler and built-entry navigation. |
| Mid-discussion sort and Refresh anchors, 10k/50k bounds | Controlled-layout tests and measured Chromium observations above. |
| English/light and Polish/dark | Captured generated reader layouts visually inspected, including compact localized Sort control and neutral rails. |

This is scripted interaction plus agent visual review; no human physical-input
or fresh live-network walkthrough is claimed. To reproduce, run the normal suite,
typecheck/lint, renderer build, the profile harness, Forge bundles, then built-entry
smoke. **Run the profile harness and Forge sequentially**: Forge clears `.vite`
and can remove an in-flight harness's worker assets. Q-10 retains persistent
sort/filter/scroll/selection restoration; collapse, acquisition progress/cancel,
Refresh optimization, backup/export and release/helper distribution remain outside
this milestone.

## Source links, helper confidence, bulk minutes and marking ergonomics (2026-10-13–14)

[ADR 0015](decisions/0015-safe-usability-intents-and-helper-confidence.md)
supersedes exact-version permission gates while preserving output validation,
and records the new source/bulk/gesture boundaries. **533 offline tests across
42 files pass**. Typecheck and lint pass without warnings. Renderer build and
Forge main/preload/renderer/worker bundle checks pass. Renderer: 415.90 kB /
128.84 kB gzip; query worker: unchanged 2.60 kB with no Temporal dependency.
Forge still exits 0 during finalization without a completed executable; bundling
is verified, completed packaging is not. The Vite CJS deprecation and occasional
Electron shutdown GPU diagnostic remain non-failing observations.

New deterministic coverage verifies canonical video/post browser destinations,
kind/source-kind matching, missing/unsupported/synthetic identity rejection,
exact item-only payload/arity and arbitrary URL/path/scheme rejection. Browser
failure preserves content/workspace/history and yields compact localized feedback.
All 18 bridge intents inherit sender/top-frame/exact-document guards. Component
tests verify English/Polish source labels, pending duplicate prevention and retry.

Shared probes identify exact tested and credible untested versions of both
helpers. Malformed/wrong/failed/nonzero/timeout probes block invocation; rejected
choices retain prior settings. Valid untested native selections persist/reopen
and later invocation uses normal trusted commands. Tests verify provenance-only
untested evidence, unchanged unknown/partial coverage, and malformed required
structure/JSON failing without changing the stored snapshot, seen/Undo or NEW.
Settings tests cover textual warnings and both versions in both languages.

Bulk tests cover date-only equality with existing query resolution, inclusive
From, exclusive minute-after-To (including :47 seconds), same-minute ranges,
mixed absent times, stable Kolkata conversion, Warsaw/New York gaps/overlaps,
skipped-midnight date-only rules and valid minutes immediately before a gap.
Malformed dates/times, invalid native partial-clock entries with empty values,
seconds, time without date, reversed boundaries and
renderer-supplied zone/instant fields fail without mutation. Temporary SQLite
checks compare the shared renderer preview predicate with main target evaluation
under injected identical zone/time, including missing/label-only and usable
estimated publication evidence, and retain revisions/recovery on validation
failure. Existing date-filter semantics and regression suites remain unchanged.

Gesture tests cover Shift/Ctrl+Shift application IDs, ordinary/right/middle and
Alt/Meta exclusions, nested controls/links/inputs/contenteditable/roles/tabbable
or explicitly interactive descendants, native keyboard Space, checkbox/label
single invocation, selection intersection and pointer-down selection capture.
The expanded label handles its own click because browser forwarding can discard
Ctrl; input/keyboard activation retain their existing handler. A 10k virtual
reader test changes unmounted descendants while keeping mounted rows bounded,
applied IDs/membership/order fixed, live unseen updated and NEW unchanged.
Existing revision-owned durable recovery/partial Undo suites remain passing.

`npm.cmd run test:electron` passes four real built-entry disposable-profile
phases on Electron 44.4.5 / Node 24.21.0 / SQLite 3.53.4. Main-only dialog/process
seams supply untested yt-dlp 2026.10.07 and post-archiver 0.4.1, validating Settings
selection/warning, real preload/IPC, acquisition, persistence across restart,
reset and environment authority. Browser destinations are captured in a main-only
seam in this offline test. Built UI checks exercise All/date confirmations with optional times,
row toggles/subtrees, durable Undo, native Chromium mouse selection plus Shift
extension, active text selection suppression, actual >=32 px seen labels and
keyboard focus outlines. A native Backspace edit creates a partial clock with
empty value and badInput; confirmation is blocked without any seen mutation.
English/light and Polish/dark Settings/help and Polish
timed confirmations were captured locally and visually inspected. No runtime
test hook or renderer executable/URL authority is shipped.

The optional live walkthrough also passed in a fresh disposable profile using
the installed tested yt-dlp 2026.08.19 and post-archiver 0.4.0. Real header actions
opened [the video](https://www.youtube.com/watch?v=IFPKfypw2CQ) and
[the Community Post](https://www.youtube.com/post/UgkxLEL8EllifRA8ZLoEkkTXSJaa0s_cWf6n)
in the external browser without changing stored state. Video: 173 comments / 173
avatar observations; Community: 34 / 34. Both Refresh operations preserved seen
state and restart retained four items/four tabs. Video had no adapter issues;
Community retained one expected invalid protocol-relative item-avatar warning.
The sanitized Polish/dark live layout was visually inspected. The walkthrough's
pre-query-era 360 px first-comment assertion and generic checkbox selector were
updated for the current controls; first comment was y=437.58 in an 861 px content
viewport, with useful reader space below it. The seen selector now explicitly
targets the comment control rather than query-field checkboxes.

Observed single-run wall times: video acquisition **12.47 s**, video Refresh
**11.94 s**, Community acquisition **4.09 s**. These include live network/helper
and UI acknowledgment and are not performance budgets or benchmarks. No Refresh
or acquisition optimization was made; systematic measurement is the next
milestone. Production profiles were not used. Actual installed untested releases
and human interaction with the native file chooser remain unverified; controlled
native-dialog/probe tests cover acceptance/persistence and malformed output.

To repeat the live walkthrough, set both authoritative helper overrides, the
`YOUTUBE_COMMENTS_LIVE_VIDEO_URL`/`YOUTUBE_COMMENTS_LIVE_POST_URL` variables, and
optionally `YOUTUBE_COMMENTS_LIVE_OPEN_SOURCE=1` to open the originals, then run
`node scripts/verify-live-reader.cjs`. It owns and removes a disposable profile;
ordinary tests remain offline. No helper updates/downloads or production writes
are needed.

## External helper Settings (2026-10-08)

[ADR 0014](decisions/0014-main-owned-helper-settings.md) narrows Q-19 to remaining
helper distribution/compatibility work. **462 offline tests across 39 files pass**.
Typecheck and lint pass without warnings. Standalone renderer and Forge
main/preload/renderer/worker bundles build successfully. The renderer is
410.76 kB / 127.16 kB gzip; the query worker remains 2.60 kB. Forge still exits 0
at finalizing without producing a completed executable; no release/package
completion is claimed. The existing Vite CJS deprecation remains non-failing.

New deterministic coverage verifies environment > saved > PATH, authoritative
invalid/empty overrides, broken saved paths without fallback, per-helper reset,
absolute regular Windows .exe acceptance and relative/directory/missing/.bat/.cmd
rejection. Selection and acquisition share the unchanged exact version probe.
Wrong/unverified versions, failed probes and cancellation retain prior selections;
only fixed status/version/path evidence crosses IPC, never raw diagnostics.
Temporary SQLite checks reopen selections/reset, isolate another profile, and
preserve every schema-6 discussion/comment/state/history/workspace/preferences/Undo
row through schema-7 migration and injected rollback/retry. Runtime tests verify
later acquisition/Refresh switches to a new selection or PATH immediately without
restart. Exact helper-kind/arity tests reject extra executable/path/argument/shell
fields before privileged work; sender/frame/document guards cover all 17 intents.

Component checks cover both helpers, English/Polish, full accessible wrapping path,
automatic/custom/environment sources, ready/unavailable/incompatible/broken states,
Browse/reset/Recheck, clean cancellation and retained selection after failure.
Status checks are lazy once per mounted Settings section, including StrictMode,
and ordinary Reader renders/tab activation do not re-probe. Native picker tests
verify parenting, single-file .exe convenience filtering and clean cancellation.

`npm.cmd run test:electron` passes against the real built entry with Electron
44.4.5 / embedded Node 24.21.0 / SQLite 3.53.4. Four disposable-profile process
phases verify automatic resolution, main-owned selection/cancel/rejection,
acquisition through each newly selected helper, saved selection after restart,
reset and its persistence after another restart, and valid/invalid environment
authority with disabled controls. Environment values never enter helper_settings.
The existing seen/history/workspace/date/NEW/Undo workflows continue passing.
Native-dialog results and subprocess outputs are injected only in the unshipped
main-side smoke script; no renderer injection or runtime test switch is added.

Actual native dialog interaction and live installed-helper/YouTube acquisition
remain unverified by this offline run. For a manual walkthrough, use a new
disposable profile: check both PATH-resolved helpers in Settings, choose their
installed exact-version executables, restart, acquire/Refresh through both, reset
to automatic, reject incompatible/missing choices while retaining a valid prior
selection, and restart with authoritative environment overrides. Never use a
valuable production profile for this check. Bundling/download/update, artifacts,
licensing/integrity and completed installer/release verification remain open.

## Atomic bulk seen actions and durable safe Undo (2026-10-08)

[ADR 0013](decisions/0013-atomic-bulk-seen-and-durable-undo.md) resolves Q-09.
**444 offline tests across 36 files pass**. Typecheck and lint pass without
warnings. Standalone renderer and Forge main/preload/renderer/worker bundle checks
pass. Forge still exits 0 at finalizing without a completed executable; this is
not a release/package fix. The renderer is 406.23 kB / 125.97 kB gzip; the query
worker remains 2.60 kB and excludes Temporal. Existing Vite CJS deprecation and
occasional Electron shutdown GPU diagnostics remain non-failing observations.

Schema-5 to 6 tests preserve existing seen values, initialize zero revisions and
verify complete migration rollback/retry. Temporary SQLite checks cover both All
assignments, discussion isolation, exact frozen matching IDs despite stale seen
state, context/raw-only exclusion, malformed/duplicate/cross-item rejection and
50k matching payloads. Publication scopes reuse ADR 0012: own instant only,
estimated/coarse inclusion, missing/label-only exclusion, local whole-day To,
From/between and Warsaw DST boundaries. Its existing injected multi-zone/DST pure
tests remain. Invalid ranges fail before mutation; targets include hidden rows.

Recovery checks cover changed-only entries, no-op revision preservation, same-item
supersession, other-item independence, one-change multi-target bulk recovery,
single-target preservation and mixed subtree restoration. More than one actual
subtree change creates recovery; one change preserves earlier recovery, including
when several descendants were targeted. Later single edits and away-and-back
revisions win during partial Undo; unrelated edits do not prevent restoration.
All-stale recovery returns zero restored, counts every skip and consumes itself.
Tests reopen the database and tab, preserve revisions across Refresh, exclude
post-operation discoveries and cascade recovery on removal. Composite foreign keys
reject cross-item entries. Injected late update, entry and Undo failures preserve
exact prior states, revisions, recovery entries and descriptors.

Renderer tests cover closed compact controls, conditional dates, English/Polish,
localized action/scope/count confirmation, initial Cancel focus, Escape, pending
write ownership, error/retry and exact frozen matching requests. Confirmation
remains visible outside a hidden discussion panel and retains its named captured
discussion during parallel acquisition. Acknowledged bulk/Undo preserve applied
IDs, roles/counts, visible membership and NEW while updating live unseen/ruler
state. No-op/error feedback preserves recovery. FIFO local save tests retain later
accepted commands. Ctrl+Z works only with discussion recovery outside editable
controls; input/textarea/select/contenteditable preserve native Undo, and missing
recovery does not swallow the key. Settings includes the centralized shortcut.

Generated disposable SQLite measurements from a passing suite run (rounded ms):

| Changed rows | Publication target resolution | State-write replay | Recovery-entry replay | Bulk commit + repository acknowledgment | Undo commit + repository acknowledgment | Recovery file growth |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | 10.9 | 14.2 | 68.3 | 202.1 | 250.2 | 3,059,712 bytes |
| 50,000 | 12.7 | 171.3 | 883.2 | 2,478.5 | 2,116.8 | 15,241,216 bytes |

The target timing uses preloaded stored comments and the shared publication
resolver/predicate. Replay measurements use prepared statements inside rolled-back
transactions, separating writes from entry creation; they are not complete command
latencies and should not be added together. End-to-end repository timings include
full stored projection, real transaction commit and result construction, but exclude
Electron IPC cloning and renderer paint. SQLite file growth includes indexes and
allocated pages, not a theoretical entry size. A late 10k/50k failure proves atomic
rollback before successful All/Undo; subsequent full-size subtree and matching
commands/Undo also pass, retaining only one operation and exactly changed entries.
Measurements are local observations, not millisecond CI thresholds. Synchronous
50k main work still occupies seconds; Q-21 backend worker/clone/paging choices remain
open and this milestone does not redesign bootstrap.

`node scripts/profile-discussions.cjs --50k` passes on generated flat/shallow/mixed
discussions in a disposable Electron profile. It measures renderer reconciliation
and paint separately from SQLite, verifies frozen applied views and observes
bounded mounted rows after bulk/Undo and scrolling. The detailed ignored artifact
is `.vite/performance-results.json`; the ruler retains four structural SVG nodes
with pixel-bounded buckets. Two-frame paint observation contributes a timing floor;
these numbers are not full IPC-to-paint latency or hardware-independent budgets.

| Rows | Bulk acknowledgment + paint, flat/shallow/mixed | Undo acknowledgment + paint, flat/shallow/mixed | Mounted rows after acknowledgment / during scroll |
| --- | --- | --- | --- |
| 10,000 | 24.3 / 21.9 / 25.2 ms | 32.7 / 33.4 / 33.3 ms | 10 / 19 |
| 50,000 | 42.5 / 44.3 / 47.7 ms | 53.3 / 51.0 / 50.6 ms | 10 / 19 |

`npm run test:electron` passes the actual production bundles, bridge and query
worker through **two real process restarts**. On its disposable generated/acquired
fixture it verifies All seen/unseen then Undo; applied Unseen matching bulk keeps
the view frozen until Apply; date-range bulk reaches comments outside an empty
displayed result; mixed Ctrl+click recovers the original mixture; Refresh preserves
existing recovery and excludes new rows; bulk then a later manual edit survives
restart and Ctrl+Z restores only still-owned rows. The second restart verifies
consumption. No valuable production/development database is used for bulk writes,
and no live YouTube requests are required.

Agent-driven Chromium inspection covers `.vite/bulk-confirm-pl-dark.png` and
`.vite/bulk-controls-en-light.png`. These ignored local captures verify presentation,
not brittle pixel snapshots or owner physical-input acceptance. For an owner pass,
use the disposable smoke or a separately configured disposable profile and repeat
the workflows above, then the generated 10k/50k checks. Ordinary viewing/navigation
must remain manual, matching roles remain frozen, and later intentional edits must
win during recovery.

Redo/history, sorting/collapse, persistent query/scroll/selection, backup/export,
global search, arbitrary discovery bulk and release/packaging work remain outside
this milestone. Historical sections below describe their dated milestone state;
this section is current.

## Publication-date and latest-discovery filtering (2026-10-07)

[ADR 0012](decisions/0012-publication-date-and-latest-discovery-filters.md)
closes Q-03 and implements All discoveries / NEW from latest refresh. **400
offline tests across 33 files pass**. Typecheck, lint without warnings, standalone
renderer build and Forge main/preload/renderer/worker bundle checks pass. Forge
still exits 0 at finalizing without a completed executable; no release claim.
The renderer is 396.01 kB / 123.00 kB gzip with pinned Temporal 0.5.1 (ISC,
transitive JSBI Apache-2.0); the resolver is excluded from the 2.60 kB worker.
Vite's CJS deprecation and Electron's occasional shutdown GPU diagnostic remain
non-failing tooling observations.

Pure tests cover inclusive From, exclusive day-after-To, independent open bounds,
same-day/leap/year-end ranges, reversed/malformed dates, Today and rolling 24/168
hours with inclusive now, lower/exclusive-upper endpoints, future instants and
missing publication. Injected clocks/zones verify Warsaw and New York spring/autumn
23/25-hour days, non-DST Kolkata and São Paulo's skipped midnight. Locale formatting
never enters resolution or comparison. Query tests exercise exact and estimated/
coarse own instants, missing/invalid/label-only evidence, no discovery/parent/item
substitution, same-comment AND, full-tree context and separate raw-search counts.

Session tests capture one clock for all rows, freeze membership as time/zone
changes, re-resolve applied rolling/custom criteria at successful Refresh without
promoting date/discovery drafts, and preserve prior results on invalid dates or
evaluation failure. Existing worker deadline/supersession/pathological-regex tests
remain; numeric bounds/NEW payload tests cover deterministic comparison. Temporary
SQLite cohort tests also run NEW-only queries over baseline, old-published/seen
discoveries, partial/unknown/zero-insert acceptance, failure and restart histories.
Renderer tests cover compact closed-by-default details, disabled custom inputs,
Apply/Ctrl+Enter, English/Polish range alerts, independent per-discussion drafts,
and unchanged seen writes. A 10k complete containing tree with one distant date
match retains bounded DOM and exact-ID navigation; one match plus two NEW rows
proves the context NEW lane remains independent of the combined match lane.

`npm run test:electron` passes the actual bundled worker under CSP and **two real
process restarts** in a freshly created disposable profile. Its test-only helper
timestamps cover old baseline publication, missing publication, estimated/coarse
publication, and a later discovery. Its renderer-only clock is fixed then advanced
before explicit Refresh; no production clock or database is modified. The checks
exercise Today, Last 24 hours, Last 7 days, custom From/To, reversed-range retention,
baseline NEW exclusion, NEW-only, search + unseen + date + NEW, seen NEW, applied
Refresh with draft preservation, and ruler navigation without writes. Existing
failed source Refresh and durable NEW/restart assertions still pass.

Agent UI inspection uses the deterministic/disposable smoke discussion, with local
captures `.vite/date-controls-pl-dark.png` and `.vite/date-controls-en-light.png`.
These are agent-driven Chromium checks/visual inspection, not owner physical-input
acceptance. Captures are ignored artifacts, not brittle pixel snapshots. No valuable
profile was changed to manufacture publication/discovery evidence or fetch live
YouTube data. Pure boundary/DST cases remain deterministic rather than relying on
the workstation zone. For an owner pass, run the disposable smoke or use a separate
development root, open Date / discoveries, check each mode and combined search,
then Apply, navigate and Refresh; normal seen state must remain manual.

At this earlier milestone bulk seen commands and undo/recovery were unimplemented;
ADR 0013 now closes Q-09. Date bulk reuses ADR 0012's exact
`resolvePublication` / `publicationMatches` semantics. Arbitrary historical
discovery windows, sorting, collapse, persisted filters/scroll, global search and
broader Q-21 storage/query scaling remain future work. Historical sections below
describe earlier milestones and do not override this status.

## Virtualized overview ruler and durable NEW (2026-10-06)

[ADR 0011](decisions/0011-virtualized-overview-and-durable-new.md) settles the
latest accepted post-baseline NEW cohort and current applied-view ruler. **370
offline tests across 31 files pass**. Strict typecheck and lint pass without
warnings. The standalone renderer build and Forge production main/preload/renderer
bundle checks pass. Forge still exits 0 at finalizing without a completed packaged
executable; this milestone makes no installer/distribution claim. Vite's existing
CJS Node API deprecation remains a tooling diagnostic.

New temporary SQLite tests cover baseline exclusion, old publication, seen NEW,
existing observations, cohort replacement/zero discoveries, accepted partial and
unknown/unavailable collections, failure preservation, tied/regressing clocks,
schema-4 to 5 preserving migration rollback/retry, VACUUM and close/reopen/restart.
Main derives latest accepted attempt from explicit durable ordinals; no mutable
NEW flag is tested or stored. Existing merge rollback and local-state protections
remain. `npm run test:electron` passes write plus **two actual process restarts**
with real acquired-fixture NEW badge/ruler survival, marking NEW seen, failed
Refresh preservation, keyboard ruler reveal with no seen save, and closed-file
SQLite/schema-5 checks. A shutdown GPU diagnostic remains non-failing. Hidden
smoke frames are unthrottled; native text input waits for controlled-value commit
before select/search commands.

Pure ruler tests cover unrestricted unseen/NEW without match-everything,
restrictive active matches, raw-only context exclusion, unseen context, hidden
trees, multiple categories, exact virtual preorder, header-aware first/middle/last
mapping, large estimated/measured heights and resize. Pixel-band tests retain
category counts and deterministic nearest-center/preorder targets. The shared
category spans use binary geometry boundary searches; a 50k structural test
verifies refinement reads fewer than all virtual measurements, without a timing
threshold. Component tests verify tooltip counts in English/Polish, pointer lane
and keyboard activation, 10k/50k constant ruler DOM, unmounted far targets, unchanged
seen, immediate acknowledged unseen versus frozen matches/NEW, Apply scope and
accepted Refresh. F3/live unseen, Ctrl+click subtree and tab-render isolation
regressions still pass.

Run `node scripts/profile-discussions.cjs --50k --real` for reproducible offline
Chromium observations using actual DiscussionPanel/worker/CSS and an owned
disposable profile. The generator now accepts `newIndexes`, using explicit
fixture first-discovery/latest-attempt identities. Real source SQLite is opened
read-only for a consistent backup; all migration/reading uses its disposable
copy. No valuable profile data or public comment text is written/logged/committed.
Generated seen timings exclude SQLite/IPC. The ignored
`.vite/performance-results.json` and generated/sanitized screenshots retain local
evidence; they are not shipped assets.

Representative final flat/shallow/mixed observations at 1280×900, development
React and two frame observations (local ranges, **not CI latency budgets**):

| Observation | 10k | 50k |
| --- | --- | --- |
| Initially mounted / scrolled comment rows | 10 / 19 | 10 / 19 |
| Initial DOM elements | 217–253 | 217–253 |
| Ruler SVG child nodes / occupied bands | 4 / 277 | 4 / 277 |
| Initial render through two frames | 22–26 ms | 77–96 ms |
| Scroll sample through two frames | 36–37 ms | 55–59 ms |
| Acknowledged seen update | 24–25 ms | 35–45 ms |
| Far NEW ruler click to visible selected row | 29–30 ms | 15–16 ms |
| Selective Apply / Refresh reevaluation | 50–51 / 50 ms | 133–150 / 116–133 ms |

An initial implementation recreated one geometry target per marked comment at
every remeasurement: its 50k scroll sample was 75–91 ms. Shared category ranges and
pixel-boundary search reduced that work while retaining all category/identity
information. Projection/indexing still uses O(N) application data; the virtualizer
still refines estimates and full bootstrap/clone/query/memory remain Q-21. These
discrete scroll samples prove bounded mount/reveal and improved work, not a
continuous physical-input frame-rate guarantee. The 10k depth-60 probe also
reveals its final unmounted target with 11 initial / 13 target rows.

The existing real **154-comment** discussion passed copied-data search/context,
manual seen, actual unseen ruler click/exact viewport reveal, immediate category
counts, language change and 831→646→831px ruler resize. All 154 articles remain
mounted under ADR 0010's small-result ceiling. Reflow has no measured gaps/overlap.
The generated raw-hit scenario shows one MATCH/NEW unseen reply, a seen raw-only
SEARCH HIT context root without a match marker, and unseen context separately.
Light/English and dark/Polish captures were inspected for scrollbar-adjacent lanes,
neutral rails, distinct badges and unchanged unseen-only tint. Automated Chromium
interaction and visual inspection are agent checks, not owner physical-input
acceptance. No live YouTube refresh discovering an actually new public comment
was attempted; disposable synthetic ingestion and real built-entry helper fixtures
exercise the rule without forcing changes in valuable data.

Date/discovery filter UI, bulk recoverability/undo, sorting/collapse, persisted
scroll/criteria and broader Q-21 scaling remain future work. Release still needs
backup/restore/export, helper distribution, packaging completion, signing/update
and final Windows acceptance decisions. Historical sections below report earlier
milestones and do not override this current verification.

## Large-discussion rendering and virtualization (2026-10-04)

[ADR 0010](decisions/0010-variable-height-discussion-virtualization.md) records the
before/after measurements, dependency/measurement decision, flat tree-rail model
and remaining Q-21 limits. The generator in `src/development/large-discussions.ts`
controls count, shape/roots, maximum depth, body length, seen ratio and match input
indices. Stable IDs/content/evidence repeat without live YouTube or large fixtures.

Projection tests verify exact existing preorder, depth/root/parent/first/last
sibling metadata and shared ancestor continuation, complete filtered context,
unchanged direct-parent/Community truth, frozen placement after Refresh failure,
and iterative 10k-deep projection. Component tests run the actual pinned TanStack
virtualizer with deterministic viewport/ResizeObserver geometry: bounded 10k
mounted rows, distant unmount/mount, variable height correction, width reflow,
configurable overscan, one focused retained row, selected remount, exact far/deep
match/live-unseen reveal/wrap, explicit Apply/start and Refresh anchor retention,
ordinary/Ctrl seen over unmounted descendants, stable applied Unseen results and
only visually changed article rendering. These use work/row/identity assertions,
not hardware latency thresholds or pixel snapshots. Small 154-row results retain
semantic byline/time/checkbox labels and complete list positions/counts.

App tests retain all prior query, shortcuts, manual seen and ADR 0009 isolation
checks, including zero unrelated work during activation with a 10k hidden panel.
Existing temporary SQLite tests protect transactional subtree scope and durable
state; the renderer still has no SQLite access. Final verification:
**356 offline tests across 29 files pass**, strict typecheck and lint pass without
warnings. Standalone renderer and Forge production main/preload/renderer bundles
pass. The existing Forge exit-0 stop at finalizing remains, with no completed
executable/release claim. esbuild config resolution and Chromium GPU checks need
the ordinary outside-sandbox retries. Built-entry Electron smoke passes manual
state/query/workspace checks, two actual process restarts and closed-file SQLite
persistence. The existing nonfatal shutdown GPU diagnostic remains.

Optional `node scripts/profile-discussions.cjs --50k --real` builds a separate
ignored Vite harness using the actual DiscussionPanel/worker/styles, blocks network
avatars, and starts Electron in an owned disposable OS-temp profile. Without
`--real` it needs no existing database. With `--real`, the source database opens
read-only for a consistent backup; only its disposable copy is read/migrated.
No originals are changed, no raw public archives/text are logged or committed.
Generated-only seen timing excludes SQLite/IPC; persistence is verified separately.
The harness checks actual last-target viewport intersection, not just selection
identity or row presence, and saves ignored generated/sanitized screenshots.

At 1280×900, the recursive 10k baseline mounted 10k comments / 155k–173k DOM nodes,
took 2.17–3.03 s through two frame observations, and 1.07–1.24 s for a normal seen
toggle or far selection. Tree/identity preparation was 9–16 ms. After virtualization,
10k initially mounted 10 rows / 212–246 nodes (19 rows around a scrolled viewport),
flat projection took 2.2–4 ms, initial rendering 16–21 ms, seen/far navigation
29–33 ms, selective Apply 48–51 ms. At 50k, projection took 11–19 ms, initial render
63–69 ms, seen 28–48 ms and Apply 150–167 ms; mounted work stayed the same. An
additional 10k discussion with chains up to depth 60 revealed its last target.
Frame observation floors/cold startup explain some variation; these are local
evidence, not CI budgets or owner physical-input signoff. CDP heap observations
can be collected by the harness without forced GC; full memory budgets stay open.

The existing real **154-comment** video passed offline worker search/count/context,
single manual seen change and exact target reveal on the copied dataset. All 154
articles remained mounted. Sanitized captures were inspected for compact reading,
bylines/avatars/fallbacks, neutral connected rails and separate unseen treatment.
Locale reflow also passed measured row-adjacency assertions with no gaps/overlaps.
Production entry IPC/restarts remain covered by `npm run test:electron`; this
generated harness adds no product preload capability or durable view state.

## Keyboard discoverability and workspace shortcuts (2026-10-04)

The Windows keyboard milestone reuses the existing workspace/query actions and
introduces no dependency, schema, IPC or persistent preferences. Registry tests
check unique IDs, exact/formatted chords and independent display-name mapping.
Settings tests in both locales compare every rendered entry to the complete
registry, verify localized descriptions/scopes and semantic key markup/row headers.
App tests cover cycling/wrap across mixed tabs, right/left/empty close without
deletion, discussion/Library search focus and selection, unconsumed Settings/empty
Ctrl+F, URL reveal/select/repeat and subsequent native editing, F1 closed/background/
active/empty Settings and failed/pending acknowledgments, contextual input ownership,
focused-tab-only reorder and safe removal confirmation/pending writes. Existing
Ctrl+Enter/F3/Shift+F3, Enter/Escape, Ctrl+Click, manual-seen and performance tests
continue to pass. Tooltip/help checks compare registry output in English and Polish.

Verification: **332 offline tests across 26 files pass**, strict typecheck and lint
pass without warnings. Renderer-only and Forge main/preload/renderer production
bundles pass. esbuild config loading required broader filesystem access after the
sandbox denied parent-directory reads; the Electron GPU subprocess also required
the ordinary outside-sandbox retry. Forge retains the documented exit-0 finalizing
limitation without a completed executable; an installer/distributable is not verified.

`npm run test:electron` now also sends native Chromium key input through the real
built reader in a disposable profile: tab cycling/wrap, close neighbors, discussion/
Library focus-selection, ordinary search/URL typing/arrows, repeated Ctrl+L, F1
singleton activation/heading focus, unconsumed Settings Ctrl+F and removal modal
ownership. It checks control titles, the Settings reference and absence of comment/
Library deletion from workspace actions, then passes its existing acquisition/query/
seen/workspace checks, two real restarts and closed-file SQLite persistence.
The existing nonfatal shutdown GPU diagnostic remains.

English/light and Polish/dark Settings captures are saved under ignored `.vite/`
and were visually inspected for readable key labels, table layout and theme tokens.
This is scripted native UI verification plus agent visual inspection, not a
hand-operated owner acceptance signoff. A manual acceptance pass should cycle and
close several mixed tabs, inspect hover hints, invoke F1 from closed/background/
active Settings, use Ctrl+F/Ctrl+L and then type/navigate in those inputs, and confirm
removal owns the keyboard. Ctrl+R/F5 source Refresh, reopen and numbered tabs are
deliberately unbound; no new query/filter/persistence feature is claimed.

## Tab-switch performance and input verification (2026-10-04)

See [ADR 0009](decisions/0009-isolated-discussion-rendering-and-tab-input.md) for
before/after evidence and limitations. Deterministic App counters cover Library,
Settings, A→B with C open, A draft/Apply and seen changes, and held workspace saves.
They verify unrelated panels/forests/trees stay idle and mounted DOM/scroll survives.
Pointer tests cover stable capture, outside-tab motion, child capture loss, primary
and other pointer release, one write, Escape/delayed release, pointercancel and
lifecycle loss. Wheel tests cover overflow, edges, horizontal deltas, units and
drag coexistence.

Optional `node scripts/profile-tabs-dev.cjs --interactions` requires the existing
development database (or `YOUTUBE_COMMENTS_QUERY_DATABASE`). It backs up the
read-only source into a disposable profile and opens all stored discussions. It
does not log public text or commit captures. Nine switches on five discussions
including the existing 154-comment video measured 515–597 ms before and 23–73 ms
after. Work fell from four executions per discussion to zero. Timings include
acknowledgment and two frame observations, depend on hardware/run, and are evidence
rather than CI assertions.

Enable `window.__readerWork = {}` in development DevTools to record panel/forest/
root-tree work; reset that object for a new sample. Production records no counters.
The script uses native CDP input to check dragging into the reader/back/across a
scrolled strip, stationary edge auto-scroll, one reorder revision, Escape then
delayed release, rapid mixed clicks, tab wheel and discussion wheel. It does not
claim cross-OS physical-input testing outside the native window. Full initial
mounting/large-discussion rendering and virtualization remain targets.

Final verification: **315 tests across 25 files pass**, typecheck and lint pass,
the standalone renderer build passes, and Forge production main/preload/renderer
bundles pass. The built-entry Electron smoke passes writes, two real restarts and
closed-file SQLite persistence. Its existing shutdown GPU diagnostic remains
non-failing. Forge again exits 0 at finalizing without a completed executable;
this milestone makes no installer/distributable claim. Run development profiling
before the final Forge build: `npm start` replaces `.vite/build` with development
entries, so the built-entry smoke must follow a production rebuild.

Automated testing is a product requirement. Vitest covers domain/localization, components, temporary SQLite, IPC/bridge/sender validation, adapters and injected processes. [ADR 0006](decisions/0006-compact-reader-and-persistent-tabs.md) adds compact reading, avatars, helper overrides and bounded tab persistence. ADR 0008 adds active-discussion search/seen filtering, stable session applied views and match/unseen navigation. Dates, bulk recovery/actions, backup, persisted scroll/filter/expansion and full view restoration remain targets.

## Active-discussion query verification (2026-10-04)

[ADR 0008](decisions/0008-active-discussion-applied-queries.md) records exact
comparison, worker/deadline, session draft/applied, context and navigation rules.
Schema remains 4; no new IPC, FTS, raw fixture archive or dependency is added.

- `npm test`: **297 tests pass in 25 suites**, offline. Strict typecheck and lint pass without warnings.
- Renderer and Forge main/preload/renderer bundles pass, with a separate same-origin
  worker asset. CSP worker-src self succeeds in the built Electron reader. Forge
  retains the existing finalizing/no-completed-executable limitation; no release claim.
- Built-entry Electron smoke passes query Apply, ordinary/regex, rejected syntax
  retaining results, F3 identity selection without seen writes, Refresh reapplication
  preserving draft, manual state, preferences, workspace/deletion and two real restarts.
  A nonfatal Chromium shutdown GPU diagnostic remains.

Domain tests cover content/displayName/handle/direct-parent fields, missing/cyclic
and Community containment nonmatches, opaque-ID exclusion, multi-field OR plus seen
AND on one comment, empty search, NFC/case/diacritics/Unicode/multiline/ECMAScript
u/iu, full sibling/branch context, raw-only hits, counts and preorder wrap/navigation.
Temporary SQLite tests query actual normalized projection and committed refresh
rows, including stored comments absent from extraction and preserved local seen.
Session tests cover frozen seen-result/counts, second Apply, failed draft/Refresh
retention, independent draft reapplication, supersession/disposal and concurrent
seen saves. Renderer tests cover controls, validation/timeout, per-discussion
session switch/close/reopen, StrictMode, raw-only context, pending indicators,
Apply/Ctrl+Enter, Refresh placement changes with evaluation failure, buttons/F3/
Shift+F3 and the final scroll target. Localization tests cover keys and count plurals.

Worker tests use injected 20/25 ms deadlines and fake timers, including creation/
execution errors, old replies, supersession, termination/recreation, late deadline
checks and no partial acceptance. A real isolated test thread executes the actual
browser-worker handler/pure evaluator against `(a+)+$` and a long synthetic input;
its deadline is advanced only after the worker signals evaluation started. The
next recreated worker completes ordinary and regex queries. No production-sized
sleep or native regex package is needed; Node adaptation stays test-only.

### Separate development/live and visual check

[scripts/verify-query-dev.cjs](../scripts/verify-query-dev.cjs) launches real Forge
start against a consistent SQLite backup of the existing development library in
a freshly owned OS-temp profile. It leaves the original database untouched. The
loopback debugger drives UI controls, application IPC snapshots verify saved state,
and only aggregate results are logged. Public source data stays in the disposable
profile; screenshots replace titles/authors/content in DOM and stay ignored locally.

The existing video began with **154 stored comments**. Content, author and known
direct-video-parent author searches, Unseen, combined content/Unseen, stable saved
seen membership/counts, second Apply, valid/invalid regex, F3/Shift+F3 and unseen
buttons, independent discussion state and Refresh with unapplied draft all passed.
An initial no-override run also verified failed Refresh preserved the applied view.
Exact helper executables were found by reading PATH wrappers and supplied as
main startup overrides; wrappers themselves were never executed. The second run
completed live Refresh and public Community acquisition. Community direct-author
regex returned zero matches for thread containment. The video gained two locally
stored comments on that live run; seen and applied/draft semantics were preserved.
Light/dark sanitized screenshots were inspected for compact controls, neutral
connected rails, avatar alignment and separate unseen treatment.

This is scripted development UI verification plus agent visual inspection, not a
hand-operated owner acceptance signoff or a remote completeness guarantee. Dates,
bulk recovery/actions, persistent criteria/selection/scroll, collapse, virtualization,
ruler/NEW final presentation and large-data Q-21 budgets remain unimplemented.

## Unified workspace and Library removal verification (2026-10-03)

ADR [0007](decisions/0007-unified-workspace-and-library-removal.md) adds schema 4,
mixed singleton app/discussion tabs and local deletion. Normal tests stay offline.

- `npm test`: **255 deterministic tests pass in 21 suites**, offline.
- Typecheck and lint pass without warnings. Renderer build and Forge production
  main/preload/renderer bundle checks pass. Forge still stops at finalizing with
  exit 0 and no completed executable; no packaging fix/release claim is made.
- `npm run test:electron` passes writes and **two actual process restarts**,
  schema 4, mixed app/discussion order and active identity, pointer/keyboard reorder,
  confirmed local removal and closed-file FK/state/history checks. The existing
  nonfatal shutdown GPU diagnostic remains. esbuild and Electron GPU checks need
  Windows sandbox escalation.

Coverage includes populated schema-3 → 4 preserving migration (including empty
workspace), rollback/retry with foreign keys ON, app/discussion singletons, mixed
close neighbors and restart/order/active identity, first/middle/last move and invalid
indexes, pointer preview/final commit/cancel and Alt+arrow reorder, accessible kind
labels/separate close, full Library open/closed metadata/counts/filter/demo protection,
Cancel/Remove confirmation and failed/busy deletion feedback, and Settings controls
outside toolbar. Temporary SQLite deletion cases check content/comments/local state/
history/workspace absence, unrelated data/preferences/app views, late transactional
rollback, prior failed target history and restart without resurrection. Same-source
Acquire/Refresh rejects removal while different-source removal remains available;
stale content/workspace acknowledgments preserve newer deletion and mixed tabs.
A 60-level tree retains structural DOM depth/rails/elbows across seen edits and
Ctrl+click; no brittle pixel snapshots are used.

The built-entry Electron smoke script now checks the twelve-method isolated bridge,
native mouse tab dragging, keyboard reorder, Settings preferences, modal Cancel/
Remove, deletion and mixed workspace persistence across two real process restarts.
Its fake process injection stays only in the privileged test script; it is offline.

### Separate development and visual verification

The optional [development workspace check](../scripts/verify-workspace-dev.cjs)
launches the real Forge start/development app with a freshly owned OS-temp profile
and a loopback Chromium debugger used only by the verification script. It inherits
the owner's PATH, uses explicit startup helper executable overrides and never changes
the regular development/production databases. It exercises singleton open/close,
Settings changes, live acquire/Refresh, native pointer reorder retaining active,
Library reopen, real Community local removal with Cancel then confirmation, and
a real development restart. Only aggregate results are logged. Screenshots substitute
representative text and failed-avatar fallback in DOM only and remain ignored local
artifacts. The profile is cleaned with an owned-directory guard.

This is scripted UI interaction plus agent visual inspection, not an exhaustive
hand-operated owner acceptance pass. The first development attempts failed to deliver
toolbar clicks through debugger mouse events; the control path uses DOM click
dispatch and the reorder path uses native debugger input. The built-entry smoke
separately uses actual Electron mouse events. Visual review corrected parent gutter
rail alignment; compact deep levels have a neutral return connector while retaining
all semantic nesting. Executed with the existing exact yt-dlp/post-archiver executables in a disposable
development profile: the previously verified video IFPKfypw2CQ acquired/refreshed
**154 stored comments**, with projected depth up to **3**. Manual seen state survived
Refresh; a real background Settings drag moved it to the first slot without changing
active Library. Library reopened the closed video. The previously verified Community
Post acquired/refreshed successfully, Cancel preserved it, and confirmed Remove
deleted it locally while retaining the video/demos/preferences/app tabs. Restart
restored the exact mixed order, active discussion, preferences and absence of the
removed real item. Light/dark sanitized screenshots were visually inspected; the
neutral rail and separate UNSEEN tint/badge/checkbox are distinct. These are live
runtime checks, not remote completeness claims. Helper paths are not renderer data
and no raw public archives/comments are committed.

The owner's exhaustive hand-operated UX acceptance pass remains outstanding,
especially high-depth rail readability and longer Library lists. The automated
60-depth DOM test establishes nesting/structure, not a large-data layout benchmark.

## Compact reader/workspace verification (2026-10-03)

- `npm test`: **214 deterministic tests pass in 16 suites**, offline without helpers,
  Python or network. Added coverage includes avatar extraction/URL safety/lossy
  preservation/newer updates/old JSON and image fallback; populated schema-2→3
  preserving migration/rollback; open/close/restart/order/active/empty behavior;
  Library reopen/same-item reacquisition/seen-history protection; failed tab writes;
  compact URL reveal/hide/submit, descriptions, accessible close controls and stale
  workspace responses; exact workspace IPC shapes; override precedence/invalid paths,
  startup snapshot, pinned probes and unchanged no-shell execution; verified English
  like labels and the retained protocol-relative post-avatar warning.
- Typecheck and lint pass without warnings. Renderer-only build and Forge production
  main/preload/renderer bundle checks pass. Forge again exits 0 at finalizing without
  a completed executable; this milestone makes no packaged release claim.
- `npm run test:electron` passes writes plus **two real process restarts**, schema 3,
  eight-method isolated bridge, tab close/Library reopen/order/active identity and
  closed discussion preservation, as well as the prior seen/preferences/security
  checks. Fake helpers and avatar omission keep this smoke check offline; no
  fake-execution switch is shipped in product code. The known shutdown GPU diagnostic
  remains nonfatal. esbuild/GPU subprocess checks need Windows sandbox escalation.

### Separate development/live checks

The real `npm.cmd start` app launched with exact yt-dlp/post-archiver executable
overrides, the owner's PATH unchanged, and a disposable OS-temp development root.
An initial test profile inside the repository triggered Vite watching locked
Chromium cache files; moving that verification profile outside the watched tree
resolved it without a product/configuration change. Neither real development nor
production user data was migrated/modified by these checks.

The optional [live reader harness](../scripts/verify-live-reader.cjs) exercises the
real Forge-built entry and UI in a separately owned temporary profile, with no fake
process injection and no Python Scripts PATH addition. It verified live video
acquisition, avatar loading and forced-error fallback, description expansion,
manual seen saving, Refresh preserving avatar/seen/tab identity, tab close/reopen
through Library, closed Community retention, and active/order/seen restoration after
a real restart. Layout was inspected locally at 1680×900; the first video comment
began about 320px down. This is a scripted live UI exercise plus visual inspection,
not a claim of an exhaustive hand-operated native UI acceptance pass.

Final live acquisition/Refresh outcomes through the real bridge:

| Source | Stored comments / supplied commenter avatars | Acquire / Refresh adapter issues | Workspace/state |
| --- | --- | --- | --- |
| Video IFPKfypw2CQ | 154 / 154 | 0 / 0; coverage stays partial from helper warning evidence | Avatar/seen/active ID preserved; close/Library reopen uses same item |
| Community UgkxLEL8EllifRA8ZLoEkkTXSJaa0s_cWf6n | 34 / 34 | 1 / 1: `invalid-field $.item.avatarUrl` (protocol-relative post-author URL) | Seen/active ID preserved; closed item remains in Library |

The earlier Community profile was unavailable. A metadata-only recapture showed
all 34 comment likes as integer English accessibility labels; the old parser's
integer-only grammar explains the systematic `invalid-field` comment `.likes`
warnings. The corrected grammar removes those 34 warnings while retaining the
one newly modeled post-avatar warning. Counts/zero exit never prove completeness.
A real restart restored three open tabs, four library items and the marked video
comment; the closed Community item remained listed in Library.

All temporary
normalized profiles/archives are removed; no raw public dump or real source name/
avatar URL is added to fixtures. The layout screenshot is a local ignored artifact.
Normal test commands do not run this optional harness.

To repeat it after Forge builds, configure `YOUTUBE_COMMENTS_YTDLP_EXE`, optionally
`YOUTUBE_COMMENTS_POST_ARCHIVER_EXE`, and explicit public
`YOUTUBE_COMMENTS_LIVE_VIDEO_URL` / `YOUTUBE_COMMENTS_LIVE_POST_URL`, then run
`node scripts/verify-live-reader.cjs`. The latter two variables are test-script
inputs only, not product configuration or renderer capabilities.

## Live acquisition verification (2026-10-03)

- `npm test`: **186 deterministic tests pass in 14 suites**. No internet,
  installed helpers, Python or authenticated access is required. Added coverage
  includes target canonicalization/rejection; no-shell argument/environment/stream
  boundaries; executable absence/version checks; deadlines/abort/buffer bounds;
  Community owned config/output cleanup on success/nonzero/timeout/invalid output;
  adapters through SQLite; repeated acquisition/refresh identity, absence, unseen
  discoveries and seen preservation; BUSY with concurrent local writes; shutdown;
  exact IPC payloads/sender checks; UI Enter/activation/refresh, localized failures
  and local checkbox use during acquisition, including response reconciliation.
- Strict typecheck and lint pass without warnings. Renderer-only build and Forge
  production main/preload/renderer builds pass. Forge again exits 0 at finalizing
  without a completed `out` executable; helper distribution/installer is unverified.
- `npm run test:electron` passes the real built-entry write phase and two real
  restarts. Its privileged test harness injects fake process execution before
  importing the application, with test-owned executable placeholders in PATH.
  No fake-execution switch is shipped in the app. It exercises both adapters,
  acquired-item activation, refresh/new/missing comments, seen persistence,
  failed-refresh preservation, isolated SQLite and preferences. Closed-file checks
  confirm schema 2, 32 comments, nine attempts (four synthetic, four accepted
  helper-style and one failed), and the five-method isolated bridge.
- Windows sandbox restrictions require escalation for esbuild config loading and
  real Electron GPU subprocesses. The successful smoke run still emits the known
  shutdown GPU diagnostic without assertion/exit failure.

### Optional anonymous live verification (separate from normal tests)

The installed direct executables returned yt-dlp **2026.08.19** and
`post-archiver 0.4.0`. The first normal yt-dlp PATH lookup was a `.bat` wrapper;
the disposable live harness prepended the existing executable's directory to
its child PATH only. Production resolver code contains no machine-specific path.
Installed Community `cli.py`, `config.py`, `scraper.py` and `output.py` were read
to verify the version command, minimal anonymous config and actual archive naming.

Through the real built Electron main/bridge in a disposable development profile:

| Owner-supplied target | Acquire | Refresh | Restart |
| --- | --- | --- | --- |
| [Video IFPKfypw2CQ](https://www.youtube.com/watch?v=IFPKfypw2CQ) | 153 comments inserted unseen; partial helper-warning evidence; no adapter issues | Same item, 153 existing observations, zero insertions; manually marked comment retained seen | Item and seen state retained |
| [Post UgkxLEL8EllifRA8ZLoEkkTXSJaa0s_cWf6n](https://www.youtube.com/post/UgkxLEL8EllifRA8ZLoEkkTXSJaa0s_cWf6n) | 34 comments inserted unseen; partial configured-limit evidence; 34 optional-metadata adapter warnings | Same item, 34 existing observations, zero insertions; manually marked comment retained seen | Item and seen state retained |

Both helper executions and refreshes exited zero. Unknown/partial coverage was
not promoted to complete. Real Community output matched the verified channel-based
archive filename. Its optional-metadata warnings did not reject useful observations
or change authoritative adapter rules. No raw comments/archives were committed;
the disposable profile and temporary output were removed afterward.

Earlier attempts against the public extractor test video `BaW_jenozKc` and the
Community package's example post `UgkxMVl0vgxzNvE3I52s0oKlEHO3KyfocebU` returned
`ACQUISITION_FAILED`; their precise remote causes were not established. They made
no replacement discussion. These are separate from the successful owner targets
and from deterministic verification; live availability is not a test requirement.

## Persistence foundation verification (historical)

- `npm test`: **131 deterministic tests pass in eleven suites**: the prior 97 plus 8 pure merge/projection tests and 26 temporary SQLite ingestion/migration/history tests. Tests need Node 24.13+ with built-in SQLite, no live Electron/network/YouTube or installed helpers. Every SQLite case owns its temporary database. Existing Ctrl/Space, acknowledgment/failure, safe retry, schema and preference coverage remains unchanged. The new extractor coverage is detailed below.
- `npm run typecheck`: passes with strict TypeScript and TSX.
- `npm run lint`: passes without warnings. Generated `.vite` and `out` artifacts are excluded. The scaffold's legacy ESLint import resolver cannot resolve Vitest's package export; a documented single-line exception leaves TypeScript and the runner to validate that import.
- `npm run build:renderer`: passes; emits the React bundle and relative local asset paths.
- `npm run package`: Forge production main/preload/renderer builds passed on Windows x64. Generated main uses external `node:sqlite`; preload exposes only the three application methods. The process again returned exit code 0 during packaging without producing a completed executable in `out`; a distributable is **not verified**. No makers/fuses or release settings were changed to address this existing limitation.
- Actual Electron 44.4.5 main-side SQLite probe passed with embedded Node 24.21.0 / SQLite 3.53.4. A hidden runtime harness loaded the real Forge-built entry points, rendered all 24 stored synthetic comments, exercised ordinary click and Ctrl+click, checked ancestors/siblings/other discussion preservation, opened the Community Post, and tested malformed payload rejection through the real bridge. It verified exactly three bridge methods, no renderer Node globals, sandbox/context isolation, both languages, all appearance modes, live native light-to-dark System changes, and explicit Light override. Light/dark Polish screenshots were inspected locally.
- The harness closed and restarted the **real Electron process twice** against one freshly created isolated development root. First restart restored Polish/Dark and both ordinary/subtree comment edits; second restored English/System with the same comments. A separate read-only opening of the closed SQLite file confirmed schema 2, 24 stored comments, four explicitly synthetic history attempts, and durable preferences. The reusable focused check is [scripts/smoke-electron.cjs](../scripts/smoke-electron.cjs), run with `npm run test:electron` after Forge builds. It creates/cleans only its own temporary profile, clears inherited Node-only Electron mode for its children, and uses no additional UI framework. Earlier screenshot artifacts were inspected locally; no screenshot/database is committed. These checks prove built-app persistence and IPC, not an installed/distributable package.

Persistence coverage includes empty 0→2 migration, metadata/ordering reopen, unsupported newer-schema rejection without file changes, profile/configuration isolation, idempotent demo initialization, ordinary/subtree restart state and unrelated comments, language and all appearance modes, configured foreign keys/constraints, a late-write trigger failure rolling back the whole subtree, version-0 migration failure preserving data, a real initial-schema collision, and ordered later-migration rollback/retry. A supported app does not silently recreate a failed database.

Commands were run on Windows with Node 26.7.0 using `npm.cmd` because PowerShell blocks `npm.ps1`. esbuild config loading required a sandbox retry with broader filesystem access. The runtime check removed the inherited `ELECTRON_RUN_AS_NODE` environment variable for its process so Electron could run as a desktop app. Vite's existing CommonJS Node API emits a deprecation notice; it does not fail these checks.

Hidden-window smoke runs emitted a Chromium GPU diagnostic during shutdown; the renderer/preload checks, all assertions, and process exit results passed.

`npm start` uses the separate development profile and idempotently seeds the two fixtures. `npm run build:renderer` provides an independent renderer build. To run just the new integration suite, use `npm test -- src/main/persistence/reader-repository.test.ts`. A manual acceptance pass can switch tabs/languages, click and Ctrl+click mixed subtrees, check that NEW survives marking seen, change all appearance modes, quit, and restart: seen state and explicit preferences should remain while the current milestone also restores open tab order/active selection (remaining Q-10 view state stays open).

For an alternate disposable development root in PowerShell, set `$env:YOUTUBE_COMMENTS_DEMO_ROOT` to an absolute directory before `npm.cmd start`; it appends `youtube-comments-development/reader.sqlite` and never uses production fallback. Clear that environment variable afterward to return to the usual development profile. When this environment inherits `ELECTRON_RUN_AS_NODE=1`, clear it for desktop execution. Empty/relative demo-root configuration fails. Never point verification at real production data. Those historical foundation checks did not claim live acquisition/refresh. Current search/live verification is recorded above; virtualization/ruler performance, backup/restore and a packaged installer remain unverified.

## Durable normalized ingestion verification (2026-10-02)

All 131 offline tests pass, including all 24 schema-1 demo comments migrating with
seen/preferences/IDs/order intact, actual schema-2 migration rollback/retry,
unsupported-newer rejection, source scope, authority (all unknown reasons and
trustworthy empty/zero/false), accepted unknown/partial baselines, later discoveries,
absence, relationship updates, Community containment, unresolved/later-resolved
relationships, cycle-safe projection, identical/conflicting duplicate skipping,
same-item history constraints, complete evidence retention, sanitized history,
mid-merge rollback, seen-write exclusion and close/reopen.

`npm run typecheck` and `npm run lint` pass without warnings. The independent
renderer build and Forge production main/preload/renderer builds pass. Forge
again exits 0 during finalizing without a completed executable; no distributable
claim or packaging fix is made. `npm run test:electron` passes writes and two real
restarts against a disposable profile, including schema 2/four synthetic attempts,
the unchanged three-method bridge, manual seen behavior and preferences. The
existing shutdown GPU diagnostic was emitted without assertion/exit failure.

Run the new suites alone with `npm test -- src/domain/observation-merge.test.ts src/main/persistence/observation-ingestion.test.ts`. All normal
tests remain offline and require neither helpers nor Python. Publication labels
are not converted against the test clock. Future NEW lifetime and process/UI
behavior are not asserted as implemented.

## Test layers

| Layer | Purpose | Environment |
| --- | --- | --- |
| Domain/unit | Prove tree, state, merge planning, filtering, search, and sorting behavior quickly. | Vitest is installed; tree/manual-state foundation tests exist. Pure merge/projection/search/seen-filter/navigation tests exist; dates/sort/bulk/ruler await later increments. |
| Persistence/integration | Prove transactions, migrations, queries, restart persistence, backup/restore, and data isolation. | A fresh temporary SQLite database for each independent test case or deliberately isolated suite. |
| Adapter/fixture | Prove backend output becomes valid domain data without exposing backend types. | Saved extractor output and controlled process-runner responses; no YouTube or helper installation required. |
| Focused UI/end-to-end | Later, prove a small number of meaningful workflows across the Electron boundary and actual UI. | A test profile and fixture data; UI automation tooling remains undecided. |
| Optional live smoke | Detect changed extractor behavior against selected remote examples. | Explicit opt-in, network/helper prerequisites, and a disposable profile, separate from deterministic checks. |

Most rules should be testable without opening Electron. Application services should accept clocks, repositories, and extraction dependencies in forms that allow deterministic control; exact dependency-injection mechanics are not prescribed. Prefer behavioral assertions over tests that merely repeat implementation details.

Windows is the initial development and packaging target. The deterministic domain suite should remain portable, while packaged/UI checks initially target Windows. Linux/macOS are future possibilities, not initial test-matrix requirements.

## Deterministic domain coverage

The table is a requirements matrix. Decisions marked unresolved in the linked documents need explicit acceptance rules before their boundary cases can become normative tests.

| Area | Required examples and invariants | Specification |
| --- | --- | --- |
| Stable identity and merge | Repeated acquisition of a stable source comment ID updates one existing comment; different content/source identities cannot accidentally overwrite one another. | [Domain model](DOMAIN_MODEL.md), [Refresh and merge](REFRESH_AND_MERGE.md) |
| Seen preservation | Refresh text/metadata for both a seen and an unseen comment and preserve each local value. A refresh concurrent with a manual state change must not write stale seen state back. | [Seen state](SEEN_STATE.md), [Refresh and merge](REFRESH_AND_MERGE.md) |
| Initial acquisition baseline | The first successful acquisition establishes a baseline. Every imported comment starts unseen and receives `firstDiscoveredAt`, but the baseline has no visual NEW indicators. | [Refresh and merge](REFRESH_AND_MERGE.md) |
| Later discoveries | A top-level comment or reply first discovered during a later refresh starts unseen and is eligible for NEW even if its `publishedAt` is old. | [Refresh and merge](REFRESH_AND_MERGE.md) |
| Missing records | Omit a previously stored comment from an extraction and retain it and its local state. Absence alone never deletes. | [Refresh and merge](REFRESH_AND_MERGE.md) |
| Failed/partial/uncertain refresh | Malformed output, process failure, interruption, and failed persistence preserve the previously valid snapshot. A successful process exit must not turn unknown completeness into complete coverage. Test the chosen partial/uncertain-result policy explicitly once decided. | [Refresh and merge](REFRESH_AND_MERGE.md), [Database](DATABASE.md) |
| Discovery versus unseen | An existing comment does not become a new discovery merely by remaining unseen in another refresh; marking a later discovery seen does not rewrite its discovery facts. Test indicator lifetime only after that policy is selected. | [Domain model](DOMAIN_MODEL.md), [Refresh and merge](REFRESH_AND_MERGE.md) |
| Manual checkbox | A normal checkbox toggle affects only that comment. Viewing, scrolling, expanding replies, and navigating never mark a comment seen. | [Seen state](SEEN_STATE.md) |
| Ctrl+click subtree | Choose the resulting state from the clicked comment, then apply that value to it and every descendant, including collapsed or unrendered descendants. Leave ancestors, siblings outside the subtree, and unrelated trees unchanged. | [Seen state](SEEN_STATE.md) |
| Contextual trees | An otherwise seen thread with one unseen reply remains visible as the complete relevant tree. Identify the matching reply separately from context comments. Repeat for text, author, replied-to author, and date filters. | [Filtering and search](FILTERING_AND_SEARCH.md) |
| Matching-set bulk action | Default to the active discussion. Use the last applied active-filter matching IDs, including while saved seen edits await Apply; exclude context-only comments. Do not silently re-evaluate targets at execution time or use raw search matches alone. | [Filtering and search](FILTERING_AND_SEARCH.md), [Seen state](SEEN_STATE.md) |
| Stable filtered view | Persist a seen-state edit immediately while preserving current displayed membership/order. Apply changes recomputes from stored state without starting a remote extraction. Exercise failure reporting for unsuccessful persistence. | [Filtering and search](FILTERING_AND_SEARCH.md), [UI and navigation](UI_AND_NAVIGATION.md) |
| Explicit remote refresh | After a successful user-requested Refresh safely commits its merge, automatically recompute the active view. Preserve manual seen state; failed refreshes preserve valid stored data. | [Refresh and merge](REFRESH_AND_MERGE.md), [UI and navigation](UI_AND_NAVIGATION.md) |
| Text search | The initial core searches original stored contents throughout the active discussion, including collapsed and unrendered comments. Cover required substring, regex, and case modes; library-wide search is not an initial requirement. | [Filtering and search](FILTERING_AND_SEARCH.md) |
| Author search | Cover required display-name/handle and direct replied-to-author search, plus source author identity where supported. Cover top-level thread-author search only if that optional capability is added. Distinguish replying to a reply from replying to its top-level author. | [Filtering and search](FILTERING_AND_SEARCH.md), [Domain model](DOMAIN_MODEL.md) |
| Regex | Cover explicit regex opt-in, case-sensitive and insensitive modes, valid expressions, and invalid expressions producing validation errors rather than crashes or misleading empty results. Test any resource limits once selected. | [Filtering and search](FILTERING_AND_SEARCH.md) |
| Combined filters and counts | Distinguish raw search matches from comments satisfying all active filters, then add context. A raw search match that fails the date or unseen condition is not an active-filter match. One comment satisfying text and another satisfying date must not falsely satisfy an AND query. Report active-filter matching-comment and containing-thread counts separately. | [Filtering and search](FILTERING_AND_SEARCH.md) |
| Publication dates and presets | Cover from/to ranges and the chosen useful presets, such as Today, Last 24 hours, or Last 7 days, with an injected clock. The exact preset list is flexible. Cover boundaries, missing timestamps, timezone changes, and daylight-saving changes according to the documented policy. | [Filtering and search](FILTERING_AND_SEARCH.md) |
| Discovery versus publication | Any "new since refresh" control uses discovery history, not publication dates. A reply published long ago and first discovered after the baseline can qualify; an already stored reply does not qualify solely because its publication timestamp is recent. Baseline imports have no visual NEW; test remaining discovery-window/marker-lifetime details once chosen. | [Filtering and search](FILTERING_AND_SEARCH.md), [Refresh and merge](REFRESH_AND_MERGE.md) |
| Bulk date operations | Default to the active discussion and test mark all, before, after, between, and actual matches. Each date operation tests the comment's own publication timestamp and does not implicitly change relatives or other discussions. Verify recoverability according to the selected undo policy without prescribing its mechanism. | [Seen state](SEEN_STATE.md) |
| Tree construction | Unordered parent/child input, nested replies, empty discussions, duplicate IDs, missing parents, and invalid cycles. Enforce the chosen malformed-tree policy without losing otherwise valid stored data. | [Domain model](DOMAIN_MODEL.md), [Extractors](EXTRACTORS.md) |
| Sorting | Sort primarily among top-level threads; keep descendants attached to their conversation and stable comment identity available for navigation. Test tie behavior once specified. | [UI and navigation](UI_AND_NAVIGATION.md), [Domain model](DOMAIN_MODEL.md) |
| Navigation and ruler | Next/previous match navigation uses the applied active-filter matches, not every raw search hit. Unseen navigation and the required unseen/search/new ruler categories use application data, including targets outside the DOM. Marker navigation resolves a comment by identity under virtualization and sorting; overlap/position rules await their design. | [UI and navigation](UI_AND_NAVIGATION.md) |
| Locale independence | Changing UI language does not change stored original content, search membership, seen state, or canonical timestamps. | [Localization and theming](LOCALIZATION_AND_THEMING.md) |
| Appearance default | A fresh profile defaults to System and follows OS appearance changes; explicit Light/Dark overrides persist. | [Localization and theming](LOCALIZATION_AND_THEMING.md) |

## SQLite integration and user-data safety

Every test database must be explicitly isolated from the real user profile. Use temporary paths and a test-specific configuration; do not fall back to the production database if test configuration is absent. Development profiles must also be separate from production. See [Database](DATABASE.md) and [Packaging](PACKAGING.md).

Integration tests should cover:

- Committing a refresh's comment/metadata changes and associated discovery/history information consistently, and rolling back candidate changes on failure.
- Persisting manual seen changes immediately, including when refresh work is in progress, without lost updates.
- Restarting with tabs, useful per-tab view state, language, and appearance preferences restored according to the selected persistence design.
- Preserving publication, first-discovered, and last-observed times according to their distinct meanings; repeat refreshes must not rewrite first discovery.
- Preserving the initial-acquisition baseline separately from later refresh discoveries, without inferring NEW eligibility from publication time or seen state.
- Migrating supported older schema fixtures while preserving comment identities, text, local state, and refresh history; rejecting unsupported schema versions safely.
- Simulated migration failure, failed writes, and restoration from a backup without silently replacing valuable user data with an empty database.
- Backup consistency and successful round-trip restoration once the database backup mechanism is chosen.
- Database-enforced constraints and query results, especially matching identities/counts and tree reconstruction at realistic data sizes.

Exact migration support windows and backup formats remain unresolved in [Database](DATABASE.md) and the [decision register](decisions/README.md). Undo retention and revision ownership are implemented by ADR 0013: one durable operation per discussion without expiry, consumed once with later edits protected. Tests encode that policy.

## Fixtures and process tests

Implemented extractor tests cover yt-dlp root/direct-parent depth with parents
after children, opaque IDs, absent versus explicit zero/false metadata,
estimated publication labels/instants, unavailable/null versus empty comments,
ordinary unknown and externally evidenced partial coverage. Community tests
cover top-level/thread containment (including deeper nesting without fabricated
direct parents), default collapse, unreliable flags/counts, image/link metadata,
publication labels, and conflicting duplicate candidates. Both paired fixture
sets normalize changing membership independently with no deletion actions.
Required malformed shapes and wrong backends fail without publishing
observations; malformed optional fields stay unknown. Tests check version and
preparation provenance, generic-contract separation, missing/cyclic references,
and pure arguments/child-environment specs. ADR 0005 adds the injected process
runner/workspace/orchestration tests described above.

The [eleven-file fixture matrix](../src/main/extractors/__fixtures__/README.md)
documents ten reconstructed-sanitized fixtures from verified investigated
formats and one synthetic duplicate conflict. Names/text are invented,
IDs/references are consistently remapped and attachment URLs are harmless.
An offline development-only round trip through the installed Community 0.4.0
serializer passed for all five raw archive examples. Python/helpers are not
required by normal tests. Run just this boundary with
`npm test -- src/main/extractors`.

Use saved backend output for `yt-dlp` and `post-archiver-improved` adapter tests. Keep fixture schemas separate from application domain fixtures. Record each fixture's backend/version where known, what behavior it exercises, and whether it is captured, redacted, or synthetic. Avoid committing credentials or unnecessary personal information.

Include minimal fixtures for optional metadata, Unicode/Polish text, multiline content, unavailable timestamps, nested relationships, parents arriving after replies, partial data, malformed output, and duplicate/conflicting identities. Which fixture represents a valid source record must be verified against the selected backend; do not invent an output format and call it a captured example.

A controlled runner should simulate missing helpers, incompatible output, process failure, cancellation, and diagnostic output. Assert safe argument construction and that only the main process invokes extractors. An internal database worker remains owned by the main-side backend and does not expose SQLite or other privileges to the renderer. The planned adapter boundary is in [Extractors](EXTRACTORS.md).

## Small meaningful UI workflows

A small meaningful UI/end-to-end suite is expected later. Choose a few workflows that prove the important boundaries; this is not a requirement for a large suite duplicating every domain case. Useful candidates include:

1. Acquire the unseen baseline without NEW indicators, manually process a comment, then explicitly refresh with a later discovery and verify preserved state plus automatic active-view recomputation.
2. In Unseen only, save a seen edit without moving the result, apply a matching-set bulk action to the last applied IDs while excluding context, then Apply changes locally.
3. Search a large discussion with another active filter, navigate to an unrendered active-filter match through the keyboard/ruler, and reopen the saved workspace after restart.

Use focused checks as needed for English/Polish, System as the first-run appearance, persisted Light/Dark choices, safe rendering, and the typed security boundary. Current Windows keyboard bindings and virtualized reveal are verified above; later platform bindings and collapse remain open. Retain most edge-case coverage in the deterministic domain/integration suites.

## Performance and test execution

Generate reproducible datasets containing thousands and tens of thousands of comments, including deep and broad trees. Verify filtering/search/navigation do not inspect DOM nodes and that rendering is virtualized. Timing and memory budgets must be chosen against supported target hardware; avoid arbitrary pass/fail thresholds before that decision. Performance regressions should be measured separately from deterministic correctness assertions where timing would be flaky.

The normal suite must run without live YouTube access, credentials, or external helper installation. Future optional smoke tests must have a distinct command/opt-in switch and disposable database. They can reveal upstream drift but must not make ordinary domain validation depend on remote availability.

The foundation selects Vitest, jsdom, and Testing Library in [ADR 0001](decisions/0001-synthetic-reader-foundation.md). Keep commands and current verification above in sync with [agent guidance](../AGENTS.md). Behavior changes require corresponding tests and documentation; significant policy choices belong in [ADRs](decisions/README.md).
