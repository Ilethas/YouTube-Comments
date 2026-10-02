# 0005 — Live helper execution and acquisition IPC

Date: 2026-10-03. Status: accepted for Windows development acquisition.

## Context and evidence

ADR 0003's pinned adapters and ADR 0004's accumulating SQLite merge are
authoritative. This increment connects public acquisition and explicit refresh
to them without changing schema, field authority, source relationships, seen
state, baseline treatment or NEW lifetime.

The installed post-archiver-improved **0.4.0** `cli.py` declares argparse
`--version` with `post-archiver {__version__}` before configuration or scraping.
The selected installed executable returned exactly `post-archiver 0.4.0`.
Its `config.py` accepts a minimal explicit JSON config and bypasses ambient
configuration search. `output.py` generates timestamped archive filenames;
`scraper.py` initially assigns `post_<id>` but replaces metadata.channel_id with
the author's channel or `unknown` before saving. Actual successful individual
post naming therefore uses `posts_<channel>_YYYYMMDD_HHMMSS.json`, rather than
the post-prefixed name suggested by the output method's docstring.

The installed yt-dlp executable returned **2026.08.19** with
`--ignore-config --no-plugin-dirs --version`. The owner's first PATH entry for
yt-dlp is a batch wrapper around an executable outside PATH. A batch wrapper is
not eligible for no-shell Windows resolution; add the actual executable's
directory to the launching process's PATH for development. No installation,
wrapper interpretation, machine-specific production path or Python discovery
is introduced.

## Decision

- Electron main owns `AcquisitionService`, `createLiveExtractor`, the injectable
  PATH resolver and asynchronous structured process executor. Domain/adapters,
  repository, preload and React never launch processes.
- Development resolution scans absolute nonempty PATH directories in order for
  `yt-dlp.exe` / `post-archiver.exe` on Windows, and executable bare filenames
  elsewhere. Relative/current-directory lookup and Windows batch scripts are
  excluded. Resolution remains replaceable for later app-local artifacts.
- Probe the same selected executable on every attempt: yt-dlp's isolated version
  command, or Community's verified `--version`. Probe deadline is at most ten
  seconds. Only exact supported version output is accepted. Unverified or
  unsupported versions return `HELPER_INCOMPATIBLE`; absence/ENOENT returns
  `HELPER_UNAVAILABLE`. No unsupported output reaches the adapters.
- `spawn` receives an executable and trusted-builder argument array with
  `shell: false`, hidden Windows child windows, ignored stdin and separate
  stdout/stderr. No renderer input controls executable, arguments, environment,
  output/config paths, working directory or process handles.
- yt-dlp uses config/plugin isolation, single-video/single-JSON comments,
  skip-download, no playlists, 15-second socket timeout and two configured
  retries. No cookies, browser profile, media download or format-tolerance flag.
- Community uses one public post, comments, application-owned limits of 1,000
  comments and 1,000 replies, 15-second timeout and two configured retries.
  Child-only `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` prevent the investigated
  Windows encoding failure. Broken `--quiet` is excluded.
- Community gets a unique OS-temp workspace and output subdirectory, with
  `anonymous.json` containing only
  `{"scraping":{"cookies_file":null,"download_images":false}}`. The verified
  defaults supply other config fields, while explicit arguments own bounds and
  output. Exactly one JSON archive matching the verified channel/unknown naming
  pattern is required. Nonregular/oversized files and missing/ambiguous JSON
  fail. Normalized source identity must equal the requested target for both
  backends. Workspace removal runs in `finally` on success and failure; cleanup
  failure prevents ingestion. Raw archives are not retained by default.
- Stdout/archive input is bounded at 128 MiB; stderr capture is bounded at
  64 KiB, separate from JSON. Neither raw payloads nor arbitrary diagnostics
  are logged/persisted/exposed. History uses fixed application tokens, verified
  version, bounded numeric exit-code evidence and adapter structural issues.
  Existing repository sanitization still applies; retention remains open.
