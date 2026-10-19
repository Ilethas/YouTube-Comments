# M9.1: aggregate multi-window scale and performance

Date: 2026-10-19. Scope: verification and measured hardening over M5–M8.2.
Schema **14**, migrations 1–14 unchanged. M9.2 presentation/release work requires
owner review and is not included. This report supplements the historical ledgers;
it does not replace M0/M0.5 or certify physical HTML drag input.

## Reproduction and isolation

Build with `npm.cmd run make:zip`, then run:

```powershell
npm.cmd run profile:m91
# Shorter correctness run, still both native window counts and real processes:
npm.cmd run test:m91
# Optional, separate diagnostic run (adds sampling overhead):
node scripts/profile-multi-window.cjs --label=cpu --samples=1 --cpu
```

`scripts/profile-multi-window.cjs` requires the actual Forge main, preload,
React and worker bundles. Each window count gets a freshly owned `reader-m91-*`
OS-temp root. All Electron account/session/log/crash paths and the explicit
development SQLite path are redirected there before production startup. Fixtures
are generated in a separate short-lived Node process, so its large preparation
heap cannot compete with native readers. Cleanup checks the absolute temp parent
and owned basename before deleting. No production-profile fallback is used.

Network requests are denied in renderer sessions. The saved sanitized helper
format supplies deterministic synthetic 50k Refresh bytes through a test-only
main child-process interception; the dummy helper EXE is never executed. Production
resolution, version probe, normalization, merge and synchronization still run.
Dialog answers, failure injections and restore orchestration are test-only. The
runner does not use clipboard, Setup, installed application or live acquisition.

Raw environment, per-process memory, worker/long-task/frame observations, timings,
IPC summaries and bundle hashes are written under ignored
`.packaging-diagnostics/m91/<label>.json`. Optional CPU profiles go beside them.
This report preserves selected results; raw files are regenerated,
not shipped as production telemetry. Run benchmarks serially, apart from Vitest,
packaging and other Electron suites. Ordinary machine activity still adds noise.

## Workload and methods

The same database contains 10,000- and 50,000-comment fictional video discussions,
plus the existing 24 demo comments. IDs/text/seen patterns/publication/likes repeat
deterministically. Every 100-comment tree has a direct-parent chain to depth 60,
then broad sibling replies. Unicode and multiline text vary over five lengths;
every 97th comment matches `needle`; every third begins seen. Both large datasets
retain complete tree context under filters. Initial 50k Unseen has 33,333 matches.

Two and four independent production BrowserWindows start with 12 generated
discussion placements each (six copies per item), plus the initial window's demo
tabs. Initial active 50k/10k views alternate by window. Stress visits a second
independent same-item view in every renderer with a distinct selective query and
draft. Unvisited views stay lazy. This verifies 24/48 generated placements and
4/8 visited large views, not 48 simultaneously evaluated 50k sessions.

Measurements have deliberately separate boundaries:

- **Startup:** per-window usable reader controls, completed saved-query restoration
  without query error, visible native and no inert shell, measured from child
  harness entry. The parent records total process lifetime including Quit;
  launch-to-entry uses same-machine wall-clock milliseconds. These are fresh
  processes with a warmed filesystem. Neither OS caches nor the owner's machine
  are reset; no true disk-cold or boot-cold startup claim follows. Repeated launches
  use the same closed profile and verify its committed tables.
- **Main/repository:** isolated Node bootstrap and structuredClone samples, plus
  actual Electron IPC handler elapsed times. Query-field projection, structured
  clone, pure query and sort/presentation are separately observed at both sizes.
  Node microbenchmarks are not Electron contextBridge timings.
- **Transport:** request/reply and main notification counts, UTF-8 JSON byte totals.
  JSON bytes are a reproducible payload-size proxy, not Chromium wire bytes or
  object resident size. Counting/stringification occurs outside handler timing but
  contributes overhead to wall time and loop delay in both versions.
  Explicit mutation/Refresh calls return their result through executeJavaScript
  to the test runner, adding an automation copy of large comment/state replies.
  The before/after runs use the same method, but these operation times and memory
  samples do not isolate production UI acknowledgment cost. Startup polling and
  ordinary metadata reads avoid that extra full-profile automation copy.
