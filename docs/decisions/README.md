# Decisions and open questions

[Documentation map](../README.md) · [Product requirements](../PRODUCT_REQUIREMENTS.md) · [Architecture](../ARCHITECTURE.md)

This directory holds small architecture decision records (ADRs). This register includes the owner's clarification of 2026-10-02 and the first application foundation decision, separating settled requirements from remaining choices. Detailed contracts remain in their owning documents.

## Accepted foundations

These come from the owner's requirements and are not waiting for a technology-selection exercise:

- Electron + React + TypeScript desktop reader; SQLite for durable application data. [Architecture](../ARCHITECTURE.md), [Database](../DATABASE.md)
- Video extraction initially uses yt-dlp; public individual Community Post extraction initially uses post-archiver-improved. Adapters isolate external formats from the domain and UI. [Extractors](../EXTRACTORS.md)
- Renderer -> typed preload/contextBridge -> privileged backend owned by the Electron main side -> persistence/extractors. Renderer never owns/accesses SQLite. The backend may later delegate database work to an internal worker; only main invokes external extractors. [Architecture](../ARCHITECTURE.md)
- Seen/unseen is manual, durable, and per comment. Refresh preserves it; new identities start unseen; missing extraction records are retained. [Seen state](../SEEN_STATE.md), [Refresh](../REFRESH_AND_MERGE.md)
- Initial normal search/filtering covers all stored comments in the active discussion, including collapsed/unrendered ones. Contents, author/display name/handle, direct replied-to author, ordinary text, opt-in regex, and case modes are required initially. Top-level author search may also be supported where useful. Library-wide search is a possible future feature. [Filtering](../FILTERING_AND_SEARCH.md)
- Generic "all comments" bulk actions mean the active discussion. Any future library-wide mutation must be separately and explicitly named/scoped. Matching bulk actions use the last applied active-filter matching IDs even after pending seen edits. [Seen state](../SEEN_STATE.md)
- Raw search matches satisfy search alone; applied active-filter matches satisfy the complete filter set at its applied evaluation; context comments are included for their containing trees. Complete trees are retained. Filtered-reader next/previous match navigation uses applied active-filter matches; search-specific navigation refers to raw search matches within the applicable view. [Filtering](../FILTERING_AND_SEARCH.md), [UI](../UI_AND_NAVIGATION.md)
- Seen edits save immediately without changing displayed membership/order or replacing the applied match set. Apply recomputes locally. Successful explicit Refresh acquires, safely merges, then automatically recomputes the active view. Ctrl+Enter and F5 remain likely/default shortcuts pending formal shortcut policy. [Refresh](../REFRESH_AND_MERGE.md)
- First successful acquisition establishes a baseline: comments receive `firstDiscoveredAt` and start unseen but are not visually NEW. Subsequent refresh discoveries are eligible for NEW; lifetime remains open. [Domain model](../DOMAIN_MODEL.md)
- Publication filters use `publishedAt`; "new since refresh" uses discovery/refresh history. Do not use a vague "Since last refresh" publication-date preset. Useful date presets are examples, not a fixed mandatory list. Exact timestamps must remain discoverable when available. [Filtering](../FILTERING_AND_SEARCH.md), [UI](../UI_AND_NAVIGATION.md)
- Recoverability for bulk state changes is required design work. The undo mechanism is unresolved; recording previous values in the mutation transaction is only a candidate unless a later ADR selects it. [Seen state](../SEEN_STATE.md), [Database](../DATABASE.md)
- Virtualization must coexist with data-based filtering, counts, search, and navigation. The scrollbar-adjacent overview/navigation ruler is a required target feature representing at least unseen comments, search matches, and subsequent-refresh discoveries. Geometry/overlap/lifetime remain open. [UI](../UI_AND_NAVIGATION.md)
- English/Polish localization and System/Light/Dark appearance are designed in from the start. System is the default and follows OS changes; search uses original content independently of UI language. [Localization and theming](../LOCALIZATION_AND_THEMING.md)
- Windows is the initial development and packaging target. Avoid unnecessary barriers to later Linux/macOS support without requiring those platforms initially. [Packaging](../PACKAGING.md)
- Deterministic automated domain, fixture, and temporary SQLite tests and documentation updates are part of implementation. A small meaningful UI/E2E suite is expected later, without an exhaustive UI-testing commitment. Eligible remote metadata/text may update with newer valid information; a refresh need not mutate unchanged fields. [Testing](../TESTING.md), [Refresh](../REFRESH_AND_MERGE.md)

## Resolved register entries

The original IDs are retained for traceability. Related entries below contain only their remaining open portions.

