# Sanitized extractor fixture matrix

ADR 0006 updates representative avatar fields with harmless HTTPS example.invalid
URLs in yt-nested-a and community-thread-a. A separate anonymous 0.4.0 recapture
verified integer English `like_count` accessibility labels (`"N like(s)"`); the
invented `"4 likes"` in community-thread-a reproduces that type/grammar. All 34
comment thumbnails were HTTPS; the post author used a protocol-relative URL.
community-limited reproduces that still-invalid post avatar using
`//example.invalid/post-author.png`. Existing fixtures remain honestly reconstructed,
with no public source names/URLs/text copied. The old serializer checks below are
historical; no helper is required to exercise these changes in normal tests.

Normal Vitest tests read these JSON files only. They need no network, YouTube,
helper installation, cookies, credentials, or Python. The optional development
serializer check below is not part of the test suite.

Each file wraps `raw` backend output with trusted capture `context` and fixture
documentation. The wrapper is a test artifact, not a helper output format.
Versions, preparation, preserved fields, behavior, and invocation characteristics
are recorded per file. Side-channel evidence must not be confused with a field
serialized by either helper.

Original investigation dumps were not present in the repository. These are
**reconstructed-sanitized**, not claimed live captures. They combine the owner's
completed anonymous investigation with inspection of the installed versions:

- yt-dlp **2026.08.19**, YouTube `_extract_comment` / `_extract_comment_old`
  and CLI option definitions. Release commit:
  `3a08beaf031ab68f966401ead017ac81fe8486cf`.
  `594bd50c2c78ac432f81600d309fdc4e0a92d82c` is its immediate pre-release
  parent; the relevant extractor source did not differ across the release commit.
  [Versioned upstream source](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/yt_dlp/extractor/youtube/_video.py).
- post-archiver-improved **0.4.0**, executable `post-archiver`, installed
  `models.py`, `output.py`, `scraper.py`, `extractors.py`, and `cli.py`;
  [upstream v0.4.0](https://github.com/sadadYes/post-archiver-improved/tree/v0.4.0)
  was the version in the investigation. All five Community raw objects were
  additionally checked through installed `ArchiveData.from_dict(...).to_dict()`:
  exact round trips passed, including serializer-derived `total_comments` and
  flattened archive metadata. This was a local, offline verification only.

| File | Backend/version | Preparation | Behavior and intentionally preserved structure |
| --- | --- | --- | --- |
| `yt-nested-a.json` | yt-dlp 2026.08.19 | Reconstructed, sanitized | Child before parent, two direct-parent reply levels, opaque IDs, literal `root`, optional likes/flags, relative label plus numeric timestamp, Polish/multiline text. |
| `yt-membership-b.json` | yt-dlp 2026.08.19 | Reconstructed, sanitized | Same item/root identities, two missing replies and a new root; each batch stands alone. |
| `yt-limited.json` | yt-dlp 2026.08.19 | Reconstructed, sanitized | One-comment limit with usable output; no raw completeness/partial flag. Partial evidence is in context. |
| `yt-disabled.json` | yt-dlp 2026.08.19 | Reconstructed, sanitized | Null collection and explicit comments-disabled side-channel category. Null by itself is insufficient. |
| `yt-unavailable.json` | yt-dlp 2026.08.19 | Reconstructed, sanitized | Null collection without disabled evidence, preserving the unavailable/empty distinction. |
| `yt-empty.json` | yt-dlp 2026.08.19 | Reconstructed, sanitized | Present empty array and zero count, still unknown completeness. |
| `community-thread-a.json` | post-archiver-improved 0.4.0 | Reconstructed, sanitized | Flattened one-post archive, nested replies, opaque IDs, thread containment, relative labels, image/link shapes, unreliable zero count and pin flag. |
| `community-membership-b.json` | post-archiver-improved 0.4.0 | Reconstructed, sanitized | Same post/root/shared reply, differing membership; serializer totals count extracted records only. |
| `community-limited.json` | post-archiver-improved 0.4.0 | Reconstructed, sanitized | Explicit one-comment/one-reply limits in invocation/config; partial evidence outside archive output. |
| `community-lossy.json` | post-archiver-improved 0.4.0 | Reconstructed, sanitized | Empty strings, string zero, false flags, empty arrays and nullable image-free metadata preserve default collapse. |
| `community-duplicate.json` | post-archiver-improved 0.4.0 | **Synthetic conflict** | Duplicate reply ID with different text and different containing roots, based on investigated duplicate-prone processing paths. Not evidence that this exact conflict was captured live. |

Names and all commenter/post text are invented. Item/comment/author IDs are
consistently remapped across pairs and references; punctuation in comment IDs
exercises opacity. Avatar URLs are empty defaults or harmless example.invalid
examples as described above; attachments/links also use example.invalid. Timestamps/labels are illustrative with their
types and estimation evidence preserved. No raw public dumps, source-person
mapping, user paths, authentication, or unnecessary video media metadata are
committed. These compact projections test the verified supported shapes, not
every field of the original helpers' output.

Malformed required shapes, missing/cyclic parent references, deeper Community
nesting, unsupported versions, optional-field corruption, and failed runs are
constructed explicitly in tests. They are labeled test cases, not captures.
No fixture proves complete coverage; counts and zero exit outcomes do not do so.
