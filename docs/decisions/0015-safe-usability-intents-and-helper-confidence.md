# ADR 0015: Safe usability intents and helper confidence

Date: 2026-10-14. Status: accepted. Supersedes the exact-version permission gates
in ADRs 0003/0005/0014 and extends ADR 0013's publication targeting. Other decisions
in those records remain in force.

## Context

Hands-on reading needs convenient original-source access, usable installed helper
versions, optional bulk clock boundaries, and easier explicit seen marking. This
record combines the bounded usability milestone's safety contracts: narrow
privileged intents, validated output, and deliberate transactional mutation. It
does not establish sorting, acquisition performance policy or helper distribution.
Checkbox hit-area CSS is an accompanying UI change, not an architectural decision.

## Decision

### Original-source capability

`openSource({ itemId })` accepts exactly one application identity and no URL.
Existing sender/top-frame/exact-document IPC checks apply. Main reads the stored
item without changing workspace/content, verifies its kind/source-kind pairing,
and reconstructs `https://www.youtube.com/watch?v=<encoded ID>` or
`https://www.youtube.com/post/<encoded ID>`. The existing supported-target parser
checks source ID grammar and the canonical HTTPS YouTube destination. Main alone
calls Electron `shell.openExternal`. Remote URL fields cannot authorize navigation.
Missing/unsupported/synthetic items fail safely; browser rejection returns a fixed
error and a compact localized header alert. No generic external-open capability,
raw remote link activation, or title hyperlink is introduced.

### Tested is confidence; output validation is safety

yt-dlp 2026.08.19 and post-archiver 0.4.0 become **tested** versions. The bounded
helper-specific probes retain their arguments and named output parsing. yt-dlp
must report a real Gregorian `YYYY.MM.DD`; Community must report
`post-archiver <major.minor.patch>`. A zero exit alone does not identify a helper.
Wrong/malformed output or failed execution is unavailable/invalid and blocks
acquisition. A credible different version is **untested**, accepted by the native
picker and persisted, with textual English/Polish warning and detected/tested
versions. There is no version-difference-as-incompatibility label.

Acquisition still probes every time, then uses the normal command, output limits,
timeouts, normalizers, target validation and preserving merge. Adapters retain
backend identity and all structural/field validation, without an exact-version
gate. CLI/process/malformed-required-structure failures preserve the stored
snapshot and prior recovery. An untested version contributes only the bounded
`untested-helper-version` provenance token; it does not change coverage, tolerate
malformed required fields, infer deletion or store stderr.

Startup environment > saved profile selection > safe direct PATH is unchanged,
as are fail-closed higher-priority paths, no-shell/.exe validation, serialized
Settings operations and immediate later-operation resolution. Q-19 now covers
distribution/artifacts/runtime/license/integrity/update ownership; no download,
bundling, update or expanded output-format contract is selected here.

### Bulk local minutes

Publication targets retain optional `from`/`to` ISO calendar dates and add optional
`fromTime`/`toTime` strict `HH:mm` strings. A time needs its corresponding date.
Only bulk seen controls expose times. Query criteria/UI/worker payload remain
date-only. Main captures the current system IANA zone inside the mutation
transaction and resolves the final target set there. Renderer confirmation uses
the same resolver/predicate for a current preview, never as mutation authority.

`resolveBulkPublication` shares ADR 0012's calendar validation/resolution. Blank
time is omitted: From is inclusive local day start, To is exclusive next local
day start. Date-only reversed/malformed ranges retain the existing rejection.
Explicit clock boundaries use Temporal with `disambiguation: 'reject'`: repeated
or skipped entered minutes produce localized validation and no write. Lower is
inclusive at the entered minute's start; upper is exclusive one minute after
the uniquely resolved entered instant. Zoned minute addition includes the whole
minute even at a following clock transition; it never guesses the entered time,
uses a current fixed offset or fabricates 59.999 seconds. Same From/To minute
is valid. A From instant greater than the effective exclusive To endpoint fails.
Date-only skipped/repeated midnight retains ADR 0012 start-of-day behavior.

Each comment's own usable publication instant remains authoritative, including
estimated/coarse evidence. Missing/label-only evidence fails. No ancestry,
discovery or item timestamp substitution exists. Recovery stores changed IDs and
revisions, not calendar targets, so schema 7 and the durable Undo representation
need no migration.

### Deliberate comment gestures (superseded)

ADR 0022 removes both row-wide Shift gestures below. They remain here as historical
rationale only; current marking uses explicit checkbox click / Ctrl+checkbox.

### Historical ADR 0015 behavior

Shift + primary click on the non-interactive comment surface toggles one comment;
Ctrl+Shift applies the clicked resulting state to all stored descendants. Plain,
right/middle, Alt and Meta row clicks send no seen command. Inputs, labels,
buttons, links, editable/role/tabbable controls and `data-interactive` descendants
are excluded. A non-collapsed selection intersecting the comment at pointer down
or click is preserved without mutation. Pointer down is never canceled.

The enlarged native checkbox label remains keyboard accessible with visible
focus. It handles its own surface click to retain modifiers and suppress browser
forwarding; input/keyboard clicks own themselves. This prevents duplicate bubbling
and retains Ctrl+checkbox subtree behavior. Settings presents **Shortcuts and
gestures**, including all three mouse gestures in both languages.

Both row gestures use the existing application-ID toggle intent and FIFO
acknowledgments. Main derives descendants from stored data, including unmounted
rows. ADR 0013 recovery remains exact: subtree changes of >1 actual comments
replace recovery; one actual change and ordinary single toggles retain prior
recovery. Applied match IDs/membership/order and NEW stay frozen; live unseen
counts/navigation/ruler update and seen-dependent views offer Apply.

## Reasons and consequences

Semantic IPC prevents renderer URLs or precomputed clock instants becoming
privileged authority. Shared Temporal/predicate logic avoids a second timezone
model. Tested-version warnings communicate confidence while runtime structure
validation protects stored discussions. Reusing the mutation intent preserves
Undo ownership and virtualization semantics without a second seen implementation.

Deterministic domain, component, temporary SQLite, exact IPC and built Electron
restart checks cover these contracts; executed checks and manual limitations are
recorded in [Testing](../TESTING.md). No sorting, performance optimization,
incremental extraction, preferences for gestures, seconds UI, time query filters,
persisted views, packaging fixes or release guarantees are added. The next
acquisition milestone measures before considering optimization. Future sorting
decisions use the next available ADR number (0016 or later).
