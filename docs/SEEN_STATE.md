# Seen state

Seen/unseen is a durable, manual property of each individual comment. It is the reader's record of processing a contribution, not evidence that the application displayed it. Ordinary and Ctrl+click behavior now persists in main-owned SQLite through the typed bridge. The service reads the current target state, resolves the pure domain action, and commits all subtree changes in one transaction. The UI waits for acknowledgment and reports failure while retaining its last acknowledged state. Viewing, scrolling, tabs, language, and appearance do not mark comments seen. Reopen and late-write rollback tests cover these invariants. Refresh preserves seen state; filtered-view integration and bulk operations remain unimplemented. See [ADR 0002](decisions/0002-sqlite-and-typed-reader-boundary.md), [product requirements](PRODUCT_REQUIREMENTS.md), and the [domain model](DOMAIN_MODEL.md).

[ADR 0007](decisions/0007-unified-workspace-and-library-removal.md) uses neutral
ancestry rails/elbows for structure in both seen states. Unseen rows have a subtle
accent-tinted background plus a text UNSEEN badge and explicit checkbox, never a
structural line color. Reading, reordering and app-tab navigation do not mark seen.
Confirmed removal deletes the item's local state with its comments/history; closing
a view preserves it. The projected subtree and Ctrl+click rule are unchanged.

## Invariants

1. Each stored comment has its own seen state. There is no persistent thread-level seen state.
2. Merely opening a discussion, scrolling, displaying a comment, searching, navigating, expanding replies or visiting an overview marker must never mark a comment seen.
3. An ordinary checkbox click changes only that comment.
4. Ctrl+click on a checkbox computes the opposite of that clicked comment's current state and applies that same resulting state to the comment and all its known descendants. It does not invert every descendant separately.
5. Refresh preserves the seen state of every existing comment and inserts newly discovered comments unseen.
6. User state changes are persisted immediately without moving or removing comments from the current view or changing its applied matching set. Apply changes / Update view and a successful explicit remote Refresh recompute the active view; Apply does not save pending seen changes or invoke extraction.
7. Filter-based bulk actions use the last applied active-filter matching IDs in the active discussion, never raw search matches alone or comments included only for context.

Derived tab/thread unseen counts are allowed. They are queries over comment state, not independent state that can disagree with its constituent comments.

## Checkbox behavior

| Action | Affected comments | Result |
| --- | --- | --- |
| Click checkbox | Clicked comment only | Toggle its current state |
| Ctrl+click checkbox | Clicked comment plus stored descendants | Assign the inverse of the clicked comment's current state to every target |
| Read, scroll or navigate | None | No seen-state write |

For a mixed subtree, Ctrl+click on an unseen parent marks both seen and unseen descendants seen. Ctrl+click on a seen parent marks all descendants unseen. Ancestors, siblings and unrelated threads are untouched. The descendant set is structural; collapsed or currently unmounted descendants still belong to the operation.

This explicit subtree gesture can affect context-only comments and descendants outside the current filter's actual matches. It is different from “mark matching comments,” whose scope is the matching set. The UI must make those action scopes understandable. A reply discovered by a future refresh is unseen by default; a previous subtree operation is not a continuing rule for future descendants.

The service should resolve the target set from application data and apply a multi-comment change transactionally. A Ctrl+click must not leave only half of a subtree changed after a persistence failure. Exact ordering with concurrent refresh or other state commands must be designed before those operations run concurrently; no ordering may reset existing local state. See [database transactions](DATABASE.md).

## Stable filtered views

Seen edits can make comments stop satisfying an Unseen-only filter. Removing them immediately would shift the page while the user is reading. Required behavior separates durable state from displayed result membership and order.

```mermaid
sequenceDiagram
    participant User
    participant View as Displayed evaluated view
    participant API as Main-process state service
    participant DB as SQLite
    User->>View: Mark a matching comment seen
    View->>API: Set comment state
    API->>DB: Commit state change
    DB-->>API: Success
    API-->>View: Current persisted state
    View-->>User: Checkbox updated; membership retained
    User->>View: Apply changes / Update view
    View->>API: Evaluate active filters over stored data
    API->>DB: Read current data and state
    DB-->>API: Current dataset
    API-->>View: New matching and contextual sets
    View-->>User: Display recomputed results
```

This sequence illustrates required effects, not a settled choice between optimistic and acknowledged UI updates. The implementation must clearly surface a write failure and reconcile the checkbox with stored state; it must not falsely report that a failed change is saved.

Required behavior between evaluation and Apply or a successful explicit remote Refresh:

- The checkbox reflects current persisted state.
- Visible comment/thread membership, ordering and the applied active-filter matching set stay stable in response to seen edits.
- Bulk operations use the last applied active-filter matching IDs, excluding raw search matches outside that set and comments included merely for context.

