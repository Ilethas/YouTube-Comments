# Windows application and ZIP distribution

Windows x64 application folders and no-install ZIPs are supported development-preview
artifacts under [ADR 0020](decisions/0020-windows-packaged-application-and-zip-distribution.md).
This is not a signed, installer-based or zero-configuration public release.

## Build and verify

Use the lockfile (`npm.cmd ci`) and Node 24.13+. Verified here: Node 26.7.0,
Forge 7.11.2, Packager 18.4.4, Electron 44.4.5, Windows x64.

```powershell
npm.cmd run package -- --platform=win32 --arch=x64
npm.cmd run make -- --platform=win32 --arch=x64 --targets=@electron-forge/maker-zip
npm.cmd run verify:artifacts
npm.cmd run test:packaged
```

`package` produces `out/youtube-comments-win32-x64/youtube-comments.exe` and its
complete adjacent runtime. `make` first packages, then invokes the existing ZIP maker,
producing `out/make/zip/win32/x64/youtube-comments-win32-x64-1.0.0.zip`.
Select the ZIP target explicitly; Squirrel completion is outside this milestone.
The existing version/product/profile names remain; `1.0.0` is inherited metadata,
not a stable release declaration. The description identifies a development preview.

The parent wrapper removes only the previous Windows x64 target (and its ZIP for
`make`), waits for Forge, then inspects fresh output. Exit zero without output fails.
Checks cover x64 PE, required Electron resources/locales, ASAR main/preload/HTML/CSS/
renderer/worker and all six configured fuses. ZIP checks read every entry and compare
SHA-256 with the entire application folder, rejecting missing/duplicate/unexpected/
empty/truncated output. Packages, ZIPs and logs remain ignored; nothing is published.

## Diagnosed finalization failure

The original command reproduced exit **0** with no `out` application. Debug output
stopped inside Electron ZIP extraction, before app copying or fuse hooks. A standalone
`extract-zip` reproduction abandoned the first `locales/ja.pak` stream and reached
Node `beforeExit` with extraction still pending. The temporary template held only
that partial file. No completed output was created and then removed.

