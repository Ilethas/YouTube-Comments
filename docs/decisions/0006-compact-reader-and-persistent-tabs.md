# 0006 — Compact reader, persistent tabs, avatars and helper overrides

Date: 2026-10-03. Status: accepted for the bounded reader/workspace milestone.

## Context and evidence

Manual use of ADR 0005 exposed excessive chrome/header height, unclosable tabs,
missing author thumbnails, spacious comment cards and a development PATH containing
only a yt-dlp batch forwarding wrapper. Stored discussions must remain valuable
user data when their workspace views close.

The usual development database had no Community attempts (only synthetic/video
history). ADR 0005's Community verification profile had been removed. A separate
anonymous 0.4.0 recapture of the previously verified public post returned 34 comments:
all 34 had `like_count` as an integer English `N like(s)` accessibility label and
HTTPS `author_thumbnail`. Installed `extractors.py` obtains `likeCountA11y` and
`models.py` serializes it verbatim. Our integer-string-only adapter treated every
one as `invalid-field` at `$.posts[0].comments[*].likes` (including nested reply
locations). This reproduces/explains the earlier 34-warning pattern; the original
attempt's individual issues are unavailable. No public comment dump was retained.
After the count grammar correction, live acquisition has one retained
`invalid-field` at `$.item.avatarUrl`: the post author's thumbnail is a
protocol-relative string (`//…`), not HTTPS evidence. All 34 commenter thumbnails
are HTTPS. The separate sanitized community-limited fixture reproduces the post
shape; it stays unknown and cannot erase a useful avatar.

## Decision

- **Library** is all stored items. **Workspace** is ordered open item IDs and one
  nullable active ID. **Discussion** is remote evidence, history/discovery and local
  seen state. **View** is temporary presentation. Schema 3 adds `workspace_tabs`
  and a singleton `workspace`; library `content_items.position` stays library order.
  Migration opens existing stored items in their prior order, selecting the first.
  All previous content, IDs, state, preferences and history remain untouched.
- Exact-key `openStoredItem({itemId})`, `activateTab({itemId})` and
  `closeTab({itemId})` extend the typed main-owned bridge. Bootstrap/acquisition
  include a compact workspace DTO. Open activates an existing tab or appends one;
  it never duplicates an item/tab. Close changes workspace only. Closing active
  chooses the immediately right tab, otherwise left, otherwise an empty workspace.
  Closing background keeps active. Acquisition opens within its merge transaction;
  Refresh never changes workspace. A persisted revision orders acknowledgments so
  stale acquisition/workspace responses cannot undo newer tab actions.
- One compact toolbar retains branding, Add / Open, Library and preferences.
  The URL form appears on demand, supports hiding/Cancel/Escape, and clears/hides
  after success. Cancel hides input; it does not cancel an already running helper.
  Failure stays visible. Coverage/local-storage details sit beside source/Refresh;
  live progress is transient. Video descriptions default to a two-line preview
  with explicit expansion; stored text is retained in full. Community bodies remain
  readable. Compact rows, avatars, bylines and indentation replace bordered cards;
  text UNSEEN badges and checkboxes retain non-color state distinction.
- `AuthorObservation.avatarUrl` is an explicit `ObservedField<string>`. Valid usable
  HTTPS thumbnails are observed; missing/invalid values are unknown. Community's
  empty string is lossy. Unknowns never clear useful stored URLs; newer observed
  URLs can update. Normalized remote JSON carries the evidence without avatar
  columns. Older JSON gains unavailable evidence in memory, without rewriting it.
- Reader author projection exposes an optional avatar URL. `<img>` is decorative
  beside its author label, fixed 32×32, lazy, asynchronously decoded, with no-referrer
  and anonymous CORS loading to omit cross-origin credentials. Failed/unavailable/
  unsafe URLs fall back to initials. CSP permits HTTPS images; remote text stays
  React text, with no source HTML/SVG markup or application image cache. Servers
  that disallow anonymous CORS produce the safe fallback.
- Main snapshots startup configuration. `YOUTUBE_COMMENTS_YTDLP_EXE` and
  `YOUTUBE_COMMENTS_POST_ARCHIVER_EXE` select exact absolute regular executable
  files before safe direct PATH lookup. Windows requires `.exe`; batch/cmd,
  drive-relative/root-relative, missing/empty/nonregular overrides fail closed with
  `HELPER_UNAVAILABLE`, without PATH fallback. Unset overrides permit the existing
  PATH resolver. The same exact pinned version probe runs on the selected file
  before acquisition; unsupported/unverified version returns `HELPER_INCOMPATIBLE`.
  Execution remains `shell:false`. Renderer cannot supply paths or see configuration.
- Community counts accept only bare positive integers and the verified exact
  integer English `N like(s)` grammar. Zero/default labels remain conservative
  unknowns; abbreviations, other locales, unsafe integers and unexpected types still
  warn. A reconstructed sanitized fixture reproduces that grammar and HTTPS avatar
  field types with invented data. Warnings are not generally suppressed.

## Reasons and consequences

Separate workspace tables make closing reversible without deleting user data.
Returning workspace separately avoids refreshing seen/preferences during tab edits;
revision checks protect overlap with acquisition. No generic workspace/preference
mutation, drag ordering, filter state, scroll persistence or delete API is added.
Remote JSON already expresses field authority, making an avatar column migration
unnecessary. Explicit startup paths solve the owner's wrapper-only PATH without
introducing shell execution, installation scanning or helper Settings UI.

Offline tests cover preserving migrations/rollback, close/reopen/restart/order,
neighbor/empty behavior, stable identity and seen/history protection, authority and
old JSON, avatars/fallback, compact controls, overlaps, exact payloads and overrides.
Built-entry restart and separate anonymous live checks are recorded in
[Testing](../TESTING.md). Full workspace restoration, search/filtering,
virtualization, ruler, NEW lifetime, bulk recovery, packaging completion, helper
distribution, backup lifecycle and unrelated product decisions remain future work.
