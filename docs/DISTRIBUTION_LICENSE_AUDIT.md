# Post-M9.2 distribution license and notice audit

Date: 2026-10-20. Status: **metadata corrected; identified notices supplied;
human licensing/release review still required**. This follow-up does not change
the historical [M9.2 evidence](M9_2_VERIFICATION.md).

Original application metadata is `UNLICENSED` in `package.json` and lockfile
`packages[""]`; `private: true`, version `1.0.0` and application identity remain.
The owner's original code has no current open-source license grant. No project
LICENSE, EULA, dependency upgrade or schema/runtime behavior change was made.
Only those two license values changed in the package/lockfile; all dependency
entries, resolved URLs and integrity hashes are unchanged.

## Actual application contents

The [recipient notice index](../THIRD_PARTY_NOTICES.md) supplies component versions,
licenses, verbatim copyright notices, source links and full license-text paths.
The reviewed [manifest](../third-party/manifest.json) pins license-file SHA-256s,
Electron's original notice hashes and the Squirrel vendor inputs.

Evidence is the fresh Windows x64 Forge application, ASAR entries and rendered
Rollup module records, not an enumeration of all lockfile devDependencies:

| Shipped location | Incorporated components |
| --- | --- |
| ASAR main bundle | @js-temporal/polyfill 0.5.1; JSBI 4.3.2; electron-squirrel-startup 1.0.1; its nested debug 2.6.9 and ms 2.0.0; CommonJS generated helpers |
| ASAR React renderer | React/React DOM 18.3.1; Scheduler 0.23.2; @tanstack/react-virtual 3.14.13; @tanstack/virtual-core 3.17.11; Temporal/JSBI; Vite modulepreload helper |
| ASAR preload/query worker | No rendered third-party npm modules in these builds |
| Adjacent native runtime | Electron 44.4.5, Chromium 152.0.7977.130, Node.js 24.21.0, V8 15.2.124.28-electron.0, SQLite 3.53.4, ICU 78.2 and the vendor's full Chromium/Electron component inventory |
| Static application assets | Project-owned SVG/ICO geometry and outline UI icons; no external font/icon pack/stock image |

