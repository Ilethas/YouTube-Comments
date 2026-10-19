# How it works

This guide is for the technically capable project owner who wants to understand the whole application without having written each subsystem. The Windows reader implements local SQLite storage, acquisition/Refresh through separately installed helpers, manual seen state, search/filter/sort, reply collapse, bulk recovery and persistent reading state. Independent duplicate tabs and native windows share library data. Menus and dragging move tabs between windows. Start with the [documentation map](README.md) for status or [product requirements](PRODUCT_REQUIREMENTS.md) for the full contract. The [M9.2 review](M9_2_VERIFICATION.md) separates automated evidence from pending physical verification.

## The local library is the center

The application keeps discussions in SQLite so that reading, searching, and manually tracking processed comments do not depend on an open download session. A refresh adds observations to that library. It does not replace your reading history with whatever an extractor happened to return that time.

A **content item** is a video or a Community Post. Each item contains comments. A top-level comment and its replies form a **thread**. Every comment has its own seen/unseen value. A thread can have a computed unseen count, but it has no stored seen flag of its own. See [Domain model](DOMAIN_MODEL.md) and [Seen state](SEEN_STATE.md).

Initially, normal search/filtering and generic bulk actions work within the discussion in the active tab. "Complete local dataset" means all stored comments of that discussion, including collapsed and unrendered ones. Other discussions remain in the library, but library-wide search is a possible future feature. Initial development and packaging target Windows while allowing later Linux/macOS support.

```mermaid
flowchart LR
    URL[Video or public post URL] --> Main[Main-process acquisition service]
    Main --> Helper[Source-specific external helper]
    Helper --> Adapter[Adapter and normalizer]
    Adapter --> Model[Our discussion and comment model]
    Model --> Merge[Transactional merge]
    Merge --> DB[(SQLite library)]
    DB --> Query[Local query and conversation context]
    Query --> Bridge[Typed preload API]
    Bridge --> UI[Virtualized React reader]
```

## From a URL to stored comments

The user opens a supported item. React asks the main process to acquire it through a small typed API exposed by the preload script. React cannot run arbitrary commands or open the database. The main process identifies the source and uses the corresponding adapter: yt-dlp for a video, post-archiver-improved for an individual public Community Post.

The helper's output is not yet our application data. The adapter validates and converts it into our own identities, comment text, parent relationships, authors, and available metadata. A missing timestamp or author property must remain honestly missing. Neither the UI nor the domain rules should need to know how one helper happens to spell a field. This separation lets us change helper versions or replace a backend without rewriting the reader. See [Extractors](EXTRACTORS.md) and [Architecture](ARCHITECTURE.md).

Validated observations are merged into SQLite in a transaction. The first acquisition and later refreshes share the important preservation rules: new identities get unseen state; existing identities keep their local state. Refresh history records what happened. Pure helper command specifications and source field/coverage observations have offline fixtures (ADR 0003); normalized transactional ingestion/history is implemented in ADR 0004. Live execution and acquisition/refresh UI are implemented in ADRs 0005 and 0018.

The first successful acquisition establishes the discussion's local baseline. Every imported comment gets `firstDiscoveredAt` and starts unseen, but the reader does not label thousands of baseline comments visually NEW. The same recorded discovery history can later distinguish comments first discovered by subsequent refreshes.

## Refresh adds knowledge without losing your work

Suppose you read a root comment and two replies yesterday and marked all three seen. Today a refresh finds an edited root, those replies, and a new reply. The application can update the root's text, keep the existing flags, and insert the new reply unseen. If a reply is absent from this extraction, absence alone does not remove it from the local library.

Three times answer different questions:

- **Published:** when YouTube says the comment was posted, if available.
- **First discovered:** when this library first learned about the comment, which may be much later than publication.
- **Last observed:** when an accepted extraction most recently included it.

"New" refers to discovery history, while "unseen" is your durable choice. Visual NEW is intended for discoveries after the initial successful baseline. An old discovered comment may stay unseen for months; a later newly discovered comment may immediately be marked seen. Editing an existing comment does not create a newly discovered identity. NEW identifies only the latest accepted post-baseline first-discovery cohort. It survives restart and seen changes; the next accepted refresh replaces it, including with no NEW comments. Failed refreshes preserve it.

The helper runs before the final database merge, so a long network operation need not hold a database write transaction open. A failure cannot wipe out the last valid stored discussion. Valid partial/unknown batches can contribute safe additions/authoritative updates and establish the first baseline, retaining their true coverage. Ambiguous identities are skipped while independent observations remain eligible. See [Refresh and merge](REFRESH_AND_MERGE.md) for the sequence and failure rules.

## Matching a comment does not remove its conversation

Filters answer “which comments satisfy the complete applied filter set?” A **raw search match** satisfies the search predicate alone. An **active-filter match** satisfies the full combination at the applied view evaluation. A **context comment** is included for the conversation but does not satisfy that evaluation's full predicate. A text hit can therefore be context if it fails another active filter and a different comment in its thread satisfies the full set.

