# M9.2 final verification and release review

Follow-up dated 2026-10-20: [distribution license audit](DISTRIBUTION_LICENSE_AUDIT.md)
corrects original-code metadata to `UNLICENSED`, supplies third-party notices and
records new artifact checks and unresolved installer/legal review. The M9.2
results below remain historical; they did not verify that later work.

Date: 2026-10-19. Status: **ready for owner review; release candidate pending
physical verification and license/notice resolution**.

Schema **14**, migrations 1–14, application identity, version `1.0.0`, M2/M3
barriers, M4–M8 ownership and M9.1 snapshot/cache behavior remain unchanged.
`1.0.0` is inherited build metadata. No owner profile, installer execution, tag,
commit, push or public release was part of this work.

## Final checks

| Check | Executed result |
| --- | --- |
| Full Vitest | **PASS**, 1,209 tests / 96 files, 130.45 s |
| Typecheck / ESLint | **PASS**, no lint warnings |
| Aggregate Electron | **All 19 harnesses PASS**, from the first harness through M8.2 |
| M9.1 correctness/stress | **PASS**, two/four native windows, 10 process launches, 10k/50k discussions |
| Fresh Windows x64 ZIP | **PASS**, 73 runtime files / 386,076,406 bytes; ZIP 158,366,182 bytes |
| Unmodified extracted EXE | **PASS**, native backup/restore, independent safety, same-ID transfer, new-PID relaunch with three windows, second-folder profile persistence |
| Squirrel structural inspection | **PASS**, Setup 155,752,448 bytes, full NuGet 155,046,743 bytes, RELEASES 87 bytes; never executed |
| Presentation | **PASS**, six visually reviewed PNGs, 17 README links/anchors, 477 links across 11 guidance documents, seven ICO frames |
| Whitespace | `git diff --check` **PASS** |

Application tests used independently owned disposable profiles. The extracted-EXE
smoke checked the resolved isolated Windows profile before production-mode launch.
Scale runs were serial, separate from other suites. Their raw report is
`.packaging-diagnostics/m91/m92-verification.json`, generated with:

```powershell
node scripts/profile-multi-window.cjs --label=m92-verification --samples=1 --stress
```

This is the `test:m91` workload with a distinct label, preserving historical reports.
Restart digests allow native geometry/focus acknowledgements as documented in M9.1;
the backup boundary compares every authoritative table. These observations do not
replace the authoritative [M9.1 measured comparison](M9_1_PERFORMANCE.md).

## Correction and verification failures

The first aggregate stopped at M5's existing **focus new tab** assertion. Its trace
recorded focus while the tab was disabled and the shell inert. An animation frame
could precede React's acknowledged topology/enabled-state commit. A deterministic
regression delivers frames at the next microtask and models native inert/disabled
focus rejection: it **fails against the original code** and passes after correction.

Workspace-command focus now waits for the acknowledged topology and enabled DOM
commit. Superseding topology/profile/transfer work cancels it. No save, checkpoint,
freeze, replica ordering or transfer authority changed. The focused App/duplicate/
transfer run passes 99 tests; the subsequent full suite and full aggregate pass.
The earlier intermittent M5 report remains historical; this run reproduces a cause
for the current failure. No assertion was weakened or replaced by an isolated pass.

Other initial failures were environmental/tooling: the sandbox denied esbuild's
parent-directory reads; the screenshot runner needed to await actual React tab
activation; an old retained Squirrel NuGet differed from the fresh ZIP's ASAR.
Vitest ran successfully with the required read access, capture now waits for the
selected usable panel, and both makers were rebuilt together before final matching
byte checks. Setup was only inspected as bytes.

## Workflow review

