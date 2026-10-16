# ADR 0023 — Persistent thread collapse and virtual navigation

Date: 2026-10-16. Status: accepted. Resolves expansion persistence in Q-10,
collapsed reveal in Q-11 and collapsed geometry in Q-12. Schema 10.

## Decision and scope

Every discussion starts fully expanded. A compact native button on comments with
applied display descendants toggles the reply subtree; the comment itself remains
visible. The chevron and localized Show/Hide replies count describe **all descendant
comments in the complete applied display tree**, excluding the comment itself,
including descendants behind nested collapsed replies. Leaves have no toggle.
The accessible Expand replies / Collapse replies name, tooltip, aria-expanded,
native Enter/Space activation and existing focus indication accompany the count.
Only the button collapses: comment text retains native selection and all existing
avatar, checkbox, creator, author/timestamp/translation and badge behavior.

Expand all and Collapse all are compact labeled outline-icon toolbar buttons for
the current discussion. Expand all resets the default to expanded; Collapse all
sets it to collapsed. Both clear every exception, including filtered-out IDs.
Opening one branch in Collapse All mode reveals direct replies; any individually
collapsed children remain collapsed until reopened. No confirmation is necessary.

This is presentation only. No source identity, text, relationship evidence,
observations, seen/revisions/Undo, NEW, query criteria, applied match membership or
bulk targets change. No multi-selection, menus or additional bulk scope is added.

## Durable representation and boundary

The additive transactional 9→10 migration creates strict tables:

- `discussion_collapse(item_id PRIMARY KEY, default_collapsed)` with an item
  foreign key and boolean check. Absent row means expanded.
- `comment_collapse_overrides(item_id, comment_id)` with a composite primary key,
  cascading parent default and same-item comment foreign keys. Presence means the
  opposite of that discussion's default; there is no redundant per-comment boolean.

All stores one default and deletes exceptions, never enumerating comments. An
individual assignment inserts/removes an exception. Preferences contain no ID array.
Main validates exact `setDiscussionCollapse` commands: item ID, All or comments,
boolean assignment, and for comments 1–100,000 unique bounded application IDs.
All identities must belong to the item before any transactional write. Existing
sender/window/top-frame/document checks apply. No SQL, paths or generic writes cross
preload. The array limit permits one navigation ancestor assignment even for a
50k-deep chain. A missing discussion rejects rather than recreating content.

Bootstrap reads collapse independently of view intent. Invalid defaults fall back
to expanded for that discussion; orphan/unowned overrides are ignored. Subsequent
valid writes repair an invalid default and discard its dependent exceptions. Content
and unrelated presentation state remain readable. Backup validation stays strict:
integrity/foreign keys/constraints must pass, and modified schemas reject.

Renderer sessions hydrate once and retain state across tab switches and close/reopen;
later main acknowledgments do not replace live intent. Optimistic presentation sends
idempotent assignments promptly through a FIFO writer. Failed commands stay queued,
show localized Retry, and retry on the next edit/flush without a retry loop. Close,
workspace changes and backup/restore flush include this queue; failed saves abort
snapshot flow. Library removal cancels follow-ups and cascades both tables.

All authoritative tables are included by the existing SQLite online snapshot. Exact
known-schema validation recognizes 1–10; 1–9 upgrade on a staged restore copy only.
Startup verifies a pre-migration safety snapshot before changing an older profile.
Rollback, immutable recovery phases, source immutability and profile identities stay
as in ADR 0019. No installer is executed for verification.

## Complete and displayed presentation

`DiscussionViewResult` remains immutable. The existing `ReaderPresentation` is the
complete applied, sorted containing-tree preorder, including context, raw-only hits
and hidden matches. It remains the source of match X/N and navigation order.

`CollapsedPresentation` is an independent linear projection: visible rows/indexes,
effective collapsed IDs, a representative ID for every complete row, and descendant
counts. A forward preorder pass maps hidden comments to the closest **visible**
collapsed ancestor hiding them. A reverse pass accumulates total descendants, live
unseen and frozen applied matches into parents. Both passes are iterative O(N), with
O(N) maps and shared existing ancestry. They consume only safe frozen display parents;
unresolved/cyclic fallback roots remain roots and Community containment never becomes
direct reply evidence. Source IDs are never used to reconstruct another hierarchy.

