# 0003 — Extractor observations and normalization

Date: 2026-10-02. Status: accepted for the fixture/adapter milestone.

This record describes the earlier pure-adapter increment. Its remaining persistence
choices are now settled in [ADR 0004](0004-durable-observation-merge.md); live
execution and acquisition UI remain unimplemented.

## Context and evidence

The owner completed investigation of yt-dlp **2026.08.19** and
post-archiver-improved **0.4.0** (executable `post-archiver`, upstream
sadadYes/post-archiver-improved v0.4.0). The approved increment is deterministic
fixtures, pure parsing/normalization, and pure invocation descriptions. It adds
no execution, persistence, IPC acquisition command, or renderer acquisition.
The existing SQLite schema and reader model remain the synthetic foundation.

The investigation found opaque identities, yt-dlp `root`/direct-parent evidence,
Community nested thread membership with insufficient deeper parent fidelity,
varying memberships, unreliable counts, and lossy Community defaults. Ordinary
successful output has no completeness status; deliberately limited successful
runs need invocation/warning evidence outside their JSON. Numeric timestamps
can be estimates of relative labels. The investigated Community Windows child
needs UTF-8 environment handling and its `--quiet` is broken.

Installed sources were inspected again at those exact versions to reconstruct
the saved shapes. Community's archive serializer flattens metadata beside
`posts`, computes extracted totals, and serializes missing values as strings,
booleans and empty lists. See the [fixture matrix/provenance](../../src/main/extractors/__fixtures__/README.md)
and [extractor contract](../EXTRACTORS.md). Original captures were unavailable
in the repository; reconstructed fixtures are explicitly labeled, not passed
off as live captures. All five Community raw fixtures round-tripped exactly
through the installed 0.4.0 archive serializer in an offline development check.

## Decision

The local database is an **accumulating local history**. Future merge matches
`(content source kind, opaque source item ID, opaque source comment ID)` and may
update newly observed meaningful remote fields. It preserves local state and
first discovery; unknown IDs start unseen. Missing comments remain completely
untouched. Absence has no deletion meaning. None of these database writes is
implemented here.

`src/domain/extraction-observation.ts` defines remote observations independently
of backend schemas, React, Electron, SQLite, and local state. Source identity
is separate from descriptive backend/version provenance. These are candidate
observations, not persistence DTOs or the reader's complete stored tree.

- `ObservedField<T>` distinguishes an observed value (including a trustworthy
  empty/zero/false) from unknown, with reasons for unavailable, lossy default,
  unreliable, invalid, or unsupported information. Only observed values can
  authorize a later remote-field update. Unknown/default/unreliable values
  cannot erase previously useful values.
- Relationships distinguish top-level, direct parent, and thread containment.
  yt-dlp maps its literal root sentinel and observed parent IDs verbatim, without
  ordering inference. Community nesting proves a containing root only; this
  verified format has no direct-parent evidence. Unknown extensions do not
  establish it. Replied-to-author search must use known direct parents only.
- Collection availability is separate from coverage: unavailable, disabled
  with external evidence, or a present array (possibly empty). An unavailable
  collection does not claim there are zero comments.
- Coverage is unknown, partial with specific external evidence, failed/unusable,
  or reserved complete with affirmative evidence. Both current adapters emit
  ordinary usable output as unknown, even with matching counts/zero exit. No
  supported input currently proves completeness. Valid observations in
  partial/unknown runs are acceptable observational input for later safe,
  non-destructive merges; the application's baseline/history/view treatment
  still needs design.
- Publication retains available instants and source labels, estimatedness and
  precision separately. yt-dlp comment timestamps are coarse estimates even
  when serialized as integer seconds. Community labels remain labels, without
  conversion using the current clock or locale. A false estimation default
  never upgrades a label to an exact instant. Date-query semantics remain open.
- Duplicate candidates are retained with all normalized relationships and a
  structured duplicate issue identifying occurrences. Missing/cyclic references
  are diagnosed without repairing them. Issues do not select a winner or
  authorize writes. Invalid required identity/text/container structure makes
  this adapter batch unusable with no published item; invalid optional fields
  become unknown with diagnostics. Broader conflict/subset-acceptance policy
  remains open before ingestion.

yt-dlp optional likes and explicit pin/creator booleans remain observed when
valid. Its post-fetch comment count cannot establish an original reported
total. Community string zero, empty text/author/attachment lists, and false
estimatedness remain conservative unknowns. Positive unambiguous integer likes
may be observed; abbreviated counts are not guessed. Community comment counts
and pin flags are unreliable, while favorite/member/verified flags are not
creator identity. Image/link observations preserve supported remote metadata
only, without download paths, rendering behavior or poll claims.

Pure command builders preserve structured arguments, JSON mode, comments,
config/plugin isolation for yt-dlp, no playlist/media download, and explicit
finite network bounds. Community uses an individual post, explicit config and
output locations, explicit comment/reply limits, and child-only Python UTF-8
additions; it omits broken `--quiet`. Builders choose no paths, write no config,
and spawn nothing. Supported parser versions are intentionally pinned to the
investigated contracts; future versions need fixture validation.

## Reasons and alternatives

A replace-all snapshot would lose history and manual processing state whenever
membership varies. A single optional-value schema would conflate missing fields
with trustworthy clearing values. Mapping Community replies to root parents
would falsely identify the replied-to author. Counts or process success cannot
prove that continuation pagination returned an entire discussion. Explicit
adapter semantics make these uncertainties inspectable without a generic
schema framework or invented data.

## Consequences and validation

Eleven compact JSON fixtures preserve versions, invocation characteristics,
types/presence, relationship references, and coverage categories. Public names
and text are replaced with invented Unicode/Polish/multiline examples; IDs are
remapped consistently, avatars omitted/defaulted and attachments use harmless
representative URLs. Ten fixtures are reconstructed-sanitized; the duplicate
conflict is synthetic based on verified processing behavior. Deterministic
Vitest tests need no helpers/network; local serializer checks are separate.

See [Testing](../TESTING.md) for checks and [the register](README.md) for the
remaining portions of Q-08/Q-14/Q-15/Q-19. Before production helper execution,
choose supported-version checks, helper resolution/path precedence, caller-owned
config/output safety, URL validation scope, process failure/output handling,
timeouts/retry/cancellation/concurrency/crash lifecycle, and diagnostic/raw-file
retention. Before persistence, choose conflict/orphan acceptance and identity
constraints, merge/history schema, precision storage, baseline treatment and
partial/unknown outcome reporting/view behavior. Distribution, dependencies,
bundling, update ownership, signing and licenses remain open. There is no
acquisition/refresh implementation or poll contract, and unrelated questions
are unchanged.
