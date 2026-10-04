# ADR 0010: Variable-height discussion virtualization

Date: 2026-10-04. Status: accepted for the bounded renderer milestone.

## Context and measurements

ADR 0009 removed unrelated cross-tab React work. The remaining active reader
still built every recursive comment element. Offline generated flat, shallow and
mixed discussions measured in a real Electron/Chromium reader at 1280×900:

| Before virtualization | 1k | 10k |
| --- | --- | --- |
| Identity/tree preparation | 0.8–2.7 ms | 8.5–15.7 ms |
| Render through two frame observations | 201–323 ms | 2168–3028 ms |
| Mounted comments / all DOM elements | 1000 / 15.6k–17.3k | 10000 / 155k–173k |
| Single seen toggle | 118–126 ms | 1074–1239 ms |
| Far last-row selection | 106–129 ms | 1030–1240 ms |
| Apply selective query and replace result | 32–40 ms | 292–351 ms |
| Hide/show already mounted panel (four frames) | 96–113 ms | 796–960 ms |

The harness uses the actual DiscussionPanel, query worker and stylesheet, with
generated application data and pure acknowledged seen updates. It does not time
SQLite, bootstrap IPC, StrictMode double rendering or source extraction. Hide/show
isolates browser visibility/layout, not complete workspace activation IPC. These
are local observations, not latency guarantees or CI hardware thresholds. A 50k
recursive baseline was not run. The bottleneck at 10k was DOM/React work, so no
storage/query redesign is justified by this evidence.

## Decision and alternatives

