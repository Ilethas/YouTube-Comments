# Testing strategy

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

Exact migration support windows, backup formats, and undo retention are unresolved in [Database](DATABASE.md) and the [decision register](decisions/README.md). Tests should encode the policy that is selected, not invent it.

## Fixtures and process tests

Implemented extractor tests cover yt-dlp root/direct-parent depth with parents
after children, opaque IDs, absent versus explicit zero/false metadata,
estimated publication labels/instants, unavailable/null versus empty comments,
ordinary unknown and externally evidenced partial coverage. Community tests
cover top-level/thread containment (including deeper nesting without fabricated
direct parents), default collapse, unreliable flags/counts, image/link metadata,
publication labels, and conflicting duplicate candidates. Both paired fixture
sets normalize changing membership independently with no deletion actions.
Required malformed shapes and unsupported versions fail without publishing
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
