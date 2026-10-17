# Decisions and open questions

[ADR 0027](0027-secure-window-coordination-foundation.md) implements M1 secured
window coordination and authenticated native-dialog origins with one production
reader and no schema change. It records the accepted provisional HTML dragging
policy; actual gestures and M2–M9 remain outside this increment.

[ADR 0026](0026-custom-translation-reader-minutes-and-layout.md) adds schema-12
atomic custom translation, shared reader/bulk publication minutes, an activity-only
reduced-motion exception, title-first video headers and aligned selection/rail gutters.

[ADR 0025](0025-persistent-video-thumbnails.md) implements optional persistent
video thumbnails, main-owned bounded retrieval/cache, opaque image delivery,
inline expansion and explicit OS-viewer action without schema changes.

[ADR 0024](0024-comment-selection-context-menus-and-view-prefix-seen.md)
implements session-only per-discussion bulk selection, explicit visual ranges,
accessible context menus and confirmed inclusive applied/sorted reading prefixes.
Schema 11 persists control visibility and include-collapsed-prefix preferences,
preserving populated revision-owned Undo while adding selected/view-prefix kinds.
This owner-requested increment supersedes prior milestone exclusions of selection,
menus and additional scopes; Q-21 and release/helper work remain unchanged.

ADR 0023 resolves persistent reply expansion (Q-10), hidden-target ancestor reveal
and persisted expansion (Q-11), and compressed three-lane ruler geometry (Q-12).
Schema 10 stores discussion defaults plus sparse opposite-default comment exceptions;
fully expanded remains the default. Complete query/sort/navigation/bulk membership
is independent of visible virtual rows. Optional badges, platform mappings, avatar
caching and Q-21 scaling remain open.

[Documentation map](../README.md) · [Product requirements](../PRODUCT_REQUIREMENTS.md) · [Architecture](../ARCHITECTURE.md)

This directory holds small architecture decision records (ADRs). This register includes the owner's clarifications of 2026-10-02 and the synthetic reader, persistence, pure extractor, durable merge and live acquisition milestones, separating settled requirements from remaining choices. Detailed contracts remain in their owning documents.

## Accepted foundations

These come from the owner's requirements and are not waiting for a technology-selection exercise:

- Electron + React + TypeScript desktop reader; SQLite for durable application data. [Architecture](../ARCHITECTURE.md), [Database](../DATABASE.md)
- Video extraction initially uses yt-dlp; public individual Community Post extraction initially uses post-archiver-improved. Adapters isolate external formats from the domain and UI. [Extractors](../EXTRACTORS.md)
- Renderer -> typed preload/contextBridge -> privileged backend owned by the Electron main side -> persistence/extractors. Renderer never owns/accesses SQLite. The backend may later delegate database work to an internal worker; only main invokes external extractors. [Architecture](../ARCHITECTURE.md)
- Seen/unseen is manual, durable, and per comment. Refresh preserves it; new identities start unseen; missing extraction records are retained. [Seen state](../SEEN_STATE.md), [Refresh](../REFRESH_AND_MERGE.md)
- Initial normal search/filtering covers all stored comments in the active discussion, including collapsed/unrendered ones. Contents, author/display name/handle, direct replied-to author, ordinary text, opt-in regex, and case modes are required initially. Top-level author search may also be supported where useful. Library-wide search is a possible future feature. [Filtering](../FILTERING_AND_SEARCH.md)
- Generic "all comments" bulk actions mean the active discussion. Any future library-wide mutation must be separately and explicitly named/scoped. Matching bulk actions use the last applied active-filter matching IDs even after pending seen edits. [Seen state](../SEEN_STATE.md)
- Raw search matches satisfy search alone; applied active-filter matches satisfy the complete filter set at its applied evaluation; context comments are included for their containing trees. Complete trees are retained. Filtered-reader next/previous match navigation uses applied active-filter matches; search-specific navigation refers to raw search matches within the applicable view. [Filtering](../FILTERING_AND_SEARCH.md), [UI](../UI_AND_NAVIGATION.md)
- Seen edits save immediately without changing displayed membership/order or replacing the applied match set. Apply recomputes locally. Successful explicit Refresh acquires, safely merges, then automatically recomputes the active view. ADR 0008 implements Ctrl+Enter for Apply and F3/Shift+F3 for matches; Ctrl+R/F5 source Refresh is deliberately unbound in the current keyboard milestone. [Refresh](../REFRESH_AND_MERGE.md)
- First successful acquisition establishes a baseline: comments receive `firstDiscoveredAt` and start unseen but are not visually NEW. NEW is exactly first discoveries in the latest accepted post-baseline attempt, surviving restart until another accepted refresh replaces it (ADR 0011). [Domain model](../DOMAIN_MODEL.md)
- Publication filters use each comment's own best-available `publishedAt`; latest-refresh NEW uses durable discovery identity. ADR 0012 selects current system-zone calendar days, half-open From/To boundaries and captured-clock Today/rolling 24h/7d presets. Estimated/coarse instants participate; missing/label-only instants fail active date filters. Future date bulk MUST reuse the same resolver/predicate. [Filtering](../FILTERING_AND_SEARCH.md), [UI](../UI_AND_NAVIGATION.md)
- ADR 0013 implements one durable multi-comment recovery per discussion, changed-row revision ownership, safe partial one-shot Undo, no expiry and subtree recovery; no redo. [Seen state](../SEEN_STATE.md), [Database](../DATABASE.md)
- Virtualization must coexist with data-based filtering, counts, search, and navigation. The scrollbar-adjacent overview/navigation ruler is a required target feature representing at least unseen comments, search matches, and subsequent-refresh discoveries. ADR 0011 settles height geometry, three lanes/pixel aggregation and durable NEW lifetime for the current uncollapsed view. [UI](../UI_AND_NAVIGATION.md)
- English/Polish localization and System/Light/Dark appearance are designed in from the start. System is the default and follows OS changes; search uses original content independently of UI language. [Localization and theming](../LOCALIZATION_AND_THEMING.md)
- Windows is the initial development and packaging target. Avoid unnecessary barriers to later Linux/macOS support without requiring those platforms initially. [Packaging](../PACKAGING.md)
- Deterministic automated domain, fixture, and temporary SQLite tests and documentation updates are part of implementation. A small meaningful UI/E2E suite is expected later, without an exhaustive UI-testing commitment. Eligible remote metadata/text may update with newer valid information; a refresh need not mutate unchanged fields. [Testing](../TESTING.md), [Refresh](../REFRESH_AND_MERGE.md)

