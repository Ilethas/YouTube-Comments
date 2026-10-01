# Packaging and distribution

Windows is the initial development and packaging target. Keep future Linux/macOS support possible, but neither is an initial implementation or release requirement. This document separates that target from the existing scaffold; no release is implemented by this documentation task. See [Architecture](ARCHITECTURE.md), [Database](DATABASE.md), and [Extractors](EXTRACTORS.md) for the boundaries packaging must preserve.

## Current scaffold

The repository currently uses Electron Forge with Vite and TypeScript. [package.json](../package.json) provides `start`, `package`, `make`, `publish`, and `lint` scripts. These scripts describe scaffold entry points; the presence of `publish` is not authorization or configuration for a release destination.

[forge.config.ts](../forge.config.ts) currently contains:

| Configuration | Observed state |
| --- | --- |
| Application archive | `asar: true`. |
| Main/preload builds | Separate Vite entries for `src/main.ts` and `src/preload.ts`. |
| Renderer build | A Vite renderer named `main_window`. |
| Makers | Squirrel, ZIP restricted to `darwin`, RPM, and DEB. |
| Electron fuses | `RunAsNode`, Node options environment variables, and Node CLI inspect arguments disabled; cookie encryption, embedded ASAR integrity validation, and loading only from ASAR enabled. |

These maker declarations come from the scaffold and do not expand the initial Windows target into a cross-platform release commitment. Windows versions/architectures, installer details, signing, and release channels remain unresolved. Linux/macOS makers may remain in the scaffold without making those platforms initial requirements.

The scaffold still has placeholder application metadata, a template renderer, a preload placeholder without an application API, and automatic DevTools opening in the main entry. React, SQLite, localization, application services, extraction adapters, and tests have not been added. This documentation increment deliberately leaves the scaffold unchanged; these items must be handled in appropriate later implementation increments.

## Target packaging responsibilities

The packaged application must preserve the renderer → typed preload/contextBridge API → privileged backend owned by the Electron main side → persistence/extractors boundary. The renderer must not gain Node.js, SQLite, filesystem, or process-launching access to make packaging convenient. Release verification should examine the actual built app as well as source configuration; see [Architecture](ARCHITECTURE.md) and [Testing](TESTING.md).

The main-side backend owns persistence and may use an internal database worker. That is an implementation option behind the same security boundary, not renderer SQLite access. External extractors remain invoked only by the Electron main process.

The build must eventually carry the React renderer, English and Polish translations, theme assets, and the selected SQLite integration. If a chosen SQLite library or helper introduces native/platform-specific artifacts, its compatibility must be tested against each supported Electron/platform/architecture combination. The library choice and bundling mechanics are unresolved; no native dependency has been selected by this document.

System is the first-run appearance default. System, Light, and Dark preferences and live OS appearance changes must work in the packaged app. Language selection and locale-aware formatting must also work without relying on development-only asset paths. See [Localization and theming](LOCALIZATION_AND_THEMING.md).

## External helper distribution

Initial backends are `yt-dlp` for video discussions and `post-archiver-improved` for public individual Community Posts. Main-process helper resolution may use `PATH` during development and must permit app-local/bundled helpers later. A development installation that happens to find a helper on the owner's machine is not sufficient evidence that an end-user package can acquire discussions.

Before committing to helper bundling, decide and document:

- Supported versions and how compatibility is detected.
- Artifacts and any runtime dependencies for the supported Windows versions/architectures; assess Linux/macOS separately if later added.
- Installation locations and resolver precedence, with clear behavior when no usable helper is available.
- Applicable redistribution licenses, notices, signing, and artifact integrity checks.
- Whether updates arrive with the app or through a separate mechanism, and how failures are handled without compromising stored discussions.

The application license in `package.json` does not establish redistribution rights for helpers or their dependencies. Do the assessment for the actual selected artifacts. No automatic downloading/updating behavior or user-specified binary-path UI is committed here. See the [extractor contract](EXTRACTORS.md) and [decision register](decisions/README.md).

## Protecting durable data

SQLite is valuable user data. Store the application database and durable preferences separately from replaceable application binaries and extraction scratch files. Exact paths and profile identifiers remain to be selected, with distinct production, development, and test databases required from the beginning. Never use the real user database as a convenient integration-test fixture.

Installer and update planning must account for:

- Preserving discussions, seen state, discovery information, refresh history, tabs, and preferences across supported upgrades.
- Running explicit schema migrations with transaction/recovery behavior; do not silently create a replacement empty database after a migration error.
- A consistent backup/restore mechanism and a defined policy for backup creation and retention around schema upgrades.
- Safe behavior when an older app encounters a newer schema; downgrade compatibility is unresolved and must not be assumed.
- App removal and any optional data deletion as a deliberate, documented policy rather than an accidental consequence of replacing binaries.
- Eventual discussion export as a separate product capability; export is not automatically a complete database backup.

The required persistence guarantees and unresolved operational policies are documented in [Database](DATABASE.md). Packaging must not weaken [transactional refresh](REFRESH_AND_MERGE.md) or [manual seen state](SEEN_STATE.md).

## Proposed release verification

The following is a release checklist to establish during implementation, not a claim of checks already available:

| Check | Why it matters |
| --- | --- |
| Deterministic domain, adapter, and persistence suites pass. | Packages must preserve the product's state and merge invariants. |
| Packaged app starts on supported Windows targets and can reopen a prior test profile. | Development execution does not prove packaged paths, dependencies, or migrations work. |
| Fresh acquisition and refresh work through the selected helper strategy in an isolated test profile. | Detect missing binaries/runtime dependencies and invocation differences without touching real user data. |
| Missing, incompatible, failed, and partial helper outcomes are understandable and preserve stored data. | Acquisition can fail independently of the local reader. |
| Security boundary and safe rendering are verified in the built artifact. | Process/database access and untrusted remote text must stay within their intended boundaries. |
| English/Polish, locale formatting, System as the first-run default, all appearance modes, and restart persistence work. | Localization and theming are product requirements, including offline installed usage. |
| Backup/restore and supported upgrade paths succeed against disposable database fixtures. | A distributable update must account for valuable existing data. |
| Product metadata, icons, artifact names, diagnostics, and DevTools behavior are reviewed. | Scaffold defaults are not a finished release experience. |
| Licenses/notices, signing, integrity, and release destinations match the decided distribution policy. | Distribution must match the actual artifact and supported platform choices. |

Live YouTube smoke tests remain optional and separate from the normal deterministic suite. A release may include an explicitly chosen live verification step, but ordinary test execution must not silently depend on YouTube availability. Performance checks should use representative large local fixtures as described in [Testing](TESTING.md).

## Decisions still open

Within the initial Windows target, supported versions/architectures, product branding/app identity, SQLite driver and native packaging, helper bundling/version/update strategy, application update mechanism, signing/release destinations, database paths/profile identifiers, backup retention, downgrade support, and uninstall-data policy remain unresolved. Future Linux/macOS support would need its own decisions. Resolve these as needed for implementation and record significant choices under [decisions](decisions/README.md); do not infer commitments merely from the Forge template.