| Workflow | Evidence and boundary |
| --- | --- |
| Acquire / Refresh / cancellation | Fixture acquisition/helper paths, transactional history/NEW preservation and scale Refresh; no new live YouTube pass. |
| Nested reading / search / filter / sort / navigation | Full Vitest, reader/query-worker, view-restoration, collapse and usability harnesses; complete data targets and bounded DOM. |
| Seen / selection / bulk / Undo | Selection, reader-actions and shared-sync harnesses; explicit mutations, independent temporary selection and guarded recovery. |
| Collapse / reading positions / duplicates | M5, collapse and restart/backup checks preserve private view state and shared content/seen/Refresh/Undo. |
| Reorder / Move Tab | M5/M7 and extracted-EXE out/back transfer retain identity, independent same-item copies and live frozen results; stale owners reject. |
| Drag / detach | M8 category A synthetic DragEvents through actual windows/IPC/SQLite. Authentic OS drag and physical input remain pending. |
| New / Close / Quit / restore | M6/M8.2 and scale lifecycle checks: peer Close excludes one, last Close retains one, Quit preserves all currently open windows. Ctrl+W / Ctrl+Shift+W / Ctrl+Shift+Q remain distinct. |
| Backup / restore / recovery | Large backup/rename-gap checks, native EXE dialogs, independent safety, exact tables and real relaunch. |
| EN/PL / light/dark/system / menus | Aggregate preference, keyboard/menu and native-key tests; EN/light, EN/dark and PL/dark captures reviewed. |

Native Copy/Ctrl+C/link-copy writes are **UNVERIFIED** where the existing Windows
clipboard formats could not all be safely preserved; those writes were skipped.
Other selection/menu/keyboard assertions ran. Optional live helpers were not configured.

## Screenshots

**Like metadata polish (2026-10-24):** Comment metadata now shows an inline
thumbs-up icon and a visible localized number. The existing EN/PL likes wording
remains the accessible label and tooltip; zero stays visible and unknown counts
stay omitted. The seven README views and the separate Charcoal/wallpaper example
are refreshed from genuine Electron captures using fictional data. Presentation
verification also decodes and checks the wallpaper image and its provenance hash.
After a verified Forge build, run `node scripts/capture-readme.cjs` for the seven
README views, then `node scripts/capture-readme.cjs --wallpaper-only="C:\path\to\carmine-rock.jpg"`
with the original credited artwork for the wallpaper example. The latter uses
the native import adapter in a disposable profile, Charcoal, 85% opacity and 8 px
blur; it updates only that image and `wallpaper-capture.json`. No artwork source
file is bundled. Run `node scripts/verify-presentation.cjs` to check all eight.

**Download Manager addition (2026-10-24):** `downloads-light.png` (1360 × 1000)
shows the finalized production UI with three active jobs, badge 3 and five queued
jobs. Run `node scripts/capture-readme.cjs --downloads-only` after a verified Forge
build to replace only this image. The six baseline PNGs below and the existing
Charcoal/wallpaper example remain unchanged. A normal capture run regenerates the
six baseline views plus the new Downloads view.

The new image is an unedited Electron `capturePage()` of the real built
main/preload/renderer. Three real offline Node helper fixture processes run through
the production probe/executor/parser/scheduler; eight accepted Acquire/Refresh
requests create the real active/queued state. No renderer job data or DOM text is
injected and no YouTube request occurs. The capture checks badge/counts, then
cancels one real child and verifies automatic queue advancement before shutdown
drains the rest. `capture.json` records separate per-image build hashes and fixture
provenance for this addition, retaining the older images' original provenance.
Presentation verification now checks seven manifested PNGs and the README links.

The six M9.2 baseline captures used actual production
main/preload/React entries with an owned OS-temp SQLite profile and isolated Chromium
paths, invented people/discussions and offline geometric avatars. Other HTTPS
requests are rejected; helper overrides are empty. No DOM text replacement, owner
data, desktop imagery or shipped test hook is used. The temporary profile is removed.

| File in `docs/screenshots/` | Pixels | Shows |
| --- | --- | --- |
| `reader-light.png` | 1360 × 1000 | Nested replies, creator evidence, seen boxes, selection circles, rails and ruler |
| `search-dark.png` | 1360 × 880 | Applied audio AND Unseen, one match with conversation context |
| `collapse-selection-light.png` | 1360 × 920 | Collapsed branch, three selected comments and bulk controls |
| `library-light.png` | 1360 × 680 | Four fictional discussions and local/open counts |
| `multi-window-light.png` | 1848 × 1000 | Filtered duplicate and a separate native workspace's Library |
| `move-tab-pl-dark.png` | 1360 × 880 | Polish Move Tab chooser and destination details |

