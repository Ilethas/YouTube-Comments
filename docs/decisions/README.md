# Decisions and open questions

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
- First successful acquisition establishes a baseline: comments receive `firstDiscoveredAt` and start unseen but are not visually NEW. Subsequent refresh discoveries are eligible for NEW; lifetime remains open. [Domain model](../DOMAIN_MODEL.md)
- Publication filters use `publishedAt`; "new since refresh" uses discovery/refresh history. Do not use a vague "Since last refresh" publication-date preset. Useful date presets are examples, not a fixed mandatory list. Exact timestamps must remain discoverable when available. [Filtering](../FILTERING_AND_SEARCH.md), [UI](../UI_AND_NAVIGATION.md)
- Recoverability for bulk state changes is required design work. The undo mechanism is unresolved; recording previous values in the mutation transaction is only a candidate unless a later ADR selects it. [Seen state](../SEEN_STATE.md), [Database](../DATABASE.md)
- Virtualization must coexist with data-based filtering, counts, search, and navigation. The scrollbar-adjacent overview/navigation ruler is a required target feature representing at least unseen comments, search matches, and subsequent-refresh discoveries. Geometry/overlap/lifetime remain open. [UI](../UI_AND_NAVIGATION.md)
- English/Polish localization and System/Light/Dark appearance are designed in from the start. System is the default and follows OS changes; search uses original content independently of UI language. [Localization and theming](../LOCALIZATION_AND_THEMING.md)
- Windows is the initial development and packaging target. Avoid unnecessary barriers to later Linux/macOS support without requiring those platforms initially. [Packaging](../PACKAGING.md)
- Deterministic automated domain, fixture, and temporary SQLite tests and documentation updates are part of implementation. A small meaningful UI/E2E suite is expected later, without an exhaustive UI-testing commitment. Eligible remote metadata/text may update with newer valid information; a refresh need not mutate unchanged fields. [Testing](../TESTING.md), [Refresh](../REFRESH_AND_MERGE.md)

## Resolved register entries

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


ADR 0007 extends this with generic singleton Library/Settings views, unified pointer/keyboard reorder, confirmed local Library removal with active-source protection, Settings-owned preferences and neutral ancestry rails. Scroll/filter/sort/expansion/selection restoration remains open.

ADR 0006 resolves the bounded open-tab portion of Q-10/Q-17: unique tabs per
library item, persisted IDs/order/active selection, close without deletion, nearby
replacement and Library reopen. It also selects compact reading and anonymous
HTTPS avatar evidence/rendering (part of Q-12/Q-15), exact main-startup executable
overrides before PATH (part of Q-19), and three exact workspace IPC intents (Q-22).
The Community warning conclusion and regression evidence are in ADR 0006. Remaining
scroll/filter/expansion restoration, caching/link formatting, broader contracts and
distribution questions remain open as narrowed below.

The original IDs are retained for traceability. Related entries below contain only their remaining open portions.