A newly checked comment remains an applied active-filter match even though it would fail a freshly evaluated Unseen-only filter. This matching set determines matching-only bulk targets until the next application of the view. Exact styling and supplementary live indicators remain design choices; they must distinguish live seen state from the applied result and must not silently redefine the action's scope.

The interface needs to communicate that changes are saved and a view update is available. It should not describe this as unsaved edits. ADR 0008 implements Ctrl+Enter for Apply, explicit draft controls, saved-seen indication only for applied Seen/Unseen, and stable MATCH/CONTEXT roles/counts. Unseen navigation uses live state within displayed trees; match navigation remains applied IDs. Remote Refresh is a separate button-only operation, with Ctrl+R/F5 source Refresh deliberately unbound: after a successful explicit refresh merges remote data, it automatically recomputes the active view. See [filtering and search](FILTERING_AND_SEARCH.md) and [UI and navigation](UI_AND_NAVIGATION.md).

Counts must have clear scope and distinguish applied matching comments from containing threads. Any supplementary live unseen-count badge derives from current stored state and must be distinguishable from the applied result's counts. The exact badge presentation and behavior after restart remain design decisions; none permits automatic membership removal, reordering or replacement of the applied bulk target set during seen edits.

## Bulk operations

Support explicitly setting seen or unseen for:

| Operation | Target rule |
| --- | --- |
| All comments | All stored comments in the active discussion by default |
| Before a timestamp | Comments in the active discussion whose own publication times satisfy the boundary rule |
| After a timestamp | Comments in the active discussion whose own publication times satisfy the boundary rule |
| Between two timestamps | Comments in the active discussion whose own publication times satisfy the range rule |
| Current matching filter set | Last applied active-filter matching IDs in the active discussion |

Date operations never implicitly modify an ancestor or descendant because a related comment matches. A subtree operation and a publication-date operation are different commands, even when invoked from the same discussion.

The application must make the active-discussion scope clear before execution. Initial bulk actions do not imply application-wide changes. When seen edits make the displayed evaluation stale, “current matching filter set” still means the last applied active-filter matching IDs; the action does not first recompute from current persisted state. A raw search match satisfies only the search predicate and may fail another active filter, while a contextual comment is present only to complete a conversation. Neither is a matching-only bulk target unless it belongs to the applied active-filter matching set. Timestamp inclusivity, timezone interpretation, and handling absent/imprecise publication timestamps remain open; see [filtering and search](FILTERING_AND_SEARCH.md).

Undo/recoverability for bulk actions is a product and design requirement. Capturing each changed comment's previous state in the same transaction as the update is one optional candidate mechanism, not a required implementation. The mechanism and undo contract need a future decision. Open details include history lifetime, persistence across restart, memory/storage limits, interaction with later edits and refresh, and whether all manual state changes are undoable. Do not ship a broad state command with accidental or undefined recovery behavior.

## Persistence and concurrency

The main-process application service owns state commands; the renderer reaches it through the typed preload API. SQLite is authoritative for durable state. A component must not maintain a separate durable localStorage flag. Tabs referring to the same comment share its current seen state but may keep independently evaluated filters and display membership.

The normalized merge repository updates eligible remote fields and never writes existing comment_state; only new comments receive an unseen state insert. This preserves seen edits completed during future extraction. The pure reader projection defines the display subtree for Ctrl+click, including Community containment, while retaining true direct-parent evidence separately. See [ADR 0004](decisions/0004-durable-observation-merge.md). Computing a refresh plan from an old seen-state snapshot and writing it back later would violate that invariant. Baseline-imported comments are unseen without visual NEW indicators; subsequent discoveries also start unseen and are eligible for NEW. See [refresh and merge](REFRESH_AND_MERGE.md), [database design](DATABASE.md), and the [Electron boundary](ARCHITECTURE.md).

## Verification and open decisions

[Domain and persistence tests](TESTING.md) must cover ordinary toggles, mixed-state subtrees, collapsed/unmounted descendants, no automatic seen changes, baseline and future replies starting unseen, stable visible membership/order and applied matching IDs, matching-only bulk actions using the last applied active filters, date actions based on each comment's own timestamp, write rollback, and preservation through refresh. Cover automatic active-view recomputation after a successful explicit remote Refresh, while Apply performs no extraction.

Before their dependent features are implemented, resolve date boundaries, undo mechanism and semantics, failed-write presentation, command ordering, and shortcuts beyond the required Ctrl+click interaction. Exact visual treatment and supplementary indicators also need UI design, without reopening the last-applied bulk scope. Capture consequential choices in [decision records](decisions/README.md). A shortcut or recovery design may evolve; the per-comment manual-state invariants may not change silently.