- **Workers/renderers:** synchronous Worker.postMessage duration includes sender
  clone work; round trip includes queueing, worker creation/evaluation/reply and
  renderer delivery. It cannot isolate algorithm time. CDP main-isolate heap usage
  excludes worker-isolate heaps; whole-renderer OS working sets include native and
  worker memory. Per-worker retained/peak heap is not separately measured.
- **Memory:** main `process.memoryUsage`, Electron app metrics and CDP heap samples
  at usable startup and after overlapped work. These are snapshots without forced
  GC, not exact peaks, leak proofs or additive unique physical memory. Working-set
  sums double-count shared pages; GC/scheduling affect comparisons.
- **Responsiveness:** main 10 ms event-loop-delay histogram, renderer Long Tasks
  and bounded RAF intervals. DOM actions plus two animation frames time tab,
  filter, navigation and scroll/paint observations. These are synthetic application
  latency proxies, not physical input-to-photon or native drag-loop measurements.
  CPU profiles help attribution; native `(program)` samples cannot identify each
  Electron serialization/bridge-copy stage independently.

There are no invented speed thresholds. Integrity, equality, ownership, frozen
membership, existing query deadlines and bounded DOM are correctness assertions.
Hang guards only fail a stalled run; they never authorize a drain or data loss.

## Environment and results

Windows 11 Education x64 (10.0.26300); AMD Ryzen 9 7950X3D, 32 logical CPUs; 102,116,085,760
bytes RAM (95.10 GiB). Host Node 26.7.0. Electron 44.4.5 embeds Node 24.21.0,
Chromium 152.0.7977.130, V8 15.2.124.28 and SQLite 3.53.4. Display bounds/scales,
OS release, runtime components and available memory are recorded per run. This
is a high-memory workstation, not evidence for low-memory hardware.

Baseline started at source `57ed29a7e85db765fbc35f9f6f537458bf103bf6`, with built
main SHA-256 `d636962044de283b3af9bcca6bb83744c2dd1b38edf40a3feb5cc69a6b0ab736`.
The older 25.3-second 60k startup was concurrent with regression load and has no
matching environment/measurement boundaries. Fresh serial samples reproduce a
substantial startup cost, but do not establish a historical regression ratio.

The comparison uses `baseline-control.json` and `current.json` for three startup
samples per window count. The completed four-window stress rerun is
`stress-final.json`; the two-window stress/restart phases are in `current.json`.
An exploratory `baseline.json` preceded separation of fixture preparation into
its own process and is retained, but excluded from the comparison. No existing
artifact was deleted to hide a failed or slower run. Final measured main bundle
SHA-256: `44320bded7440781e63e3b1e9e763a4a3f7932a94e193c093e8b1f4b54067e2f`.

| Startup observation | Baseline | Final |
| --- | --- | --- |
| Two windows, slowest usable window, median (range), s | 21.84 (21.55–22.05) | 2.78 (2.75–2.86) |
| Four windows, slowest usable window, median (range), s | 26.07 (25.80–26.84) | 3.84 (3.83–3.89) |
| Two windows, main RSS median, MiB | 877.7 | 525.7 |
| Four windows, main RSS median, MiB | 1,165.2 | 533.0 |
| Renderer main-isolate heap, per-window range, MiB | 224.4–254.8 | 121.8–151.4 |
| Renderer working set, per-window range, MiB | 422.7–495.6 | 323.3–392.6 |
| Full-profile snapshot JSON bytes | 116,414,137 | 62,332,041 |
| Main maximum startup loop delay, two-window range, s | 1.32–1.36 | 1.01–1.07 |
| Main maximum startup loop delay, four-window range, s | 1.89–3.36 | 1.01–1.03 |

Usable-startup medians fell about **87% / 85%** for two/four windows in these
samples; snapshot JSON bytes fell **46.5%**. Every sample is a cold application
process on a warmed filesystem. The first launch was 21.84/26.84 seconds before
and 2.86/3.83 seconds after; subsequent launches account for the other range values.
These are local samples, not release-wide speed guarantees. Shorter runs also
change histogram populations: p99 loop delay is not directly comparable between
an idle-heavy 26-second startup and a 4-second startup. Maximum stalls remain
about a second even after hardening.

Node-only bootstrap reads were 727–812 ms before on every read. Final first reads
were 798–858 ms, followed by 0.75–0.83 ms for same-revision reuse. Thus **first-read
SQL/projection work did not improve**. Node structuredClone samples fell from
737–891 ms to 406–547 ms. The fixture database is 106,000,384 bytes; it was not
reduced, reindexed or migrated for these results.