The paired-window PNG contains two unscaled Electron content captures separated by
8 pixels, without invented OS chrome; it is explicitly labelled in the README.
All six final images were opened for visual review and total about 612 KiB.
`capture.json` records timestamp, runtime, main/renderer hashes and dimensions.
`node scripts/verify-presentation.cjs` checks links/anchors, decoded PNGs/provenance
and seven ICO frames. None of this certifies physical dragging or desktop flicker.

## Distribution and documentation audit

The README retains the author's personal-project voice, helper troubleshooting and
ZIP setup. It now explains independent tabs/windows, menus, moving/dragging, Close
versus Quit and temporary selection versus saved seen/reading state. The walkthrough,
UI/helper/packaging guidance, documentation map and manual checklist were updated;
two stale shortcut anchors were corrected. Historical evidence remains historical.

ZIP verification compares every runtime entry, PE architecture, ASAR/worker/preload/
renderer resources, six fuses, EN/PL locales and embedded icons. The extracted app
needs no Node/npm/checkout and uses the expected isolated counterpart of
`%APPDATA%\youtube-comments-production`. Backup safety/recovery survives replacement
and relaunch. Electron/Chromium notices and `version` are present. Windows
Authenticode reports **NotSigned** for both EXE and Setup. The ZIP remains recommended;
installed shortcuts/install/update/uninstall are **UNVERIFIED**, not a ZIP gate.

Helper names, Python requirements and entry points were checked against
[yt-dlp](https://github.com/yt-dlp/yt-dlp), [its metadata](https://pypi.org/project/yt-dlp/),
[post-archiver metadata](https://pypi.org/project/post-archiver-improved/),
[its console declaration](https://github.com/sadadYes/post-archiver-improved/blob/main/pyproject.toml)
and [Python's Windows downloads](https://www.python.org/downloads/windows/).
Known-tested app versions remain yt-dlp `2026.08.19` / post-archiver `0.4.0`;
executables are `yt-dlp.exe` / `post-archiver.exe`. No installation/update or live
extraction was performed. A GitHub Releases download could not be verified; the
README now points to local build instructions without implying a hosted artifact.

**Distribution issue:** package metadata declares MIT, but there is no repository
project `LICENSE` or standalone license/notice inventory in ASAR. React license
banners remain; these do not establish complete bundled dependency attribution.
Resolve project licensing/notices before a public artifact. No license was selected
or legal compliance inferred from metadata.

## Release assessment

- **Verified:** the final-check/workflow tables above; no unresolved automated
  functional failure remains after the narrow focus correction.
- **Owner/manual gates:** complete [P01–P25](M8_MANUAL_VERIFICATION.md), especially
  physical reorder/attachment/detachment, Escape, covered/minimized windows,
  focus/ghost/cursor, available mixed DPI, Close/Quit after transfers and a physical
  recording of the former Close-overlay flicker. Resolve resulting failures and
  the license/notice issue before public distribution. All physical rows remain pending.
- **Known limits:** M9.1 startup gains were local to high-memory hardware. Large
  mutations/Refresh/database work still take seconds with material main stalls;
  post-work memory did not improve uniformly. No universal window/comment maximum,
  low-memory qualification or all-Windows claim follows. Helpers can break and
  coverage can be partial. Unobserved outside Escape, desktop/foreign/taskbar
  endings may detach identically under the unchanged accepted policy.
- **Optional future work:** measured summary-only mutation replies, scoped hydration
  and main scheduling/worker investigation; broader hardware, installer testing,
  signing and distribution/update channels. No redesign, version bump or publishing
  was selected. Clipboard and live-helper evidence limits remain explicit above.

Final local logs use `.m92-{vitest,typecheck,lint,build,electron,scale,packaged,artifacts,capture,presentation}.log`;
the wider link audit is `.m92-document-links.log`. Initial failures/results remain
in `.m92-{electron,vitest,artifacts}-initial.log` and `.m92-focus-baseline.log`;
the focused correction is `.m92-focus-fixed.log`. Prior M8.2/packaged/M9.1 evidence
was archived under `.packaging-diagnostics/m92/prior-verification/`; the final EXE
report is `.packaging-diagnostics/packaged-smoke.json`.

Stop for owner review. All changes remain uncommitted.