| ID | Settled result | Owning documents |
| --- | --- | --- |
| Q-07 | Search comparison semantics are settled by ADR 0008: NFC substring, locale-independent lowercase, significant diacritics, selected-field OR plus seen AND, unknown direct-parent author does not match, ECMAScript pattern-only u/iu. | [ADR 0008](0008-active-discussion-applied-queries.md) |
| Q-01 | Initial search/filtering and default all-comments bulk scope is the active discussion. Library-wide search is future scope; generic Mark all must never imply it. | [Filtering](../FILTERING_AND_SEARCH.md), [Seen state](../SEEN_STATE.md) |
| Q-02 | Matching bulk actions use the last applied active-filter matching set. Pending seen edits do not trigger a fresh target query. Apply or successful explicit Refresh creates a new evaluation. | [Seen state](../SEEN_STATE.md), [UI](../UI_AND_NAVIGATION.md) |
| Q-04 | Discovery-based "new since refresh" is separate from publication-date filtering. The vague publication preset is not part of the specification. Selection/lifetime for any discovery presentation is still covered by Q-05. | [Refresh](../REFRESH_AND_MERGE.md), [Filtering](../FILTERING_AND_SEARCH.md) |
| Q-17 (partial) | Built-in node:sqlite, one main-owned connection, ordered transactional migrations through schema 4, normalized remote evidence/history, scoped constraints, atomic writes and separate tab workspace. Search, further view state, backups and large-data choices remain open. | [ADR 0004](0004-durable-observation-merge.md), [ADR 0006](0006-compact-reader-and-persistent-tabs.md) |
| Q-18 (partial) | Distinct development/production profile paths, explicit absolute temporary test paths, no missing-config production fallback, idempotent demo initialization, and safe rejection of newer schemas. Released migration backup/restore, retention, uninstall, and export remain open. | [ADR 0002](0002-sqlite-and-typed-reader-boundary.md) |
| Q-22 (partial) | Foundation React/Intl/theme/Vitest choices remain; the bridge has twelve intent methods with exact runtime guards, sender/frame/document checks, structured errors and acknowledged snapshots. Broader query/event/diagnostic contracts and later E2E tools remain open. | [ADR 0001](0001-synthetic-reader-foundation.md), [ADR 0002](0002-sqlite-and-typed-reader-boundary.md), [ADR 0006](0006-compact-reader-and-persistent-tabs.md) |
| Q-13 (partial) | Foundation matches the first supported browser-language base, formats with en/pl and host timezone, falls back to English, and labels a fixed demo reference clock. Production time cadence, timezone controls, and optional follow-system language remain open. | [Localization](../LOCALIZATION_AND_THEMING.md), [ADR 0001](0001-synthetic-reader-foundation.md) |
| Q-08 (partial) | Stored source relationships stay distinct from safe display placement; missing/cyclic relationships remain durable, with display-root fallback and later same-item resolution. Ambiguous identities are skipped, independent candidates retained. Sorting remains open. | [ADR 0004](0004-durable-observation-merge.md) |
| Q-14 (partial) | Usable partial/unknown batches commit non-destructively with true coverage and may establish the first accepted baseline. Failed normalization commits history only; database failure rolls back all candidate writes/history. ADR 0005 adds stable process failures and compact localized coverage reporting; richer reporting remains open. | [ADR 0004](0004-durable-observation-merge.md) |
| Q-15 (partial) | Source-kind-scoped item uniqueness, item-scoped comment uniqueness, injected UUID internal IDs, current field authority and durable publication precision/labels are implemented. Explicit trustworthy deletion remains open; absence never deletes. | [ADR 0004](0004-durable-observation-merge.md) |
| Q-19 (partial) | yt-dlp 2026.08.19 and post-archiver-improved 0.4.0 formats/invocation intent have deterministic sanitized fixtures and pure adapters/specs. ADR 0005 implements development execution/resolution and exact version probes; distribution remains open. | [ADR 0003](0003-extractor-observations-and-normalization.md) |

Q-05's initial baseline, Q-06's successful Refresh and applied-set behavior, Q-11's filtered-match navigation, Q-13's System default, and Q-20's Windows initial target are likewise settled in the foundations above. They are not reopened by the narrower questions below.

## Open decisions

The questions below do not weaken the accepted invariants. Resolve each before implementing behavior that depends on it. A routine engineering choice can be made within an authorized increment using evidence and documented reasoning; a materially ambiguous product rule should be clarified with the owner. An item here is not an automatic approval gate for unrelated work.

### Product semantics

| ID | Unresolved question and why it matters | Owning documents |
| --- | --- | --- |
| Q-03 | **Publication-date semantics:** Choose inclusive/exclusive endpoints, governing timezone, missing/imprecise `publishedAt` handling, which useful presets to offer and their evaluation rules, and exact timestamp presentation. Date bulk and filtering must agree; preset examples are not fixed commitments. | [Filtering](../FILTERING_AND_SEARCH.md), [Seen state](../SEEN_STATE.md), [Localization](../LOCALIZATION_AND_THEMING.md) |
| Q-05 | **Discovery presentation:** Choose final NEW-marker lifetime/removal and which subsequent refresh history window a discovery control represents. Initial baseline comments remain excluded from visual NEW. Interaction with accepted partial/unknown attempts depends on Q-14; do not invent that policy. | [Refresh](../REFRESH_AND_MERGE.md), [Domain model](../DOMAIN_MODEL.md), [UI](../UI_AND_NAVIGATION.md) |
| Q-06 | **Remaining view UX:** Broader inactive-tab notification behavior remains open. ADR 0010 selects first-match/start on Apply and retained visible identity/offset on Refresh. ADR 0008 settles explicit Apply, independent draft, saved-seen indications, localized errors retaining prior results and Refresh of applied criteria. Applied matching targets and automatic active-view recomputation after successful explicit Refresh are settled. | [Filtering](../FILTERING_AND_SEARCH.md), [UI](../UI_AND_NAVIGATION.md), [Seen state](../SEEN_STATE.md) |
| Q-08 | **Thread sorting:** Stored malformed/unresolved source relationships and safe tree projection are selected in ADR 0004. Define sorting among top-level/display-root trees and stable ties; do not reinterpret containment as direct replies. | [Domain model](../DOMAIN_MODEL.md), [Filtering](../FILTERING_AND_SEARCH.md), [Extractors](../EXTRACTORS.md) |
| Q-09 | **Undo/recovery:** Select mechanism, operation scope, retention, durability across restart, and interaction with later edits. Bulk recovery is a requirement to design for; an exact history format and UI are not selected. | [Seen state](../SEEN_STATE.md), [Database](../DATABASE.md) |
| Q-10 | **Remaining view restoration:** Saved pending-result reconstruction, persistent scroll/anchor fallback, filters/sort/expansion/selection and optional tab unseen-badge scope. ADRs 0006/0007 settle singleton discussion/Library/Settings tabs, unified draggable order, open/active persistence and mixed close/reopen; shared comments retain one seen state. | [UI](../UI_AND_NAVIGATION.md), [Database](../DATABASE.md) |
| Q-11 | **Navigation details and shortcuts:** Collapse reveal, persistence of navigation-triggered expansion and future platform mappings remain open. ADR 0010 selects data-index scrolling and exact mounted reveal/focus. ADR 0008 settles wrapping preorder navigation, live unseen within displayed membership, ID reveal, Ctrl+Enter and F3/Shift+F3. The keyboard milestone adds documented Windows workspace/focus/help bindings and contextual ownership. Filtered-reader match navigation uses the last applied active-filter set; Ctrl+click remains required. Ctrl+R/F5 source Refresh, reopen and numbered tabs are deliberately unbound. | [UI](../UI_AND_NAVIGATION.md), [Seen state](../SEEN_STATE.md) |
| Q-12 | **Ruler geometry and remaining presentation:** Define variable-height/collapsed-tree marker positions, overlapping categories, aggregation and lifetime; richer formatting/external links and any future avatar cache. ADR 0006 selects compact rows and anonymous HTTPS avatars with fallback. The ruler remains required and unimplemented. | [UI](../UI_AND_NAVIGATION.md), [Architecture](../ARCHITECTURE.md) |
| Q-13 | **Remaining localization details:** Optional follow-system language, timezone controls, richer regional formatting needs, and production relative-time update cadence. Base-locale matching and English key fallback are selected; ADR 0002 persists explicit selections and uses main-side OS languages on first run. | [Localization and theming](../LOCALIZATION_AND_THEMING.md) |

