# ADR 0025: Profile-owned video thumbnail cache

Status: Accepted, 2026-10-17 (owner-requested bounded milestone).

Video headers need optional offline images and explicit OS-viewer opening, without
comment reacquisition, binary SQLite storage or another application window.

Use existing image observations for eligible yt-dlp `thumbnail` / `thumbnails`
metadata. Sources must use HTTPS `i.ytimg.com`, a known individual thumbnail
variant, and the stored validated 11-character YouTube video ID in the path.
Rank maxresdefault, hq720, sddefault, hqdefault, mqdefault; retain at most two
metadata URLs and four canonical JPEG fallbacks, deduplicated and quality ordered.
Existing videos therefore need no extractor invocation. Posts, synthetic demos
and invalid identities make no requests. Missing metadata remains unknown.
The upstream [yt-dlp single-video extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_video.py)
provides both observed and generated variants; availability is established by
validated downloaded bytes, never by the URL or advertised dimensions alone.

Main owns a `thumbnails` directory beside the explicitly resolved profile database.
`<videoId>.json` associates canonical identity, HTTP validators, successful-check
and attempted-check clocks with `<videoId>-<SHA256>.<actual jpg/png/webp format>`.
Raster signatures, dimensions and Electron decoding must agree. Limits: 5 MiB,
320x180 minimum, 8192 per dimension and 20 million pixels maximum; maxres/hq720
must be at least 640 wide. This rejects common 120x90 missing-image placeholders.
Preserve original bytes without cropping/re-encoding. Files commit before an
atomic manifest replacement; the prior entry survives any failed download/write.
Obsolete successful versions are removed best-effort. Crash-orphan cleanup and
disk quotas are not implemented; this cache can always be regenerated.

One pending job per canonical video and at most two active network jobs (32 waiting)
bound work independently of comment count. Each candidate has at most two attempts,
six seconds per request and thirty seconds for the whole active job. Redirects
are manual, at most two, and must pass the same origin/path/identity policy.
Connection-time DNS allows only public IPv4; IPv6-only environments fail closed.
Bodies stream with a hard byte limit; credentials, cookies, compression and unsafe
redirects are excluded. Accepted MIME and signatures are JPEG/PNG/WebP, with a
successful platform decoder also required. Failures are quiet presentation failures.

Read cached bytes first. Check freshness asynchronously after activation, and every
24 hours while active. A successful check is fresh for 24 hours. Explicit source
Refresh may force an independent check even if comment extraction fails. Missing
or failing sources have a persisted 15-minute backoff, including forced checks.
Use ETag/Last-Modified for the same URL and respect 304. Changed bytes at the same
URL produce a new content hash/capability; failed checks retain the old image.
Valid changed images may have lower resolution; tiny placeholders still reject.

Renderer sends item identity through get/check/open-thumbnail intents only. Existing
exact-payload and top-level-window IPC authorization apply. A secure application
image scheme serves bounded raster bytes through opaque runtime UUID capabilities;
it exposes no cache paths and cannot fetch arbitrary URLs. Each read rechecks stored
canonical identity. Capabilities are bounded and revoked on deletion. CSP permits
this image scheme without relaxing script, filesystem, navigation or window policy.

The header shows a 360px, max-width 100%, 16:9 contained image between the action
row and title. A native button toggles full reading-column width immediately, with
localized action labels and focus indication. Expansion stays mounted-local.
Missing/loading/failed-decoding images reserve no space. The existing accessible
menu supplies only Open in image viewer; explicit activation re-resolves and checks
the cached regular file in main, then calls `shell.openPath`. Failures return safe
localized feedback. No automatic viewer invocation or local shell/openExternal URL.

Thumbnail state is isolated from discussion sessions. Header geometry updates retain
comment identity/offset using the existing virtualizer cache, without invalidating
row heights. Native scroll anchoring is disabled for panels containing thumbnails
so it cannot double-correct the virtualizer's explicit restoration.

No schema migration. SQLite snapshots exclude cache bytes and HTTP validators;
normalized source metadata remains ordinary evidence. Restore never associates by
internal item ID alone. Removal commits first, then deletes the cache only when no
stored video reference remains; cleanup failure cannot undo Library removal.
Seen/history/NEW/query/sort/collapse/selection remain independent of image results.

Deterministic HTTP/cache/IPC/component tests and built-entry Electron first/restart/
offline interaction checks cover the boundary. OS viewer invocation is mocked;
live YouTube retrieval and live OS-viewer integration are not claimed verified.