| Complete operation, one stress sample per window count, s | 2 windows before → after | 4 windows before → after |
| --- | --- | --- |
| Shared single seen acknowledgment | 5.53 → 2.80 | 5.32 → 2.82 |
| Bulk 50k | 6.94 → 3.39 | 8.55 → 7.22 |
| Guarded Undo | 8.28 → 3.24 | 8.91 → 6.04 |
| Live 50k transfer | 0.737 → 0.739 | 0.718 → 0.711 |
| Refresh 50k through fixture helper | 35.83 → 10.29 | 41.41 → 12.69 |
| Verified backup | 1.11 → 1.22 | 1.48 → 1.19 |
| Confirmed restore, before fresh-process startup | 6.81 → 7.16 | 7.06 → 6.71 |
| Close with pending draft | 0.062 → 0.048 | 0.062 → 0.024 |

There is no statistically supported transfer/Close speed claim. Two-window backup
and restore were **slower by about 0.11/0.35 seconds**; four-window navigation plus
paint increased from 60 to 76 ms. Single samples cannot separate those differences
from scheduling, I/O, frame cadence or GC. Tab activation of a second view was
44–179 ms (two windows) and 61–179 ms (four); selective Apply was 64–302 ms and
73–337 ms. Scroll plus two frames was 254/207 ms after, versus 264/359 ms before.
These timings include test IPC/polling and do not simulate physical input latency.

Pure query tests retained identical 104/516 selective matches and complete
10k/50k context. At 10k, baseline/final query ranges were 8–18 / 7–16 ms; at 50k,
63–90 / 62–85 ms. Final query-field projection was about 3–6 / 16–19 ms and
sort plus reader projection about 9–15 / 53–80 ms at 10k/50k. Query-worker payloads
remain 4,510,199 / 22,728,150 JSON bytes: those algorithms/payloads were not optimized.
No whole-query deadline was relaxed.

Transport still moves substantial data. In the four-window stress sample,
snapshot requests were 17 → 18, carrying 1.79 → 1.02 GB of JSON-equivalent replies;
metadata requests were 196 → 126, partly because the shorter run spans fewer
two-second polls. Shared commit notifications were 127 → 135 and only about
14.7 → 15.6 kB total, while one bulk acknowledgment still carried **51.9 MB**
(previously 97.0 MB). The 7 transfer notifications total about 14.2 MB and retain
the same live handoff semantics. Counts include deliberate failures, recovery,
readiness and one renderer reload; they are not steady-state rates. Snapshot
count did not improve, and main handler time for Refresh stayed about 6–7 seconds.

Post-work memory did **not** improve uniformly: main RSS was 380 → 1,467 MiB
in the two-window samples and 386 → 934 MiB at four windows. In the two-window
case main JS heap used was lower (213 → 135 MiB), while one renderer's sampled
heap was higher (427 → 993 MiB). At four windows, renderer heap samples ranged
154–450 MiB before and 169–437 MiB after. These are different GC/allocator points
after a much shorter workflow, not proof of a retained-heap leak or a memory fix.
The report retains this regression; startup memory reductions must not be
generalized to all lifecycle phases. A separate GC diagnostic is described below.
The automation copy described above is another source of temporary allocation;
these snapshots cannot distinguish allocator retention from application retention.

The separate two-window `gc-audit.json` repeats the same correctness workflow and
then requests main/renderer heap collection through test-only Inspector/CDP, after
the ordinary post-work sample. It passes the subsequent Close/restore/crash/Quit
checks. Normal benchmark samples never force GC. Reproduce separately with:

```powershell
node scripts/profile-multi-window.cjs --label=gc-audit-repeat --windows=2 --only-stress --stress --gc-audit
```

| Same diagnostic process | Before diagnostic GC | After diagnostic GC |
| --- | --- | --- |
| Main RSS, MiB | 1,288.3 | 215.8 |
| Main JS heap used, MiB | 357.3 | 82.1 |
| Reloaded renderer main-isolate heap, MiB | 168.8 | 100.8 |
| Populated target renderer main-isolate heap, MiB | 969.9 | 262.6 |
| Populated target renderer working set, MiB | 1,322.2 | 540.4 |

