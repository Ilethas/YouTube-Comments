# 0002 — SQLite persistence and typed reader boundary

Date: 2026-10-02. Status: accepted for the synthetic persistence milestone.

## Context and evidence

The owner authorized durable synthetic discussions, manual seen actions, preferences, migrations, environment isolation, and a real preload/main boundary. Acquisition, refresh, real-source identity guarantees, final workspace restoration, bulk recovery, and backup/export are outside this increment. This settles only parts of Q-17, Q-18, and Q-22 in the [register](README.md).

The installed environment is Electron **44.4.5**, Forge **7.11.2**, Vite **5.4.21**, TypeScript **5.6.3**, and Windows x64. A real Electron **main-process** probe (not just the shell's Node) successfully created, wrote, and queried SQLite using `node:sqlite`: embedded Node **24.21.0**, SQLite **3.53.4**. The shell/test runtime is Node **26.7.0**. Subsequent application checks exercised SQLite through the built main/preload/renderer bundles and restarted the real Electron process twice against one isolated profile.

## Integration and ownership

Use built-in `node:sqlite` / `DatabaseSync`, with one connection owned by the main-side `ReaderRepository`. SQLite stays external in the main Vite build and is supplied by Electron, rather than bundled into renderer or preload. No separate driver/native add-on, ORM, or validation framework is added. Declare the already installed `@types/node` as a direct development dependency for privileged Node/SQLite types. Development/test Node must be at least 24.13; compatibility is established for the actual installed runtimes, not every newer runtime.

The [Node SQLite documentation](https://nodejs.org/download/release/v24.21.0/docs/api/sqlite.html) describes the synchronous API and its release-candidate stability. [Electron's SQLite support fix](https://releases.electronjs.org/pr/47706) explains why version inspection and actual Electron verification matter. Pinning Electron and rechecking the module during upgrades is necessary. No flag was needed in the tested Electron runtime.

Synchronous operations are deliberately small at this milestone's 24-comment scale. Commands execute serially on main, with `BEGIN IMMEDIATE` transactions, a 5-second busy timeout, explicit per-connection foreign-key enforcement, `synchronous=FULL`, and SQLite's default DELETE rollback journal for newly created databases. The journal mode is tested. No worker, pool, WAL policy, refresh scheduling, or performance commitment is selected; larger datasets require measurement before extending this approach.

Meaningful alternatives:

- **better-sqlite3:** a small established synchronous API, but adds an Electron ABI-specific native add-on, rebuild/prebuild availability, and ASAR unpacking considerations that the verified built-in module avoids here. Reconsider if runtime compatibility or needed capabilities warrant it.
- **sqlite3:** asynchronous operations, with native packaging/rebuild concerns and callback/transaction orchestration for this small repository. No demonstrated need for that additional integration.
- **sql.js:** avoids an ABI-specific add-on through WASM, but a file-backed durable database needs explicit serialization/write coordination; it does not offer the same direct SQLite file/transaction integration for this milestone.
- **ORM/query framework:** adds schema/runtime abstractions without a use case at this size. SQL and explicit row-to-domain mapping are understandable and sufficient.

## Initial schema and migrations

An ordered migration array advances `PRAGMA user_version` from **0 to 1**. Pending migrations and version advancement run in one transaction; later versions can be appended. Opening a newer version fails with `UNSUPPORTED_SCHEMA`. Migration/initialization failure closes the connection and preserves the file; there is no delete/recreate/reset fallback. Tests cover rollback from populated version 0, a real initial-schema collision, and a failed later migration against committed version 1 data. Complex migration backups are deferred until a released schema evolves; eventual backup/restore remains required.

Schema 1 contains only:

- `content_items`: internal IDs, fixture ordering, kind/source ID, discriminated content, available inline author metadata, optional publication time, and synthetic baseline discovery ID.
- `comments`: internal IDs, item/parent relationships, fixture ordering, opaque source comment ID, text/author metadata, optional publication time, discovery/observation instants and synthetic discovery ID, optional likes/creator/pinned metadata.
- `comment_state`: one local seen boolean per comment, separately owned from remote observations. The repository always inserts/reads required state; it rejects missing state rather than inventing a default on read.
- `preferences`: one row with nullable explicit language and System/Light/Dark intent. Null language means first-run OS-language detection, not a new persisted follow-system-language option.

Internal IDs have primary keys. Composite parent foreign keys enforce the same item and are deferred within insertion transactions. Boolean/enumeration/content-shape constraints and position uniqueness are enforced; the parent lookup index serves current trees. Fixture source fields are retained without final real-source uniqueness constraints. Discovery IDs are synthetic labels, not foreign keys to an unimplemented refresh history. Author fields stay inline because the current domain does not guarantee a separately normalized author identity.

Initial timestamps are **ISO 8601 UTC TEXT with a Z suffix**, retaining the fixture's supplied precision/spelling (with or without fractional seconds). Missing publication time stays SQL NULL and domain `undefined`; discovery time never substitutes for publication time. Precision/missing/imprecise timestamp policies for future real observations, canonicalization needed for date predicates, and date-filter timezone rules remain open. No timestamp filter/index is introduced.

## Profiles and initialization

Privileged `resolveDatabasePath` requires an explicit mode and absolute root/path:

| Mode | SQLite path |
| --- | --- |
| Development (`!app.isPackaged`) | `<appData>/youtube-comments-development/reader.sqlite` |
| Future packaged production | `<appData>/youtube-comments-production/reader.sqlite` |
| Test | Explicit absolute file under the temporary directory owned by that test |

On Windows, Electron `appData` normally means `%APPDATA%`. Chromium/Electron `userData` is also assigned to the chosen profile directory, before readiness. Database resolution does not use the scaffold's prior `userData` location. Missing/relative test paths or roots fail; there is no production fallback.

An optional privileged environment variable, `YOUTUBE_COMMENTS_DEMO_ROOT`, supplies an **absolute root** and explicitly selects development mode, including for checking a packaged artifact. The database still receives the `youtube-comments-development` directory suffix. An empty/relative value fails rather than falling back. This variable is not a renderer capability or a production-path override. With it absent, packaged startup selects production and **does not seed** synthetic content.

Development initialization inserts both existing synthetic discussions, 24 comments, and their mixed example seen states **only when no content items exist**, in one transaction. It leaves preferences untouched, including preferences selected while the library was empty. Repeated initialization neither resets state nor overwrites content. Packaged production currently opens an empty library and has no acquisition UI. There is no new source-ID guarantee or real baseline-acquisition implementation.

## Typed boundary and acknowledgment

`window.reader` exposes exactly `bootstrap()`, `toggleSeen({itemId, commentId, subtree})`, and `updatePreferences({locale} | {appearance})`. Shared contracts use domain objects and serializable preferences/results, never driver/SQL row types. Preload retains the IPC transport privately. Main allowlists channels and checks the owning window, exact top-level frame, and expected application document URL before service dispatch.

Small handwritten guards validate payload arity, exact object keys, bounded nonempty IDs, booleans, and preference enums at main. Main verifies target membership against stored data. Adding a larger schema library would not improve this three-operation contract enough to justify a new dependency. Stable error codes (`INVALID_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `STORAGE_UNAVAILABLE`, `UNSUPPORTED_SCHEMA`) cross IPC; paths/driver errors stay in privileged diagnostics. Broader query/event contracts and diagnostic/request-ID policy remain open.

Seen commands read current stored state and apply the existing pure domain resulting-state rule inside one transaction. Ordinary click targets only one comment; Ctrl targets every stored descendant. The UI serializes saves and waits for acknowledgment before changing its snapshot. Failed/rejected calls show localized feedback and retain the acknowledged snapshot; bootstrap has loading/error/retry presentation with no renderer fixture fallback. No membership/order recomputation, tab restoration, or bulk command is added.

When startup initialization fails with `STORAGE_UNAVAILABLE`, a validated bootstrap call retries the same safe open/demo initializer. Once initialization succeeds, subsequent calls reuse that repository. Unsupported-schema failures stay closed and show the newer-version message without a Retry action. Retrying never resets or replaces the database, and requires no additional IPC capability.

Explicit language persists and overrides first-run detection via `app.getPreferredSystemLanguages()` and supported en/pl bases with English fallback. Appearance defaults to System; CSS still follows live OS changes. Preferences never change comment state. No localStorage is used.

## Packaging, consequences, and validation

The built-in driver introduces no native rebuild/unpacking dependency. Forge main/preload/renderer production builds pass; the generated main retains `require('node:sqlite')`, and the renderer bundle carries no driver or fixture-discussion authority. Electron's sandbox, context isolation, disabled renderer Node integration, and existing fuses remain intact.

Forge's packaging step again exits without a completed `out` executable in this environment, as documented for the prior scaffold. Running the built application proves the integration in Electron, **not a completed distributable or installer**. This milestone does not change makers, signing, or release configuration. Resolve the packaging completion issue before making release claims.

Deterministic temporary-file persistence, migration, constraint, rollback, IPC/sender, bridge, and UI acknowledgment tests run with the existing Vitest stack. Actual Electron checks verify manual clicks, subtree scope, saved state and preferences across two process restarts, both languages, all appearance modes, live native System changes, and renderer isolation. See [testing status](../TESTING.md) for the current results and limitations.