In the example above, Unseen only matches the single new reply. The visible tree still includes the root and all stored replies in that thread. The new reply is marked as a match; the rest are context. The counts are **one matching comment** and **one containing thread**, even though more comments are visible.

This rule also applies to dates, comment text, author, direct replied-to author, and other applicable filters. A bulk operation on matching comments acts on the last applied active-filter matching IDs, not every visible row. Otherwise, preserving context would accidentally expand the mutation scope. See [Filtering and search](FILTERING_AND_SEARCH.md).

## Saving a checkbox and updating a view are separate

When you click the new reply's checkbox, its seen value is saved immediately. The current filtered result stays in place so it does not disappear while you are reading. Apply changes / Update view recomputes the result from already-saved state. If no comment in that thread is still unseen, the thread leaves Unseen only at that point.

This creates two distinct kinds of state: durable comment state in SQLite, and the currently applied result set. A pending view change does **not** mean the checkbox is unsaved. Checkbox feedback must reflect successful persistence or clearly report an error. The applied active-filter matching set, its result counts, and displayed membership/order remain tied to that evaluation until recomputation. Matching bulk actions use those same IDs even after a seen edit; they do not run a fresh query first. Restart freshly reconstructs the saved applied semantic query against durable comments/seen/NEW, clearing seenStale on success. Old result membership is never saved; draft controls remain distinct (ADR 0017).

An ordinary checkbox click changes only its comment. Ctrl+click takes the clicked comment's resulting seen value and applies it to that comment and its descendants. It does not independently invert every reply. Generic Mark all means all comments in the active discussion, never the entire library. Date-based bulk actions instead test each comment's own publication time, without extending to parents or replies. The latest changed multi-comment operation has durable Undo; later individual edits are protected when recovering it. See [Seen state](SEEN_STATE.md).

