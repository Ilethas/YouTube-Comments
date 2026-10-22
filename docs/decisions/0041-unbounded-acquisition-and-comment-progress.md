# ADR 0041: Acquisition without an overall deadline and live comment counts

Date: 2026-10-22. Status: accepted. Supersedes ADR 0005/0018's extraction deadline
and ADR 0018's indeterminate-only presentation. Schema remains **16**.

Long discussions legitimately exceed the former 180-second deadline. Acquisition
and Refresh now await completion, explicit cancellation, shutdown or actual failure.
Extraction omits the process executor's optional deadline; identity probes retain
their ten-second/4096-byte bounds. Network timeouts (15 seconds), retries (two),
stdout/archive limits (128 MiB), retained stderr (64 KiB), Community limits and
helper identity policy remain. Async child execution leaves the renderer responsive.
Cancellation still terminates the owned Windows process tree using no-shell
`taskkill /T /F`, awaits close and then cleans the workspace. There is no replacement
wall-clock or inactivity deadline. Synchronous normalization/ingest remains unchanged.

Installed yt-dlp **2026.08.19** was inspected and exercised on the owner's public
video `lEZ5UPPtaHA`. Its supported `--quiet --verbose` combination routes screen
notes to stderr while final `--dump-single-json` output remains on stdout. Quiet
selects stderr for screen messages; verbose permits extraction notes to appear.
`--progress` alone controls media progress and did not emit comment counts.
`--no-quiet` mixed notes into stdout, making it unsuitable. No wrapper, plugin,
logger injection or maintained fork is required. Verbose diagnostics remain private.
See [upstream options](https://github.com/yt-dlp/yt-dlp#verbosity-and-simulation-options).

The main-only executor observes stderr chunks independently of its retained buffer.
A bounded parser recognizes YouTube comment page/reply-thread notes, including
CR/LF, split chunks and final unterminated lines. Lines exceeding 1024 characters
are discarded through their terminator. Unknown/malformed formats are ignored.
Warning detection continues after the retained buffer fills, preserving conservative
partial coverage. Only safe integer fetched/estimated-total values are accepted;
zero/unknown/underestimated totals are omitted. Fetched counts cannot move backwards.

An optional exact `comments: {fetched, estimatedTotal?}` field extends the existing
typed acquisition notification/current snapshot. Counts are restricted to video
Fetching, copied from validated numbers, deduplicated and coalesced to at most one
numeric notification per 250 ms with a trailing update. Operation/controller/stage
guards and timer disposal reject callbacks after cancellation, stage exit or a
later run. Main and preload retain exact payload validation and authentication.
No diagnostics, URLs, comment text, paths, arguments or process identities cross IPC.

The English/Polish status keeps the spinner, local elapsed timer and Cancel. It
uses Intl counts, `~` for any reported total and an approximate percentage only for
a usable total. Fetching percentage is capped at 99; count/total changes can revise
the percentage. Counts are observations before the next API request and may lag
the final JSON. They never certify completion or coverage. Unknown versions/formats
fall back to the existing indeterminate status. Processing, Saving and Updating
view retain their existing stages and never present fetched counts as completed work.

M2 synchronization, M3 shutdown/drains, exact-ID Cancel, Saving's synchronous
linearization point, transactional merge, failed/cancelled history and all stored
comments/seen/NEW/Undo/view preservation rules remain. No schema or durable progress
records are added. Verification and optional live command are in [Testing](../TESTING.md).
