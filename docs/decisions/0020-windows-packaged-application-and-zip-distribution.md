# ADR 0020 — Windows packaged application and ZIP distribution

Date: 2026-10-16. Status: accepted. Narrows Q-20; schema stays 8.

## Context and diagnosed cause

Forge built Vite bundles but exited zero at the displayed Finalizing phase with no
completed output. Debug logging located the actual stop in Electron archive extraction,
before copying/fuses. Standalone `extract-zip` against the same cached archive reached
Node `beforeExit` with an unresolved promise and a partial first `locales/ja.pak` in
the temporary template. No executable was briefly created/removed under `out` and no
unexpected completed artifact was found.

Node 26.7.0 exposes the known `yauzl@2.10.0`/`fd-slicer@1.1.0` stream defect.
[Upstream explains the fix](https://github.com/thejoshwolfe/yauzl/issues/176).
After correction, Windows ZIP creation exposed another Node 26 incompatibility:
`cross-zip@4.0.1` calls removed recursive `fs.rmdir`, throwing `ERR_INVALID_ARG_VALUE`.

## Decision

Retain Forge 7.11.2, Packager 18.4.4, Electron 44.4.5, ASAR and every existing fuse.
Use scoped npm overrides: `extract-zip` uses fixed `yauzl@3.4.0`; only the existing
`@electron-forge/maker-zip` uses API-compatible `cross-zip@3.1.0`, whose rimraf cleanup
still works. Keep the reproducible lockfile and revisit overrides when upstream fixes
compatibility. No global API patch or replacement packager is justified. The extraction
failure preceded fuse hooks, so security isolation experiments were unnecessary.

Enable the existing ZIP maker on Windows. `package` creates the complete Windows x64
application folder; `make` additionally archives it. A parent wrapper clears only the
old target and inspects fresh executable/runtime/ASAR/fuse output after Forge returns.
ZIP checks compare all decompressed bytes with the folder. Missing artifacts cannot
pass merely because Forge exits zero. Outputs remain ignored; nothing publishes.

## No-install and profile contract

Extract the complete ZIP and run its EXE without installer, source, npm or Vite.
Data stays in the established Windows application-data profile, never beside the EXE.
Copying the folder on the same Windows account reuses production data. No portable
flag/mode is introduced. Packaged execution normally selects production; explicit
`YOUTUBE_COMMENTS_DEMO_ROOT` still selects development/demo. Fresh production has no
synthetic content; existing/restored data remains authoritative. Product/profile names
and version stay unchanged; the description now identifies a development preview.

## Runtime, testing and consequences

The unmodified extracted EXE is driven externally with explicit test-only loopback CDP
and Windows native dialog controls. Demo and ordinary production tests own disposable
data; production uses independently isolated Windows profile environment directories,
not the owner's roaming data and not a newly provisioned account. Actual Electron
path resolution on this host was probed before launch.

Main-owned SQLite, ASAR preload/renderer/worker, Temporal, translations/styles,
separate contexts, absent ambient renderer Node and restricted IPC remain. Native
Settings selection, snapshots and confirmed restore exercise the real application.
ADR 0019 remains unchanged: offline replacement and actual `app.relaunch()` must start
the extracted EXE and preserve independently verified safety without source paths.
See [Testing](../TESTING.md) for results and sample sizes/timings.

Helpers stay externally installed with environment > saved > PATH > unavailable
resolution and tested/untested status. A ZIP does not imply zero-configuration
acquisition. Signing, installers, updates, helper bundling, final branding, Windows
compatibility matrix, release/licensing review, portable data, future platforms and
public release distribution remain open. No Q-21 redesign is included.