The main and renderer graphs overlap on Temporal/JSBI: there are **ten distinct
rendered npm packages** plus generated helpers. Vite 5.4.21 supplies modulepreload;
its bundled @rollup/plugin-commonjs 26.0.1 supplies CommonJS helpers (version
traced through [Vite's tagged lockfile](https://github.com/vitejs/vite/blob/v5.4.21/pnpm-lock.yaml)).
Both helper licenses are retained. `loose-envify` and `js-tokens` are dependencies
in the install tree, but contribute no rendered modules here. Root debug 4.4.3
and ms 2.1.3 are build dependencies, distinct from the shipped nested versions.
React's production banners survive, but complete MIT texts are supplied as well.

React DOM also incorporates Modernizr **3.0.0pre (Custom Build)** event detection,
as its production banner and
[tagged source](https://github.com/facebook/react/blob/v18.3.1/packages/react-dom/src/events/isEventSupported.js)
explicitly say. The [historical Modernizr LICENSE](https://github.com/Modernizr/Modernizr/blob/v3.0.0/LICENSE)
is only a 48-byte MIT banner, without a copyright holder or full grant. That exact
notice is supplied separately (Vite strips that unannotated bundle comment); no holder was guessed.
**Both-format review item:** establish whether additional original attribution/
license wording is required for this borrowed fragment. React's MIT text covers
its adaptation but is not evidence of Modernizr's original copyright attribution.

`scripts/notice-bundle.ts` emits separate JSON input records for main, preload,
renderer and worker without changing their executable code. It records modules
with nonzero rendered length, including npm code removed from the package-directory
tree by bundling. The ASAR contains compiled entries and metadata, with no runtime
node_modules directory. The small generated inventories remain inside ASAR.

Electron's **20,472,830-byte** `LICENSES.chromium.html` remains intact. Its vendor
inventory includes the runtime's individual attributions and full license texts
(including Node.js and FFmpeg), rather than applying Electron's MIT license to
every embedded library. Runtime versions were read from the installed Electron
binary in Node mode without opening the application profile, and Chromium is also
reported by the extracted-EXE smoke. Remote avatars/thumbnails are user-acquired
content, not bytes redistributed in the inspected ZIP.

## Notices and obligations

MIT/ISC components require retention of copyright/permission notices; those
complete upstream package texts are included. JSBI and electron-squirrel-startup
use Apache-2.0: full license texts are retained, and JSBI's concrete source-map
copyright header is preserved in `jsbi-NOTICE.txt`. The startup package has a named
author but no concrete copyright statement; none was invented. Neither package
supplies a separate NOTICE file. Vite's original core license section and bundled
CommonJS notice section are retained individually. Bundling/minification and
environment substitution are described in the index; no vendored source patch is
applied. Upstream license wording and existing modification notices are preserved.

The existing Electron/Chromium notices contain multiple licenses, including
file-level/source-availability terms. Preserving those files is necessary evidence,
not a conclusion that all obligations are discharged. Before public distribution,
human review should confirm the exact FFmpeg build's LGPL obligations (matching
source, modifications/build instructions and applicable relinking/replacement
rights), any MPL-covered runtime files, and the sufficiency of the vendor's source
references. This task supplies no fabricated source offer or owner EULA.

## Squirrel-specific findings and blockers

The ZIP contains no Squirrel native updater/bootstrapper/stub or installation GIF.
The startup JavaScript package is included in both formats. Squirrel's structural
build adds native code/assets, so its licensing has a separate review boundary.

electron-winstaller **5.4.4** supplies Setup.exe (file version **1.9.1.0**),
Squirrel.exe/Update.exe (**2.0.1+eef37460ae**, file version **2.0.1.1**) and the
execution stub. Exact pristine vendor SHA-256s are pinned in the manifest. Resource
icons/version metadata change during packaging; the embedded bootstrap updater
is compared byte for byte with the pristine vendor updater. Setup was never run.

The [pinned Update project](https://github.com/Squirrel/Squirrel.Windows/blob/eef37460ae/src/Update/Update.csproj)
explicitly merges WpfAnimatedGif, SharpCompress, Microsoft.Web.XmlTransform,
DeltaCompressionDotNet/MsDelta, Squirrel, NuGet.Squirrel and Mono.Cecil. The
[Squirrel project](https://github.com/Squirrel/Squirrel.Windows/blob/eef37460ae/src/Squirrel/Squirrel.csproj)
declares the versions recorded in the index. Version-specific NuGet packages were
downloaded and read as ZIP data, never installed or executed. Findings:

- Squirrel MIT COPYING and the execution stub's semver MIT notice are included.
  The pinned bootstrap source includes modified zlib/unzip and WTL 9.0. Original
  copyright/modification headers and CPL 1.0 text are included, with source links.
- Mono.Cecil 0.11.2 and SharpCompress 0.17.1 MIT texts were recovered from their
  versioned source. NuGet.Squirrel's Apache text comes from the exact pinned
  submodule. WpfAnimatedGif 1.4.15 metadata points to Apache 2.0; the standard text
  is included. A later historical branch's 2019 copyright was **not** assigned to
  this older binary. Its exact attribution/source correspondence needs review.
- **Blocker: DeltaCompressionDotNet 1.1.0** includes no license declaration/text
  in the exact NuGet; copyright metadata names Todd Aspeotis 2014. Recover a
  version-applicable grant and confirm all merged MsDelta code before publishing.
- **Blocker: Microsoft.Web.Xdt 2.1.1** requires license acceptance, has no included
  text, and points to `https://go.microsoft.com/fwlink/?LinkId=273778`. On this
  audit date that redirects to unrelated Windows Web documentation. Obtain the
  applicable historical redistribution terms; do not substitute a guessed SPDX ID.
- **Blocker: complete vendor-binary provenance/obligations.** The commit/version
  and project files do not prove a reproducible mapping of every merged native/
  managed input. Review SharpCompress codec-specific notices, WTL/CPL source
  availability and binary-distribution conditions, native Microsoft runtime
  redistribution rights, and remaining merged inputs before installer publication.
- **Blocker: install-spinner.gif provenance.** The vendor asset matches Setup's
  embedded GIF. The provider's MIT license is included, but asset-specific
  authorship/permission has not been established. No replacement asset was selected.

7-Zip, WiX, rcedit, NuGet CLI and ILRepack are build tools, not separate files
redistributed in these artifacts. That observation does not rule out copied code
inside the merged binaries. No genuine conflict with the owner's original-code
licensing decision has been established; the unresolved evidence above prevents
an installer legal sign-off. No license or architecture change was made to bypass it.

## External helpers

Known-tested versions remain yt-dlp **2026.08.19** and post-archiver-improved
**0.4.0**. The app does not bundle/download/install/update either helper or Python.
The [yt-dlp versioned README](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/README.md#licensing)
and [LICENSE](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/LICENSE) distinguish
Unlicense source/PyPI packages from PyInstaller executables containing GPLv3+ code
and other release formats with additional terms. post-archiver-improved's
[version-specific PyPI JSON](https://pypi.org/pypi/post-archiver-improved/0.4.0/json)
declares `license_expression: GPL-3.0-or-later` and identifies its
[upstream repository](https://github.com/sadadYes/post-archiver-improved).

The unchanged integration launches independently installed CLI executables and
parses JSON/archive output. It does not link/embed helper code. This does not
automatically relicense the application; process separation is not an absolute
legal guarantee either. No concrete integration conflict was found here. Review
the actual communication/distribution if legal assurance is required. Helper
licenses/executables and Python were not copied into the app to resolve this audit.

## Delivery and reproducible checks

Forge `extraResource` copies the repository's index and `third-party/` into
`resources/`. Electron's LICENSE/Chromium collection stay beside the EXE. The
complete-runtime nuspec includes these in `lib/net45/`, and Setup embeds that exact
NuGet. Recipients can read the texts offline without a checkout or ASAR extractor.

```powershell
node scripts/verify-notices.cjs --metadata-only
npm.cmd run make -- --platform=win32 --arch=x64 --targets=@electron-forge/maker-zip,@electron-forge/maker-squirrel
node scripts/verify-notices.cjs
npm.cmd run verify:artifacts -- --squirrel
npm.cmd run test:packaged
```

Checks use locked/installed metadata and reviewed hashes, with no network required
for already-built artifacts. They reject root/package-lock MIT or inconsistencies,
packaged metadata differences, incomplete/excluded/changed notice sets, missing
index paths, changed Electron notices and unreviewed rendered packages/helpers.
The existing ZIP/NuGet checks compare every runtime entry, including index/texts
and ASAR, rejecting loss, truncation, CRC/hash differences or stale payloads.
Setup's embedded NuGet equals the checked standalone NuGet. Negative regressions
cover missing/truncated notices, changed inventories and retained MIT metadata.

Notice hashes are reviewed evidence, not a self-updating scanner. Dependency,
generated-helper or vendor changes require re-audit and intentional updates to
the manifest/index. A successful file check establishes notice delivery/integrity
for the identified inventory; **it does not establish complete legal compliance**.
`.gitattributes` disables line-ending conversion for `third-party/` so an ordinary
Windows checkout preserves the reviewed upstream bytes and their hashes.

## Executed follow-up verification

| Check | Result |
| --- | --- |
| Root package/lockfile consistency | PASS; comparison with HEAD confirms only the two license declarations changed |
| Focused packaging regression | PASS, 10 tests, including the new metadata and corrupt/missing-notice checks |
| Typecheck / ESLint | PASS, no errors or lint warnings |
| Full Vitest | PASS, 1,221 tests / 96 files, 143.84 s with `--maxWorkers=4`; no test excluded |
| Notice verification against actual packaged app | PASS, ten rendered npm packages, 25 notice/manifest files plus index and unchanged native notices |
| Fresh Windows x64 application and ZIP | PASS, 99 runtime files / 386,173,981 bytes; ZIP 158,408,677 bytes |
| Structural Squirrel and embedded payload | PASS; Setup 155,789,824 bytes; NuGet 155,090,286 bytes; RELEASES 87 bytes; no installer execution |
| Extracted, unmodified EXE | PASS; 14 check groups, isolated production/demo profiles, native backup/restore, same-ID transfer and actual relaunch |
| Markdown/presentation | PASS, 60 local links/anchors across the five changed Markdown documents; six decoded screenshots and seven ICO frames |
| Whitespace | `git diff --check` PASS; upstream notice whitespace is intentionally preserved |

Local logs use `.licenses-*`;
raw upstream evidence is in ignored `.packaging-diagnostics/license-evidence/`.
Earlier packaged-smoke reports/logs were copied to
`.packaging-diagnostics/license-followup/prior-packaged/` before re-running.

The first full run exposed ASAR's cached fixture header when a regression rebuilt
an archive at the same path. The test now clears that cache before inspecting the
replacement; its intended inventory/metadata failures are asserted. A subsequent
default-concurrency run passed 1,220 tests but hit the unchanged App lifecycle
test's `receive is not a function` subscription-timing failure. No application
code/assertions were changed for it; the complete final run uses four workers.
The initial sandboxed Forge attempt failed on esbuild's parent-directory reads;
authorized builds subsequently passed with the required access. Logs are retained.

The aggregate Electron and M9 scale harnesses were not repeated: no application
code, schema, persistence, lifecycle or transfer implementation changed. The
required final extracted-EXE regression did run. Live helper acquisition, physical
OS drag/clipboard writes and installed Squirrel lifecycle were not tested.

## Changed files

- Metadata: `package.json`, root license entry in `package-lock.json`.
- Notices: `THIRD_PARTY_NOTICES.md`, the 25 files indexed by
  `third-party/manifest.json`, and `.gitattributes` for exact notice bytes.
- Packaging: `forge.config.ts`, `vite.main.config.ts`, `vite.preload.config.ts`,
  `vite.renderer.config.ts`, `scripts/notice-bundle.ts`.
- Checks: `scripts/verify-notices.cjs`, `scripts/verify-artifacts.cjs`,
  `src/main/packaging-artifacts.test.ts`.
- Documentation: `README.md`, `docs/PACKAGING.md`, a dated follow-up link in
  `docs/M9_2_VERIFICATION.md`, and this report.

No owner database, backups, helper settings or clipboard was modified. No Setup
execution, installation/uninstallation, commit, tag, push or public upload occurred.
ZIP remains recommended. Installed Squirrel behavior remains **UNVERIFIED**.
The earlier [physical Windows checks P01–P25](M8_MANUAL_VERIFICATION.md) remain
pending, including Close flicker. Human legal/source-obligation review, physical
verification and an explicit owner publication decision remain release gates.