Forge's `extract-zip@2.0.1` selected `yauzl@2.10.0`/`fd-slicer@1.1.0`, whose legacy
stream destruction conflicts with Node 26. A scoped override selects fixed
`yauzl@3.4.0` only for `extract-zip`; the same cached archive then extracts and Forge
completes. See [upstream diagnosis](https://github.com/thejoshwolfe/yauzl/issues/176).
Evidence did not implicate antivirus, a terminating packaging child, fuses or ASAR.

The first Windows `make` exposed a second Node 26 incompatibility: `cross-zip@4.0.1`
calls removed recursive `fs.rmdir`. Only the ZIP maker's utility is pinned to the
API-compatible `3.1.0`, which uses rimraf and the same Windows .NET ZIP implementation.
No filesystem monkey patch, alternate packager or security reduction is involved.
Revisit both scoped overrides when upstream fixes compatibility.

## Run the ZIP and keep your data

Download/copy the ZIP, extract **all** files into an ordinary folder, and run
`youtube-comments.exe`. Keep the entire folder together. npm, an IDE, the repository,
a Vite server and an installer are not runtime requirements. An EXE alone is insufficient.

This is **no-install**, not portable-data mode. Normal packaged data remains at
`%APPDATA%/youtube-comments-production/reader.sqlite`, with `recovery/`, helper settings,
seen/Undo/history, views and Chromium data in that established profile. Copying the
application folder on the same Windows account reuses the same production data.
No database-beside-EXE, portable flag or portable mode is implemented. Development
remains separate at `%APPDATA%/youtube-comments-development`.

`YOUTUBE_COMMENTS_DEMO_ROOT` remains an explicit absolute development/demo root even
when packaged, appending `youtube-comments-development`. Only genuinely new development
profiles seed examples. Normal packaged production starts with an empty library;
existing/restored data is never seeded or replaced with an empty fallback.

## Packaged smoke and isolation

`test:packaged` verifies/extracts the ZIP to an owned OS temporary directory, launches
the unmodified fused EXE with a temporary working directory and drives its renderer
through explicit test-only loopback CDP plus native Windows dialog controls. No test
bridge/main hook/debug default ships. It requires an interactive Windows desktop.

It tests demo mode and ordinary production mode with **no demo override**, using
independently created `APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, Desktop/Documents/Downloads
directories. This host's Electron resolves `appData` to the existing disposable roaming
directory; a path-only probe verified that before any production launch. This is an
isolated profile environment on the same account, not a new OS account or VM. Never
simply omit the demo override in an ordinary smoke launch against the owner's account.
The harness retains disposable data/reports for diagnosis and prints its root.

The smoke covers schema 8, transactions, Undo/NEW/history, worker, bounded virtual
rendering/navigation, view reconstruction, native backup/restore and actual relaunch.
It compares every authoritative table and the independent safety snapshot. ADR 0019
is unchanged: relaunch must use the extracted EXE; recovery cannot require source paths.

## Assets and security

Vite bundles main, sandboxed preload, React, Temporal, translations and application
icons/styles. The worker is a separate ASAR asset loaded under relative `file://` paths.
There are currently no separate application font dependencies. Main's external
`node:sqlite` is supplied by Electron, without an ABI add-on/unpacking requirement.
Recheck actual runtime compatibility on Electron upgrades.

ASAR, embedded integrity, ASAR-only loading and cookie encryption remain enabled;
RunAsNode, Node environment options and Node CLI inspection remain disabled. Sandbox,
context isolation, disabled renderer Node, blocked navigation/windows and the frozen
narrow bridge remain. Native paths and canonical identity-only source opening stay
main-owned. CDP is an explicit smoke launch argument, not a shipped default.

## External helpers

Acquisition requires user-installed **yt-dlp** and/or **post-archiver**, including their
own runtime dependencies. Nothing is bundled/downloaded/updated. Main retains startup
environment > saved executable > safe direct PATH > unavailable; invalid configured
paths fail closed. Shells and `.bat`/`.cmd` wrappers remain excluded. Settings selects
real EXEs through native dialogs, validates identity, shows tested/untested confidence
and persists per profile. Backups may include machine-specific executable paths.

Optional native-selection/live checks are separate from deterministic tests:

```powershell
$env:PACKAGED_SMOKE_YTDLP_EXE = 'C:\path\to\yt-dlp.exe'
$env:PACKAGED_SMOKE_POST_ARCHIVER_EXE = 'C:\path\to\post-archiver.exe'
node scripts/smoke-packaged.cjs --live
```

These variables are test-runner inputs, not shipped application capabilities. The
runner selects them through real pickers, retaining the existing Python user-base for
installed Python launchers while isolating the reader's Windows profile.
Add `--compare-startup` to compare the same closed database with the built-entry
development runtime through the same external rendered-shell ready point.

## Durable data and remaining release work

Preserve the entire profile/recovery directory while replacing binaries. ADR 0019
requires online verified backups, pre-migration snapshots, staged validation, offline
closed-file replacement, retained safety/previous files and fail-closed recovery.
Never copy an open database, prune recovery incidentally, downgrade or initialize an
empty replacement after recovery failure. Snapshot publication requires hard links;
unsupported filesystems fail safely. Node cannot portably fsync Windows directory
metadata. See [database policy](DATABASE.md) and [verification evidence](TESTING.md).

Q-20 still covers Windows version compatibility beyond this tested host, final
identity/icons, Squirrel/MSI, signing/SmartScreen, updates, release hosting/channels,
notices/licensing review, helper distribution, released schema upgrades and uninstall
data policy. Retention, future format portability/export, portable data, other platform
distribution and public release publishing remain separate. A working ZIP is not
release readiness.
