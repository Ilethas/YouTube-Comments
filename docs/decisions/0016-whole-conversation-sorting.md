# ADR 0016: Whole-conversation sorting

Date: 2026-10-14. Status: accepted. Resolves Q-08; persistence remains Q-10.

The session-only/restart-default state described below is the historical ADR 0016
milestone. [ADR 0017](0017-persistent-discussion-view-restoration.md) now persists
and restores its five-mode preference after fresh query reconstruction, resolving
Q-10 for current uncollapsed reader concepts. The sorting rules remain unchanged.

## Decision

Sorting moves complete **display-root conversation trees**, including every
stored descendant in the applied containing-tree result. Replies keep their
existing preorder. Unresolved/cyclic safe roots are ordinary sortable roots;
sorting never reconstructs or reinterprets source relationship evidence.

| Mode | Key and direction |
| --- | --- |
| Original order (default) | Existing stable stored/display root order and complete tree preorder. This need not reproduce YouTube's ranking after later Refreshes. |
| Newest first | Display root's own usable publication instant, descending. |
| Oldest first | Display root's own usable publication instant, ascending. |
| Most liked | Display root's own trustworthy projected `Comment.likeCount`, descending. Zero is known; missing is unknown. |
| Latest activity | Newest usable publication instant anywhere in the complete displayed tree, descending. |

Unknown keys always follow known keys in both directions. Every equal/unknown
tie uses Original order. Publication uses ADR 0012's `ownPublicationInstant`:
estimated/coarse usable instants participate; calendar/relative labels do not.
No discovery, observation, item time or Refresh clock is substituted. Likes come
only from the adapter-authorized reader projection, never raw evidence or
descendant aggregation. Community authority remains unchanged. Most liked
availability uses all safe display roots in the stored discussion, independently
of applied filters. Empty or all-unknown filtered results do not disable it when
another conversation has known root likes. If every stored root has unknown likes
(including an empty discussion), Most liked is disabled with localized accessible
explanation. A retained Most liked mode becomes effectively Original until known
root likes are available again; its selected preference is kept.

## Presentation pipeline and complexity

Stored comments -> applied query/filter result -> complete containing trees ->
sorted display-root trees -> flat preorder/ReaderRows -> virtualizer -> navigation
and overview ruler.

`DiscussionViewResult.visibleCommentIds` and frozen parents retain the query's
Original preorder. Pure `sortDiscussionTrees` builds one record/span per displayed
root in one pass, then compares scalar keys and Original indexes. It never walks
a subtree in a comparator: O(N + T log T) sorting work for N displayed comments
and T trees. The existing live-comment ID join still indexes supplied comments.
`projectReaderRows` produces sorted IDs, ordered applied matches, root/depth,
first/last sibling and linked ancestry metadata without changing Comment or query
results. Session caching shares this projection across controls, navigation and
reader; the ruler consumes those same rows and measured/estimated indexes. Live
content joins reuse accepted order while the applied result and mode are unchanged.
Discussion-wide availability is computed during the existing comment-ID join and
cached with the presentation, without a separate forest projection or render-time
scan. It follows current stored roots even while order is frozen or transferred.
Thus committed Refresh metadata cannot move a tree before anchor
capture at evaluation completion. Successful promotion or explicit sort change
computes fresh keys; seen-only joins do not sort again.

Virtualization retains viewport plus overscan and at most one focused row, with
the existing constant small-result ceiling. No recursive mounting, DOM target
discovery or storage/bootstrap redesign is introduced.

## State and interaction

Sort is immediate presentation state, independent per discussion and session-only.
It has no Apply button, worker evaluation, criteria promotion, staleness, seen or
NEW mutation. Close/reopen in one Reader lifetime retains it; Library removal
clears it. Restart defaults to Original. No SQLite/IPC/schema changes are needed.

Before changing mode the reader captures its current virtual anchor application
ID and row-relative offset. The same ID resolves through the reordered index and
measured scroll correction; absent/invalid anchor means discussion start. Selected
identity remains unchanged. Sorting does not jump to the first match or save seen.
Capture reads the known list element's current origin to account for header/status
reflow before ResizeObserver delivers its cached margin, without scanning rows.

Match/F3/Shift+F3 and live-unseen navigation follow sorted displayed preorder,
including nearest eligible resolution from context and existing wrapping. X/N uses
sorted applied matches. Membership/counts and current-matching bulk targets remain
the frozen `activeMatchIds`. Ruler category identities remain applied match, live
unseen and durable NEW; only geometry/target order changes.

Apply retains mode and sorts the newly selected complete trees; restrictive Apply
reveals the first sorted match. Successful Refresh retains mode, reevaluates last
applied criteria and recomputes keys from committed metadata, preserving existing
Refresh anchor behavior. New replies can change Latest activity; root time/likes
can change the other ranks. Failed acquisition preserves content/order/mode. Query
reevaluation errors retain frozen membership/placement/order. Seen or NEW changes alone
cannot reorder trees; draft edits cannot change displayed membership/order.

## Verification and remaining scope

Deterministic tests cover all keys, unknowns/ties, complete filtered trees, deep
chains, broad trees, Community containment/like authority and safe fallback roots;
session lifecycle, Apply/Refresh, navigation/position, frozen bulk targets, ruler,
and identity/offset retention with bounded 10k/50k mounting. Property-read counts
verify linear key preparation without wall-clock CI budgets. The offline Chromium
harness exercises actual select changes and layout in disposable data. Current
results and limitations are recorded in [Testing](../TESTING.md).

Q-10 still owns persistent sort/filter/scroll/selection restoration. Collapse,
reply-level sorting, YouTube Top ranking, library/global search, acquisition
progress/cancellation/optimization, backup/export and release/Forge finalization
are outside this milestone. Q-21's full-bootstrap/memory/query limits remain.
