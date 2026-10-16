# ADR 0022 — Reader actions, external links and translation preferences

Status: accepted and implemented, 2026-10-16.

## Context

Row-wide Shift marking conflicts with native selection. Reading also needs
discoverable source/translation actions without broadening renderer authority,
inventing creator/channel identity, or changing applied views and manual seen state.

## Decision

- Remove Shift/Ctrl+Shift comment-surface mutations and their registry/help entries.
  No replacement modifier exists. Checkbox click toggles one comment; Ctrl+checkbox
  applies that resulting value to the entire stored subtree. Existing atomic writes,
  durable revision-owned Undo, frozen applied membership, NEW and ruler remain.
  Pointer selection, Shift extension, cross-element selection and Copy stay native.
- Use a 16px CSS circular spinner in global acquisition status. Its coarse stage,
  elapsed time, Cancel and operation identity remain unchanged. Saving and Updating
  view are non-cancellable. Reduced motion disables rotation; the ring and textual
  stage remain visible. No percentage or new progress transport is introduced.
- Accent the video author's name and show a compact Creator badge only when the
  normalized `isCreator` evidence is positively true. This is yt-dlp's observed
  `author_is_uploader`, never a display-name/handle/avatar/relationship comparison.
  Community metadata supplies no reliable creator evidence and has no highlight.
- Bootstrap comments carry main-derived action availability, without destinations.
  `openCommentAction({itemId, commentId, action})` accepts exactly author/permalink/
  translate. Main validates arity/keys, reads stored identity through indexed owned
  lookups, checks item ownership and reconstructs fixed HTTPS destinations. It never
  trusts remote URLs or accepts renderer text, target language, path or process args.
- Author actions prefer `UC` plus 22 ASCII identity characters at `/channel/ID`.
  Fallback handles require a leading @, 3–30 Unicode letters/numbers with internal
  `.`, `_`, `-`, or `·`, and no leading/trailing separators. This conservative subset
  deliberately omits some valid short/international handles. Display names are not
  identities. Missing/invalid identity leaves ordinary text. Synthetic source items
  expose no external comment actions.
- Video comment actions reconstruct `watch?v=VIDEO_ID&lc=COMMENT_ID` using validated
  stored source IDs, including bounded reply suffixes. Application-local IDs never
  become source IDs. Relative/estimated publication labels retain their meaning;
  available original coarse labels remain visible and date tooltips say approximately.
  No verified stable Community comment destination is established by the adapter's
  fields or reviewed documentation, so its timestamp stays plain. The existing
  explicitly labeled heading action opens the post.
- Translation opens `https://translate.google.com/?sl=auto&tl=…&text=…&op=translate`
  through the existing main-owned browser capability. URLSearchParams encodes the
  full text as UTF-8, including newlines and emoji. The complete encoded URL must
  fit 8000 ASCII characters; input is also capped at 5000 UTF-16 units, conservatively
  respecting Google's documented 5000-character web limit. Longer comments reject
  with TRANSLATION_TOO_LONG; localized feedback offers full-text Copy and manual
  translation in smaller parts, never silent truncation.
  Copy uses renderer clipboard access to already visible text; no new privileged
  clipboard capability exists. Copy failure explains native selection/Copy.
- Settings explains that this explicit action sends the comment text to Google
  through the browser. There are no APIs, credentials, background requests, cache,
  translation persistence or raw URL/text diagnostics. Browser exceptions are not
  logged, since they may embed the generated URL.
- Schema 9 additively adds constrained `preferences.translation_target`, default
  `app`. Allowed choices: app, en, pl, de, fr, es, it, pt, ja, ko, zh-CN. Main resolves
  app against the current persisted EN/PL interface choice when activated. Explicit
  choices remain independent. The existing acknowledged FIFO persists preferences.
  Schemas 1–8 retain exact known-schema validation, verified pre-migration snapshots
  and staged restore migration; no reset, downgrade or alternate settings store.
- Keep the existing app-owned outline SVG strategy in one ActionIcon vocabulary,
  with consistent currentColor, stroke and sizing. Refresh, Cancel/close, seen/unseen,
  Translate, external opening, Copy, Undo, Library and Settings share this vocabulary.
  This bounded set does not justify a new icon dependency. Controls have localized
  labels/tooltips and focus indication; icons are decorative. Row actions use semantic
  buttons for identity-based browser commands, with underlined author/time affordances
  and small external glyphs. Translate has a visible localized label, independent of
  hover. No future feature receives an inert button.

Actions do not change persistent selected identity, query navigation, seen or sort.
No row click handler exists. Actions suppress activation during text selection across
their control. Virtualization still mounts a bounded row window, with local action
state only on mounted rows. Main computes capabilities during its existing read,
validating the item destination once; no per-render IPC or per-click forest rebuild.

## Evidence and limits

[YouTube handle guidance](https://support.google.com/youtube/answer/11585688?hl=en)
documents channel handles and international/length exceptions. The conservative
fallback above is an application safety policy, not a claim to accept every handle.
[YouTube comment help](https://support.google.com/youtube/answer/6000976?hl=en)
describes timestamp access to highlighted comments; it does not establish a verified
Community permalink template for this adapter. Remote availability, deleted comments,
browser/network behavior and Google's UI remain outside local guarantees.

[Google Translate Help](https://support.google.com/translate/answer/6142478?hl=en-GB)
documents the 5000-character web text limit. Both text and encoded-URL bounds apply;
the app cannot promise that Google's external UI or availability stays unchanged.

See [Testing](../TESTING.md) for executed deterministic, native Electron and packaged
checks and their explicit external-browser verification limits. Thread collapse,
selection modes, menus and new bulk scopes remain separate milestones.
