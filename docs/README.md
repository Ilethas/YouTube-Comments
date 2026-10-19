# Documentation map

**Post-M9.2 tab keyboard fix:** [cause and verification](POST_M9_2_TAB_KEYBOARD.md)
records the native click/disabled-focus reproduction and global active-tab
Ctrl+Shift+PageUp/PageDown shortcuts. Changes remain uncommitted for owner review.

**M9.2 final review:** [verification and release assessment](M9_2_VERIFICATION.md)
records the final regression/ZIP/extracted-EXE checks and six refreshed real-app
screenshots. Status: owner review required, with physical M8/Close-flicker checks
and distribution license/notice review outstanding. ZIP remains recommended;
genuine installed Squirrel behavior is unverified. Nothing is published.
The [README](../README.md) and [owner walkthrough](HOW_IT_WORKS.md) explain the
finished multi-window reader; the [UI guide](UI_AND_NAVIGATION.md) includes M8.2's
application menu and distinct Close Tab / Close Window / Quit shortcuts.

**M9.1 scale verification:** see the focused [performance report](M9_1_PERFORMANCE.md)
for serial 2/4-window 10k/50k observations, payload hardening, lifecycle stress and
remaining Q-21 limits. Schema stays **14**. Historical milestone notes below retain
their original scopes; later milestones supersede their future-work statements.

[ADR 0034](decisions/0034-native-html-tab-dragging.md) implements **M8**: native HTML
tab reorder/attachment, source-only reservation/one-use offer, and accepted guarded
outside detachment over M7. Schema stays **14**. Outside Escape can detach; actual
native/physical drag verification remains pending. See [testing](TESTING.md) and
[manual verification](M8_MANUAL_VERIFICATION.md). M9 remains future work. Earlier
milestone sections below retain their historical scope.

The **M8.1 UI polish** adds a responsive, localized Move Tab chooser with source
context, destination-window details, radio selection and explicit Move confirmation,
plus whole-tab keyboard focus and a visible empty-window drop area. Transfer
authority and schema remain unchanged; see [UI](UI_AND_NAVIGATION.md) and
[validation](TESTING.md). Awaiting owner review; M9 remains future work.

[ADR 0033](decisions/0033-atomic-cross-window-tab-transfer.md) implements **M7**:
explicit keyboard/menu movement between equal reader windows, live frozen-view
handoff, atomic ownership and singleton merge, generation/ABA fencing and safe
Move to New Window. Schema remains **14**. See [UI](UI_AND_NAVIGATION.md),
[architecture](ARCHITECTURE.md), [database](DATABASE.md) and [testing](TESTING.md).
M8 gestures and M9 aggregate scale/release remain future work. Earlier sections
retain their original milestone scope.

[ADR 0032](decisions/0032-equal-native-windows-and-session-restoration.md) implements **M6**, equal production native windows,
File > New Window / Ctrl+N, persistent intended session restoration and safe DIP
geometry. Current schema is **14**. One shared service/profile serves independent
window workspaces and views; M3 drains/fencing cover native saves. See [UI](UI_AND_NAVIGATION.md),
[database](DATABASE.md) and [testing evidence](TESTING.md). M7 transfer, M8 native
dragging and M9 aggregate scale/release remain future work. Earlier milestones below
retain their original scope.

[ADR 0031](decisions/0031-independent-duplicate-discussion-tabs.md) implements M5: independent duplicate video/Community discussion tabs inside
one native window. Semantic source queues checkpoint before atomic copying;
versioned scoped hydration precedes mount; DOM IDs and interactions belong to the
view. Shared content/seen/Undo/Refresh remain item-owned. Schema stays **13**.
See [UI](UI_AND_NAVIGATION.md) for Duplicate versus Library Open/resume policy and
[testing](TESTING.md) for the current evidence. M6-M9 remain future work.


[ADR 0030](decisions/0030-persistent-window-topology-and-view-instances.md) implements
M4: schema **13**, persistent windows and opaque discussion tab/view instances,
per-window topology, independent intent/collapse CAS and owned dormant resume
pointers. Migration preserves exact schema-12 topology and optional state for every
stored item. Production still opens one reader; M5 is implemented above; M6-M7 remain future work. See
[testing](TESTING.md) for the final 1,031-test, 14-harness and packaged-EXE evidence.

