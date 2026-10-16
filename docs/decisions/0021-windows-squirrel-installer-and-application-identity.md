# ADR 0021 — Windows Squirrel installer and application identity

Date: 2026-10-16. Status: accepted. Narrows Q-20 and uninstall policy in Q-18;
schema stays 8. No public release, signing or update delivery is introduced.

## Decision and identity

Retain Forge 7.11.2 / MakerSquirrel and electron-winstaller 5.4.4. Produce Windows
x64 `Setup.exe`, `youtube_comments-1.0.0-full.nupkg` and `RELEASES`, alongside the
independently supported no-install ZIP. Version 1.0.0 remains inherited scaffold
metadata, **not** a declaration of a stable v1 release or a published release.

`src/shared/application-identity.json` fixes package/artifact name `youtube-comments`,
display name `YouTube Comments`, EXE `youtube-comments.exe`, Squirrel/NuGet/install
directory/registration ID `youtube_comments`, and AppUserModelID
`com.squirrel.youtube_comments.youtube-comments`. This follows Squirrel's
`com.squirrel.<package ID>.<EXE without extension>` shortcut convention, also set
explicitly in main before creating any window. Do not change these identifiers
casually in future upgrades. Display/branding is replaceable separately.

Use resolvable maker config names, not short-named Maker instances: installed
Forge's `generateTargets` matches `--targets` by exact maker name. A module target
otherwise silently instantiates a new unconfigured maker. Squirrel-only and
ZIP-only commands select exactly one configured module. MSI, deltas, remote feeds,
automatic updating and publishing are excluded. The NuGet template includes the
complete Forge folder; the default template omitted `version` and Chromium notices.

## Branding and lifecycle

The original neutral slate discussion glyph is generated locally from simple
geometry; it uses no YouTube/Google logo, downloaded asset or endorsement. Its
32-bit ICO contains 16/24/32/48/64/128/256 pixel frames. Packager embeds it in the
application, and Squirrel embeds it in Setup, its packaged helper and execution
stub, and carries `setupIcon.ico` inside Setup. Shortcuts use the application EXE.
No fake hosted icon URL is supplied. The installed Programs and Features icon is
not verified: this Squirrel API normally downloads `iconUrl`; without hosted
branding it may use a generic icon. No custom registry mutation is introduced.

Retain `electron-squirrel-startup@1.0.1`. Its install/updated events invoke
Update.exe shortcut creation, uninstall invokes shortcut removal, and obsolete
quits. Only when it returns false does main enter `startReader`. Do not call quit
early while its shortcut child is pending. Lifecycle launches cannot resolve/set
profile paths, register ready/window callbacks, initialize services/SQLite, seed,
migrate, back up, recover or acquire. Tests run the actual helper in a VM with
inert spawn/Electron dependencies and import the real entry behind mocked results;
they perform no operating-system lifecycle actions. Ordinary ZIP/first-run startup
remains available.

## Data continuity and relaunch

Both distributions explicitly use `%APPDATA%/youtube-comments-production`, including
`reader.sqlite`, `recovery/`, comments/history/NEW/seen/Undo, workspace, views,
preferences and helper selection. Development stays
`%APPDATA%/youtube-comments-development`. Neither productName nor the binary's
installation location determines profile identity. There is no data rename,
migration, portable-data mode or database shipped with the installer.

Uninstall must retain the entire application-data profile and recovery directory.
Reinstall/replacing binaries is intended to reuse it. No uninstall data-deletion
hook is added. Existing migration/compatibility checks and safety snapshots still
apply; never downgrade or replace a failed recovery with an empty database.

ADR 0019 is unchanged: online backup, staging/validation, mutation barrier, helper
settlement, verified current-data safety, closed SQLite replacement, crash recovery
and `app.relaunch()` remain main-owned. No execPath override is passed: Electron
relaunches the currently running executable, whether extracted or installed.
Installed restore/relaunch needs genuine isolated verification before claiming it.

## Artifact proof and installation safety

The parent wrapper clears only the selected repository output before building and
rejects implicit/unknown maker selection and output/skip-package overrides. It
checks fresh package/PE/resources/ASAR/fuses and then each selected distribution.
ZIP verification retains complete SHA-256 byte comparison. Squirrel verification
checks PE signatures, section bounds, bootstrapper x86 versus application x64,
icon resources, NuGet XML identity/version/title/author, all runtime bytes,
archive sizes/CRC, RELEASES SHA1/size/name, and Setup's embedded DATA/131 archive.
Embedded NuGet/RELEASES must equal external artifacts; updater bytes must match the
installed build tool's vendor binary. No executable is launched for inspection.
The raw embedded bootstrap updater has the vendor icon; the payload also carries
the configured setup icon and branded packaged helper. Actual shell use is unverified.

The owner's normal Windows account is **never an installer test account**. Do not
run Setup, install/update/uninstall, change shortcuts/registration/install folders
or clean LocalAppData/Squirrel there. APPDATA redirection isolates application
tests only; it does not isolate Squirrel. First establish an already available,
permitted disposable account/VM/Sandbox. Do not provision users, virtualization or
Sandbox features without permission. If none is established, finish non-destructive
validation and explicitly leave lifecycle behavior unverified.

This milestone used no separate Windows account, VM or Sandbox and ran no genuine
installation lifecycle test. The read-only availability check found no Sandbox
executable, VM management command or running VM from the checked tools/processes;
no disposable account was designated. [Testing](../TESTING.md) records artifact and
ZIP runtime evidence separately from unverified installation behavior.

## Remaining scope

Unsigned artifacts can trigger SmartScreen; do not bypass Windows protections.
Helpers remain external (environment > saved EXE > safe PATH > unavailable), with
native selection, identity probing, confidence, shell:false and no .bat/.cmd.
Installer availability does not imply zero-configuration acquisition. Genuine
fresh install/shortcut/taskbar/native-dialog/installed restore/uninstall retention/
reinstall/upgrade checks, Windows compatibility matrix, signing, helper distribution,
final branding, notices/licensing review and public release channels remain work.

Conventions checked against installed maker/startup/winstaller source and
[Forge Squirrel documentation](https://www.electronforge.io/config/makers/squirrel.windows),
[Electron shortcut identity](https://www.electronjs.org/docs/latest/api/auto-updater#windows),
and [Squirrel uninstall metadata implementation](https://github.com/Squirrel/Squirrel.Windows/blob/develop/src/Squirrel/UpdateManager.InstallHelpers.cs).