| ID | Settled result | Owning documents |
| --- | --- | --- |
| Q-01 | Initial search/filtering and default all-comments bulk scope is the active discussion. Library-wide search is future scope; generic Mark all must never imply it. | [Filtering](../FILTERING_AND_SEARCH.md), [Seen state](../SEEN_STATE.md) |
| Q-02 | Matching bulk actions use the last applied active-filter matching set. Pending seen edits do not trigger a fresh target query. Apply or successful explicit Refresh creates a new evaluation. | [Seen state](../SEEN_STATE.md), [UI](../UI_AND_NAVIGATION.md) |
| Q-04 | Discovery-based "new since refresh" is separate from publication-date filtering. The vague publication preset is not part of the specification. Selection/lifetime for any discovery presentation is still covered by Q-05. | [Refresh](../REFRESH_AND_MERGE.md), [Filtering](../FILTERING_AND_SEARCH.md) |
| Q-17 (partial) | Built-in node:sqlite, one main-owned connection, minimal schema 1, ordered transactional user_version migrations, UTC TEXT fixture timestamps, FK enforcement, and atomic seen writes. Search/history/backup and large-data connection/performance choices remain open. | [ADR 0002](0002-sqlite-and-typed-reader-boundary.md) |
| Q-18 (partial) | Distinct development/production profile paths, explicit absolute temporary test paths, no missing-config production fallback, idempotent demo initialization, and safe rejection of newer schemas. Released migration backup/restore, retention, uninstall, and export remain open. | [ADR 0002](0002-sqlite-and-typed-reader-boundary.md) |
| Q-22 (partial) | Foundation React/Intl/theme/Vitest choices remain; persistence adds three intent-only bridge methods, small runtime guards, sender/frame/document validation, structured error codes, and acknowledged UI snapshots. Broader query/event/diagnostic contracts and later E2E tools remain open. | [ADR 0001](0001-synthetic-reader-foundation.md), [ADR 0002](0002-sqlite-and-typed-reader-boundary.md) |
| Q-13 (partial) | Foundation matches the first supported browser-language base, formats with en/pl and host timezone, falls back to English, and labels a fixed demo reference clock. Production time cadence, timezone controls, and optional follow-system language remain open. | [Localization](../LOCALIZATION_AND_THEMING.md), [ADR 0001](0001-synthetic-reader-foundation.md) |

Q-05's initial baseline, Q-06's successful Refresh and applied-set behavior, Q-11's filtered-match navigation, Q-13's System default, and Q-20's Windows initial target are likewise settled in the foundations above. They are not reopened by the narrower questions below.

## Open decisions

The questions below do not weaken the accepted invariants. Resolve each before implementing behavior that depends on it. A routine engineering choice can be made within an authorized increment using evidence and documented reasoning; a materially ambiguous product rule should be clarified with the owner. An item here is not an automatic approval gate for unrelated work.

### Product semantics

| ID | Unresolved question and why it matters | Owning documents |
| --- | --- | --- |
| Q-03 | **Publication-date semantics:** Choose inclusive/exclusive endpoints, governing timezone, missing/imprecise `publishedAt` handling, which useful presets to offer and their evaluation rules, and exact timestamp presentation. Date bulk and filtering must agree; preset examples are not fixed commitments. | [Filtering](../FILTERING_AND_SEARCH.md), [Seen state](../SEEN_STATE.md), [Localization](../LOCALIZATION_AND_THEMING.md) |
| Q-05 | **Discovery presentation:** Choose final NEW-marker lifetime/removal and which subsequent refresh history window a discovery control represents. Initial baseline comments remain excluded from visual NEW. Interaction with accepted partial/unknown attempts depends on Q-14; do not invent that policy. | [Refresh](../REFRESH_AND_MERGE.md), [Domain model](../DOMAIN_MODEL.md), [UI](../UI_AND_NAVIGATION.md) |
| Q-06 | **Remaining view UX:** Choose explicit filter/search control timing, pending-state styling or supplementary live indicators, invalid-query/failed-save feedback, scroll handling after recomputation, and inactive-tab notification behavior. Applied matching targets and automatic active-view recomputation after successful explicit Refresh are settled. | [Filtering](../FILTERING_AND_SEARCH.md), [UI](../UI_AND_NAVIGATION.md), [Seen state](../SEEN_STATE.md) |
| Q-07 | **Search comparisons:** Define multi-field/value combination, Unicode normalization/diacritics/case rules, text representation, regex dialect, and unavailable replied-to/author behavior. Interface language must not change results. | [Filtering](../FILTERING_AND_SEARCH.md), [Domain model](../DOMAIN_MODEL.md) |
| Q-08 | **Tree and sort policy:** Define handling of missing parents, cycles, duplicate/conflicting records, absent relationship data, sort modes/defaults/ties, and reply ordering. Do not fabricate source relationships or detach replies to achieve a sort. | [Domain model](../DOMAIN_MODEL.md), [Filtering](../FILTERING_AND_SEARCH.md), [Extractors](../EXTRACTORS.md) |
| Q-09 | **Undo/recovery:** Select mechanism, operation scope, retention, durability across restart, and interaction with later edits. Bulk recovery is a requirement to design for; an exact history format and UI are not selected. | [Seen state](../SEEN_STATE.md), [Database](../DATABASE.md) |
| Q-10 | **Tab restoration:** Decide duplicate-tab behavior, saved pending-result reconstruction, missing scroll-anchor fallback, cross-tab update timing, and optional unseen-badge scope. Shared comments retain one durable seen state. | [UI](../UI_AND_NAVIGATION.md), [Database](../DATABASE.md) |
| Q-11 | **Navigation details and shortcuts:** Choose wrap/reveal behavior, persistence of navigation-triggered expansion, specialized unseen/search navigation freshness within the applicable view, and formal shortcut/focus policy. Filtered-reader match navigation uses the last applied active-filter set; Ctrl+click is required and Ctrl+Enter/F5 are likely/default bindings. | [UI](../UI_AND_NAVIGATION.md), [Seen state](../SEEN_STATE.md) |
| Q-12 | **Ruler geometry and presentation:** Define variable-height/collapsed-tree marker positions, overlapping categories, aggregation, and marker lifetime. Also settle field layout, supported text formatting, avatar loading/caching, and external-link policy. The ruler and its unseen/search/new categories are required. | [UI](../UI_AND_NAVIGATION.md), [Architecture](../ARCHITECTURE.md) |
| Q-13 | **Remaining localization details:** Optional follow-system language, timezone controls, richer regional formatting needs, and production relative-time update cadence. Base-locale matching and English key fallback are selected; ADR 0002 persists explicit selections and uses main-side OS languages on first run. | [Localization and theming](../LOCALIZATION_AND_THEMING.md) |

