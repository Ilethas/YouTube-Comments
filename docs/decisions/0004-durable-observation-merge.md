# 0004 — Durable observation merge, history and identity

Date: 2026-10-02. Status: accepted for normalized fixture ingestion.

## Context

The owner approved an accumulating local history, field-authoritative updates,
accepted partial/unknown acquisitions, conservative conflict handling and durable
relationship truth. [ADR 0003](0003-extractor-observations-and-normalization.md)
supplies normalized candidates; [ADR 0002](0002-sqlite-and-typed-reader-boundary.md)
supplies main-owned SQLite. This increment connects them without executing a
helper or adding acquisition/refresh IPC or UI.

## Decision

Schema **2** extends schema 1 in an ordered transactional migration. Existing
item/comment IDs, source IDs, metadata, order, seen state, preferences and
discovery labels are preserved. Unique indexes enforce `(kind, source_id)` for
items and `(item_id, source_comment_id)` for comments. The two current reader
kinds map one-to-one to `youtube-video` / `youtube-community-post`. Backend
name/version does not participate in identity. Comment IDs are never globally
unique remote keys. New internal item/comment/attempt IDs use injected factories;
the main repository defaults to `crypto.randomUUID`, with an injected UTC clock.

The additive schema keeps schema-1 reader columns and stores current normalized
remote evidence as checked JSON on each item/comment. JSON contains only the
domain observation vocabulary, including authority, publication labels/precision,
source relationships and remote image/link metadata. It contains no raw backend
dump, download/cache/media subsystem or historical text/like versions. Reader
scalar columns are written from that evidence in the same transaction; missing
text/title has an empty reader fallback while evidence remains unknown.

`extraction_attempts` stores ID, optional stored item and opaque target association,
UTC acceptance time, backend/version, coverage, accepted/failed outcome, collection
availability, provenance, structured issues and counts. Counts mean candidate
occurrences, inserted comments, accepted existing-comment observations (`updated`,
not a count of changed fields), skipped occurrences and conflicted identities.
Coverage retains its evidence; no process/count heuristic promotes completeness.
Free-text provenance/evidence is bounded and control characters removed; issues
are explicitly projected structural fields. Raw messages/dumps are not persisted.
Retention and a future process diagnostic policy remain open.

Baseline/first/last attempt references have foreign keys. Consistency triggers
enforce same-item accepted-history associations and remote/source identities.
Legacy discovery labels remain intact alongside the references. Migration and
empty-library demo seeding explicitly create synthetic accepted history; demo
mixed seen states and invented direct-parent links are preserved as demo evidence.
Reinitialization does not reset any existing library/preferences.

`src/domain/observation-merge.ts` plans inserts, remote updates and history using
current stored evidence and injected dependencies, without SQLite/React/Electron,
raw extractor schemas or seen state. Only observed fields replace stored values;
all unknown reasons preserve useful values. Author subfields and still-observed
attachment subfields merge independently. Publication keeps evidence separately
for instants and labels, preventing a later coarse label from changing an exact
retained instant's precision. Missing publication never uses discovery time.

The repository reads/plans/applies under one `BEGIN IMMEDIATE` transaction. Helper
execution and normalization belong outside it. New comment state is inserted
unseen; existing `comment_state` is never written by ingestion. Absent or skipped
comments receive no writes, including no last-observed or relationship mutation.
Database failure rolls back item/comments/state inserts and history together.
There is no pending/in-flight history or overlapping-refresh scheduling yet.

All occurrences of duplicate/conflicted source identities are skipped; no winner
is selected, even for identical duplicates. Independent candidates remain eligible.
Unknown/partial (and future affirmatively complete) usable batches are accepted;
failed normalization records failed history only. For failures with no published
item, the future caller may provide a target; no item is created for that failure.
The first accepted usable acquisition, including partial/unknown or empty/unavailable
collections, establishes the baseline. Baseline comments start unseen and their
first-discovery attempt equals the baseline. Later discoveries record later
attempts. This adds no final NEW badge or lifetime policy.

Relationships remain `top-level`, `direct-parent` or `thread-containment` with opaque
target IDs. They can remain unresolved and can even retain diagnosed cyclic source
truth. The pure reader projection resolves only within the item: missing targets
and every cycle member display as roots; other descendants stay attached. It never
rewrites source truth or drops comments. A later parent can improve placement on
read without changing child identity, seen, discovery or last observation.
`directParentId` is supplied only for resolved, usable direct-parent evidence;
Community containment supplies display `parentId` only. Future replied-to-author
search must use direct evidence. Schema-1 `parent_id` remains a legacy fixture
column/index, not the authority for newly ingested display trees. Ctrl+click uses
the complete projected tree, independently of mounted DOM rows.

## Reasons and alternatives

Row replacement or mirror deletion would lose local history and manual processing
state. Global comment-source uniqueness asserts evidence we do not have. Treating
Community containment as a direct reply invents an author relationship. Rejecting
all candidates because one identity conflicts loses independent safe observations.
Rejecting missing-parent children prevents accumulating useful partial discussions.
Silently repairing cycles rewrites source truth. Separating evidence and display
projection preserves diagnosis while providing a safe tree.

An additive migration avoids rebuilding valuable schema-1 tables and retains the
existing reader mapping. Small current-evidence JSON avoids many nullable columns
and an unrelated attachment subsystem. Its deliberate scalar duplication stays
transactional; future SQL querying/performance work must use the source evidence
and is not chosen here. Synchronous main-side execution retains ADR 0002's limits.

## Validation and remaining scope

Offline pure and temporary-SQLite tests cover scoped identity, authority, baseline,
duplicates, missing/cyclic relationships, later resolution, complete/partial/unknown
history, failed input, write rollback, seen protection, all 24 schema-1 demo comments,
migration rollback/retry, unsupported versions and close/reopen. See
[Testing](../TESTING.md) for executed checks.

Live helper resolution/version checks, safe config/output ownership, execution,
failure/cancellation/deadline/crash/concurrency handling, acquisition/refresh IPC,
URL/progress UI and active-view integration remain future increments. Search,
bulk recovery, workspace, virtualization/ruler, NEW lifetime, explicit deletion,
polls, backup/release and distribution decisions are unchanged.
