# 0007 — Unified workspace, Library removal and structural reply rails

Date: 2026-10-03. Status: accepted for this bounded milestone.

## Context

The owner wants browser-like rearrangeable views, a usable Library and Settings,
and a reply tree whose ancestry does not compete with manual unseen state. ADR
0006 separates stored discussions from their workspace views; that boundary stays.

## Decision

- `WorkspaceState` contains ordered `tabs`, nullable `activeTabId`, and a persisted
  monotonic acknowledgment `revision`. `WorkspaceTab` discriminates discussion,
  Library and Settings. Discussion IDs are `discussion:<internal item ID>`;
  app IDs are `library` and `settings`. Remote IDs and SQLite rowids never identify
  tabs. Library/Settings are ordinary singleton closable views with no reserved slot.
- Schema 4 replaces the schema-3 workspace tables transactionally with
  `workspace_tabs(id, kind, item_id, position)` and
  `workspace(active_tab_id, revision)`. Checks enforce app singleton identities and
  discussion identity/item ownership. It preserves exact old discussion order,
  active identity and revision without opening app tabs. Library/evidence/state/
  history/preferences remain untouched. `content_items.position` stays Library order.
- Open appends a closed view and activates it; open of an existing singleton only
  activates. Close changes workspace only. Closing active selects immediately right,
  then left, then empty; closing background preserves active. Acquire opens through
  the same singleton rule in its merge transaction; Refresh never changes workspace.
- `moveTab({tabId,toIndex})` validates a final zero-based slot and preserves active
  identity. Small pointer-capture dragging previews locally and writes once on
  release, with a six-pixel threshold, drag feedback and horizontal overflow.
  Cancel/Escape loses no tabs and writes nothing; a changed workspace revision
  invalidates an in-progress preview. Alt+Left/Right moves a focused tab;
  Arrow/Home/End still activate/focus. App-owned SVG icons replace tab type text;
  accessible names/tooltips announce kind. Close remains a separate button.
- Toolbar retains branding, Add/Open, Library and Settings launch actions. Settings
  owns durable Language/Appearance controls. Its helper explanation contains no
  configured paths or path-editing capability; main startup overrides remain unchanged.
- Library lists all stored discussions, open or closed, with metadata/counts/open
  status and Open/Activate. Its local literal case-insensitive substring filter
  searches only titles/post text/display names/handles with locale-independent
  `toLowerCase()`. This does not select discussion comments or settle Q-07.
- Remove from Library permanently deletes locally stored discussion/comments,
  manual state and history. An English/Polish native modal `<dialog>` explains
  this and that YouTube is unaffected, offers Cancel and destructive Remove,
  and contains focus while making the background inert. Main validates existence
  and protects synthetic baselines (identified by main-owned `synthetic-demo`
  provenance); renderer receives only a `removable` capability.
- Removal uses one short SQLite transaction: remove its view using ordinary
  neighbor rules, delete comment_state/comments/content and associated attempts
  (including earlier failed attempts with the same canonical target). The cyclic
  content-baseline/history graph uses `defer_foreign_keys` until commit;
  enforcement remains ON. No helper runs and no remote deletion occurs. A late
  failure rolls back every record and returns stable storage failure. Removal
  advances revision even for a closed item. Unrelated content/preferences/app tabs
  survive. Removed real content does not reseed; demo Remove is unavailable.
- The existing single-live-operation scheduler records its canonical active source
  before awaiting extraction. Main rejects same-source removal with
  `ACQUISITION_BUSY` until it settles, including Acquire of an already stored URL.
  Unrelated removal and workspace actions remain available. Thus an outstanding
  result cannot recreate an explicitly removed target. Renderer revisions reject
  stale workspace acknowledgments; session removed-ID reconciliation also excludes
  removed items from delayed acquisition content snapshots. This is a narrow policy,
  not background scheduling infrastructure or permanent remote tombstones.
- The projected data tree stays unchanged. Nested ordered lists carry depth/branch
  metadata, neutral vertical rails and elbow spans, including parent avatar gutters
  and last-sibling termination. Indentation narrows from 22px to 10px at depth 5 and
  3px at depth 10, retaining every ancestor and semantic nesting. From depth 5 a neutral return connector joins the parent gutter to the compact rail. Unseen uses a
  subtle accent-tinted row plus UNSEEN text and the explicit checkbox; rails use
  neutral border tokens in both states. Avatar loading and Ctrl+click are unchanged.

## Reasons and consequences

Narrow intents retain the existing validated preload/main authority and sender/
frame/document guards. Separate application identities avoid turning database
mechanics into capabilities. Local preview avoids pixel-by-pixel SQLite writes;
no drag or icon dependency is needed. Deferred checks permit atomic deletion of
the existing history cycle without disabling referential integrity.

Deterministic temporary SQLite/domain/React tests and real Electron restart checks
cover migration/rollback, singletons, order, mixed neighbors, pointer/keyboard
reorder, deletion/confirmation/protection/concurrency, preferences and deep trees.
Separate development/live and visual evidence is recorded in [Testing](../TESTING.md).

Q-10 settles only generic singleton tabs, exact open/order/active restoration and
close/reopen/reorder. Scroll, filters, sorting, expansion, selection and pending
results still need decisions. Discussion search/filter/navigation, virtualization,
ruler, collapse, bulk recovery, final NEW behavior, helper distribution/editing,
backup lifecycle and the existing packaging limitation remain outside this increment.