## Resolved register entries

ADR 0017 resolves Q-10 for all current uncollapsed reader concepts: independent semantic draft/applied criteria, fresh restart reconstruction with current clock/zone/state, five sorts, stable application-ID/row-offset anchors and selected identity without focus. ADR 0023 resolves collapse expansion; optional badge details remain.

ADR 0013 closes Q-09 with the owner-approved durable per-discussion recovery, revision ownership and safe partial one-shot Undo. All/frozen-matching/publication scopes reuse ADR 0012 and preserve applied views; Ctrl+click changes greater than one row are recoverable. No-op, failure and ordinary single edits retain previous recovery.

ADR 0012 closes Q-03: current system-zone calendar dates, half-open whole-day
From/To, Today/local day, rolling 24h/168h inclusive now, one evaluation clock,
missing/estimated publication policy, and reuse by future date bulk. It implements
latest-refresh NEW filtering; Q-05 retains only arbitrary historical windows.


ADR 0011 settles the NEW-lifetime portion of Q-05 and current ruler portion of
Q-12: durable latest accepted post-baseline first discoveries, independent of
seen/publication/restart, accepted partial/unknown and zero-discovery replacement,
failure preservation, height-based applied-view geometry, pixel aggregation and
three overlapping lanes with virtual pointer/keyboard reveal. Future discovery
filter windows remain open; ADR 0023 implements collapsed presentation; ADR 0016 implements sorted presentation.
Schema 5 preserves explicit attempt insertion chronology; Q-21 remains open.

