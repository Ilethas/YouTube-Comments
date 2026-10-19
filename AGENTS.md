# Project guidance

## M9.2 review boundary

[M9.2 verification](docs/M9_2_VERIFICATION.md) records final regression/distribution
checks, refreshed fictional-data Electron screenshots and remaining owner gates.
Use `node scripts/capture-readme.cjs` after a Forge build and
`node scripts/verify-presentation.cjs` for the six current PNGs/links/icon frames.
The paired-window image combines two actual native content captures; it does not
certify physical dragging. P01–P25 in the M8 manual matrix remain pending, including
physical Close-flicker confirmation. ZIP remains recommended; installed Squirrel
behavior is unverified. Project license/third-party notice review is outstanding.
No release/version/identity/schema change, Setup execution or public publication
is authorized by this evidence. Stop for owner review; leave changes uncommitted.

## M9.1 scale boundary

[M9.1 report](docs/M9_1_PERFORMANCE.md) records disposable production-entry
2/4-window 10k/50k measurements, independent same-item views, large transfers,
shared operations, failure injection and lifecycle/restart/restore equality.
`npm.cmd run profile:m91` records repeated observations; `test:m91` is the shorter
correctness/stress run after a Forge build. Run benchmarks serially, separate from
other tests. JSON payload sizes/RAF/heap snapshots are approximations, not timing
budgets or physical-input certification. Full-profile hydration and synchronous
main work remain Q-21 concerns.

Reader comment snapshots omit the redundant optional `remote` evidence tree;
all consumed author/relationship/publication/state projections remain. Complete
SQLite evidence, schema **14** and migrations 1–14 remain unchanged. Do not
reintroduce that tree into bootstrap, item snapshots or mutation results without
measuring aggregate bridge/memory cost. Preserve M2 ordering, M3 barriers and
M4–M8 ownership/live-result safety. No worker/paging/index/persistence redesign
is selected. M9.2 README/release/screenshot results are linked above for owner review.

[ADR 0036](docs/decisions/0036-measured-reader-snapshot-hardening.md) reuses only
shared bootstrap data at one repository commit revision. Every transaction clears
it before execution and on exit (including failure); reads inside transactions
bypass it. Keep all caller-private seeds fresh and never derive authority from
cached data. Preserve the existing 1000 ms query deadline; main snapshot stalls
can delay early windows' cold worker loading.

## M8 current boundary

[ADR 0034](docs/decisions/0034-native-html-tab-dragging.md) implements HTML DnD over
M7 on schema **14**, unchanged. Primary mouse pointer-down prepares a source-only
main ticket before synchronous dragstart writes ONLY the opaque UUID custom MIME
token. No pointer-capture adapter runs alongside HTML. Genuine authenticated
recipient drop binds exact topology/neighbor/document once; source terminal event
must arrive before M7 freeze/checkpoint/readiness/COMMIT. Local reorder uses its
existing CAS lane with no-op suppression; ordinary hover never freezes reading.

The isolated outside drag-end detector uses bounded sequenced app hover and native
cursor/visibility/focus DIP evidence. It is a heuristic: unobserved Escape outside,
foreign-app/taskbar and desktop release may detach identically by accepted owner
policy. Delivered DOM/native Escape cancels. Never infer correct Escape detection,
positive desktop release or topmost recipient from coordinates. New reader creation
uses M6 current work-area clamping and M7 hidden readiness/atomic restore enrollment.
M3 revokes tokens before drain manifests. Preserve M7 live frozen results, same ID,
owner-generation/ABA and both save-lane fences. No hook/addon/overlay/file drag.

`test:m8` is category A synthetic DragEvents through real production windows/IPC/DB;
it is NOT an OS drag-loop or physical pass. See `docs/M8_MANUAL_VERIFICATION.md` and
the OS-temp-only `node scripts/manual-tab-drag.cjs` launcher. Physical input remains
pending. M9 aggregate scale/release remains outside M8. Preserve M0/M0.5 ledgers.

## M7 foundation (historical scope)