Only visible rows enter TanStack Virtual, its measurements and range count. Existing
six-row overscan, one retained focused row and the constant 200-row small-discussion
ceiling remain. A hidden focused row is released to the reader; hidden logical
selection is retained. No invisible descendant DOM or measurements are required.
Complete query/bootstrap/clone costs remain Q-21; no paging or FTS change is implied.

## Navigation, anchor and refresh

F3/Shift+F3 resolve the next/previous complete applied match in sorted preorder,
wrapping as before. Unseen navigation uses live seen across the same complete applied
trees, including context. Ruler activation also resolves a real application ID.
One iterative parent walk finds only that target's collapsed safe display ancestors,
assigns them expanded, persists, projects the visible subset and resolves its new
virtual index. Existing mount/exact-ID scroll/focus follows. The target's own reply
preference and unrelated branches remain untouched. No navigation writes seen.

Manual collapse/expand captures the stable row ID plus row-relative offset before
projection. A still-visible anchor retains its offset; a hidden anchor maps to its
closest visible hiding ancestor at offset zero; missing IDs fall back to the beginning.
Variable-height restoration clamps old offsets and reconciles measurements. Restart,
close/reopen, Apply/Refresh and sort scroll requests use the same visible representative
mapping. A saved hidden selection never forces expansion or nonexistent DOM focus.
Explicit navigation later reveals it. Near the scroll extent, the browser's normal
maximum scroll position can limit exact offset preservation.

All five whole-conversation sorts retain collapse identities and original reply order;
keys never depend on collapse. Apply and successful Refresh retain the entire sparse
preference, including IDs outside current results. Explicit Apply anchors a hidden first
match to its visible ancestor; only explicit navigation opens that branch. Refresh
retains current anchor context and reevaluates existing applied criteria as before.
New descendants follow the default unless hidden by a collapsed ancestor. Missing
observations never delete stored comments or collapse preferences.

## Summaries and ruler policy

A collapsed button includes its total descendant count, optional live unread count
and optional frozen applied-match count, in one compact text summary. These are
derived from complete applied trees; there are no persistent summary counters.
Seen-stale applied Unseen matches continue contributing to matches after marking,
while the unread count updates immediately. NEW remains independently durable.

Each unseen/match/NEW marker retains its original target ID and category membership.
Its geometry index is the visible representative's index: hidden descendants share
the visible collapsed ancestor's measured/estimated row center. This compresses the
ruler to actual scroll geometry rather than retaining expanded positions. Excluded
trees have no markers. Restrictive applied matches alone enter MATCH; raw-only
SEARCH HIT context never does. Live unseen/context and durable NEW remain independent.

Marker data distinguish the ancestor's own membership from hidden membership.
Each band's localized tooltip reports category totals and hidden reply counts;
own membership equals total minus hidden. Three overlapping 6px lanes and 3px
bands still use exactly three compound SVG paths plus one keyboard stop. Prefix
counts and next-hidden indexes are built once per category projection; geometry
updates use binary band searches without rebuilding hidden target arrays.

Pointer activation chooses the nearest represented row center; ties keep preorder.
At a shared center, prefer the first hidden member of that category so the marker
can reveal an actual hidden target even when the ancestor also belongs to that lane.
Keyboard arrows/Home/End choose band/lane and Enter/Space uses the same policy at
band center. Activation expands only the chosen target's ancestors and recomputes
geometry. This is deterministic representative selection, not one DOM marker or
keyboard stop per hidden comment; F3/unseen navigation can traverse every candidate.

## Verification and remaining scope

Deterministic projection/session tests cover defaults, nested/deep safe trees,
Community containment, all sorts, complete frozen membership, hidden navigation,
live summaries, sparse representation, FIFO failure/retry and no seen side effects.
SQLite tests cover ownership, corruption isolation/repair, additive preserving
migration/failure/safety, close/restart/removal and stored subtree/matching Undo.
Backup roundtrip and crash checks include both new tables. Actual TanStack tests,
offline Chromium measurements and built-entry native keyboard/restart checks cover
10k/50k virtualization, ruler bounds and hidden selection/anchor restoration.
Results and exact remaining verification limits are recorded in [TESTING](../TESTING.md).

Optional tab badge details (Q-10), later platform shortcuts (Q-11), richer formatting/
avatar caching (Q-12), full-bootstrap scaling (Q-21) and release/helper distribution
remain separate. No new marking scope, collapse-related bulk preference or automatic
translation is introduced.