[ADR 0029](decisions/0029-global-profile-and-window-lifecycle-safety.md) implements
M3: main-owned global drain/Close/Reload/Quit coordination, pre-registered queued
mutation tickets, exact bounded drain leases, M2 reconciliation on release and
terminal old-profile restore fencing. M3 retained schema 12; M4 above supersedes
its identity model. Production remains one reader. See [testing](TESTING.md) for
disposable multi-renderer evidence.

[ADR 0028](decisions/0028-ordered-shared-state-synchronization.md) implements M2: ordered shared
commit notifications, bounded renderer reconciliation, explicit checkbox
assignments, guarded shared Undo and global acquisition progress fanout. Schema
stays 12, production stays one reader, and M3 lifecycle barriers are added by ADR 0029.
The two-renderer test interface is confined to disposable Electron harnesses.

[ADR 0027](decisions/0027-secure-window-coordination-foundation.md) implements M1:
main-owned window registration/document leases, one secured factory, authenticated
IPC caller context and originating native dialogs. Production still opens one
reader, with schema 12 at that milestone. M5 is implemented above; M6-M9 remain future work. The owner accepts provisional
HTML DnD outside detachment where Escape may detach; M8 native testing is pending.

[M0 drag feasibility](MULTI_WINDOW_M0_FEASIBILITY.md) records the isolated two-window
fake-tab experiment, automated evidence and pending native Windows checklist.
Full browser-like desktop dragging remains unproven; production M1 is implemented.
See the historical [audit](MULTI_WINDOW_AUDIT.md) and
[proposed design](MULTI_WINDOW_DESIGN.md) for the separately scoped milestones.

[ADR 0026](decisions/0026-custom-translation-reader-minutes-and-layout.md) adds
schema-12 custom translation targets, optional reader publication minutes shared
with bulk resolution, steady loading rotation under reduced motion, title-first
video headers and aligned selection/rail gutters. See [verification](TESTING.md).

[ADR 0025](decisions/0025-persistent-video-thumbnails.md) adds optional cached video
header thumbnails, inline expansion and explicit OS image-viewer opening. Cache
bytes are profile-local presentation data excluded from SQLite backups; source
selection, security, freshness and offline behavior are documented there.