[ADR 0033](docs/decisions/0033-atomic-cross-window-tab-transfer.md) implements explicit
Move to Window/New Window on schema **14**, unchanged. Main owns short-lived one-use
reservations bound to exact authenticated source/target documents, topology,
profile epoch and ownership generation. Discussion moves preserve the SAME tab/view
ID and bounded live frozen results/selection/anchor; never substitute restart query
reconstruction for an uninterrupted handoff. Source final intent/collapse saves must
acknowledge before readiness/COMMIT. The single repository transaction moves owner,
placements/active IDs, revisions/resume pointers and new-native restore enrollment;
private view children survive. Normal same-item views NEVER merge. Library/Settings
merge into existing target singleton identity/state; dirty source Settings requires
explicit preserve/discard. Empty source natives remain open.

Every transfer rotates runtime owner authority and advances both save lanes. Preserve
ABA rejection for intent/collapse and sealed M3 checkpoints. M3 cancels precommit
reservations before capturing participants; transfer cancellation must NEVER release
a concurrent profile queue pause. New natives stay hidden/dormant until COMMIT and
failed creation never leaves restore membership. Transient tokens/results never enter
SQLite/backups. Preserve exact migrations 1-14 and all older safety tests. M8 now layers gestures over this protocol; M9 scale/release remains future work.

## M6 foundation (historical scope)

[ADR 0032](docs/decisions/0032-equal-native-windows-and-session-restoration.md)
implements equal native production windows and schema **14**. Main owns one
ReaderService/SQLite profile, per-window authenticated workspaces and independent
views. File > New Window / Ctrl+N (Cmd+N) creates an empty workspace. Explicit
window_restore/window_session membership is authoritative: Quit captures all live
windows before teardown; ordinary peer Close removes one; last Close retains one;
crash restores acknowledged membership. Dormant app_windows rows never imply live
readers. Persist normal DIP bounds via getNormalBounds, separate maximize/fullscreen
and display hints; validate current work areas without a global DPI multiplier.
M3 all-participant drains remain, including native checkpoints before snapshots and
Close/Quit. Terminal offline fencing covers every native save. Preserve exact
migrations 1?13, verified safety/staged backups and empty/no-reseed rules. M7 transfer,
M8 native HTML DnD/detachment and M9 scale/release remain outside M6. Earlier
milestone notes below retain their original scopes and one-reader limitations.

This project is a persistent YouTube discussion reader built toward Electron + React + TypeScript. The core loop is acquire, persist, refresh, identify changes, read in context, manually mark processed, and search/filter/navigate.

## Start here