### Data, execution, and distribution

| ID | Unresolved choice and evidence needed | Owning documents |
| --- | --- | --- |
| Q-14 | **Richer acquisition reporting:** ADR 0004 settles acceptance/history; ADR 0005 adds localized errors, coverage notice and acknowledged unfiltered view updates. Richer diagnostics and future filtered-view presentation remain open. | [Refresh](../REFRESH_AND_MERGE.md), [Extractors](../EXTRACTORS.md) |
| Q-15 | **Explicit remote deletion:** Identity scope, internal IDs, collision skipping and publication evidence storage are selected in ADR 0004. Trustworthy deletion/tombstone evidence and presentation remain open. Absence never deletes. | [Domain model](../DOMAIN_MODEL.md), [Extractors](../EXTRACTORS.md), [Database](../DATABASE.md) |
| Q-16 | **Remaining scheduling/lifecycle:** ADR 0005 selects temporary single-live-operation serialization, bounded helper retries/deadline, normal-quit cleanup and structured diagnostics while preserving local edits. Final scheduling, cancellation/progress, crash recovery, view revisions/notifications and retention duration remain open. | [Architecture](../ARCHITECTURE.md), [Refresh](../REFRESH_AND_MERGE.md), [Extractors](../EXTRACTORS.md) |
| Q-17 | **Remaining SQLite implementation:** Search/index acceleration, further view state, larger-data connection/worker/journaling choices, released migration support and backups. ADR 0004 selects merge/history; ADR 0007 evolves the bounded tab workspace to schema 4 with unified app views and atomic local removal. | [Database](../DATABASE.md), [Architecture](../ARCHITECTURE.md) |
| Q-18 | **Remaining data lifecycle:** Backup-before-released-migration/restore policy, retention/validation, restore coordination, supported downgrade/upgrade behavior beyond safe newer-schema rejection, uninstall handling, and export format/coverage. Initial profile locations and isolation are selected in ADR 0002. | [Database](../DATABASE.md), [Packaging](../PACKAGING.md) |
| Q-19 | **Helper distribution and future compatibility:** ADR 0005 selects exact probes/no-shell lifecycle; ADR 0006 adds main-startup override → direct PATH precedence with invalid overrides failing closed. Bundled runtime/artifacts, licenses/integrity, bundled precedence and version/update expansion remain open. | [Extractors](../EXTRACTORS.md), [Packaging](../PACKAGING.md) |
| Q-20 | **Windows release details and later platforms:** Choose supported Windows versions/architectures, application identity, helper distribution/licensing/update mechanics, native SQLite packaging, signing, release channels, and app updates. Future Linux/macOS support and timing remain open; initial Windows targeting is settled independently of template makers. | [Packaging](../PACKAGING.md) |
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
