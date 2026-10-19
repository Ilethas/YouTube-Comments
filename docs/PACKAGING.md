# Windows application, ZIP and Squirrel installer

Windows x64 application folders and no-install ZIPs are supported development-preview
artifacts under [ADR 0020](decisions/0020-windows-packaged-application-and-zip-distribution.md).
[ADR 0021](decisions/0021-windows-squirrel-installer-and-application-identity.md) adds
real Squirrel artifacts and stable identity. This is an unsigned development preview;
genuine installation behavior remains **UNVERIFIED** and acquisition needs helpers.
The [M9.2 review](M9_2_VERIFICATION.md) records the earlier ZIP/extracted-EXE audit
and manual release gates. The [license follow-up](DISTRIBUTION_LICENSE_AUDIT.md)
records the later metadata/notice work and remaining legal review.
Version `1.0.0` is not a stable-release declaration; no hosted download is implied.

## Build and verify

Use the lockfile (`npm.cmd ci`) and Node 24.13+. Verified here: Node 26.7.0,
Forge 7.11.2, Packager 18.4.4, Electron 44.4.5, Windows x64.

```powershell
npm.cmd run package -- --platform=win32 --arch=x64
npm.cmd run make -- --platform=win32 --arch=x64 --targets=@electron-forge/maker-zip
npm.cmd run make:squirrel
npm.cmd run verify:artifacts -- --squirrel
npm.cmd run test:packaged
```

`package` produces `out/youtube-comments-win32-x64/youtube-comments.exe` and its
complete adjacent runtime. `make` first packages, then invokes the existing ZIP maker,
producing `out/make/zip/win32/x64/youtube-comments-win32-x64-1.0.0.zip`.
`npm.cmd run make:zip` is the ZIP-only alias. `make:squirrel` is exactly
`npm.cmd run make -- --platform=win32 --arch=x64 --targets=@electron-forge/maker-squirrel`;
it selects ONLY Squirrel. Bare `make` rejects implicit maker selection. Resolvable
maker module names ensure `--targets` retains configured options (short-named maker
instances lose their options under this Forge version). Version `1.0.0` remains
inherited scaffold metadata, not a stable release declaration. Nothing is published.

Installer output is `out/make/squirrel.windows/x64/`:

- `Setup.exe`
- `youtube_comments-1.0.0-full.nupkg`
- `RELEASES`

`npm.cmd run verify:artifacts -- --squirrel-only` checks package + installer without
requiring ZIP. Default verification remains package + ZIP; `--squirrel` adds the
installer. Verification inspects bytes and never executes Setup.

The wrapper removes only the previous Windows x64 package and selected maker output
(ZIP or Squirrel x64 directory), waits for Forge, then inspects fresh output. Exit
zero without output fails. Unselected maker output remains.
Checks cover x64 PE, required Electron resources/locales, ASAR main/preload/HTML/CSS/
renderer/worker and all six configured fuses. ZIP checks read every entry and compare
SHA-256 with the entire application folder, rejecting missing/duplicate/unexpected/
empty/truncated output. Packages, ZIPs and logs remain ignored; nothing is published.

Squirrel checks PE signatures/section bounds, coherent NuGet XML identity/version,
complete runtime byte equality, archive CRCs, RELEASES SHA1/size/name, and Setup's
embedded archive with identical NuGet/RELEASES plus the known vendor updater.
Squirrel's bootstrapper/updater is x86; its checked application payload is x64.
The complete-runtime nuspec template preserves Chromium notices and `version`,
which electron-winstaller's default file list omits. Icon frames and application
display metadata are checked. Stale artifacts cannot satisfy the fresh-build wrapper.

## Stable identity and application icon

| Purpose | Value |
| --- | --- |
| npm package / Forge folder / ZIP name | `youtube-comments` |
| Human display name / NuGet title / intended shortcut name | `YouTube Comments` |
| EXE | `youtube-comments.exe` |
| Squirrel package / install directory / registration identity | `youtube_comments` |
| AppUserModelID and Squirrel shortcut identity | `com.squirrel.youtube_comments.youtube-comments` |
| Installer filename | `Setup.exe` |
| Build version | `1.0.0` (unpublished scaffold metadata) |

`src/shared/application-identity.json` is shared by main, Forge and validation.
Packager explicitly fixes folder/EXE names independently of `productName`. Main sets
the same AppUserModelID as Squirrel's shortcut convention. Keep upgrade identifiers
stable when changing the artwork.

`node scripts/generate-icon.cjs` reproduces the original navy and teal overlapping
comment bubbles in `assets/application.svg` and `application.ico`. One geometry
list supplies both vector and raster output; the dependency-free rasterizer uses
4× supersampling. ICO has 32-bit PNG frames at 16/24/32/48/64/128/256 pixels.
Add `--preview` to write individual PNG frames under `.packaging-diagnostics/icons/`
for visual inspection. No YouTube/Google imagery or external asset is used.
Application, Setup, packaged Squirrel helper and execution stub contain the icon;
Setup also carries `setupIcon.ico`. Shortcuts/taskbar are intended to use the EXE
icon; actual installed rendering is unverified. No hosted `iconUrl` is invented:
Programs and Features may use a generic icon, because this API normally downloads
its registration icon. Setup's raw embedded bootstrap updater retains the vendor
icon; the separately packaged helper is branded. The default install animation
remains. Regenerate the icon before building both distributions after artwork changes.

