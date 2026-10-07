# 0012 — Publication-date and latest-discovery filters

Date: 2026-10-07. Status: accepted for this bounded milestone.

## Context

The owner approved Q-03's calendar/rolling semantics and a latest-refresh
discovery filter. Existing ADR 0008 supplies draft/applied snapshots and worker
evaluation; ADR 0011 supplies durable NEW. Publication, discovery and manual seen
are independent evidence. Future date-based bulk operations need the same rules.

## Decision

- `DiscussionQuery.publication` is `all`, `custom` with optional validated ISO
  Gregorian `YYYY-MM-DD` From/To calendar dates, `today`, `last-24-hours`, or
  `last-7-days`. These dates are not instants. `discovery` is `all` or `new`.
  The compact Custom / no preset UI also represents `all`; editing a boundary
  creates custom criteria. Empty custom criteria impose no date restriction.
- Calendar filters use the computer's **current system time zone at evaluation**,
  obtained at the renderer boundary with a fresh
  `Intl.DateTimeFormat().resolvedOptions().timeZone`. Locale governs formatting
  only. There is no zone preference, UTC assumption, Poland assumption or stored
  fixed offset. The runtime's IANA rules govern conversion.
- Custom dates resolve to `[start of From local day, start of day after To)`.
  Either boundary can be absent; a same-day range includes the whole day. To is
  never 23:59:59.999. Calendar-day addition precedes zoned conversion, so a day
  can span 23 or 25 hours. The start of a skipped-midnight day is its first
  available instant; repeated midnight uses its earliest instant. Reversed dates
  and malformed dates return localized validation errors and retain the old view.
- Today is `[start of local today, start of local tomorrow)`. Last 24 hours is
  `[now - 24h, now]`; Last 7 days is `[now - 168h, now]`, both inclusive at now.
  Seven days is a rolling duration, not a calendar week. A preset disables the
  custom inputs and replaces them; changing modes clears custom dates.
- Capture **one** injected evaluation instant and zone per recomputation. Apply
  resolves captured draft criteria before dispatch and promotes them only after
  complete successful evaluation. Successful explicit Refresh resolves the last
  applied semantic criteria against fresh now/zone and committed evidence,
  preserving drafts. Failed acquisition or evaluation retains the old result.
  Wall time and zone changes alone never change membership, counts or stale flags.
- Evaluate each comment's own best-available normalized `publishedAt` instant.
  Missing/invalid/label-only evidence fails any active date predicate; no parent,
  item, discovery or last-observed substitution and no human-relative-label parsing.
  Estimated/coarse instants participate normally; precision/estimate metadata is
  retained unchanged. Compact English/Polish help explains the approximation.
  Future instants use ordinary comparisons: rolling excludes times after now,
  Today can include times later today. Filtering never repairs source evidence.
- NEW from latest refresh uses `isNewDiscovery` over the current main-projected
  latest accepted attempt and comment first-discovery identity. It excludes
  baseline/prior cohorts, includes seen or old-published latest discoveries,
  survives failure/restart, and becomes empty on accepted zero-insert refresh.
  No mutable NEW state or additional SQLite schema/IPC is added. The original
  demo badge examples remain presentation-only, as in ADR 0011.
- Search AND seen AND publication AND discovery must hold on **one comment**.
  Selected search fields still OR. Raw search hits stay separate. Any active
  match includes the complete stored containing tree as context, with unchanged
  match/thread counts, F3/wrapping navigation and virtual reveal.
- `ResolvedDiscussionQuery` has numeric publication bounds and endpoint inclusion,
  separate from semantic criteria. `QueryComment` projects only normalized numeric
  publication instants and durable NEW eligibility alongside existing fields.
  The worker receives neither calendar dates nor timezone/clock/locale/extractor
  JSON. Its import graph excludes the resolver/Temporal runtime. ADR 0008's
  cancellable worker, supersession and 1000 ms deadline remain authoritative.
- The ruler needs no new category. MATCH uses the combined applied set; NEW
  remains an independent durable category over displayed matches/context, and
  UNSEEN remains live. Date/NEW drafts never change any lane before Apply.
- Future date-based bulk operations **MUST reuse `resolvePublication` and
  `publicationMatches` with these exact semantics**, rather than creating a
  second date model. Their command/recovery contract remains unimplemented.

## Reasons and alternatives

Use pinned `@js-temporal/polyfill` 0.5.1 (ISC; transitive JSBI is Apache-2.0)
only in calendar resolution. Its `PlainDate.toZonedDateTime(zone)` supplies
start-of-day semantics, calendar addition and tested IANA gap/overlap handling.
This avoids hand-maintaining ambiguous/skipped midnight conversion with Intl
offset iteration. Native Temporal availability differs across the declared Node
24.13+ test floor and Electron runtimes; a named import avoids changing globals.
No date UI framework or bundled timezone database is added: conversion uses the
runtime's zone data. Package/license evidence: [upstream project](https://github.com/js-temporal/temporal-polyfill),
[start-of-day API](https://tc39.es/proposal-temporal/docs/plaindate.html#toZonedDateTime).

The renderer bundle grows by the focused polyfill; the worker remains small.
Current runtime timezone-database versions determine historical/future rules,
just as they determine timestamp presentation. No fixed-offset approximation is
acceptable. Forge/Vite builds and built-worker Electron smoke verify bundling.

## Consequences and validation

Q-03 is closed. Q-05 now covers only any future arbitrary historical discovery
window UI. Controls and semantic criteria remain independent per discussion and
session-only; close/reopen retains them, restart resets them. No bulk commands,
undo, sorting, collapse, global search, persisted criteria/scroll, time-of-day or
custom-zone inputs, SQLite paging/FTS, or release work is included.

Deterministic tests cover explicit/open/same-day boundaries, exact endpoint
inclusion, malformed/reversed dates, Today/rolling presets, one clock, zone and
locale independence, Warsaw/New York spring/autumn DST, Kolkata and São Paulo's
skipped midnight. Query/session/UI tests cover missing/estimated/coarse evidence,
same-comment AND, raw/context/count distinctions, durable cohort projection,
Apply/Ctrl+Enter, validation retention, fresh Refresh resolution without draft
promotion, and 10k bounded DOM/distant reveal/ruler overlap. Temporary SQLite
tests exercise discovery filtering through accepted/failed/zero-insert histories
and restart. Executed build, Electron and agent UI checks are in [Testing](../TESTING.md).