### Data, execution, and distribution

| ID | Unresolved choice and evidence needed | Owning documents |
| --- | --- | --- |
| Q-14 | **Partial/uncertain refresh policy:** Decide whether validated partial/unknown-completeness observations may commit safely or only known-complete accepted runs may commit. Define completeness evidence, field absence versus explicit-empty updates, and how any accepted partial first attempt relates to the first successful baseline and view recomputation. A successful process exit is not completeness evidence; preserve valid local data. | [Refresh](../REFRESH_AND_MERGE.md), [Extractors](../EXTRACTORS.md) |
| Q-15 | **Identity and remote deletion:** Verify source-ID stability/scope, parent fidelity, and available timestamp precision with fixtures. Choose internal IDs and behavior for explicit remote deletion/tombstone signals; absence alone is never deletion. | [Domain model](../DOMAIN_MODEL.md), [Extractors](../EXTRACTORS.md), [Database](../DATABASE.md) |
| Q-16 | **Scheduling and failure lifecycle:** Choose refresh serialization/concurrency, retries, cancellation, crash-interrupted-run recovery, view revisions/notifications, and diagnostic retention. Preserve seen edits made while extraction runs. | [Architecture](../ARCHITECTURE.md), [Refresh](../REFRESH_AND_MERGE.md), [Extractors](../EXTRACTORS.md) |
| Q-17 | **Remaining SQLite implementation:** Search/index acceleration, refresh/history/workspace schema, larger-data connection/worker/journaling choices, released migration support, and backup mechanism. The initial integration/schema/transactions are selected in ADR 0002 only for this milestone. | [Database](../DATABASE.md), [Architecture](../ARCHITECTURE.md) |
| Q-18 | **Remaining data lifecycle:** Backup-before-released-migration/restore policy, retention/validation, restore coordination, supported downgrade/upgrade behavior beyond safe newer-schema rejection, uninstall handling, and export format/coverage. Initial profile locations and isolation are selected in ADR 0002. | [Database](../DATABASE.md), [Packaging](../PACKAGING.md) |
| Q-19 | **Helper compatibility:** Verify helper versions, commands, flags, output/completeness contracts, runtime needs, resolution precedence, and missing-helper UX. Preserve the development PATH to app-local/bundled transition behind a resolver. | [Extractors](../EXTRACTORS.md), [Packaging](../PACKAGING.md) |
| Q-20 | **Windows release details and later platforms:** Choose supported Windows versions/architectures, application identity, helper distribution/licensing/update mechanics, native SQLite packaging, signing, release channels, and app updates. Future Linux/macOS support and timing remain open; initial Windows targeting is settled independently of template makers. | [Packaging](../PACKAGING.md) |
| Q-21 | **Query performance:** Select virtualization/measurement, query scheduling, batching, worker placement, regex responsiveness strategy, and measurable performance budgets. Indexes must preserve substring/regex semantics and complete results. | [Architecture](../ARCHITECTURE.md), [Filtering](../FILTERING_AND_SEARCH.md), [UI](../UI_AND_NAVIGATION.md), [Testing](../TESTING.md) |
| Q-22 | **Remaining libraries and contracts:** Broader query/event/workspace contracts, request-ID/diagnostic policy, and later E2E tooling. Initial durable bootstrap/seen/preference contracts and small runtime IPC validation are selected in ADR 0002; future commands are not implied. | [Architecture](../ARCHITECTURE.md), [Localization](../LOCALIZATION_AND_THEMING.md), [Testing](../TESTING.md) |
| Q-23 | **Future source/library scope:** Channel-wide Community Post browsing, authenticated/member-only extraction, and library-wide search are possible future features with unresolved scope and behavior. None is required by the initial product; no generic bulk command grants future library-wide mutation scope. | [Product requirements](../PRODUCT_REQUIREMENTS.md), [Extractors](../EXTRACTORS.md), [UI](../UI_AND_NAVIGATION.md) |