The bounded keyboard discoverability milestone adds a renderer metadata registry,
English/Polish Settings reference and shared tooltip formatting. Q-11 gains
Windows Ctrl+Tab/Ctrl+Shift+Tab, Ctrl+W, contextual Ctrl+F, Ctrl+L and acknowledged
F1 Settings help targeting, with editable-control and destructive-modal ownership.
See [the implemented keyboard policy](../UI_AND_NAVIGATION.md#keyboard-shortcuts-and-discoverability).
This reuses existing workspace/query actions and requires no new ADR, schema or
IPC. Future platform mapping, richer navigation and configurable shortcuts are
not decided by this increment.

ADR 0008 resolves Q-07 for this milestone: selected fields OR, independent seen
AND on one comment, NFC substring, deterministic lowercase, significant diacritics,
pattern-only ECMAScript u/iu, and unavailable direct author never matching. It
narrows Q-06 with explicit draft/Apply, localized errors retaining prior results,
separate draft/saved-seen indications and Refresh of applied criteria. Q-11 gains
wrapping data-preorder match/live-unseen navigation, ID reveal and Ctrl+Enter/F3.
Q-21 gains a cancellable renderer worker with a 1000 ms deadline, while large-data,
batching, memory and SQLite query performance remain open; ADR 0010 selects renderer virtualization.


ADR 0007 extends this with generic singleton Library/Settings views, unified pointer/keyboard reorder, confirmed local Library removal with active-source protection, Settings-owned preferences and neutral ancestry rails. ADR 0017 resolves scroll/query/sort/selection restoration; ADR 0023 implements collapse expansion.

ADR 0006 resolves the bounded open-tab portion of Q-10/Q-17: unique tabs per
library item, persisted IDs/order/active selection, close without deletion, nearby
replacement and Library reopen. It also selects compact reading and anonymous
HTTPS avatar evidence/rendering (part of Q-12/Q-15), exact main-startup executable
overrides before PATH (part of Q-19), and three exact workspace IPC intents (Q-22).
The Community warning conclusion and regression evidence are in ADR 0006. Remaining
collapse expansion persistence, caching/link formatting, broader contracts and
distribution questions remain open as narrowed below.

The original IDs are retained for traceability. Related entries below contain only their remaining open portions.

| ID | Settled result | Owning documents |
| --- | --- | --- |
| Q-03 | Publication-date semantics implemented in ADR 0012: current system zone, inclusive From/exclusive next-day To, Today, rolling 24h/168h with captured inclusive now, estimated/coarse instants included, missing instants excluded. Future date bulk MUST reuse the resolver/predicate. | [ADR 0012](0012-publication-date-and-latest-discovery-filters.md) |
| Q-07 | Search comparison semantics are settled by ADR 0008: NFC substring, locale-independent lowercase, significant diacritics, selected-field OR plus seen AND, unknown direct-parent author does not match, ECMAScript pattern-only u/iu. | [ADR 0008](0008-active-discussion-applied-queries.md) |
| Q-01 | Initial search/filtering and default all-comments bulk scope is the active discussion. Library-wide search is future scope; generic Mark all must never imply it. | [Filtering](../FILTERING_AND_SEARCH.md), [Seen state](../SEEN_STATE.md) |
| Q-09 | One durable recovery per discussion, changed-row revision ownership, partial safe one-shot Undo without expiry/redo; restart/Refresh retention and subtree recovery. | [ADR 0013](0013-atomic-bulk-seen-and-durable-undo.md) |
| Q-10 (current reader) | Independent durable draft/applied semantics, five sorts, fresh worker restart reconstruction with current now/zone/comments/seen/NEW, stable anchor/row offset and selection without forced focus, coalesced saves and per-view fallback. ADR 0023 resolves collapse expansion; optional badge details remain below. | [ADR 0017](0017-persistent-discussion-view-restoration.md) |
| Q-02 | Matching bulk actions use the last applied active-filter matching set. Pending seen edits do not trigger a fresh target query. Apply or successful explicit Refresh creates a new evaluation. | [Seen state](../SEEN_STATE.md), [UI](../UI_AND_NAVIGATION.md) |
| Q-04 | Discovery-based "new since refresh" is separate from publication-date filtering. The vague publication preset is not part of the specification. Selection/lifetime for any discovery presentation is still covered by Q-05. | [Refresh](../REFRESH_AND_MERGE.md), [Filtering](../FILTERING_AND_SEARCH.md) |
| Q-17 (partial) | Built-in node:sqlite, one main-owned connection, ordered transactional migrations through schema 8, normalized remote evidence/history, scoped constraints, atomic writes and separate tab workspace. ADR 0019 adds complete backups; ADR 0023 implements collapse state; search acceleration and large-data choices remain open. | [ADR 0004](0004-durable-observation-merge.md), [ADR 0006](0006-compact-reader-and-persistent-tabs.md) |
| Q-18 (partial) | Distinct development/production profile paths, explicit absolute temporary test paths, no missing-config production fallback, idempotent demo initialization, and safe rejection of newer schemas. ADR 0019 implements complete SQLite backup, safe confirmed restore/recovery and automatic pre-migration safety. ADR 0021 settles uninstall data retention; genuine installed behavior is unverified. Retention management, export and future portability remain open. | [ADR 0002](0002-sqlite-and-typed-reader-boundary.md) |
| Q-22 (partial) | Foundation React/Intl/theme/Vitest choices remain; the bridge has explicit semantic intent and progress methods with exact runtime guards, sender/frame/document checks, structured errors and acknowledged snapshots. Broader query/event/diagnostic contracts and later E2E tools remain open. | [ADR 0001](0001-synthetic-reader-foundation.md), [ADR 0002](0002-sqlite-and-typed-reader-boundary.md), [ADR 0006](0006-compact-reader-and-persistent-tabs.md) |
| Q-13 (partial) | Foundation matches the first supported browser-language base, formats with en/pl and host timezone, falls back to English, and labels a fixed demo reference clock. Production time cadence, timezone controls, and optional follow-system language remain open. | [Localization](../LOCALIZATION_AND_THEMING.md), [ADR 0001](0001-synthetic-reader-foundation.md) |
| Q-08 | Source relationships remain distinct from safe display placement (ADR 0004). ADR 0016 sorts complete display-root trees in five modes, with unknown-last/Original ties, session state, sorted navigation/ruler and anchor retention; safe roots never reinterpret evidence. | [ADR 0004](0004-durable-observation-merge.md), [ADR 0016](0016-whole-conversation-sorting.md) |
| Q-14 (partial) | Usable partial/unknown batches commit non-destructively with true coverage and may establish the first accepted baseline. Failed normalization commits history only; database failure rolls back all candidate writes/history. ADR 0005 adds stable process failures and compact localized coverage reporting; richer reporting remains open. | [ADR 0004](0004-durable-observation-merge.md) |
| Q-15 (partial) | Source-kind-scoped item uniqueness, item-scoped comment uniqueness, injected UUID internal IDs, current field authority and durable publication precision/labels are implemented. Explicit trustworthy deletion remains open; absence never deletes. | [ADR 0004](0004-durable-observation-merge.md) |
| Q-19 (partial) | ADR 0015 makes yt-dlp 2026.08.19 / post-archiver 0.4.0 tested confidence signals; credible identified other versions run with warning under unchanged structural output validation. No-shell execution remains. ADR 0014 implements user-selected executable configuration with native main-owned selection, schema-7 profile persistence, environment > saved > PATH precedence, fail-closed configured paths and immediate runtime application. Helper artifacts/licensing/integrity/update ownership remain open. | [ADR 0014](0014-main-owned-helper-settings.md) |

Q-05's initial baseline, Q-06's successful Refresh and applied-set behavior, Q-11's filtered-match navigation, Q-13's System default, and Q-20's Windows initial target are likewise settled in the foundations above. They are not reopened by the narrower questions below.

## Open decisions

The questions below do not weaken the accepted invariants. Resolve each before implementing behavior that depends on it. A routine engineering choice can be made within an authorized increment using evidence and documented reasoning; a materially ambiguous product rule should be clarified with the owner. An item here is not an automatic approval gate for unrelated work.

### Product semantics

| ID | Unresolved question and why it matters | Owning documents |
| --- | --- | --- |
| Q-05 | **Future discovery controls:** ADR 0011 settles durable latest-accepted post-baseline NEW, including partial/unknown and zero-insert acceptance, failed-attempt preservation and independence from seen/publication/restart. ADR 0012 implements All discoveries / NEW from latest refresh. Only future arbitrary historical discovery-window UI remains open. | [Refresh](../REFRESH_AND_MERGE.md), [Domain model](../DOMAIN_MODEL.md), [UI](../UI_AND_NAVIGATION.md) |
| Q-06 | **Remaining view UX:** Broader inactive-tab notification behavior remains open. ADR 0010 selects first-match/start on Apply and retained visible identity/offset on Refresh. ADR 0008 settles explicit Apply, independent draft, saved-seen indications, localized errors retaining prior results and Refresh of applied criteria. Applied matching targets and automatic active-view recomputation after successful explicit Refresh are settled. | [Filtering](../FILTERING_AND_SEARCH.md), [UI](../UI_AND_NAVIGATION.md), [Seen state](../SEEN_STATE.md) |
| Q-10 | **Optional badge details only:** ADR 0017 resolves semantic draft/applied, sort, anchor/selection restoration; ADR 0023 resolves sparse persistent expansion across restart/Refresh/close/reopen. Existing workspace tab behavior remains ADRs 0006/0007. | [UI](../UI_AND_NAVIGATION.md), [Database](../DATABASE.md) |
| Q-11 | **Future platform mappings:** ADR 0023 resolves hidden-target reveal and persistent necessary-ancestor expansion for matches, unseen and ruler targets, preserving wraparound and seen. Existing Windows shortcuts and contextual ownership remain. Source Refresh, reopen and numbered tabs stay deliberately unbound. | [UI](../UI_AND_NAVIGATION.md), [Seen state](../SEEN_STATE.md) |
| Q-12 | **Remaining presentation:** ADR 0023 resolves collapsed summaries and compressed ruler aggregation with separate own/hidden contributions and exact-target reveal. ADRs 0011/0016 retain lanes/geometry/sorting; ADR 0022 supplies external actions. Richer formatting and avatar caching remain open. | [UI](../UI_AND_NAVIGATION.md), [Architecture](../ARCHITECTURE.md) |
| Q-13 | **Remaining localization details:** Optional follow-system language, timezone controls, richer regional formatting needs, and production relative-time update cadence. Base-locale matching and English key fallback are selected; ADR 0002 persists explicit selections and uses main-side OS languages on first run. | [Localization and theming](../LOCALIZATION_AND_THEMING.md) |

### Data, execution, and distribution

| ID | Unresolved choice and evidence needed | Owning documents |
| --- | --- | --- |
| Q-14 | **Richer acquisition reporting:** ADR 0004 settles acceptance/history; ADR 0005 adds localized errors, coverage notice and acknowledged unfiltered view updates. ADR 0018 implements coarse global stages/elapsed/cancellation, count/completion feedback and nonpersisted safe stage timings; ADRs 0008/0017 implement filtered-view reconstruction. Richer diagnostics remain open. | [Refresh](../REFRESH_AND_MERGE.md), [Extractors](../EXTRACTORS.md) |
| Q-15 | **Explicit remote deletion:** Identity scope, internal IDs, collision skipping and publication evidence storage are selected in ADR 0004. Trustworthy deletion/tombstone evidence and presentation remain open. Absence never deletes. | [Domain model](../DOMAIN_MODEL.md), [Extractors](../EXTRACTORS.md), [Database](../DATABASE.md) |
| Q-16 | **Remaining scheduling/lifecycle:** ADR 0005 selects temporary single-live-operation serialization, bounded helper retries/deadline, normal-quit cleanup and structured diagnostics while preserving local edits. ADR 0018 implements typed global progress, explicit exact-ID user cancellation, pre-save linearization and failed cancellation history. Broader scheduling/concurrency policy, crash recovery, cross-tab notifications and retention duration remain open. | [Architecture](../ARCHITECTURE.md), [Refresh](../REFRESH_AND_MERGE.md), [Extractors](../EXTRACTORS.md) |
| Q-17 | **Remaining SQLite implementation:** Search/index acceleration, larger-data connection/worker/journaling choices and each released upgrade compatibility matrix. ADR 0019 implements backup/restore and pre-migration safety. ADR 0004 selects merge/history; ADR 0007 evolves the bounded tab workspace to schema 4 with unified app views and atomic local removal. | [Database](../DATABASE.md), [Architecture](../ARCHITECTURE.md) |
| Q-18 | **Remaining data lifecycle:** ADR 0019 implements consistent complete SQLite snapshots, staged known-schema validation/migration, confirmed full replacement, verified current-data safety, offline crash recovery and startup pre-migration snapshots. No pruning or downgrade. Retention management, future backup portability/format versioning, each released upgrade matrix and export remain open. ADR 0021 settles uninstall data retention; genuine installed behavior is unverified. Initial profile isolation remains ADR 0002. | [Database](../DATABASE.md), [Packaging](../PACKAGING.md) |
| Q-19 | **Helper distribution decision:** The owner chose separate user installation of yt-dlp and post-archiver-improved, including their runtime dependencies. No Python/helper bundling, installer, download or updater is planned. Settings executable configuration is implemented by ADR 0014. ADR 0015 settles tested/untested runtime permission and preserves output validation; a future new output contract requires evidence. No release-ready distribution claim. | [Extractors](../EXTRACTORS.md), [Packaging](../PACKAGING.md) |
| Q-20 | **Remaining Windows release details and later platforms:** ADR 0020 verifies Windows x64 application/ZIP and packaged restore/relaunch. ADR 0021 adds real Squirrel artifacts, structural/embedded-payload validation, stable identity, application icon, lifecycle gating and unchanged profiles. Genuine isolated install/shortcut/taskbar/installed restore/uninstall retention/reinstall/upgrade tests remain UNVERIFIED. Windows version compatibility, installed registration icon, signing/SmartScreen, release channels, updates and notices remain open. Helpers stay user-installed. Linux/macOS and fully portable data remain future scope. | [Packaging](../PACKAGING.md), [ADR 0021](0021-windows-squirrel-installer-and-application-identity.md) |
| Q-21 | **Query/storage scale (partly open):** ADR 0010 selects flat variable-height renderer virtualization and measured DOM bounds. Full bootstrap/clone/library memory, O(N) query/projection, large-data scheduling/batching, SQLite evaluator/index/worker placement and future paging/performance budgets remain open. ADR 0008 bounds regex responsiveness with a cancellable renderer worker and 1000 ms deadline. Indexes must preserve substring/regex semantics and complete results. | [Architecture](../ARCHITECTURE.md), [Filtering](../FILTERING_AND_SEARCH.md), [UI](../UI_AND_NAVIGATION.md), [Testing](../TESTING.md) |
| Q-22 | **Remaining libraries and contracts:** Broader query/event/workspace contracts, request-ID/diagnostic policy, and later E2E tooling. ADR 0002 selects bootstrap/seen/preferences and ADR 0005 adds acquire/refresh, all with exact runtime validation; other future commands are not implied. | [Architecture](../ARCHITECTURE.md), [Localization](../LOCALIZATION_AND_THEMING.md), [Testing](../TESTING.md) |
| Q-23 | **Future source/library scope:** Channel-wide Community Post browsing, authenticated/member-only extraction, and library-wide search are possible future features with unresolved scope and behavior. None is required by the initial product; no generic bulk command grants future library-wide mutation scope. | [Product requirements](../PRODUCT_REQUIREMENTS.md), [Extractors](../EXTRACTORS.md), [UI](../UI_AND_NAVIGATION.md) |

The local open-question sections may contain finer implementation details; these grouped entries provide a shared index. Update both the owning document and this register when resolving a question. Record which acceptance tests demonstrate the resulting rule.

## Implementation dependencies, not a new roadmap

The synthetic foundation in [ADR 0001](0001-synthetic-reader-foundation.md) has SQLite/IPC persistence in [ADR 0002](0002-sqlite-and-typed-reader-boundary.md) and pure extractor adapters/fixtures in [ADR 0003](0003-extractor-observations-and-normalization.md). ADR 0004 adds durable normalized fixture ingestion/history. ADR 0005 adds live acquisition/refresh execution and minimal UI; search and bulk behavior remain absent. These notes identify dependencies for later increments without requiring every open question to be closed first.

| Before implementing this behavior | Decisions or evidence actually needed |
| --- | --- |
| Extending durable SQLite storage | Initial integration/schema/migrations/timestamps/profile isolation are selected in ADR 0002. Resolve only the additional schema, safety, or performance choices needed by the next increment. Conservative source constraints and merge/history are selected in ADR 0004; no stronger global identity guarantee is asserted. |
| Live acquisition and refresh UI | ADR 0003 supplies adapters/specs and ADR 0004 supplies durable identity/authority/conflict/relationship/baseline/history. ADR 0005 implements development process/resolver lifecycle and narrow reporting/view contracts (Q-14/Q-16/Q-19/Q-22). Distribution and broader scheduling remain open. |
| Initial functional search/filter reader | Implemented in ADR 0008: exact comparison, OR/AND, direct-author unknown behavior, worker/deadline, draft/Apply/errors, complete context and navigation. Larger-data Q-21 and remaining Q-06 restoration/scroll questions are independent. |
| Date filtering or date bulk actions | Date filtering is implemented and Q-03 is closed (ADR 0012). Bulk reuses the calendar foundations/predicate; ADR 0015 adds bulk-only optional local minutes and explicit DST rejection. Bulk undo/recovery remains ADR 0013 (Q-09 closed). |
| Bulk state-changing UI | ADR 0013 implements the selected Q-09 policy; extensions must preserve revision ownership and transaction safety. Action scope and matching IDs are already decided. |

Future backup retention/portability, helper binary distribution/update mechanics, future platform support, signing/release details, later UI test tooling, later ruler presentation extensions and source/library features do not block a foundational storage/acquisition increment. They must be resolved before their own dependent features or release guarantees are delivered. Backup planning and protection of user data remain required from the start; deferring the final mechanism does not permit unsafe data handling. If the first milestone includes the ruler or visual NEW behavior, the corresponding presentation decisions become dependencies of that milestone rather than silently chosen defaults.

## Writing an ADR

Use a short sequential name such as `0001-descriptive-title.md` when the first decision is actually made. An ADR should contain:

1. Title, date, and status: proposed, accepted, or superseded.
2. Context: the concrete requirement or problem and links to relevant documents/open questions.
3. Decision: the selected behavior or architecture and its boundaries.
4. Reasons and alternatives: enough to explain why it was chosen, including tradeoffs.
5. Consequences and validation: affected data, migration/testing needs, and practical limitations.

Prefer small records about significant decisions, such as SQLite integration, partial-refresh acceptance, query snapshot semantics, or helper distribution. Do not create ADRs to narrate every function or repeat all product requirements. Link an accepted ADR from the owning documents and this index. Keep superseded records and link their replacements so the rationale survives.

## ADR index

- [0023 - Persistent thread collapse and virtual navigation](0023-persistent-thread-collapse-and-virtual-navigation.md): accepted; fully expanded defaults, sparse schema-10 exceptions, individual/All controls, complete versus visible presentation, persistent hidden-target reveal, compressed ruler aggregation and stable anchor/selection. Resolves expansion in Q-10 and collapse details in Q-11/Q-12.

- [0022 - Reader actions, external links and translation preferences](0022-reader-actions-external-links-and-translation-preferences.md): accepted; removes Shift row marking, keeps explicit checkbox semantics, uses a reduced-motion CSS spinner, accents trusted video creator evidence, adds identity-only main-owned author/video-comment/Google Translate actions, preserves native selection, adds constrained schema-9 translation targets and a shared outline icon vocabulary. No invented Community comment permalink or automatic translation.

- [0020 — Windows packaged application and ZIP distribution](0020-windows-packaged-application-and-zip-distribution.md): accepted; diagnosed Node 26 ZIP stream/API failures, scoped dependency corrections, verified fresh Forge folder/ZIP output, no-install with unchanged profiles, extracted executable smoke and actual restore/relaunch. Narrows Q-20; signing/installers/helper bundling/public release remain open.
- [0021 — Windows Squirrel installer and application identity](0021-windows-squirrel-installer-and-application-identity.md): accepted; fresh Setup/full NuGet/RELEASES validation, stable identity, neutral icon, lifecycle startup gate, unchanged profiles and uninstall data-retention policy. Installer tests require genuine isolation; none ran on the owner's account. Narrows Q-20 and Q-18; signing/helpers/public release remain open.

- [0019 — Consistent SQLite backup and safe restore](0019-consistent-sqlite-backup-and-safe-restore.md): accepted; complete online SQLite snapshots, native dialogs, exact staged validation/migration, verified safety, offline replacement/startup crash recovery, mutation barrier/relaunch, and automatic pre-migration safety. Narrows Q-18; retention/portability/export and release packaging remain separate.

- [0018 - Acquisition progress and safe cancellation](0018-acquisition-progress-and-safe-cancellation.md): accepted; one global operation, opaque IDs, validated progress subscription, per-operation/shutdown signal composition, atomic-save cutoff, failed cancelled history, child/temp cleanup and diagnostic monotonic timings. Narrows Q-14/Q-16; Q-21 and release work stay separate.

- [0017 - Persistent discussion view restoration](0017-persistent-discussion-view-restoration.md): accepted; schema 8, exact bounded intent validation, draft/applied separation, lazy fresh worker reconstruction, sort, stable anchor/offset/selection, coalesced serialized saves and per-view fallback. Resolves current Q-10; ADR 0023 resolves collapse; optional badge details remain.

- [0015 - Safe usability intents and helper confidence](0015-safe-usability-intents-and-helper-confidence.md): accepted; canonical main-owned source opening, tested/untested helper policy superseding exact-version gates, bulk local minutes/DST rejection and explicit row marking. No sorting/performance/distribution work. Whole-conversation sorting is selected in ADR 0016.
- [0016 - Whole-conversation sorting](0016-whole-conversation-sorting.md): accepted; five whole-display-tree modes, stable Original ties/unknown-last, immediate per-discussion session state, anchor identity/offset preservation and sorted navigation/match position/ruler. Resolves Q-08; restart view persistence is implemented in ADR 0017.

- [0014 - Main-owned external helper Settings](0014-main-owned-helper-settings.md): accepted; schema-7 profile configuration, native main-owned selection/probe, authoritative environment > saved > PATH, fail-closed paths, immediate later acquisition resolution and localized status. Exact-version permission policy superseded by ADR 0015; Q-19 covers remaining distribution work.

- [0013 - Atomic bulk seen actions and durable safe Undo](0013-atomic-bulk-seen-and-durable-undo.md): accepted; schema 6, one operation per discussion, revision-owned partial recovery, all/frozen-matching/publication scopes, subtree recovery, FIFO acknowledgments and contextual Ctrl+Z. Q-09 closed.

- [0010 — Variable-height discussion virtualization](0010-variable-height-discussion-virtualization.md): accepted; flat data rows/shared ancestry, pinned dynamic measurement, bounded mounted DOM, neutral rails, unmounted-target reveal/focus, session Apply/Refresh scroll policy and generated performance evidence. Q-21 remains open for bootstrap/clone/memory and SQLite/query/paging scale.

- [0009 — Isolated discussion rendering and stable tab input](0009-isolated-discussion-rendering-and-tab-input.md): accepted; measured renderer isolation, mounted scroll retention, stable strip pointer capture and overflow-aware wheel scrolling. No query, IPC, schema or virtualization changes.


- [0001 — Synthetic React reader foundation](0001-synthetic-reader-foundation.md): accepted; scopes the React, localization, theme, domain preconditions, and deterministic testing choices to the in-memory milestone.
- [0002 — SQLite persistence and typed reader boundary](0002-sqlite-and-typed-reader-boundary.md): accepted; main-owned built-in SQLite, initial schema/migrations/profiles, narrow validated IPC, durable seen state/preferences, and packaging implications for the synthetic milestone.
- [0003 — Extractor observations and normalization](0003-extractor-observations-and-normalization.md): accepted; pure remote observations, backend adapters/specs, field authority, relationship evidence, partial/unknown coverage and sanitized fixture provenance. No acquisition execution or persistence ingestion.
- [0004 — Durable observation merge, history and identity](0004-durable-observation-merge.md): accepted; schema 2 with preserving migration, scoped uniqueness, injected IDs/clock, authoritative field merge, safe relationship projection, baseline/attempt history and conservative subset acceptance. No live execution or acquisition UI.

- [0005 — Live helper execution and acquisition IPC](0005-live-helper-execution-and-acquisition-ipc.md): accepted; main-only no-shell PATH/version-checked acquisition, temporary anonymous output/config, conservative outcomes/deadlines/diagnostics, one-live-operation scheduling, narrow acquire/refresh IPC and minimal localized UI. Helpers are not bundled.

- [0006 — Compact reader and persistent tabs](0006-compact-reader-and-persistent-tabs.md): accepted; schema 3 distinguishes Library/workspace, persists closable unique tabs/order/active ID, adds Library reopen, avatar authority/anonymous rendering, compact chrome/header/comments, main-only helper executable overrides and evidence-backed Community count-label normalization.

- [0007 — Unified workspace and Library removal](0007-unified-workspace-and-library-removal.md): accepted; schema 4 preserving generic singleton tabs/order/active/revision, pointer and keyboard reorder, compact icons, Library metadata/filter/open and atomic confirmed local deletion, active-source protection, Settings preference ownership and neutral reply rails distinct from unseen rows.

- [0008 — Active-discussion queries and stable applied views](0008-active-discussion-applied-queries.md): accepted; exact NFC/case/regex and field semantics, worker/deadline, independent session draft/applied views, complete-tree context, stable seen edits, Refresh reapplication and wrap navigation. No dates, bulk, persistent criteria/selection, virtualization or ruler.

- [0011 — Virtualized overview ruler and durable NEW](0011-virtualized-overview-and-durable-new.md): accepted; schema-5 attempt order and latest accepted post-baseline cohort, applied-view live unseen/restrictive active matches/NEW, height geometry, pixel bands/three SVG lanes, virtual pointer/keyboard reveal and 10k/50k DOM evidence. Q-05/Q-12 reduced; Q-21 remains open.

- [0012 — Publication-date and latest-discovery filters](0012-publication-date-and-latest-discovery-filters.md): accepted; system-zone whole-day boundaries, captured clock, rolling presets, missing/estimated evidence, deterministic worker payload and durable NEW filter. Q-03 closed; Q-05 only arbitrary historical windows. Future date bulk must reuse these semantics.