## Installer lifecycle and safe testing

MakerSquirrel uses electron-winstaller 5.4.4, with no MSI, deltas, update feed,
signing or auto-updater. Setup is intended for ordinary per-user installation
without elevation, supplying its runtime and Windows shell shortcuts. Installed
launch should need no npm, Node, Vite, IDE or source. These installation claims
remain intended behavior pending genuine isolated tests.

`electron-squirrel-startup` handles install/updated shortcut creation, uninstall
shortcut removal and obsolete exit before main enters normal startup. Main does
not quit early while its shortcut child is pending. Lifecycle paths cannot resolve
profiles, register ready/window callbacks or touch SQLite, migrations, backups,
restore, demo seeding or acquisition. Tests use inert VM process dependencies and
mocked Electron imports; they perform no real lifecycle actions. Ordinary
`--squirrel-firstrun` is a normal reader launch.

**Never run Setup.exe, install/update/uninstall, modify installations, shortcuts or
registration, or clean Squirrel/LocalAppData on the owner's normal Windows account.
APPDATA redirection is not installer isolation.** First establish an already
available suitable, permitted disposable Windows account/VM/Sandbox. Do not create
users, enable features, install virtualization or configure/launch a new VM without
permission. Do not bypass SmartScreen or Windows protection.

No isolated installation environment was established. Read-only checks found no
Sandbox executable, VM management command or running VM among checked tools/processes;
no disposable account was designated. No separate account, VM or Sandbox was used.
Zero real install/update/uninstall/reinstall tests ran. Fresh install, shortcuts/
taskbar identity, installed native dialogs, installed restore/relaunch, data retention
on uninstall/reinstall and controlled upgrade remain **UNVERIFIED**. Non-destructive
packaging and disposable-profile ZIP tests are separate evidence.

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
Installed execution uses the exact same profile, independent of its LocalAppData
binary location. The new display name does not move it or hide the database.
No database-beside-EXE, portable flag or portable mode is implemented. Development
remains separate at `%APPDATA%/youtube-comments-development`.

Uninstall must retain the whole production profile and `recovery/`; no deletion hook
is added. Reinstall and future binary replacement are intended to reuse comments,
history/NEW/seen/Undo, tabs, filters, sort, anchor/selection, helpers and preferences.
Existing schema checks, pre-migration snapshots and recovery still apply. Installed
lifecycle retention has not been tested. Never copy an open database for an upgrade.

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

The current smoke covers schema **14**, transactions, Undo/NEW/history, worker,
bounded virtual rendering/navigation, independent view reconstruction, three native
windows, application-menu New/Close and same-ID Move Tab out/back with stale-owner
rejection. Native backup/restore compares every authoritative table and the
independent safety snapshot, then verifies three intended readers after actual
new-PID relaunch. A second application-folder copy uses the same isolated profile.
ADR 0019 is unchanged: relaunch must use the extracted EXE; recovery cannot require
source paths. Production-entry M8.2 separately verifies coordinated Quit with
pending drafts and exact subsequent restoration; peer Close and Quit are distinct.

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
own runtime dependencies. The owner's distribution choice is separate installation;
no helper or Python bundling/download/update is planned. See the
[Windows helper instructions](../README.md#external-tools). Main retains startup
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

Q-20 now retains genuine isolated installer lifecycle verification, Windows version
compatibility beyond this host, installed registration icon, signing/SmartScreen,
updates, release hosting/channels, notices/licensing and released
schema upgrades. Uninstall retention policy is settled; actual behavior is unverified.
Retention management, future format portability/export, portable data, other platforms
and public publishing remain separate. Unsigned Setup/EXE may trigger SmartScreen;
do not bypass protection. Setup existing is not public release readiness.

The original application now declares `UNLICENSED` in package/lockfile metadata
and remains private. Publicly viewable source has no current open-source grant;
no project LICENSE or EULA is added. Third-party licenses apply to their components.
Recipients can read `resources/THIRD_PARTY_NOTICES.md` and `resources/third-party/`
directly in the extracted app. Electron's original `LICENSE` and
`LICENSES.chromium.html` remain beside the EXE. The complete-runtime nuspec retains
these files in NuGet and Setup's embedded payload as well.

`node scripts/verify-notices.cjs --metadata-only` checks package/lockfile consistency.
`node scripts/verify-notices.cjs` checks actual application output, reviewed text
hashes, documented locations, packaged metadata and rendered-module inventories.
The existing `verify:artifacts` runs this check, then compares every ZIP runtime
entry; `--squirrel` adds the complete NuGet/Setup byte comparisons and pinned
vendor hashes. Verification is offline once dependencies/artifacts exist. Changed
dependencies or notice texts need review and an intentional inventory update;
do not regenerate hashes merely to silence a failure.

ZIP remains recommended. Installed Squirrel behavior remains **UNVERIFIED**;
installer licensing also has unresolved blockers in the follow-up report. External
yt-dlp, post-archiver-improved and Python remain user-installed and absent from
both distributions. Successful notice checks establish delivery/integrity, not
complete legal compliance or authorization to publish.
