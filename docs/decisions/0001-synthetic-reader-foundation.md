# 0001 — Synthetic React reader foundation

Date: 2026-10-02. Status: accepted for the first application milestone.

## Context

The owner authorized a usable in-memory reader for evaluating video and Community Post discussions, without acquisition or storage. [Q-22](README.md) leaves implementation libraries open; [localization](../LOCALIZATION_AND_THEMING.md) requires stable keys and English/Polish from the start.

## Decision

- Use React 18 and React DOM with Vite's existing TSX transform (`react-jsx`). Keep Forge entry points; no new renderer framework, router, React Vite plugin, or state library. React state owns this small demo. Vite reload is sufficient; React Fast Refresh is not configured.
- Add strict TypeScript checking and upgrade TypeScript from 4.5 to 5.6 for the installed type ecosystem. Keep the current Forge/Vite 5 scaffold.
- Use Vitest 3.2, compatible with the existing Vite line, for deterministic TypeScript tests. Use jsdom and Testing Library for a few interaction tests. Do not introduce an E2E framework. The runner does not require live YouTube, Electron, or a database.
- Use a small typed translation dictionary, React locale state, and `Intl`. All application strings use stable keys. Polish keys must cover the English key set at compile time. Named interpolation inserts text, never markup. `Intl.PluralRules` selects English one/other and Polish one/few/many/other forms; numbers use `Intl.NumberFormat`. Missing translations fall back to English. A larger catalog or richer translation requirements may justify i18next later.
- For this milestone, select the first supported `navigator.languages` base (`en` or `pl`), otherwise English. Use that base locale for formatting and the host time zone for display. Language changes do not change time zones or discussion content. No follow-system-language preference or timezone control is added. Fixed fixture time is explicitly labeled; there is no relative-time timer yet.
- Default appearance to System. Semantic CSS tokens and `prefers-color-scheme` implement live OS following; explicit Light/Dark override it without an IPC capability.
- Keep main's renderer Node integration explicitly off, context isolation and sandbox on. Expose no preload API. Deny new windows and renderer navigation. CSP allows local application assets and development WebSockets; source text is rendered as plain React text. No external avatars or links are loaded.

## Domain and presentation boundaries

The domain represents content, author metadata, comments, discovery facts, and manual seen state independently of UI and infrastructure. Application IDs and opaque, discussion-scoped source identity fields are separate. Fixture string IDs and ISO instants do not establish database IDs, source uniqueness guarantees, timestamp precision, or adapter contracts (Q-15 remains open).

Tree functions accept one complete valid discussion, retain supplied root/sibling order, and traverse data independently of the DOM. Duplicate IDs, missing parents, mixed discussions, and cycles throw as programming/fixture precondition failures. This does not choose repair, rejection, retention, or partial-acquisition policies for real source observations (Q-08/Q-14 remain open).

The two demo discussions are already open in accessible tabs. Panels stay mounted to retain their own scroll positions during this session. There are no tab open/close controls, duplicate tabs, saved workspace, or restoration contract. Counts refer to all comments in that demo discussion. This is not a filtered-view contract.

The fixture explicitly selects two later-discovery IDs for demonstration NEW badges. Baseline examples have none. The badges remain when a comment is marked seen. This fixed demo selection is not a production NEW window, expiry, or removal policy (Q-05 remains open).

## Alternatives and consequences

i18next would add richer catalogs and integrations but is unnecessary for this small string set; tests cover keys, interpolation, plurals, and live switching. React state avoids inventing service or query APIs before persistence exists. Vitest shares the Vite transform; a separate test transpilation stack would add configuration. Domain tests run in Node; only component tests use jsdom.

All seen edits, language choices, and appearance choices reset on renderer reload. No localStorage or durable preferences are introduced. A later storage milestone must replace this ownership with main-side services and typed, validated preload operations. Full product requirements, including persistence, filtering, navigation ruler, and virtualization, remain outstanding.

## Validation

`npm test`, `npm run typecheck`, `npm run lint`, and the Forge production build cover this increment. See [testing status](../TESTING.md) for actual results and runtime checks. Domain tests prove subtree resulting-state semantics and unrelated-state preservation; component tests prove click/keyboard wiring and no automatic seen changes during reading, scrolling, tabs, locale, or appearance changes.
