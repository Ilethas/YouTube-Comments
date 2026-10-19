# Third-party notices

YouTube Comments' original source is publicly viewable, but is not currently
offered under an open-source license. Its package metadata is `UNLICENSED`.
The components below retain their own licenses; those licenses do not license
the application's original code.

In the Windows application, this index is `resources/THIRD_PARTY_NOTICES.md`.
Links to `third-party/` below resolve within `resources/`. Electron's intact
`../LICENSE` and `../LICENSES.chromium.html` are one directory above this index,
beside `youtube-comments.exe`. ZIP and Squirrel application payloads retain these
locations. The large Chromium notice collection is supplied once there.

## Application bundles and runtime

Versions identify the locked, inspected Windows x64 build. Copyright statements
reproduce upstream attribution; the linked texts contain complete license wording.
Package authors are labelled separately where no concrete copyright is supplied.

| Component | License and attribution | Included text | Upstream source |
| --- | --- | --- | --- |
| Electron 44.4.5 | MIT; Copyright (c) Electron contributors; Copyright (c) 2013-2020 GitHub Inc. | Runtime `../LICENSE` | [Electron v44.4.5](https://github.com/electron/electron/tree/v44.4.5) |
| Chromium 152.0.7977.130 and Electron's embedded components | Multiple licenses and individual attributions, retained intact | Runtime `../LICENSES.chromium.html` | [Electron source/DEPS](https://github.com/electron/electron/tree/v44.4.5) |
| react 18.3.1 | MIT; Copyright (c) Facebook, Inc. and its affiliates. | [License](third-party/react-LICENSE.txt) | [React v18.3.1](https://github.com/facebook/react/tree/v18.3.1/packages/react) |
| react-dom 18.3.1 | MIT; Copyright (c) Facebook, Inc. and its affiliates. | [License](third-party/react-dom-LICENSE.txt) | [React DOM v18.3.1](https://github.com/facebook/react/tree/v18.3.1/packages/react-dom) |
| Modernizr 3.0.0pre (Custom Build), borrowed event detection inside React DOM | MIT per embedded banner and historical upstream LICENSE; that upstream file supplies no copyright holder/full text | [Exact upstream notice](third-party/modernizr-NOTICE.txt); React's adaptation retains its [MIT text](third-party/react-dom-LICENSE.txt); original attribution completeness needs review | [React's source attribution](https://github.com/facebook/react/blob/v18.3.1/packages/react-dom/src/events/isEventSupported.js), [Modernizr historical LICENSE](https://github.com/Modernizr/Modernizr/blob/v3.0.0/LICENSE) |
| scheduler 0.23.2 | MIT; Copyright (c) Facebook, Inc. and its affiliates. | [License](third-party/scheduler-LICENSE.txt) | [Scheduler](https://github.com/facebook/react/tree/v18.3.1/packages/scheduler) |
| @js-temporal/polyfill 0.5.1 | ISC; Copyright 2017, 2018, 2019, 2020 ECMA International | [License](third-party/temporal-polyfill-LICENSE.txt) | [Temporal polyfill](https://www.npmjs.com/package/@js-temporal/polyfill/v/0.5.1) |
| jsbi 4.3.2 | Apache-2.0; Copyright 2018 Google Inc. | [License](third-party/jsbi-LICENSE.txt), [source attribution](third-party/jsbi-NOTICE.txt) | [JSBI v4.3.2](https://github.com/GoogleChromeLabs/jsbi/tree/v4.3.2) |
| @tanstack/react-virtual 3.14.13 | MIT; Copyright (c) 2021-present Tanner Linsley | [License](third-party/tanstack-react-virtual-LICENSE.txt) | [Versioned package](https://www.npmjs.com/package/@tanstack/react-virtual/v/3.14.13) |
| @tanstack/virtual-core 3.17.11 | MIT; Copyright (c) 2021-present Tanner Linsley | [License](third-party/tanstack-virtual-core-LICENSE.txt) | [Versioned package](https://www.npmjs.com/package/@tanstack/virtual-core/v/3.17.11) |
| electron-squirrel-startup 1.0.1 | Apache-2.0; package author Lucas Hrabovsky; package LICENSE supplies no concrete copyright attribution | [License](third-party/electron-squirrel-startup-LICENSE.txt) | [Versioned package](https://www.npmjs.com/package/electron-squirrel-startup/v/1.0.1) |
| debug 2.6.9 | MIT; Copyright (c) 2014 TJ Holowaychuk &lt;tj@vision-media.ca&gt; | [License](third-party/debug-LICENSE.txt) | [debug 2.6.9](https://github.com/debug-js/debug/tree/2.6.9) |
| ms 2.0.0 | MIT; Copyright (c) 2016 Zeit, Inc. | [License](third-party/ms-LICENSE.txt) | [Versioned package](https://www.npmjs.com/package/ms/v/2.0.0) |
| vite 5.4.21 generated modulepreload helper only | MIT; Copyright (c) 2019-present, VoidZero Inc. and Vite contributors | [Core license section](third-party/vite-helpers-LICENSE.txt) | [Vite v5.4.21](https://github.com/vitejs/vite/tree/v5.4.21) |
| @rollup/plugin-commonjs 26.0.1 generated helpers, bundled within Vite 5.4.21 | MIT; Copyright (c) 2019 RollupJS Plugin Contributors (https://github.com/rollup/plugins/graphs/contributors) | [Exact Vite bundled notice section](third-party/rollup-commonjs-helpers-LICENSE.txt) | [Vite upstream lockfile](https://github.com/vitejs/vite/blob/v5.4.21/pnpm-lock.yaml) |

The npm texts are copied from these exact installed, lockfile-matched packages.
Vite bundles/minifies code and substitutes build-time environment values; no
vendored library source patches are applied. JSBI's published source-map header
is retained separately. No upstream NOTICE file is supplied in the application
npm packages listed above. Vite's build-only dependency inventory is not shipped
application code.

React DOM's original Modernizr banner is preserved in the separate notice file
(Vite strips that unannotated comment from the compiled bundle). The historical Modernizr
LICENSE is itself only that banner; a version-matched original copyright notice
and complete original grant were not recovered. This is an unresolved attribution
review item for both distribution formats, not a claim that React's copyright
statement identifies Modernizr's original authors.

The runtime notice collection includes Node.js 24.21.0, V8 15.2.124.28-electron.0,
SQLite 3.53.4, ICU 78.2, FFmpeg, graphics, compression, cryptography and other
Chromium/Electron code and data. Consult its entries for individual copyright,
license texts and source references; these components are not all MIT licensed.
Build revisions are traced from Electron's tagged source/DEPS. Preserving this
collection does not itself establish fulfillment of all source-availability terms.

The app icon and outline UI icons are project-owned geometry. No external font,
icon pack, stock image or helper executable is bundled. Remote avatars and video
thumbnails are user-acquired content, not assets included in these artifacts.

## Squirrel installer distribution only

The ZIP does not contain the installer components below. These notices also travel
inside Setup's embedded NuGet application payload. **Installer licensing review
remains incomplete; do not publish Setup based on structural checks.**

electron-winstaller 5.4.4 supplies the vendor binaries. The updater identifies
itself as `2.0.1+eef37460ae` (file version `2.0.1.1`); the bootstrapper has file
version `1.9.1.0`. Icons/version resources are replaced during packaging.
The upstream source is evidence, not proof of a reproducible vendor build.

| Component / evidence | License and attribution | Included text / source |
| --- | --- | --- |
| Squirrel.Windows updater/bootstrapper/stub | MIT; Copyright (c) 2012 GitHub, Inc. | [COPYING](third-party/squirrel-COPYING.txt); [pinned source](https://github.com/Squirrel/Squirrel.Windows/tree/eef37460ae) |
| Stub's semver library | MIT; upstream notice says Copyright (c) 2015 Marko Živanovc | [Exact notice](third-party/squirrel-stub-semver-LICENSE.txt); [source](https://github.com/Squirrel/Squirrel.Windows/blob/eef37460ae/src/StubExecutable/LICENSE.md) |
| Bootstrapper unzip (zlib 1.1.3 origin with modifications) | zlib terms; Copyright (C) 1995-1998 Jean-loup Gailly and Mark Adler; modifications by Lucian Wischik | [Original header/modification notice](third-party/squirrel-unzip-NOTICE.txt); [source](https://github.com/Squirrel/Squirrel.Windows/blob/eef37460ae/src/Setup/unzip.cpp) |
| Bootstrapper WTL 9.0 | CPL-1.0; Copyright (C) Microsoft Corporation, WTL Team. All rights reserved. | [Original header](third-party/squirrel-wtl-NOTICE.txt), [CPL 1.0](third-party/CPL-1.0.txt); [source headers](https://github.com/Squirrel/Squirrel.Windows/tree/eef37460ae/src/Setup/wtl90) |
| Mono.Cecil 0.11.2 (updater build input) | MIT; Copyright (c) 2008 - 2015 Jb Evain; Copyright (c) 2008 - 2011 Novell, Inc. | [License](third-party/squirrel-cecil-LICENSE.txt); [source](https://github.com/jbevain/cecil/blob/0.11.2/LICENSE.txt) |
| SharpCompress 0.17.1 (updater build input) | MIT core; Copyright (c) 2014 Adam Hathcock; codec-specific terms need review | [Core license](third-party/squirrel-sharpcompress-LICENSE.txt); [source](https://github.com/adamhathcock/sharpcompress/tree/0.17.1) |
| NuGet.Squirrel, submodule 50f8d9e438fe948d7109501bd10f6024d0585b70 | Apache-2.0; upstream LICENSE supplies no concrete copyright attribution | [License](third-party/squirrel-nuget-LICENSE.txt); [source](https://github.com/Squirrel/NuGet/tree/50f8d9e438fe948d7109501bd10f6024d0585b70) |
| WpfAnimatedGif 1.4.15 (updater build input) | Apache-2.0 per exact NuGet metadata; package author Thomas Levesque; concrete copyright notice not recovered | [Apache text linked by metadata](third-party/squirrel-wpf-LICENSE.txt); [exact package](https://www.nuget.org/packages/WpfAnimatedGif/1.4.15); exact binary/source correspondence unverified |
| DeltaCompressionDotNet 1.1.0 / MsDelta | **Unresolved:** exact NuGet has no license text/declaration; copyright metadata names Todd Aspeotis 2014 | [Exact package](https://www.nuget.org/packages/DeltaCompressionDotNet/1.1.0); obtain applicable grant before installer distribution |
| Microsoft.Web.Xdt 2.1.1 / Microsoft.Web.XmlTransform | **Unresolved:** exact NuGet requires license acceptance; its old Microsoft license link now redirects to unrelated documentation | [Exact package](https://www.nuget.org/packages/Microsoft.Web.Xdt/2.1.1); recover applicable terms/redistribution rights |
| electron-winstaller 5.4.4 default install-spinner.gif | Package MIT; Copyright (c) 2015 GitHub Inc.; **unresolved** asset-specific authorship/license provenance | [Provider's license](third-party/electron-winstaller-LICENSE.txt); [vendor asset](https://github.com/electron/windows-installer/blob/v5.4.4/resources/install-spinner.gif) |

Before installer publication, review WTL/CPL source availability, native Microsoft
runtime redistribution rights, all merged updater libraries/notices (including
codec terms), exact binary/source correspondence and the spinner's provenance.
WTL's source link identifies where the headers can be obtained; it does not by
itself establish fulfillment of CPL obligations. 7-Zip, NuGet CLI, WiX, ILRepack
and rcedit are not shipped as separate tools in the inspected artifacts. The
full merged-code inventory still requires verification.

## External acquisition tools (not distributed)

The app does not bundle, download, install or update yt-dlp, post-archiver-improved
or Python. Users install and choose them independently.

- [yt-dlp 2026.08.19](https://github.com/yt-dlp/yt-dlp/tree/2026.08.19): its
  [source/PyPI code uses the Unlicense](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/LICENSE).
  [Upstream licensing guidance](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/README.md#licensing)
  distinguishes PyInstaller executables containing GPLv3+ code and other release
  formats with additional terms. A pip `.exe` launcher differs from a standalone
  PyInstaller distribution. Check the actual helper distribution's terms.
- [post-archiver-improved 0.4.0](https://pypi.org/project/post-archiver-improved/0.4.0/)
  declares **GPL-3.0-or-later** in its version-specific PyPI metadata.
  [Upstream repository](https://github.com/sadadYes/post-archiver-improved).

These terms do not automatically license the application's original code.
The integration invokes an independently installed executable with CLI arguments
and reads output files, without linking or embedding helper code. Process
separation is not an absolute legal guarantee; review the actual integration if
legal assurance or a different distribution model is needed. No helper license
files are included as though helpers were distributed.

[The notice manifest](third-party/manifest.json) records reviewed versions and
text/vendor hashes. Offline checks verify inventory/delivery, not complete legal
compliance. The repository follow-up report is `docs/DISTRIBUTION_LICENSE_AUDIT.md`;
it is not needed to read the distributed notices.