Apply performs local view recomputation only. A successful explicit Refresh runs the helper, safely merges the observations, then automatically recomputes the active view. A new unseen reply can therefore appear immediately under Unseen without a second Apply action. That recomputation also incorporates seen edits already saved. Ctrl+Enter applies the discussion draft; source Refresh remains button-only, with Ctrl+R/F5 deliberately unbound. F1 opens the Settings keyboard reference, which also documents workspace cycling/close and contextual search/URL focus. See [current shortcuts](UI_AND_NAVIGATION.md#shortcuts-and-gestures-discoverability). Partial/unknown batches are accepted non-destructively and retain their true coverage in history. The eventual refresh UI must report that coverage; its presentation details remain open.

## Searching and navigating a large discussion

Only the rows near the viewport need to exist as rendered UI elements. This is virtualization. The library still contains all comments, so the query engine and navigation can find comments that have never been mounted in the DOM.

Initial search must support comment contents, author/display name/handle, direct replied-to author, ordinary text matching, opt-in regex, and case-sensitive/insensitive operation. Top-level thread-author search may also be supported where useful. Search composes with other filters, normally with AND on the same comment. Invalid regex produces a validation error. Matching-comment and thread counts come from the applied active-filter result across all stored comments in the active discussion, not from counting HTML elements.

Publication-date ranges and useful presets such as Today or Last 24 hours test `publishedAt`; the preset list is not permanently fixed. "New since refresh" instead uses discovery/refresh history. A reply published months ago but discovered after the baseline can be new without passing a recent publication-date filter. The UI must not blur these concepts with a vague "Since last refresh" publication-date preset. Exact timestamps remain discoverable when available.

Next/previous match navigation in the filtered reader follows the currently applied active-filter matching set. Unseen and any search-specific navigation operate within the applicable view, with their remaining details documented separately. The required scrollbar-adjacent overview ruler represents at least unseen comments, search matches, and subsequent-refresh discoveries. Its clickable markers resolve comment identities from data. ADR 0011 uses estimated/measured row heights and three category lanes aggregated into pixel bands. It shows only the current applied view, and its match lane uses restrictive applied matches rather than raw-only hits. Pointer and local keyboard navigation reveal targets through the virtualizer; ADR 0016 reorders its geometry with whole-conversation sorting; ADR 0023 aggregates hidden contributions onto visible collapsed ancestors. Jumping cooperates with virtualization and never marks the target seen. See [UI and navigation](UI_AND_NAVIGATION.md) and [Architecture](ARCHITECTURE.md).

## Tabs restore your workspace

Each browser-like discussion tab remembers its item, draft/applied filters, search, sort, reply expansion, selected/navigation comment, and useful scroll position. These durable settings live in SQLite along with language and appearance preferences. Duplicate Tab creates an independent copy of that reading state. Comments, seen state, Undo and Refresh remain shared. Round comment selection controls instead maintain a temporary bulk set; that set is not saved across restart.

The application menu and File menu open equal native windows. Right-click a tab (or use Shift+F10) for Move to Window / Move to New Window. Drag along the strip to reorder, into another strip to attach, or outside to detach. Moving a discussion retains its current frozen results and temporary selection; restarting reconstructs results from saved criteria. Outside Escape can detach when cancellation is not delivered. Physical drag checks remain [pending](M8_MANUAL_VERIFICATION.md).

Close Tab (Ctrl+W) retains the discussion in Library. Close Window (Ctrl+Shift+W) excludes that window from next launch when peers remain; the last Close retains one. Quit Application (Ctrl+Shift+Q) preserves all currently open windows. Each restored window gets its own tabs, active view and reading state. Use Quit when the complete current workspace should return.

English and Polish interface text uses stable translation keys. Dates, relative times, and numbers use locale-aware formatting. Changing the interface language does not translate comments or change search semantics. Appearance defaults to System, follows OS changes in that mode, and also offers explicit Light/Dark. Semantic tokens support switching without restarting. See [Localization and theming](LOCALIZATION_AND_THEMING.md).

## What protects the library as the application grows

The SQLite foundation has transactional schema migration, isolated development/test profiles, and typed main-owned persistence. Settings creates verified full-database backups and confirms full-profile restore, retaining independent safety and recovery files (ADR 0019). Saved native-window membership and per-view state are included; image cache bytes are separate. Export is future work. React reaches main through a narrow typed preload bridge and receives acknowledged snapshots; it cannot open SQLite. Only main invokes helpers. See [Database](DATABASE.md), [Architecture](ARCHITECTURE.md), and [Packaging](PACKAGING.md).

Deterministic tests exercise the rules above without live YouTube access. Saved helper fixtures test normalization; temporary databases test transactions and migrations. Aggregate Electron harnesses exercise the real reader, native windows, backup/restore and extracted-EXE relaunch. Synthetic drag tests do not establish physical input behavior. Optional live smoke tests cannot replace deterministic checks. See [Testing](TESTING.md). Unsettled behavior and when it blocks implementation are collected in the [decision register](decisions/README.md).

## Reader actions

Settings offers Custom… / Własny… for codes such as uk, zh-TW or mni-Mtei. Save
validates and activates the code together; switching to a preset retains it for later.
The “?” button provides accessible code-only help. Valid syntax cannot promise Google
support. Failed saves keep the committed choice. Restart/backup/restore retain both.

Date/discoveries accepts optional local From/To HH:mm. Blank times include whole
days; explicit To includes the complete entered minute. Times need dates;
invalid/reversed or repeated/skipped DST times preserve applied results. Editing
does not filter until Apply; saved views and Refresh retain semantic applied times.

Activity rings keep rotating even with Windows Animation effects disabled, beside
textual status/elapsed time. Selection circles align with avatars in an outer lane
that leaves compact reply rails uninterrupted.

Comment surfaces support native drag and Shift text selection, including selection
across elements and Copy. Only checkbox click / Ctrl+checkbox changes seen state.
Trusted video creator evidence adds a subtle author accent. Safe author names and
video comment timestamps open their original channel/comment in the browser; missing
identity stays plain, and Community timestamps have no invented comment destination.
Translate in browser opens the stored comment in Google Translate only when chosen.
Settings explains this Google disclosure and saves Follow application language or an
explicit target independently of the interface. Long comments offer full Copy for
manual translation. See ADR 0022 and UI_AND_NAVIGATION for boundaries and shortcuts.

## Hide replies without losing their discussion

Discussions start fully expanded. Use a comment's chevron to hide/show all of its
replies, or Expand all / Collapse all beside sorting for the current discussion.
The count means all descendants, including nested replies. Hidden summaries show
live unread and last-applied matches independently. Your choices persist across
restart, Library reopen, filters, sorting and Refresh in sparse SQLite records.

Hidden replies still participate in searches, match counts, unseen navigation and
all existing seen/bulk/Undo actions. F3, unseen navigation and ruler activation open
only the ancestors needed to reveal the target, and remember that expansion.
Collapsing a selected reply keeps its logical selection. If your reading anchor is
hidden, scrolling restores its visible collapsed ancestor. No expansion action
marks comments seen. See [ADR 0023](decisions/0023-persistent-thread-collapse-and-virtual-navigation.md).


## Video header thumbnails

A saved real video can show an optional thumbnail below its title and source button. Comments open
immediately; obtaining an image never runs the comment extractor. Click the image
(or press Enter/Space on it) to expand to the reading column; activate again to
shrink to about 360px. It keeps all image content within a 16:9 box and fits narrow
windows. Expansion lasts only while that discussion stays mounted.

Right-click the loaded image for **Open in image viewer** (Polish: **Otwórz w
przeglądarce obrazów**). Only choosing that action opens the cached local image in
your OS default viewer. Image downloads and tab activation never open a viewer.

The last valid image survives restart and works offline. Images are checked in the
background after a day, or independently during source Refresh. Failures retain
the cached image; missing/undecodable images leave no blank area or broken icon.
Posts and synthetic demos do not request video thumbnails. This presentation cache
is separate from SQLite and is not included in database backups. See ADR 0025.
