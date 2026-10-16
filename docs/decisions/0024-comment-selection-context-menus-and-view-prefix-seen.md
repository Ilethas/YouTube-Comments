# ADR 0024 — Comment selection, context menus and view-prefix seen actions

Date: 2026-10-16. Status: accepted. Schema 11. Extends ADRs 0013/0022/0023;
the owner's requested milestone supersedes their historical no-selection/menu scope.

## Selection and reading identity

Each renderer discussion session owns a bulk-selected Set of stable application
comment IDs, a visual range anchor and selection-mode flag. These never enter
SQLite or persistent view intent. The existing single navigation selection,
F3/unseen/ruler reveal and durable reading anchor remain independent.

A compact circular native button with aria-pressed selects a comment. The square
checkbox still changes seen. Plain and Ctrl+circle toggle membership additively.
Shift+circle adds the inclusive range between the last non-range anchor and target
in the current collapsed visible applied/sorted order. An absent or now-hidden
anchor falls back to toggling the clicked circle and establishes a new anchor.
Offscreen rows participate; collapsed descendants do not occupy visual range rows.
Repeated Shift ranges retain their original anchor and add to existing selection.

Sort retains IDs. Collapse retains selected hidden IDs and the toolbar announces
total and hidden counts. Successful Apply/Refresh intersects selection with the
new complete applied membership, including context. Failed evaluation retains it.
Clear resets set/anchor; Exit also leaves selection mode. Close/reopen retains the
session; removal discards it; process restart always starts without bulk selection.

Settings persists selectionControls = on-demand (default) or always. On-demand
uses a Select comments button and reveals circles only in selection mode. Always
keeps circles visible after Exit. Text/body clicks never select or mark anything.

## Context menu and native selection

The lightweight renderer portal is a semantic menu with localized outline icons.
Right click, Context Menu key or Shift+F10 on a comment/its controls opens it.
Opening never selects, clears bulk selection, marks, collapses or navigates.
Up/Down wrap enabled items; Home/End, native Enter/Space, Escape and outside pointer
work. Escape restores comment focus without scrolling. Outside pointer/scroll/tab
invalidation leaves focus to the user's destination. Size is bounded to the viewport
with overflow scrolling; position is clamped after measurement. It closes on reader
scroll, resize, tab hiding, target detachment, accepted view/order/collapse/content
changes. A scoped observer exists only while open; tab activation does not require
rerendering cached discussion panels.

The 2026-10-17 usability update uses one active enabled item for both focus and
highlight. Actual pointer movement updates it; keyboard navigation replaces it
until the pointer moves again. CSS hover and stationary-pointer enter events never
compete with keyboard activity. Disabled items stay inactive; text ranges and all
existing dismissal/focus semantics remain.

Only a clicked member of a multi-selected set exposes selected-group commands.
Ordinary commands and the prefix always refer to the clicked comment. No unrelated
selection is silently used or cleared. A single-state marking label reflects the
clicked comment's acknowledged state; groups expose both boolean assignments.

Native drag, Shift text selection, cross-comment selection and Ctrl+C remain.
Invocation captures selected text plus DOM ranges; focus movement preserves connected
ranges and an explicit Copy selection copies that snapshot. Copy comment text is a
separately labeled full Unicode/newline copy. No row-wide pointer-down or Shift-body
handler is added. Menu pointer-down prevents clearing the selected text.

Main handles author/video-comment/translation as before. Copy permalink adds one
identity-only copy-permalink action on that same channel: main reads stored ownership,
constructs the trusted supported video permalink, then uses Electron clipboard.
No renderer URL/text/path is accepted. Community/synthetic unsupported permalinks
remain unavailable. Translation retains saved target, limits, browser-only opt-in,
localized full-text copy fallback and payload-free diagnostics; no translation API.

## Exact reading prefix and confirmation

Mark everything up to here always confirms. The default persisted preference
includeCollapsedInPrefix = true chooses ADR 0023's COMPLETE applied sorted preorder
from its beginning to the clicked comment inclusive. Context and actual matches both
participate. Hidden descendants of EARLIER collapsed branches participate when their
preorder positions precede the endpoint. The endpoint's later descendants NEVER
participate automatically, even if it is collapsed. Thus A,A1,A2,B,B1,C through B
targets A,A1,A2,B. Draft controls, source/database insertion order and excluded trees
cannot affect the prefix.