This supports temporary allocation/collection timing as a major contributor to
the high samples, while live views still consume substantial memory. It neither
proves an absence of leaks nor supplies a comparable forced-GC baseline for the
old build. No production GC calls, memory-pressure policy or cache-eviction change
was added to improve the numbers.

## Evidence-driven change

`readComments` previously returned the entire normalized `remote` evidence tree
alongside its already projected text, author, relationship, publication and state.
No renderer consumer reads comment.remote. At 60k, a full-profile snapshot was
116,414,137 JSON bytes. CPU sampling found only a small part of startup in JS
query/projection, with most renderer samples in native `(program)` and significant
GC. This supports investigating copying; it does not attribute every native sample
to a particular Electron bridge phase.

Reader snapshots now omit only that redundant optional comment evidence tree.
Relationship truth/status/direct-parent ID, honest publication labels/precision,
usable avatar/author evidence, discovery, likes/flags, action availability, text,
IDs and local seen remain projected. Content-item evidence stays available for
headers/thumbnails. SQLite remote_json remains complete, unchanged and used by
merge/refresh/backup. A regression test checks both snapshot paths and later lossy
merge against stored evidence. Historical migration row-equality checks remain.

Pruning alone reduced two-window startup dramatically but exposed a four-window
startup race against the **unchanged** 1000 ms worker deadline. The first two
windows dispatched at about 2.29/3.35 seconds and timed out without a reply; later
windows dispatched at 4.66/4.81 seconds and completed in 493/139 ms. Main was still
performing repeated synchronous 60k reads when early workers needed their cold
script loads. The failure report is `4-sample-0-failed.json`; it is not counted as
a successful usable startup. No timeout was increased or error ignored.

The timing evidence is consistent with main stalls delaying cold worker startup;
native CPU samples alone cannot prove the exact file-load scheduling dependency.

The final correction also reuses bootstrap's immutable shared items/comments/Undo
for one repository commit revision. Every transaction clears it before execution
and on exit, including rollback, before observers; reads inside transactions bypass
it. Per-caller workspace/view/intent/collapse/preferences remain fresh. Reopen/restore
gets a fresh repository/epoch. This removes repeated main materialization without
changing clones or renderer ownership. It may retain one shared snapshot until a
commit/close; memory observations must accompany timing results. Focused tests cover
cross-window scoping, observer freshness, immutable prior snapshots, bulk/Undo,
rollback and a removal DTO constructed inside the transaction. See [ADR 0036](decisions/0036-measured-reader-snapshot-hardening.md).

No schema, backend authority, worker placement, query semantics, lazy-loading
policy, ownership, M2 ordering, M3 fence or M7/M8 protocol changes are involved.

## Correctness evidence and remaining limits

The scale harness checks shared assignments/bulk/guarded Undo, logically frozen
33,333-member Unseen transfer after seen changes, same-ID movement into populated
windows, owner-update failure with exact all-table rollback after source checkpoints,
and concurrent shared changes cancelling a held readiness rendezvous. It exercises
real helper-path Refresh to 50,001 comments without losing seen state, failed
drain with no published backup, subsequent successful backup with all-table equality,
renderer crash/reload, ordinary Close draining a pending draft, terminal offline
fencing, complete restore into a fresh process, abrupt main exit, another restart,
coordinated Quit with pending drafts in every large reader, and exact subsequent
restoration of those drafts.
The final `test:m91` run additionally checks the destination's displayed frozen
match count/stale indication and unchanged worker-dispatch count after the 50k
transfer, not just the submitted handoff payload. Both window counts pass all
five fresh-process phases in `verification.json`.
Native geometry/focus rows may legitimately acknowledge startup; all other table
hashes compare exactly across process and restore boundaries. The backup boundary
itself compares every authoritative table including geometry/session.

An intermediate final-code four-window stress attempt rejected a second backup
with `Release pending`: the runner waited only for the initiating window after
an injected failed drain. Faster completion exposed peers still acknowledging
release. The production guard correctly refused the operation. The runner now
waits for **every live participant** to become usable before the next operation;
the completed `stress-final` run passes without weakening M3 or adding a sleep.

The first full Vitest run exposed five publication tests whose fixture setup wrote
through another SQLite connection after warming the repository snapshot. Those
fixture writes bypass the application's sole commit authority. Their setup now
reopens the disposable repository after seeding, before preview and mutation;
all date/DST, target-count, Undo and evidence assertions remain intact. Production
writers still invalidate reuse synchronously through every repository commit;
external edits to an open profile are not an additional supported writer protocol.