The [project README](../README.md) covers Windows ZIP setup, external helper
installation, basic use and real [Electron screenshots](screenshots/reader-light.png).
The icon and screenshot capture workflow is described in [Testing](TESTING.md#readme-screenshots-and-application-icon-2026-10-16).

[ADR 0024](decisions/0024-comment-selection-context-menus-and-view-prefix-seen.md)
adds independent comment multi-selection, accessible context menus, confirmed exact
view-prefix read/unread assignments, selected thread expansion and schema-11
preferences/Undo metadata. Native text selection, complete/collapsed projections,
revision-safe Undo and backup migration safety remain. See [verification](TESTING.md).

[ADR 0023](decisions/0023-persistent-thread-collapse-and-virtual-navigation.md)
implements persistent per-discussion reply collapse, fully expanded defaults,
Expand/Collapse all, sparse schema-10 state, hidden match/unseen/ruler navigation
and compressed ruler geometry. See [verification](TESTING.md).

[ADR 0022](decisions/0022-reader-actions-external-links-and-translation-preferences.md)
implements native selection without row marking gestures, compact CSS progress,
trusted video creator accents, main-owned author/comment/Google Translate actions,
schema-9 translation target Settings and consistent outline action icons.
See [current verification](TESTING.md).

Complete SQLite backup and safe full-profile restore are implemented in
[ADR 0019](decisions/0019-consistent-sqlite-backup-and-safe-restore.md), including
verified safety snapshots, startup crash recovery and pre-migration protection.
Windows x64 application folders and no-install ZIP distribution are implemented in
[ADR 0020](decisions/0020-windows-packaged-application-and-zip-distribution.md).
Extract the complete ZIP and run its EXE; data stays in the existing user profile.
See [build/run instructions](PACKAGING.md). Squirrel artifacts are implemented in
ADR 0021; actual installation remains unverified. Helpers remain separately
installed by the user. Signing, public distribution and fully portable data remain
separate release work.

This is the specification for a persistent YouTube discussion reader. The implementation has main-owned SQLite discussions/seen/history, English/Polish and System/Light/Dark preferences, preserving migrations, isolated profiles and typed validated IPC. Live public acquisition/refresh is implemented in [ADR 0005](decisions/0005-live-helper-execution-and-acquisition-ipc.md). [ADR 0006](decisions/0006-compact-reader-and-persistent-tabs.md) adds compact reading, real avatar evidence, closable persistent tabs with Library reopen and main startup helper overrides. [ADR 0007](decisions/0007-unified-workspace-and-library-removal.md) adds unified draggable Library/Settings/discussion tabs, local metadata filtering, confirmed local removal and structural ancestry rails. Development still seeds synthetic examples. [ADR 0008](decisions/0008-active-discussion-applied-queries.md) implements active-discussion search/seen filtering, stable session applied views and match/unseen navigation. [ADR 0010](decisions/0010-variable-height-discussion-virtualization.md) adds bounded variable-height comment rendering and unmounted-target reveal. [ADR 0011](decisions/0011-virtualized-overview-and-durable-new.md) adds the applied-view overview ruler and durable NEW presentation. [ADR 0012](decisions/0012-publication-date-and-latest-discovery-filters.md) adds system-zone publication-date and latest-refresh discovery filtering. [ADR 0013](decisions/0013-atomic-bulk-seen-and-durable-undo.md) implements atomic bulk seen/unseen with durable safe Undo. [ADR 0014](decisions/0014-main-owned-helper-settings.md) implements main-owned native helper selection, profile-local configuration, identity probing and immediate runtime resolution. [ADR 0015](decisions/0015-safe-usability-intents-and-helper-confidence.md) adds source actions, tested/untested helper confidence, bulk local minutes and historical row gestures (removed by ADR 0022). [ADR 0016](decisions/0016-whole-conversation-sorting.md) adds immediate whole-conversation sorting, sorted navigation/match position/ruler and identity/offset anchoring, resolving Q-08. [ADR 0018](decisions/0018-acquisition-progress-and-safe-cancellation.md) adds global coarse progress, safe exact-ID cancellation before atomic merge, failed cancellation history and monotonic diagnostic stage timings without extraction optimization. Helpers remain separately user-installed. [ADR 0017](decisions/0017-persistent-discussion-view-restoration.md) implements persistent per-discussion draft/applied queries, sort, comment anchor/offset and selection, with lazy fresh reconstruction at restart. Reply collapse is implemented in ADR 0023; storage/query/library scalability stays partly open under Q-21. See [verification status](TESTING.md).

Pure extractor observation contracts, backend-specific parsers, command descriptions and sanitized deterministic fixtures are implemented in [ADR 0003](decisions/0003-extractor-observations-and-normalization.md). They feed the durable normalized SQLite merge/history layer in [ADR 0004](decisions/0004-durable-observation-merge.md), exercised with deterministic fixtures. Their live process and acquire/refresh bridge/UI integration is implemented in ADR 0005; helpers are not bundled. The initial product targets Windows and one active discussion at a time for normal search/filtering and generic bulk actions. Core search, virtualized overview navigation and durable NEW are implemented. The owner's clarified decisions are under [accepted foundations](decisions/README.md); remaining questions do not reopen them.

## Reading paths

[ADR 0009](decisions/0009-isolated-discussion-rendering-and-tab-input.md) records
measured tab-switch renderer isolation, stable strip drag capture and wheel
scrolling. Query semantics, SQLite/IPC and virtualization scope remain unchanged.

For the project owner, begin with [How it works](HOW_IT_WORKS.md), then [Product requirements](PRODUCT_REQUIREMENTS.md). For implementation, read [agent guidance](../AGENTS.md), [Architecture](ARCHITECTURE.md), and the documents covering the requested increment. Review [open decisions](decisions/README.md) before filling in missing behavior.

| Document | Purpose |
| --- | --- |
| [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) | Scope, mandatory behavior, and acceptance examples |
| [HOW_IT_WORKS.md](HOW_IT_WORKS.md) | Plain-language end-to-end explanation for the owner |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Process boundaries, service responsibilities, data flow, and performance |
| [DOMAIN_MODEL.md](DOMAIN_MODEL.md) | Source-independent identities, comments, trees, and local/view state |
| [SEEN_STATE.md](SEEN_STATE.md) | Manual per-comment state and mutation rules |
| [REFRESH_AND_MERGE.md](REFRESH_AND_MERGE.md) | Discovery, safe merging, and refresh history |
| [FILTERING_AND_SEARCH.md](FILTERING_AND_SEARCH.md) | Match/context semantics, stable results, dates, and search |
| [UI_AND_NAVIGATION.md](UI_AND_NAVIGATION.md) | Tabs, reading, sorting, keyboard navigation, and overview ruler |
| [DATABASE.md](DATABASE.md) | SQLite storage, transactions, migrations, backup, and isolation |
| [EXTRACTORS.md](EXTRACTORS.md) | External helper adapters, normalization, and process lifecycle |
| [LOCALIZATION_AND_THEMING.md](LOCALIZATION_AND_THEMING.md) | English/Polish, locale-independent search, and appearance |
| [TESTING.md](TESTING.md) | Deterministic verification and later UI/release checks |
| [PACKAGING.md](PACKAGING.md) | Windows x64 ZIP/Squirrel build and validation, identity, installer isolation and profile safety |
| [decisions/README.md](decisions/README.md) | Accepted foundations, unresolved choices, and ADR guidance |

## How to interpret these documents

- **Required / invariant**: behavior supplied by the product requirements; future increments must preserve it.
- **Proposed / candidate**: an implementation direction to evaluate, not an installed dependency or approved final design.
- **Unresolved / open**: behavior or policy still requiring a decision. Keep it explicit until settled; the [decision register](decisions/README.md) collects these questions.
- **Current scaffold**: a statement about files currently in the repository, separate from the target architecture.

Examples explain requirements; they do not supply otherwise unspecified defaults. Conceptual entity names, directory layouts, service names, and diagrams describe responsibilities rather than committed APIs or schemas. The detailed documents own their respective contracts; [Product requirements](PRODUCT_REQUIREMENTS.md) connects them. If descriptions conflict, resolve the conflict against the owner's requirements and update all affected documents together.

## Cross-cutting glossary

| Term | Meaning |
| --- | --- |
| Content item / discussion | One video or one Community Post with its locally stored discussion |
| Comment | An individual root comment or reply, each with its own seen state |
| Thread / conversation tree | A top-level comment and its descendants; not a persistent seen-state entity |
| Active discussion | The video or Community Post in the currently active reader tab; initial search/filter/bulk scope |
| Raw search match | A comment satisfying the search predicate itself, before the other filters |
| Active-filter match | A comment satisfying the complete filter set at the currently applied view evaluation |
| Context comment | A displayed conversation member that did not itself satisfy that evaluation's complete filter set |
| Unseen | A durable, manually controlled per-comment state |
| Discovery / visual NEW | Discovery is recorded for every imported comment; visual NEW excludes the baseline and is exactly first discoveries in the latest accepted post-baseline refresh, surviving restart until the next accepted refresh |
| Apply changes / Update view | Recompute a view from local data already persisted |
| Refresh | Remote acquisition, safe merge, then automatic recomputation of the active view after successful explicit refresh |

Seen edits update durable state immediately but retain the applied matching set and displayed membership/order until local Apply or successful explicit Refresh recomputes the view. Matching bulk actions and filtered-reader match navigation use that applied active-filter set. Publication-date predicates use `publishedAt`; "new since refresh" refers to discovery history, not publication dates. See [Filtering and search](FILTERING_AND_SEARCH.md).

See [Domain model](DOMAIN_MODEL.md) for identity and relationships and [Filtering](FILTERING_AND_SEARCH.md) for the precise result-set distinction.

## Maintenance

Documentation and tests are part of every behavior change. Update affected contracts and acceptance examples; record substantial architectural decisions as small [ADRs](decisions/README.md). Move a choice from open to accepted only when it is actually resolved. Avoid duplicating implementation detail in [AGENTS.md](../AGENTS.md); keep that file a concise instruction set and map.