Disabling the preference chooses the visible collapsed projection's inclusive prefix.
Offscreen visible rows still participate. This setting changes no selected-only,
Ctrl+checkbox subtree, All, publication or applied-matching scope.

The native modal identifies discussion, action, endpoint author/application ID and
position/total in the chosen complete/visible order, applied sorted scope, target
count, currently-changing count and hidden count. Restrictive prefixes explicitly
include context. Cancel is initially focused. Escape cancels before pending commit;
pending writes cannot be cancelled. IDs and description are captured together.

Safe policy: retain that validated explicit ID snapshot through tab switches,
sort/collapse/Apply/Refresh and later selection/preference changes. Commit sends the
original itemId and IDs; it never recalculates or adds discoveries. Main revalidates
ownership and rejects the entire command if the discussion or an ID is missing.
Changed count is preview evidence at capture time; acknowledgment is authoritative.
Selected groups with >1 target also confirm; a single explicit assignment need not.

## Mutation, Undo and migration

bulkSeen adds target {kind: explicit, reason: selected | view-prefix, ids}. Validation
requires exact keys, boolean assignment, bounded identities, 1–100,000 unique IDs,
and item ownership for EVERY ID. Transactional resolution, changes/revisions and
Undo replacement reuse assignSeen. No per-comment IPC or generic SQL capability.
Stored Undo metadata uses selected/view-prefix kinds, never disguises them as matches.

The existing durable recovery contract remains: multi-target actual changes replace
one discussion recovery; no-ops/failures/single-target assignments retain it. Only
changed revisions are owned. Later manual edits, including away-and-back, survive
partial one-shot Undo. Acknowledgments use the existing renderer FIFO and update
live seen/unseen/ruler, while frozen matches/roles, query draft, sort, collapse,
selection and durable NEW stay unchanged. Restrictive Seen/Unseen shows Apply stale.

Schema 11 adds two checked preference columns and widens the seen_operations kind
CHECK. To preserve populated cascading child entries with foreign_keys ON, the
transaction saves parent/child rows to temporary tables, drops CHILD first, then
parent, recreates parent and children/index, restores rows and removes staging.
No parent DROP can cascade into valuable recovery. Failure rolls back DDL, values,
revisions, constraints, entries and user_version together. Tests verify preservation
and later partial Undo, rather than only empty migration.

Exact historical schema definitions 1–10 remain unchanged. Backup validation admits
1–11; older snapshots migrate only on a staged copy. Startup first verifies a
pre-migration snapshot. All new durable state participates in complete SQLite backup,
restore and immutable crash recovery. Profiles and production data are unchanged.

## Group collapse, scale and remaining work

Expand/Collapse selected assigns only explicitly selected comments with expandable
applied descendants, including hidden selected parents. Nested selected parents
each receive their own preference; unrelated descendant exceptions stay intact.
This does not recursively Expand All. Existing sparse model/FIFO, anchor mapping and
retry/flush behavior remain. No seen writes or automatic reveal occur.

Range/prefix resolve with existing ID-index maps and linear Set/array operations.
Group collapse filters selected IDs against hasChildren without repeated descendant
walks. Only bounded virtual rows/circles mount; the ruler retains three SVG paths.
Menu opening inspects only its target plus selected IDs; no full DOM scan or menu
framework/dependency is added. Selection-control width changes invalidate cached
heights with anchor preservation. Bootstrap/SQLite/query scaling stays Q-21.

The usability update adds a viewport-only floating selection presentation when
selected IDs exist and the ordinary toolbar no longer intersects its `.reader-panel`
root. It shares this component's session, handlers, confirmation snapshot and
pending/error state; no new bulk/selection/collapse/Undo path exists. Read/unread
and total/hidden count stay compact; native details exposes the other four actions.
Back to Top scrolls only that panel to zero, respecting reduced motion without
session mutations. Fixed controls follow panel resize/visibility, remain below
menus/native modal dialogs, and do not reserve comment width. A passive threshold
listener and rooted IntersectionObserver perform no comment/projection work on
scroll. Cached hidden panels hide their controls without rerendering discussion
content. No schema, preference, framework or dependency change is required.

Verification and measured limits are in [TESTING](../TESTING.md). No live acquisition
change, library-wide batch scope, automatic seen, translation API, helper bundling,
installer execution, commit, push or publication is part of this milestone.