M1–M8 suites provide the complementary stale/forged/ABA, singleton, save-lane,
rename-gap and actual extracted-EXE/native-dialog checks. Synthetic gesture tests
retain the accepted outside-Escape ambiguity. They do not certify physical drag.

## Final verification

| Check | Executed result |
| --- | --- |
| Focused cache/evidence/workspace tests | 50 tests PASS; publication/cache rerun 36 tests PASS |
| Full Vitest | **1,208 tests / 96 files PASS**, 126.08 s |
| Typecheck / ESLint | PASS, no lint warnings |
| Full aggregate Electron | **All 19 harnesses PASS**, M1–M8.2 included |
| Final `npm.cmd run test:m91` | PASS at two/four windows, 10 real process launches; direct target frozen-state/no-reevaluation checks included |
| Separate GC audit | PASS, two windows; subsequent lifecycle/equality checks retained |
| Verified Windows x64 package + ZIP | PASS; 73 runtime files, 386,076,172 bytes; ZIP 158,365,811 bytes; verified make 19.49 s |
| Unmodified extracted executable | PASS; native dialogs, M7 out/back transfer, independent safety, exact all-table restore, real extracted-EXE relaunch into a new PID and three restored windows |
| Presentation / whitespace | Existing 11 README links, four PNGs and seven ICO frames PASS; `git diff --check` PASS |

The separate legacy 60k backup harness passed exact fresh-process equality and
both forced rename-gap recoveries. Its confirmed restore took 13.54 seconds;
the entire 38.54-second restore phase also includes startup, cancellation,
invalid-candidate checks and fixture mutations. Its different fixture/method is
not another sample of the 6.7–7.2-second scale-harness restore table above.

Final local logs: `.m91-vitest-final.log`, `.m91-typecheck-final.log`,
`.m91-lint-final.log`, `.m91-electron-final.log`, `.m91-verification-final.log`,
`.m91-gc-audit.log`, `.m91-build-final.log` and `.m91-packaged-final.log`.
Extracted-executable details are in `.packaging-diagnostics/packaged-smoke.json`.
Existing M8.2 captures and prior packaged reports were copied under
`.packaging-diagnostics/m91/prior-verification/` before those runners refreshed
their outputs. Baseline, intermediate/failure and final M9.1 raw reports remain
available; use `node scripts/summarize-m91.cjs baseline-control current stress-final`
for the selected comparison. Inspector/failure artifacts now include the run label
so another diagnostic label does not overwrite an earlier profile.

The current Windows clipboard contains formats Electron cannot safely snapshot;
affected native Copy/Ctrl+C/link-copy checks are **UNVERIFIED**, and those writes
were skipped. Other selection/menu/keyboard/seen assertions ran. Optional live
helper smoke was not configured. No production profile, Setup, installed-app
modification, commit, push, release or M9.2 work was performed.

## Remaining scale concerns

Full-profile startup/recovery still scales with total stored data **in every
renderer**, including unopened items. Mutation replies still contain full comment
arrays even when M2 uses compact notifications; large seen changes/Refresh also
request item snapshots. Main-owned SQLite/normalization/validation remains
synchronous and stalls are material at this scale. Payload pruning does not solve
those architectural limits. Avoid claiming that four large windows are uniformly
responsive on all operations or that virtualized DOM bounds bound total memory.

The practical verified workload is this 60k stored profile in two/four native
readers, 24/48 generated placements and 4/8 visited independent large views, on
the workstation above. Usable startup and selective filtering improved or stayed
short in these samples; bulk/Refresh/restore still take seconds and block main
for material intervals. Twelve generated tabs per window exercises an overflowing
strip; hundreds of tabs or dozens of simultaneously evaluated 50k sessions are
not verified here. No maximum supported window/comment count or low-memory
hardware budget follows from this pass.

Possible follow-ups require measured, separately reviewed choices: summary-only
mutation acknowledgments with the existing reconciler, scoped initial hydration,
then evaluation of main-owned scheduling/worker placement if blocking work still
dominates. Compare complete-tree semantics, gap recovery, handoff validation and
all-participant deadlines for each. Pagination, indexes, database worker and new
persistence architecture are not silently selected here. M9.2 README/release
documentation and screenshots remain reserved for owner review.
