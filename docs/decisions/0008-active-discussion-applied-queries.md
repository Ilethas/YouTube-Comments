# 0008 — Active-discussion queries and stable applied views

Date: 2026-10-04. Status: accepted for this bounded milestone.

## Context

The owner approved exact search comparison, complete-conversation context,
explicit Apply, stable seen edits and navigation for the current full-reader
architecture. Regex must remain responsive even for valid pathological patterns.
This resolves Q-07 and narrows Q-06/Q-11/Q-21 without settling date or recovery rules.

## Decision

- `DiscussionQuery` contains one pattern, selected content/author/replied-to-author
  fields, text/regex mode, case sensitivity and All/Unseen/Seen. It evaluates every
  stored application comment in one discussion. Selected fields combine with OR;
  the search clause ANDs with seen on the same individual comment. Empty text
  disables search, including raw-search presentation; a nonempty pattern with no
  fields is invalid. Author means displayName/handle, never opaque source IDs.
- Text is substring comparison after Unicode NFC on pattern and targets.
  Sensitive comparison uses NFC directly; insensitive comparison uses JavaScript
  `toLowerCase()` on both NFC strings, independent of UI locale. Diacritics remain
  significant. No tokenization, stemming, fuzzy comparison or accent removal.
- Replied-to author requires resolved direct-parent evidence and an existing
  direct parent application ID. Unknown/missing/cyclic relationships and missing
  author metadata do not match. Community thread containment and text mentions
  are never interpreted as direct replies. Top-level author is outside scope.
- Regex uses ECMAScript `RegExp` with a pattern only, NFC-normalized pattern and
  targets, and application-owned `u` or `iu` flags. No implicit g/m/s or slash flag
  parsing. Invalid syntax is a localized error, distinct from valid zero matches.
- Every production comparison query, ordinary or regex, executes in a dedicated
  renderer Web Worker. A narrow projection sends identity, safe placement/direct
  relationship kind/status, original text, displayName/handle and seen only.
  It excludes remote/extractor evidence, source author IDs, SQLite and preload.
  Worker code imports only pure query/tree rules, has no DOM/Node/process/filesystem
  capability, and constructs only the intended RegExp.
- `QueryWorkerClient` imposes a **1000 ms whole-query deadline**, starting before
  worker dispatch. New evaluation kills older pending work. Timeout/error kills
  the worker; the next evaluation creates a fresh instance. Request IDs and a
  monotonic deadline reject stale/late responses even before a delayed timer fires.
  No truncation or partial result is accepted. Tests inject a 20/25 ms deadline
  and fake timers; a real isolated test thread exercises a catastrophic regex.
  Vite emits a separate same-origin worker asset; CSP explicitly permits only
  `worker-src 'self'`, with no blob/data/eval exception.
- `DiscussionViewResult` contains raw search IDs, active match IDs, containing
  root IDs, full visible preorder, frozen display parent IDs, ordered match IDs,
  applied comment/thread counts and restrictive/search-active flags. Whole stored
  trees, including unrelated siblings/branches, are context. Raw-only hits failing
  seen remain context. Unrestricted results have identity candidates without noisy
  MATCH/CONTEXT badges. Stable input sibling/tree order is preserved.
- Each singleton discussion has an independent session registry entry with draft,
  applied criteria, last successful result, status/error, stale-seen indication
  and selected application ID. Controls change draft only; Apply, Enter in the
  search form and Ctrl+Enter while a discussion is active evaluate it. Success
  promotes the captured draft; failure preserves the entire old result. Subsequent
  edits during evaluation remain draft. Close/reopen retains the session entry;
  confirmed Library removal disposes its worker and clears it. Restart resets it.
- Seen writes remain acknowledged immediate SQLite commands. Live checkbox/tint
  changes do not replace membership, placement/order, active IDs, roles or counts.
  Saved seen changes show a subtle Apply indication only if applied seen is not
  All. Draft difference has its own indication. Seen edits during evaluation mark
  the resulting older snapshot stale; none is described as pending save.
- Successful explicit Refresh merges first and reevaluates last applied criteria
  against acknowledged committed comments reconciled with overlapping seen writes.
  Draft is preserved. Success clears stale-seen state unless a newer save occurred
  during evaluation; failure retains prior valid membership/placement and reports
  a view error. Failed source Refresh leaves data/result intact. Reacquisition of
  an already viewed item uses the same reapplication rule.
- Match navigation uses applied active IDs. Unseen navigation uses current live
  seen over displayed membership, including context. Both follow displayed preorder,
  wrap, select the application ID and never mutate seen. From context, navigation
  chooses the next/previous eligible row in preorder. Buttons support all four
  directions; F3/Shift+F3 navigate matches. DOM is used only for final ID-based
  `scrollIntoView`, after data selects the target. No unseen shortcut is added.
- MATCH, CONTEXT and raw-only SEARCH HIT text badges are independent of unseen
  tint/checkbox, NEW and neutral rails. Source text stays React text, with no HTML
  injection/highlighting. A small rail cleanup shares row padding/avatar-center
  CSS geometry across structural parent continuation, nested rails and elbows.
  Indent compaction and relationship projection remain intact.

## Reasons and consequences

The existing bootstrap transfers full stored discussions; this worker/in-memory
boundary is bounded to that architecture. Pure query criteria/results describe
observable semantics so a future main/SQLite evaluator can replace execution
location. Synchronous renderer regex would freeze input; cooperative cancellation
cannot interrupt ECMAScript backtracking, so worker termination is required.
No native regex dependency, new IPC method, schema migration or FTS is introduced.
Structured cloning, full-tree mounting and full bootstrap remain large-data costs.
Q-21 remains open for virtualization, measurements, batching and SQLite query work.

Date/discovery filters, bulk actions/recovery, sorting, reply collapse, persisted
criteria/selection/scroll, final NEW and the overview ruler remain unimplemented.
Q-03 and Q-09 remain open. Q-10 restoration remains independent of session state.
Validation/results are documented in [Testing](../TESTING.md).