Use renderer-only **@tanstack/react-virtual 3.14.13**, pinned exactly; its single
core dependency is **@tanstack/virtual-core 3.17.11** in the lockfile. Both are MIT,
compatible with this MIT application; their installed license notices remain in
the dependency distribution. React 18 is a supported peer. The
[official virtualizer API](https://tanstack.com/virtual/latest/docs/api/virtualizer)
describes dynamic measurement, keyed items, overscan, scroll margins and index
scrolling. Installed source was also inspected for measurement compensation and
programmatic scroll reconciliation. No state-management or general UI framework
is introduced. Main, persistence, preload and query worker do not import it.

An internal virtualizer would need variable-height caches, range lookup, resize
observation, scroll anchoring and repeated index-scroll correction. That is more
correctness surface than this small headless adapter/core. Fixed-height or simple
react-window sizing would require an additional measurement system for multiline
bodies. Keeping the recursive DOM cannot bound mounted work.

### Flat presentation and neutral structure

`projectReaderRows(comments, appliedResult)` is a pure renderer projection. It
uses frozen applied preorder/parents, joins live comments by application ID, and
produces rows plus an ID→index map. Rows carry exact depth, display parent/root,
first/last sibling, children, applied normal/match/context role and raw-hit status.
Comment references carry live seen; selection is joined from session identity
only for mounted articles. It never rewrites Comment, source relationships,
directParentId or DiscussionViewResult. A linked immutable ancestor path shared
by children avoids O(N×depth) copied arrays. Projection remains O(N).

React creates only flat measured `<li>` rows containing labeled articles. Neutral
rails use ancestor sibling continuation, immediate parent elbows/last-child
termination and outgoing child gutters. Compact levels retain the original
22/10/3px reply increments and return connectors. Indentation is capped at 340px
for pathological chains; exact data depth is retained, and coincident structural
rails are coalesced. No mounted ancestor is required. Rails never encode seen.

### Measurement, bounds and focus

The existing `.reader-panel` owns one coherent scrollbar, including the content
header/query controls outside the measured list. ResizeObserver derives the list
scroll margin as these controls/description reflow. Estimated heights depend on
body line breaks, text length, available width and compact indentation. Actual
border-box heights replace estimates through the virtualizer's keyed measurement
cache/ResizeObserver. Row gap is inside the measured box. Native overflow anchoring
is disabled for the list so it cannot double-compensate library adjustments.

Normal measurements compensate changes above the viewport using the library's
anchoring logic. Width changes clear obsolete measurements/estimates and restore
the visible data identity plus intra-row offset over measured frames. Locale
changes similarly invalidate measurements and retain that anchor. Hidden panels
keep their positive viewport and cached heights; display:none's zero sizes never
replace useful measurements. Fixed 32px avatars/fallbacks retain identical space.
Offscreen heights remain estimates/cached observations until measured on mounting.
Scrollbar extent can refine during reading; no exact precomputed total is claimed.

Overscan defaults to six rows on each side and is a component parameter. Large
discussions mount viewport + overscan, with at most one extra focused row retained
for keyboard safety. Selection alone does not pin a row. Small results up to a
constant 200-row ceiling retain their complete accessible surface, including the
existing 154-comment video. This does not grow with a large discussion's size.
Articles keep stable application-owned IDs, byline/time/seen labels and selection
outlines. List-item posinset/setsize use the exact complete presentation index/count.
No hidden duplicate tree is mounted. Explicit Apply removing the focused row
returns focus to its reader. A periodic relative-time clock remains open; incidental
seen saves no longer replace every mounted article's time reference.

### Navigation and session scrolling

Match/unseen candidates and wrapping still resolve in complete application data.
Navigation selects the ID and increments a session scroll request, including for
repeated selection of the same ID. The reader resolves its presentation index and
asks the virtualizer to scroll there with automatic, measurement-aware correction.
Once mounted, exact-ID reveal/focus completes the request. DOM never discovers
candidates. Selection survives unmount/remount and never writes seen.

Successful explicit Apply scrolls to the first active match in a restrictive
result, or discussion start for unrestricted/zero-match results. It does not
automatically change selection or take focus from query controls. Failed/late
queries do not issue new scroll requests. Successful Refresh preserves draft and
captures the current visible data identity at worker completion; it restores that
identity/offset if retained, otherwise retained selection, otherwise start. A reader
still in the header preserves its panel offset. Mounted tabs retain browser scroll
naturally across switches. No scroll/selection/query state is persisted on restart.

Seen targets remain main-owned domain operations. Ctrl+click covers all stored
descendants, including unmounted context, and is transactional. Acknowledgment
reuses unchanged renderer Comment references; memoized articles only update when
visual props change. Seen edits never replace applied membership/roles/counts.

## After observations and validation

Final local profiling (same three shapes, development React, no StrictMode):

| After virtualization | 1k | 10k | 50k |
| --- | --- | --- | --- |
| Identity view / flat projection | 0.6–3.2 / 0.3–0.8 ms | 3.6–7.1 / 2.2–4.0 ms | 22.7–25.8 / 11.3–18.6 ms |
| Render through two frames | 29–172 ms (cold first sample) | 16–21 ms | 63–69 ms |
| Initial / scrolled mounted rows | 10 / 19 | 10 / 19 | 10 / 19 |
| Initial / scrolled DOM elements | 210–246 / 349–419 | 212–246 / 348–416 | 212–248 / 351–422 |
| Seen acknowledgment through two frames | 32–50 ms | 29–33 ms | 28–48 ms |
| Far last-row navigation | 32–33 ms | 32–33 ms | 27–32 ms |
| Selective Apply through two frames | 32–34 ms | 48–51 ms | 150–167 ms |
| Refresh reapplication through two frames | 33 ms | 49–50 ms | 133–150 ms |
| Already mounted hide/show, four frames | 66 ms | 66 ms | 52–66 ms |

These timings include the frame observation floor; they are not raw CPU durations.
Render timing includes the panel's own projection/count work, measured separately
above rather than subtracted. An additional 10k discussion with chains up to depth
60 mounted 11 initial rows and 13 near its last target, with successful exact reveal.
Scrolling/far targets settled within the observations; no owner physical-input
acceptance is implied. Memory readings from performance.memory were too coarsely
bucketed to support a budget. Final CDP used-heap samples without forced GC were
4–10 MB across the 1k cases, 24–36 MB at 10k and 78–213 MB across successive 50k
cases. Sequential allocations/uncollected prior datasets affect these samples;
they are not steady-state memory budgets or proof of bounded application memory.
The real locale-reflow check also asserts contiguous measured rows after changing
language, including boxes that emit no new resize entry after cache invalidation.

`node scripts/profile-discussions.cjs --50k --real` generates data rather than
committing huge fixtures, builds a separate ignored harness, blocks remote images,
and runs Chromium in an owned disposable OS-temp profile. `--real` copies the
existing development SQLite database using a read-only source/consistent backup,
never opening the original for writes. The stored 154-comment video retained all
154 mounted articles, normal single-comment seen changes and real worker search/
exact reveal; sanitized light/dark screenshots were inspected. No live YouTube
or public archive is required/committed. This harness is excluded from product
entry points and adds no privileged renderer API.

Deterministic tests run the actual virtualizer with controlled geometry, not timing
thresholds: preorder/shared ancestry/depth/siblings, frozen placement and source
truth, full context/counts, bounded 10k mounts/replacement/overscan, measured sizes
and width reflow, ordinary/Ctrl seen over unmounted descendants, stable applied
Unseen results, wrap/far reveal, focus and selected remount, Apply/Refresh scrolling,
and ADR 0009 isolation with a large hidden discussion. Existing temporary SQLite
and built-entry restart tests protect durability. See [Testing](../TESTING.md) for
final verification and bundling results.

## Remaining Q-21 limits

Virtualization bounds React/DOM construction and layout for a single large reader.
It does not bound full-discussion bootstrap, renderer/library memory, structured
cloning, O(N) worker evaluation/projection/navigation/seen reconciliation, or
SQLite ingestion/queries. Several mounted discussions retain their own data/caches.
50k projection is already observable, and those costs need larger-library budgets,
index/evaluator/worker placement and future paging evidence. This does not prove
pagination unnecessary forever, or solve SQLite FTS/global search. The ruler,
date/discovery filters, sorting, collapse, bulk/undo, persistent view restoration
and release/helper work remain outside this milestone.
