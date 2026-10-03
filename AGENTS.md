# Project guidance

This project is a persistent YouTube discussion reader built toward Electron + React + TypeScript. The core loop is acquire, persist, refresh, identify changes, read in context, manually mark processed, and search/filter/navigate.

## Start here

- [Documentation map and status](docs/README.md)
- [Product requirements](docs/PRODUCT_REQUIREMENTS.md) and [owner's walkthrough](docs/HOW_IT_WORKS.md)
- [Architecture and security boundary](docs/ARCHITECTURE.md)
- [Open decisions and ADR process](docs/decisions/README.md)

The current implementation includes main-owned SQLite ingestion/merge/history, isolated profiles, typed validated IPC, live public acquisition/refresh, compact English/Polish reading, real avatar evidence, persistent closable tabs and Library reopen. Main-only exact helper executable overrides precede safe direct PATH lookup. See ADRs [0001](docs/decisions/0001-synthetic-reader-foundation.md), [0002](docs/decisions/0002-sqlite-and-typed-reader-boundary.md), [0004](docs/decisions/0004-durable-observation-merge.md), [0005](docs/decisions/0005-live-helper-execution-and-acquisition-ipc.md), [0006](docs/decisions/0006-compact-reader-and-persistent-tabs.md), and [testing status](docs/TESTING.md). Search/filtering, full view restoration, virtualization and the ruler remain targets. Implement only the owner's requested increment.

## Invariants to protect

- Library items and open workspace tabs are distinct. Close never deletes content/comments/seen/history. Open activates one existing tab or reopens the same item; tab order and active identity persist in SQLite. Closing active chooses right, then left, then empty.
- Avatar unknown/lossy observations never clear useful evidence. Render usable HTTPS images with anonymous/no-referrer loading and fixed-size initials fallback. Helper paths are main startup configuration only; `.bat`/`.cmd` and shell execution remain excluded.
- Seen/unseen belongs to each comment, persists in SQLite, and changes only through explicit user actions. Viewing, scrolling, navigation, and refresh never mark a comment seen. There is no persistent thread-level seen state.
- A checkbox toggles only its comment. Ctrl+click applies that resulting state to the comment and its descendants. [Seen state](docs/SEEN_STATE.md)
- Refresh merges by stable source identity, preserves local state, inserts new comments unseen, and does not delete comments merely absent from an extraction. Failed/partial refreshes must preserve valid stored data; refresh writes are transactional. [Refresh and merge](docs/REFRESH_AND_MERGE.md)
- First successful acquisition establishes a baseline: record discovery metadata and insert comments unseen, without visual NEW markers. Subsequent refresh discoveries can be shown as NEW; marker lifetime is unresolved. Discovery, publication time, and manual unseen state are distinct.
- Initial search/filtering and generic "all comments" bulk actions cover the active discussion only, including all its stored comments. Library-wide search is future scope; a generic Mark all must never imply a library-wide mutation.
- Distinguish raw search matches, applied active-filter matches, and context. Include complete containing trees. Matching bulk actions and next/previous match navigation use the last applied active-filter matching set, never visible context alone. [Filtering and search](docs/FILTERING_AND_SEARCH.md)
- Seen edits persist immediately without changing current membership/order or replacing the applied matching set. Apply changes / Update view recomputes locally. Successful explicit Refresh acquires, safely merges, then automatically recomputes the active view. [UI and navigation](docs/UI_AND_NAVIGATION.md)
- Publication-date filters use `publishedAt`; "new since refresh" uses discovery/refresh history. Date presets are examples, not a fixed mandatory list. Bulk recoverability is required design work; its mechanism remains unresolved. [Seen state](docs/SEEN_STATE.md)
- Search, filtering, counts, navigation, and overview markers operate on application data, never on which rows happen to exist in the virtualized DOM.
- Renderer access follows typed preload/contextBridge -> privileged backend owned by the Electron main side -> persistence/extractors. Renderer never owns/accesses SQLite. Main-side database work may later use an internal worker; only main invokes extractors. No arbitrary Node, filesystem, SQL, or process-launch API in the renderer. [Extractors](docs/EXTRACTORS.md)
- Treat SQLite data as valuable user data. Isolate development/test databases, preserve backups and migration safety, and never use localStorage for durable application data. [Database](docs/DATABASE.md)
- Design for English/Polish and System/Light/Dark from the start; System is the default. Use stable translation keys, Intl formatting, semantic tokens, and persisted preferences. UI locale does not change content or search. [Localization and theming](docs/LOCALIZATION_AND_THEMING.md)
- Windows is the initial development/packaging target; preserve reasonable paths to Linux/macOS later. The overview/navigation ruler is a required target feature. [Packaging](docs/PACKAGING.md)

## Working agreements

- Read the relevant detailed documents before changing behavior. Distinguish accepted requirements, proposed implementation choices, and unresolved decisions; do not silently turn an open question into a product rule.
- Keep domain logic independent of Electron, React, extractor formats, and SQLite mechanics. [Domain model](docs/DOMAIN_MODEL.md)
- Add/update meaningful automated tests alongside behavior changes. Favor deterministic domain tests, temporary SQLite integration tests, and saved extractor fixtures. Live YouTube tests are optional and separate. [Testing](docs/TESTING.md)
- Update relevant docs when behavior changes. Explain invariants and reasons; use TSDoc for important exported domain types, services, and functions. Add a small ADR for a significant architectural choice.
- Do not assume a documented dependency, script, helper, or packaged platform already exists. Check the repository. [Packaging](docs/PACKAGING.md)
- Keep AI summarization, sentiment, automatic translation, posting/replying, likes/subscriptions, account integration, and other unrelated features outside the current scope.

## Useful commands at this milestone

`npm test` runs deterministic domain/localization/component, IPC, and temporary SQLite integration tests (Node 24.13+). `npm run typecheck` and `npm run lint` check the source. `npm run build:renderer` builds only the renderer; `npm run package` also invokes Forge's main/preload/renderer builds. `npm run test:electron` verifies built-entry IPC/persistence across real restarts in a disposable profile. `npm start` starts the isolated development profile. On Windows PowerShell with script execution disabled, use `npm.cmd`. See [testing status](docs/TESTING.md) for verified results and packaging limitations. Do not install a stack or start feature implementation merely to validate a documentation change.
