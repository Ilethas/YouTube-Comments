# Testing strategy

Automated testing is a product requirement. The first application milestone adds Vitest domain/localization tests and focused jsdom/Testing Library interaction tests. The broader matrix below remains the target strategy, not a claim that persistence/acquisition/search have been tested. See [Architecture](ARCHITECTURE.md) and [Product requirements](PRODUCT_REQUIREMENTS.md).

## Current execution and verification

- `npm test`: 15 deterministic tests pass across domain, localization, and renderer suites. No Electron, network, database, or real YouTube data is required. Tree precondition checks do not select real-source repair policy. Ctrl+click tests cover both resulting states and all stored descendants; component tests exercise actual Ctrl modifier and Space-key activation.
- `npm run typecheck`: passes with strict TypeScript and TSX.
- `npm run lint`: passes without warnings. Generated `.vite` and `out` artifacts are excluded. The scaffold's legacy ESLint import resolver cannot resolve Vitest's package export; a documented single-line exception leaves TypeScript and the runner to validate that import.
- `npm run build:renderer`: passes; emits the React bundle and relative local asset paths.
- `npm run package`: Forge production main/preload/renderer builds passed on Windows x64. The process returned exit code 0 during packaging without producing a final executable in `out`; a completed distributable is **not verified**. No packaging/maker changes were made to address this scaffold/environment limitation.
- An actual Electron runtime smoke check loaded the Forge-built app, rendered all 24 synthetic comments, opened the Community Post, verified live Polish selection, checked unchanged seen flags, verified no renderer Node globals plus sandbox/context isolation, and exercised native light-to-dark System changes and an explicit Light override. No renderer errors were observed. Light/dark and Polish screenshots were inspected locally. The temporary harness/profile/screenshots are ignored `.vite` artifacts, not a new E2E framework or production feature.

Commands were run on Windows with Node 26.7.0 using `npm.cmd` because PowerShell blocks `npm.ps1`. esbuild config loading required a sandbox retry with broader filesystem access. The runtime check removed the inherited `ELECTRON_RUN_AS_NODE` environment variable for its process so Electron could run as a desktop app. Vite's existing CommonJS Node API emits a deprecation notice; it does not fail these checks.

`npm start` is the development entry point. `npm run build:renderer` provides an independent renderer build. A manual acceptance pass can switch both tabs and languages, click and Ctrl+click mixed subtrees, check that NEW survives marking seen, and change System/Light/Dark. The app explicitly reports that all changes reset on reload. No restart persistence, real acquisition/merge, search/filter behavior, virtualization/ruler performance, or packaged installer is claimed by these checks.

## Test layers

| Layer | Purpose | Environment |
| --- | --- | --- |
| Domain/unit | Prove tree, state, merge planning, filtering, search, and sorting behavior quickly. | Vitest is installed; tree/manual-state foundation tests exist. Merge/search/filter/sort tests await those increments. |
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

Use saved backend output for `yt-dlp` and `post-archiver-improved` adapter tests. Keep fixture schemas separate from application domain fixtures. Record each fixture's backend/version where known, what behavior it exercises, and whether it is captured, redacted, or synthetic. Avoid committing credentials or unnecessary personal information.

Include minimal fixtures for optional metadata, Unicode/Polish text, multiline content, unavailable timestamps, nested relationships, parents arriving after replies, partial data, malformed output, and duplicate/conflicting identities. Which fixture represents a valid source record must be verified against the selected backend; do not invent an output format and call it a captured example.

A controlled runner should simulate missing helpers, incompatible output, process failure, cancellation, and diagnostic output. Assert safe argument construction and that only the main process invokes extractors. An internal database worker remains owned by the main-side backend and does not expose SQLite or other privileges to the renderer. The planned adapter boundary is in [Extractors](EXTRACTORS.md).

## Small meaningful UI workflows

A small meaningful UI/end-to-end suite is expected later. Choose a few workflows that prove the important boundaries; this is not a requirement for a large suite duplicating every domain case. Useful candidates include:

1. Acquire the unseen baseline without NEW indicators, manually process a comment, then explicitly refresh with a later discovery and verify preserved state plus automatic active-view recomputation.
2. In Unseen only, save a seen edit without moving the result, apply a matching-set bulk action to the last applied IDs while excluding context, then Apply changes locally.
3. Search a large discussion with another active filter, navigate to an unrendered active-filter match through the keyboard/ruler, and reopen the saved workspace after restart.

Use focused checks as needed for English/Polish, System as the first-run appearance, persisted Light/Dark choices, safe rendering, and the typed security boundary. Exact UI tooling and keyboard bindings remain open; retain most edge-case coverage in the deterministic domain/integration suites.

## Performance and test execution

Generate reproducible datasets containing thousands and tens of thousands of comments, including deep and broad trees. Verify filtering/search/navigation do not inspect DOM nodes and that rendering is virtualized. Timing and memory budgets must be chosen against supported target hardware; avoid arbitrary pass/fail thresholds before that decision. Performance regressions should be measured separately from deterministic correctness assertions where timing would be flaky.

The normal suite must run without live YouTube access, credentials, or external helper installation. Future optional smoke tests must have a distinct command/opt-in switch and disposable database. They can reveal upstream drift but must not make ordinary domain validation depend on remote availability.

The foundation selects Vitest, jsdom, and Testing Library in [ADR 0001](decisions/0001-synthetic-reader-foundation.md). Keep commands and current verification above in sync with [agent guidance](../AGENTS.md). Behavior changes require corresponding tests and documentation; significant policy choices belong in [ADRs](decisions/README.md).
