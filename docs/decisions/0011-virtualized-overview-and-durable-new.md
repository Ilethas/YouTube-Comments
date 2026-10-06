# ADR 0011: Virtualized overview ruler and durable NEW discoveries

Date: 2026-10-06. Status: accepted for this bounded milestone.

## Durable NEW rule

NEW means first discovered in the discussion's latest accepted post-baseline
acquisition/refresh. The baseline is always excluded. Existing observations are
never NEW solely because their text or publication metadata changes. Publication
age and manual seen state are independent: an old published reply can be NEW,
and a seen NEW comment remains NEW. Each subsequent accepted attempt replaces
the cohort, including zero-insert and collection-unavailable attempts. Accepted
unknown/partial coverage counts; failed attempts and rolled-back writes do not
advance it. Reacquiring a known source uses the same rule. Restart and closing a
tab do not clear NEW. There is no manual dismissal state.

Main projects `ContentItem.latestAcceptedDiscoveryId`; the pure domain predicate
`isNewDiscovery(item, comment)` compares that identity with the baseline and the
comment's existing first-discovery identity. No per-comment flag or stored renderer
cohort is added. Fixed v3/p3 examples are isolated to the two original demo items.

Schema **5** adds `extraction_attempts.attempt_order`. Migration freezes existing
insertion order from rowid before any further writes. A transaction-local insertion
trigger assigns the next ordinal to every new attempt, including failures and
synthetic initialization. The latest accepted attempt for an item is the greatest
ordinal with `outcome='accepted'`, rather than maximum timestamp or UUID sorting.
Tied and regressing clocks therefore cannot reverse acceptance order. A narrow
item/outcome/order index serves this projection. This additive migration preserves
all IDs, discovery facts, metadata, manual state, history and workspace records.
Rollback/retry and VACUUM tests protect the order. SQLite documents that implicit
[rowids can change during VACUUM](https://www.sqlite.org/rowidtable.html), so using
rowid indefinitely as production chronology was rejected. Attempt retention or
future export/import must preserve these ordinals or an equivalent explicit order.

## Applied-view projection

`projectRulerMarkers` takes complete virtual presentation rows, the last applied
`DiscussionViewResult`, and durable NEW identities. Markers contain application
comment ID, presentation index and an immutable category list. Only displayed
applied membership is considered, including context. Unseen uses live acknowledged
manual state; match uses applied active-match IDs only when `restrictive` is true;
NEW uses discovery eligibility. Unrestricted identity candidates create no match
markers. Raw-only SEARCH HIT context never acquires a match marker. Multiple
categories on one comment are retained. DOM mounting supplies none of these facts.

Saving seen updates unseen immediately but freezes applied match membership until
Apply or accepted Refresh reevaluation. NEW remains independent. Apply changes
displayed scope, not discovery identity. Accepted Refresh commits first, advances
the cohort, and reevaluates applied criteria while retaining draft (ADR 0008).
Source failure changes neither stored data/cohort nor applied view; worker failure
retains the previous view over the newly acknowledged data as already specified.

## Geometry and aggregation

Use row centers from TanStack Virtual's complete estimated/measured geometry.
Their starts already include the measured header/query scroll margin. Normalize
against margin + virtual total + column bottom/footer, or viewport extent for a
short discussion. The fixed 18px ruler spans the panel viewport just inside its
native scrollbar. ResizeObserver follows panel/column/list reflow; width/locale
invalidation and keyed measured heights continue to follow ADR 0010. Hidden
panels preserve geometry and hide their portal with their panel. No comment-wide
physical DOM queries occur.

Index-ratio mapping was considered: it would avoid refinement from measuring
offscreen rows, but would represent a long multiline row as the same scroll
distance as a short row and diverge from the actual scrollbar. Height geometry
shares the virtualizer's cache/width-aware estimates rather than a second model;
marker positions can refine during first measurement. Existing anchor correction
limits reading shifts; no exact unmeasured height or zero-jump guarantee is claimed.

Aggregate into **3px bands**, at most `ceil(rulerHeight / 3)` occupied buckets.
Each retains zero-copy ranges into shared category preorder plus the virtual
geometry needed to resolve targets;
counts are distinct contributions within that category. Three separate 6px lanes
(unseen, match, NEW left to right) preserve overlap. One SVG with three compound
paths paints all bands. This is constant marker DOM, including at 50k, rather than
one node per comment or thousands of hidden accessibility nodes. Theme semantic
tokens, English/Polish tooltip counts and reader badges/checkboxes provide evidence
beyond category color. Category indexing is O(N) when membership/seen/NEW changes.
Geometry refinement uses binary searches at pixel-band boundaries, O(B log N),
and retains shared spans instead of recreating one coordinate/target object per
comment on each remeasurement. Initial profiling showed additional 50k scroll
work with that full-object rebuild, motivating this bounded refinement. Shared
marker/category references still take O(N) memory; this does not resolve Q-21.

## Navigation and accessibility

Pointer horizontal lane chooses category. Within its clicked band, the closest
row center wins; equal distance chooses the earlier virtual preorder index. The
target is an application ID passed to `session.select`, then ADR 0010 resolves
index, scrolls through mount/measurement and focuses that exact article. The ruler
never saves seen. It does not use a parallel DOM-search reveal path.

The ruler has one labeled keyboard stop. Up/Down traverse occupied bands,
Home/End choose endpoints, Left/Right choose a lane, and Enter/Space activate its
nearest target at band center. Empty lanes do nothing. Localized accessible help
and focused-band category/count text explain this interaction. Hover/focus shows
compact counts, never full comment content. Existing F3/Shift+F3, unseen buttons,
Ctrl+click subtree behavior and tab rendering isolation remain unchanged.

## Evidence and remaining work

Deterministic tests cover cohort replacement/failure/partial/unknown/old publication,
seen independence, tied/regressing clocks, migration rollback/retry, VACUUM,
close/reopen/restart; applied/raw/context/hidden/overlap projection; measured and
estimated height/resize mapping; crowded target ties/counts; 10k/50k bounded DOM
and distant pointer/keyboard reveal; saved unseen versus frozen match and NEW;
accepted Refresh and Apply. Built-entry smoke checks exercise NEW badges and the
ruler across actual process restarts in disposable SQLite.

Current executed checks and generated/real Chromium observations are recorded in
[Testing](../TESTING.md). Timings are observations, never arbitrary CI budgets.
No physical-input owner signoff or live discovery is implied by offline ingestion.

Q-05 is reduced to any future discovery-filter window UI. Q-12 is reduced to
future collapse/sort mapping and richer formatting/link/avatar-cache choices.
Q-21 remains open for full bootstrap/clone/library memory, O(N) worker/projection,
SQLite evaluation/paging and hardware budgets. Dates, sorting, collapse, bulk
recoverability/undo, persisted filters/scroll, global search/FTS, helper distribution,
backup/export and installer/release work remain outside this milestone.