The local open-question sections may contain finer implementation details; these grouped entries provide a shared index. Update both the owning document and this register when resolving a question. Record which acceptance tests demonstrate the resulting rule.

## Implementation dependencies, not a new roadmap

The synthetic React/domain/UI foundation in [ADR 0001](0001-synthetic-reader-foundation.md) now has the bounded SQLite/IPC persistence foundation in [ADR 0002](0002-sqlite-and-typed-reader-boundary.md). Acquisition, refresh, search, and bulk behavior remain absent. These notes identify dependencies for later increments without requiring every open question to be closed first.

| Before implementing this behavior | Decisions or evidence actually needed |
| --- | --- |
| Extending durable SQLite storage | Initial integration/schema/migrations/timestamps/profile isolation are selected in ADR 0002. Resolve only the additional schema, safety, or performance choices needed by the next increment. Real-source constraints still require Q-15 evidence. |
| First real normalized acquisition and persistent merge | Verify helper invocation/output and exact source-ID scope/collision guarantees; resolve missing/conflicting parent handling and absent-versus-empty fields (Q-08/Q-15/Q-19). Define acceptance of partial/unknown coverage and its relation to the first successful baseline (Q-14). These questions cannot be silently answered by fixture guesses. |
| Initial functional search/filter reader | Set multi-field combination, case/Unicode behavior, regex dialect/responsiveness, and unavailable author/relationship behavior (Q-07/Q-21). Resolve control-apply timing and feedback needed by that UI (part of Q-06). Discussion scope and applied-match semantics are already decided. |
| Date filtering or date bulk actions | Define `publishedAt` boundary/timezone/missing-value rules and whichever presets are offered (Q-03). Discovery-based newness is separate. |
| Bulk state-changing UI | Choose the recoverability behavior/mechanism that supports this feature (Q-09); do not silently omit recoverability or require one candidate storage technique. Action scope and matching IDs are already decided. |

Final backup/restore implementation, helper binary distribution/update mechanics, future platform support, signing/release details, later UI test tooling, detailed ruler geometry, final NEW-marker lifetime, and future source/library features do not block a foundational storage/acquisition increment. They must be resolved before their own dependent features or release guarantees are delivered. Backup planning and protection of user data remain required from the start; deferring the final mechanism does not permit unsafe data handling. If the first milestone includes the ruler or visual NEW behavior, the corresponding presentation decisions become dependencies of that milestone rather than silently chosen defaults.

## Writing an ADR

Use a short sequential name such as `0001-descriptive-title.md` when the first decision is actually made. An ADR should contain:

1. Title, date, and status: proposed, accepted, or superseded.
2. Context: the concrete requirement or problem and links to relevant documents/open questions.
3. Decision: the selected behavior or architecture and its boundaries.
4. Reasons and alternatives: enough to explain why it was chosen, including tradeoffs.
5. Consequences and validation: affected data, migration/testing needs, and practical limitations.

Prefer small records about significant decisions, such as SQLite integration, partial-refresh acceptance, query snapshot semantics, or helper distribution. Do not create ADRs to narrate every function or repeat all product requirements. Link an accepted ADR from the owning documents and this index. Keep superseded records and link their replacements so the rationale survives.

## ADR index

- [0001 — Synthetic React reader foundation](0001-synthetic-reader-foundation.md): accepted; scopes the React, localization, theme, domain preconditions, and deterministic testing choices to the in-memory milestone.
- [0002 — SQLite persistence and typed reader boundary](0002-sqlite-and-typed-reader-boundary.md): accepted; main-owned built-in SQLite, initial schema/migrations/profiles, narrow validated IPC, durable seen state/preferences, and packaging implications for the synthetic milestone.