- Every nonzero exit fails, even if output can be parsed. Zero exit never proves
  complete coverage. Community's configured caps produce partial invocation
  evidence; ordinary yt-dlp output is unknown, or conservatively partial if its
  stderr reports a warning. These labels do not infer deletion or count equality.
- Overall helper execution has a 180-second deadline including probe time.
  Deadline/output-limit/shutdown terminates the child; Windows uses structured
  `System32/taskkill.exe /PID <owned pid> /T /F` to include Python launcher's
  descendants, with direct-kill fallback. Wait for process close before cleanup.
  Normal application quit aborts and awaits cleanup before closing SQLite.
  Abrupt OS termination cannot guarantee `finally`; crash-temp recovery remains
  future work. No user cancellation, scheduled refresh or extra retry loop.
- A temporary application-wide single-live-acquisition lock returns
  `ACQUISITION_BUSY` for overlap. Bootstrap, seen and preference operations remain
  available while extraction awaits. No transaction spans helper execution or
  normalization. This is a narrow milestone scheduler, not permanent policy.
- Main parses HTTPS youtube.com/www.youtube.com watch and individual /post URLs,
  plus youtu.be video links. Video IDs are eleven URL-safe characters; post IDs
  have the supported `Ug` prefix and bounded URL-safe characters. Canonicalization
  drops tracking/playlist parameters. Credentials, unsupported hosts/paths,
  protocols, listing pages, malformed/duplicate video IDs and arbitrary URLs
  fail without network probing.
- The five-method typed bridge adds exactly `acquire({url})` and
  `refresh({itemId})`; exact-key/arity guards and owning-window/top-frame/document
  validation remain. Refresh reconstructs its target from stored kind/source ID.
  Missing items return `NOT_FOUND`; synthetic/insufficient source identity returns
  `NOT_REFRESHABLE`. Stable acquisition errors never carry raw process/fs errors.
- Success returns committed ReaderState and a compact summary of item ID,
  coverage, inserted/updated counts and warning count, without attempt/provenance
  internals. Failures record failed attempts through the same ingestion path;
  storage failures roll back and return `STORAGE_UNAVAILABLE` without a second
  history write. Shutdown interruption does not ingest after closing begins.
- React adds URL/Enter submission and real-item Refresh, busy/status and localized
  failures in English/Polish. A known source merges into the same item. Acquire
  activates its item; refresh retains current selection. Seen controls stay
  available; acknowledged local seen updates are reconciled across acquisition
  response ordering. Real items use current render time and local-library wording;
  fixed-clock/NEW examples remain confined to demo items. No real NEW badges.

## Reasons and consequences

Explicit probes avoid trusting an incompatible installed format. No-shell
execution and intent-only IPC prevent acquisition from becoming a general
process capability. Anonymous owned config avoids accidental cookies and
ambient settings. Conservative outcomes protect valuable stored comments;
current-state transactional ingestion preserves seen changes made during awaits.

The limits favor bounded development verification over a completeness claim.
Large acquisitions may fail at the deadline or memory bound. JSON parsing and
SQLite ingestion remain synchronous in main and full-reader rendering remains
unvirtualized; large-library performance work is still needed.

Deterministic injected-process, temporary-directory/SQLite, IPC and React tests
cover this path. The real built-entry Electron smoke harness injects fake process
execution only in its privileged test script, exercises both backends and
refresh/failure/restart, and needs no network or installed helpers. See
[Testing](../TESTING.md) for executed results and separate optional live outcomes.

Helpers are **not bundled**, downloaded, installed or updated. Distributable
completion, runtime/artifact selection, licenses, integrity/signing, update
ownership, cancellation/progress, crash recovery, larger-data scheduling and
diagnostic retention remain unresolved. Search, bulk recovery, workspace,
virtualization/ruler, NEW lifetime, polls and remote deletion are unchanged.