- [Documentation map and status](docs/README.md)
- [Product requirements](docs/PRODUCT_REQUIREMENTS.md) and [owner's walkthrough](docs/HOW_IT_WORKS.md)
- [Architecture and security boundary](docs/ARCHITECTURE.md)
- [Open decisions and ADR process](docs/decisions/README.md)

The current implementation includes main-owned SQLite ingestion/merge/history, isolated profiles, typed validated IPC, live public acquisition/refresh, compact English/Polish reading, real avatar evidence, schema-14 preserving history with unified draggable discussion/Library/Settings tabs, metadata Library filtering and confirmed local removal, Settings preferences, neutral ancestry rails and separate unseen row styling. External helper Settings uses main-owned native selection and profile-local SQLite configuration: startup environment > saved selection > safe direct PATH, with helper identity probes, tested/untested confidence and fail-closed configured paths (ADRs 0014/0015). See ADRs [0001](docs/decisions/0001-synthetic-reader-foundation.md), [0002](docs/decisions/0002-sqlite-and-typed-reader-boundary.md), [0004](docs/decisions/0004-durable-observation-merge.md), [0005](docs/decisions/0005-live-helper-execution-and-acquisition-ipc.md), [0006](docs/decisions/0006-compact-reader-and-persistent-tabs.md), [0007](docs/decisions/0007-unified-workspace-and-library-removal.md), and [testing status](docs/TESTING.md). Active-discussion search/seen filtering, stable session applied views and match/unseen navigation are implemented in [ADR 0008](docs/decisions/0008-active-discussion-applied-queries.md). Isolated discussion rendering and keyboard discovery are implemented (ADR 0009 and the shortcut registry). [ADR 0010](docs/decisions/0010-variable-height-discussion-virtualization.md) adds flat variable-height virtualization, neutral data-derived rails and unmounted-target reveal. [ADR 0011](docs/decisions/0011-virtualized-overview-and-durable-new.md) adds the applied-view, height-based three-lane ruler and durable latest-accepted post-baseline NEW cohort, using explicit attempt order. [ADR 0012](docs/decisions/0012-publication-date-and-latest-discovery-filters.md) implements publication-date and latest-refresh discovery filters, with system-zone calendar boundaries and captured evaluation clocks. [ADR 0013](docs/decisions/0013-atomic-bulk-seen-and-durable-undo.md) implements atomic bulk all/frozen-matching/publication seen actions, one durable recovery per discussion, revision-owned partial Undo, subtree recovery and contextual Ctrl+Z. [ADR 0014](docs/decisions/0014-main-owned-helper-settings.md) adds durable helper Settings and immediate runtime resolution. [ADR 0015](docs/decisions/0015-safe-usability-intents-and-helper-confidence.md) adds secure original-source header actions, tolerant tested/untested helper versions, optional bulk local minutes with explicit DST rejection, and historical row marking gestures (removed by ADR 0022). [ADR 0016](docs/decisions/0016-whole-conversation-sorting.md) implements immediate whole-conversation sorting, sorted navigation/match position/ruler and identity/offset anchoring; Q-08 is resolved. Helpers and Python remain separately user-installed; public release distribution remains open. [ADR 0018](docs/decisions/0018-acquisition-progress-and-safe-cancellation.md) implements global coarse acquisition progress, exact-ID user cancellation before atomic saving, failed cancelled history, child/temp cleanup and nonpersisted monotonic stage timings. Do not optimize extraction speculatively. [ADR 0017](docs/decisions/0017-persistent-discussion-view-restoration.md) implements persistent per-discussion draft/applied queries, sort, stable comment anchor/offset and selection with lazy fresh restart reconstruction, resolving Q-10 for the current uncollapsed reader. ADR 0023 implements persistent reply collapse/expansion; optional badge details remain; Q-21 still covers bootstrap/clone/memory and SQLite/query scaling. Implement only the owner's requested increment.

[ADR 0022](docs/decisions/0022-reader-actions-external-links-and-translation-preferences.md) removes row-wide Shift marking, adds the reduced-motion CSS acquisition spinner, evidence-only video creator presentation, identity-only main-owned author/video-comment/Google Translate actions and schema-9 translation target preference. No Community comment permalink is invented. Translation is explicit browser opening with full UTF-8 text, 5000-unit text and 8000-character encoded URL bounds and localized full-copy fallback; never log text/generated URLs. Icons use the shared app-owned outline ActionIcon vocabulary. Preserve exact known older-schema validation, pre-migration safety and staged backup upgrade. Selection, menus and explicit scopes are implemented separately by ADR 0024.

[ADR 0023](docs/decisions/0023-persistent-thread-collapse-and-virtual-navigation.md)
adds fully expanded defaults, reply toggles, discussion Expand/Collapse all, schema-10
sparse defaults/exceptions, complete versus displayed projection, persistent ancestor
reveal and compressed three-lane ruler aggregation. Hidden selection stays logical;
anchors map to visible collapsed ancestors. Queries/bulk/Undo retain complete targets.
ADR 0024 adds selection, menus and explicit selected/prefix scopes.

## Invariants to protect

- [ADR 0030](docs/decisions/0030-persistent-window-topology-and-view-instances.md)
  implements M4 with schema 13: persistent windows, opaque tab/view instances (the
  SAME ID for a discussion), per-window placement and singleton tabs, per-view
  semantic intent/collapse and explicit owned dormant resume pointers. Schema-12
  migration maps EVERY item, exact workspace order/active state and optional raw
  state without normalization; closed discussions and absent rows survive. Keep
  historical migrations 1-12 exact, verified pre-migration safety and staged backup
  upgrades. Main derives window ownership before authorizing a document; renderer
  IDs cannot grant ownership. Topology uses CAS; intent and collapse use separate
  CAS lanes, including M3 sealed checkpoints. M2 epochs/commit revisions and all
  shared item/seen/history/Undo semantics remain. M5 adds Duplicate Tab and per-view
  descendant DOM namespaces (ADR 0031). M6 adds equal native windows, restore sets
  and geometry (ADR 0032); M7 owns atomic transfer/generation handoff.

- [ADR 0029](docs/decisions/0029-global-profile-and-window-lifecycle-safety.md)
  implements M3 with main-owned all-participant profile/Close/Reload/Quit drains,
  immutable pre-preparation mutation tickets, bounded exact-sequence drain leases,
  M2 reconciliation before release and terminal offline-restore fencing. Keep
  FIFO seen/preferences/Undo dispatch and preserve absent optional view/collapse
  rows when clean. Initial native Close retains authority until successful drain;
  failed or later-cancelled close must stay usable. A crash/uncontrolled reload
  retains only committed data. M4 scopes renderers to separate persisted windows
  and owned views; M5 adds independent duplicates (ADR 0031). M6 supplies production
  sessions/geometry (ADR 0032); preserve the exact native/manual evidence limits.

- [ADR 0028](docs/decisions/0028-ordered-shared-state-synchronization.md) implements
  M2 with repository post-COMMIT epoch/revisions, bounded fixed notifications,
  subscribe-first renderer reconciliation and watermark/snapshot recovery. Epochs
  and commit revisions are runtime-only, distinct from durable comment/workspace
  revisions; schema stays 12. Checkbox IPC requires an explicit displayed desired
  state. Undo requires the displayed expectedOperationId and rejects replaced
  recovery atomically. Peer seen changes keep frozen applied membership/order;
  accepted Refresh retains local applied criteria/drafts. Progress fans out to
  all authorized participants. M3 global profile/close/reload drains are implemented
  in ADR 0029; M6 equal production windows retain those contracts (ADR 0032).

- [ADR 0027](docs/decisions/0027-secure-window-coordination-foundation.md) implements
  M1: one secured application-window factory, main-owned WindowCoordinator runtime
  identities/document leases and once-registered authenticated reader IPC. Native
  dialogs use the captured current caller only; origin loss cancels preflight and
  helper selection, never reparents. Confirmed restore/started backup retain existing
  app-owned safety/shutdown. M2 synchronization is implemented by ADR 0028 and M3
  barriers by ADR 0029; M4–M6 now supply topology/views/native sessions. Transfer
  remains M7 work. Current schema is 14.
  Native HTML DnD is preferred for future M8; the owner accepts initial outside
  detachment where Escape may create a window. Keep outcome detection separate from
  durable transfer logic; M8 real native input testing remains required.

- [ADR 0026](docs/decisions/0026-custom-translation-reader-minutes-and-layout.md)
  adds schema-12 atomic custom translation activation plus separately retained code,
  renderer/main syntax validation and accessible Settings help. Reader semantic
  HH:mm filters share bulk Temporal resolution, DST rejection and complete final
  minutes; resolve once before the numeric-only worker and persist no UTC bounds.
  Loading rings intentionally rotate under reduced motion; other motion remains
  unchanged. Video title/source action precede the thumbnail. Selection circles use
  an outer lane with shared avatar/rail geometry and responsive depth compaction.

- [ADR 0025](docs/decisions/0025-persistent-video-thumbnails.md) adds optional
  profile-owned video thumbnails without schema changes or comment reacquisition.
  Main owns approved HTTPS retrieval, bounded raster validation, atomic disk cache,
  conditional freshness and opaque image-protocol capabilities. Cache bytes live
  beside SQLite and are excluded from backups. Renderer requests item identity
  only; explicit thumbnail menu activation alone may call main-owned shell.openPath.
  Preserve canonical-video association through restore/removal, quiet offline
  fallback, mounted-local expansion and virtual comment anchors. No demo/post
  image requests, arbitrary file/URL bridge or additional application window.

- [ADR 0024](docs/decisions/0024-comment-selection-context-menus-and-view-prefix-seen.md)
  adds schema-11 selection visibility and include-collapsed-prefix preferences,
  session-only per-discussion bulk ID sets, accessible context menus and confirmed
  explicit selected/view-prefix assignments. Navigation selection stays independent.
  Shift ranges belong only to round controls in current visible order. Native text
  selection/Copy remain. Prefix stops at the clicked comment inclusive, never its
  subtree end; default includes earlier hidden descendants, optional visible-only
  mode excludes them. Confirmed item/IDs never enlarge or retarget after view changes.
  Main validates every unique owned ID atomically; durable partial Undo remains
  revision-safe. Schema migration must preserve populated cascading child entries.
  Group collapse assigns selected expandable parents only, never recursive Expand
  All. This requested increment supersedes earlier no-selection/menu/scope exclusions.

- [ADR 0021](docs/decisions/0021-windows-squirrel-installer-and-application-identity.md)
  adds Windows x64 Squirrel artifacts and stable identity alongside ZIP. Use
  `npm.cmd run make:squirrel` or `make:zip`; preserve exact resolvable maker names
  so Forge target selection retains config. Validate Setup's embedded payload,
  NuGet runtime bytes, RELEASES and existing package/ZIP checks. Keep fixed
  youtube-comments EXE/profile identities independent of productName. Lifecycle
  events must never enter reader/profile/SQLite startup; let the established helper
  finish shortcut work before quitting. Uninstall retains profile/recovery data.
  NEVER execute Setup/install/update/uninstall on the owner's normal account;
  APPDATA redirection is not Squirrel isolation. Genuine installation tests require
  an established permitted disposable account/VM/Sandbox; do not provision one
  without permission. Without it, report lifecycle behavior UNVERIFIED.
  Version 1.0.0 is scaffold metadata; unsigned artifacts are not a public release.

- [ADR 0020](docs/decisions/0020-windows-packaged-application-and-zip-distribution.md)
  implements Windows x64 Forge application folders and complete no-install ZIPs.
  Package/make commands validate fresh executable/runtime/ASAR/fuse output; never
  infer success from Vite bundles or exit zero. Keep scoped Node 26 ZIP-reader/maker
  compatibility overrides until upstream replacements are verified. No-install keeps
  the established application-data profiles; copied folders share the same account's
  production data. Do not rename profiles, add portable data or weaken fuses/sandbox.
  Use `npm.cmd run test:packaged` for extracted-EXE native backup/real relaunch tests;
  it owns demo and independently isolated Windows production profile environments.
  Squirrel artifact generation is added by ADR 0021; genuine installed verification,
  helper bundling, signing and public release remain outside ADR 0020 evidence.

- [ADR 0019](docs/decisions/0019-consistent-sqlite-backup-and-safe-restore.md) implements complete asynchronous SQLite backup and confirmed full-profile restore in Settings, with native main-owned dialogs and payload-free intents. Flush renderer seen/view queues before snapshots; main rejects later mutations, settles children/helpers, verifies a separate current-data safety snapshot, checkpoints WAL/selects DELETE and closes connections before offline replacement. Immutable phases and startup recovery preserve safety/previous/failed artifacts without pruning. Unknown/modified/newer schemas reject; known older backups migrate only on staged copies. Startup creates verified pre-migration snapshots before schema changes. Never copy an open live file, downgrade, seed an existing/restored empty profile, or create an empty fallback after failed recovery. Use disposable profiles for verification. Retention management, future portability/format versioning, export and installer/portable finalization remain outside ADR 0019; Windows application/ZIP packaging is implemented separately in ADR 0020.

- One global live Acquire/Refresh owns an opaque operation ID and a fresh controller composed with shutdown. Only exact active cancellable IDs accept Cancel; stale IDs cannot affect later operations. Typed safe progress has no raw process details or percentages. Saving/cancellable=false linearizes immediately before synchronous atomic ingest. Pre-save cancellation records only failed `user-cancelled` target history, preserving accepted attempts/NEW/comments/seen/Undo/views and creating no item/tab. Await child close and temp cleanup before settlement; successful remote commit may then show non-cancellable Updating view (ADR 0018).

- Each discussion view instance has optional durable semantic draft/applied queries, sort, stable comment anchor/row offset and selection. Hydrate a session only once from bootstrap; later acknowledgments never overwrite live intent. Restart freshly evaluates saved applied criteria against current durable comments/seen/NEW with fresh now/system zone, then sorts/restores identities without focus or seen writes. No result IDs, resolved numeric dates, measurements, errors or pending state persist. Coalesce/serialize full-intent saves; close retains state, removal deletes it. Corrupt rows and failed restoration fall back per discussion (ADR 0017).

- Each persistent window owns one ordered list of opaque tab instance IDs: discussion views referencing shared items, singleton Library and singleton Settings per window. All are closable/reorderable; none is pinned. Revision guards stale acknowledgments. Alt+Left/Right reorders focused tabs.
- Library items and open workspace tabs are distinct. Close never deletes content/comments/seen/history. Open activates one existing tab or reopens the same item; tab order and active identity persist in SQLite. Closing active chooses right, then left, then empty.
- Remove from Library requires an in-app confirmation (Cancel initially focused) and atomically deletes the selected local discussion/comment/state/history/view/collapse/Undo, including synthetic demos. Keep `isDemo` derived from stored synthetic baseline provenance independently of `removable`; never infer demo identity from application IDs or names. Reject removal of the active acquisition source; never remotely delete. Development seeds only genuinely fresh profiles; deleted demos and existing/restored empty databases never reseed. Library filtering covers metadata only.
- Context menus have one active enabled item shared by keyboard focus and actual pointer movement. Stationary hover cannot override keyboard activity. Preserve native selected text and dismissal focus. Floating controls belong to the discussion's existing `.reader-panel`: Back to Top scrolls that panel to zero without session mutations; selection controls appear only with selected IDs and the ordinary toolbar outside that panel viewport. Reuse the same actions, frozen confirmation and durable Undo. Keep scroll observation constant-time and threshold-based, with no virtual row/projection work.
- Tree rails/elbows are neutral structure; unseen is a subtle row tint plus badge/checkbox. Keep source relationship projection and avatars unchanged. Language/Appearance belong in Settings; helper selection/validation/persistence stays main-owned; Settings displays narrow status evidence.
- Avatar unknown/lossy observations never clear useful evidence. Render usable HTTPS images with anonymous/no-referrer loading and fixed-size initials fallback. Helper paths are selected through a main-owned native picker or authoritative startup environment; `.bat`/`.cmd` and shell execution remain excluded.
- Seen/unseen belongs to each comment, persists in SQLite, and changes only through explicit user actions. Viewing, scrolling, navigation, and refresh never mark a comment seen. There is no persistent thread-level seen state.
- Row surfaces have no seen gestures: native drag/Shift/cross-element selection and Copy never mark. Checkbox click toggles one; Ctrl+checkbox assigns that resulting state to the stored subtree. Durable Undo/applied views/NEW remain unchanged. [Seen state](docs/SEEN_STATE.md)
- Bulk all/frozen-applied-matching/publication commands are active-discussion only and atomic with recovery. One durable undo operation per discussion has no expiry; changed-row revision ownership preserves later edits, including away-and-back edits. Ordinary/single-target edits, no-ops and failures retain prior recovery. Multi-target bulk with changes replaces it; Ctrl+click replaces it only when >1 comments actually change. Undo conditionally restores, increments revisions and consumes recovery; no redo. Local acknowledgments are FIFO. Bulk/Undo never recompute applied views or NEW; live unseen/ruler/navigation update.
- Refresh merges by stable source identity, preserves local state, inserts new comments unseen, and does not delete comments merely absent from an extraction. Failed/partial refreshes must preserve valid stored data; refresh writes are transactional. [Refresh and merge](docs/REFRESH_AND_MERGE.md)
- First successful acquisition establishes a baseline: record discovery metadata and insert comments unseen, without visual NEW markers. NEW is exactly the latest accepted post-baseline first-discovery cohort, ordered by durable attempt ordinal. Accepted partial/unknown attempts replace it, including zero discoveries; failures preserve it. Seen, publication and restart never reset NEW. Discovery, publication time, and manual unseen state are distinct.
- Initial search/filtering and generic "all comments" bulk actions cover the active discussion only, including all its stored comments. Library-wide search is future scope; a generic Mark all must never imply a library-wide mutation.
- Distinguish raw search matches, applied active-filter matches, and context. Include complete containing trees. Matching bulk actions and next/previous match navigation use the last applied active-filter matching set, never visible context alone. [Filtering and search](docs/FILTERING_AND_SEARCH.md)
- Seen edits persist immediately without changing current membership/order or replacing the applied matching set. Apply/Ctrl+Enter promotes draft only on successful worker evaluation. Successful explicit Refresh re-evaluates last applied criteria and preserves draft. Per-discussion draft/applied semantics persist independently; restart freshly reconstructs applied criteria against current durable comments/seen/NEW using fresh now/system zone and starts seenStale false. Derived IDs remain session-only; removal clears both session and stored view. [UI and navigation](docs/UI_AND_NAVIGATION.md)
- Discussion search is NFC substring with deterministic `toLowerCase()` (diacritics significant), or explicit ECMAScript regex with only u/iu. Selected content/displayName/handle/known-direct-parent-author fields OR, then AND seen, publication and discovery on the same comment. Community containment never supplies direct author. All comparisons use a cancellable dedicated worker with a 1000 ms deadline; errors retain the prior result. [ADR 0008](docs/decisions/0008-active-discussion-applied-queries.md)
- Match navigation uses applied matches; unseen navigation uses live seen over the displayed complete trees, including context. Both wrap in data preorder and never write seen. F3/Shift+F3 navigate matches; DOM only reveals an already resolved application ID.
- Sorting is immediate presentation over complete display-root trees. Original is the stored/display preorder; Newest/Oldest use only root publication, Most liked only adapter-projected root likes, Latest activity the newest usable publication anywhere in the tree. Unknowns are always last; Original breaks ties. Preserve reply order, frozen query membership, selection/anchor identity, and sorted navigation/match position/ruler. Apply/Refresh retain sort; seen/NEW alone never reorder. ADR 0017 persists sort and restores it after fresh applied-query reconstruction. [ADR 0016](docs/decisions/0016-whole-conversation-sorting.md)
- Publication-date filters use `publishedAt`; "new since refresh" uses discovery/refresh history. Calendar dates use the current system zone at Apply/Refresh: inclusive From, exclusive day-after-To; Today is a local day, Last 24h/7d are rolling durations with inclusive now. Missing own publication instants fail active date predicates; estimated/coarse instants participate. Date bulk shares the calendar resolver/predicate with the current system zone at command evaluation; optional HH:mm From is inclusive and To ends at the exclusive minute-after-To. Explicit ambiguous/nonexistent clock times reject without writes; date-only day boundaries remain unchanged. [Seen state](docs/SEEN_STATE.md)
- The overview ruler covers only applied displayed preorder: live unseen including context, restrictive applied matches (never raw-only hits), and durable NEW. Three lanes retain overlap; pixel buckets bound marker DOM. Click/keyboard activation uses existing application-ID virtual reveal and never marks seen. Search, filtering, counts, navigation, and overview markers operate on application data, never on which rows happen to exist in the virtualized DOM.
- Original-source opening accepts only `{itemId}`; main reads stored identity, reconstructs/validates supported canonical HTTPS YouTube video/post destinations and opens the browser. No generic URL bridge.
- Renderer access follows typed preload/contextBridge -> privileged backend owned by the Electron main side -> persistence/extractors. Renderer never owns/accesses SQLite. Main-side database work may later use an internal worker; only main invokes extractors. No arbitrary Node, filesystem, SQL, or process-launch API in the renderer. [Extractors](docs/EXTRACTORS.md)
- Treat SQLite data as valuable user data. Isolate development/test databases, preserve backups and migration safety, and never use localStorage for durable application data. [Database](docs/DATABASE.md)
- Design for English/Polish and System/Light/Dark from the start; System is the default. Use stable translation keys, Intl formatting, semantic tokens, and persisted preferences. UI locale does not change content or search. [Localization and theming](docs/LOCALIZATION_AND_THEMING.md)
- Windows is the initial development/packaging target; preserve reasonable paths to Linux/macOS later. The overview/navigation ruler is a required target feature. [Packaging](docs/PACKAGING.md)

## Working agreements

- Presentation milestone: the README contains Windows/helper setup and real
  disposable-profile Electron screenshots under `docs/screenshots/`. Reproduce
  them with `node scripts/capture-readme.cjs` after a Forge build; check local
  links/PNG/ICO data with `node scripts/verify-presentation.cjs`. The navy/teal
  icon is generated from shared vector/raster geometry. Helpers and Python stay
  separately user-installed by owner decision; earlier bundling possibilities
  are not planned work. ZIP remains recommended; installed Squirrel lifecycle
  remains unverified. See `docs/TESTING.md` for evidence.

- Read the relevant detailed documents before changing behavior. Distinguish accepted requirements, proposed implementation choices, and unresolved decisions; do not silently turn an open question into a product rule.
- Keep domain logic independent of Electron, React, extractor formats, and SQLite mechanics. [Domain model](docs/DOMAIN_MODEL.md)
- Add/update meaningful automated tests alongside behavior changes. Favor deterministic domain tests, temporary SQLite integration tests, and saved extractor fixtures. Live YouTube tests are optional and separate. [Testing](docs/TESTING.md)
- Update relevant docs when behavior changes. Explain invariants and reasons; use TSDoc for important exported domain types, services, and functions. Add a small ADR for a significant architectural choice.
- Do not assume a documented dependency, script, helper, or packaged platform already exists. Check the repository. [Packaging](docs/PACKAGING.md)
- Keep AI summarization, sentiment, automatic translation, posting/replying, likes/subscriptions, account integration, and other unrelated features outside the current scope.

## Useful commands at this milestone

After a Forge build, `npm.cmd run test:m91` verifies 2/4 production windows and
large-data failure/lifecycle/restart/restore behavior in OS-temp profiles.
`npm.cmd run profile:m91` adds three serial startup samples per window count;
`node scripts/summarize-m91.cjs baseline-control current` compares local reports.

After a Forge build, `npm.cmd run test:m8` runs the OS-temp production-entry
synthetic drag/restart/restore harness, included in `test:electron`. It does not
certify native mouse input.

After a Forge build, `npm.cmd run test:m6` runs the disposable production-entry
native-window/session/geometry harness. It is included in `test:electron`.

After a Forge build, `npm.cmd run test:m5` runs the disposable duplicate-tab,
two-renderer, restart and backup/restore harness. It is also in `test:electron`.

`npm test` runs deterministic domain/localization/component, IPC, packaging-check and temporary SQLite tests (Node 24.13+). `npm run typecheck` and `npm run lint` check source. `npm run build:renderer` builds the renderer only. `npm.cmd run package -- --platform=win32 --arch=x64` produces and validates a fresh application; `npm.cmd run make -- --platform=win32 --arch=x64 --targets=@electron-forge/maker-zip` also creates/verifies the ZIP. `npm.cmd run make:squirrel` builds only Squirrel Setup/full NuGet/RELEASES; `npm.cmd run make:zip` builds only ZIP. `npm run verify:artifacts -- --squirrel` inspects both distributions without executing an installer. `npm run test:packaged` tests the extracted unmodified EXE with disposable data/native dialogs/actual relaunch; optional installed-helper live checks are documented in PACKAGING. `npm run test:electron` verifies built-entry IPC/persistence across disposable restarts. `npm start` uses isolated development data. On restricted PowerShell use `npm.cmd`. See [testing status](docs/TESTING.md). Do not install a stack or implement features merely to validate documentation.
