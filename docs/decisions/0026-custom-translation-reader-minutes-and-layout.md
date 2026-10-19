# ADR 0026: Custom translation, reader minutes and activity/layout usability

Accepted, 2026-10-17, owner-requested focused increment.

Schema 12 transactionally rebuilds only preferences to widen the historical
schema-9 target CHECK. It explicitly copies id, locale, appearance, target,
selection controls and collapsed-prefix preference with their constraints.
`translation_target` remains app, a preset code, or custom;
`custom_translation_target` separately retains the last saved custom code, even
while a preset/app is active. Null means no saved custom code. Custom activation
requires a saved valid code; updating a code and activating it is one atomic write.
Historical migrations remain unchanged. Exact known schemas, pre-migration safety,
staged older-backup upgrades, newer-schema rejection and profile identities remain.

Shared renderer/main validation trims surrounding whitespace, accepts a 2–8 ASCII
letter base and optional 1–8 ASCII alphanumeric hyphen-separated subtags, maximum
35 characters. Control characters (including surrounding controls), auto, URLs,
query fragments, punctuation, internal whitespace and empty input reject. Syntax
does not promise Google support. Settings exposes Custom…/Własny…, a draft,
explicit Save, localized errors/examples, and a keyboard/screen-reader-accessible
help button with an expanded help paragraph. Failed saves retain committed intent.
Main still reads stored comment text and the effective target, uses URLSearchParams
for sl=auto/tl/text/op=translate, and retains the existing privacy, full-text copy
fallback and text/URL limits. No background translation or API exists.

Reader custom publication criteria add optional semantic fromTime/toTime HH:mm
strings. The shared custom resolver now serves both `resolvePublication` and
`resolveBulkPublication`; bulk additionally requires at least one date. Each time
needs its corresponding date. Blank times retain day-start/next-day boundaries;
explicit From is inclusive and explicit To ends exclusively one elapsed minute
after the uniquely resolved instant. Equal entered minutes are valid; reversed
or empty clock intervals reject. Temporal rejects ambiguous/nonexistent specified
local minutes, while date-only skipped/repeated-midnight rules stay unchanged.
Presets retain their existing behavior. Bounds resolve once using evaluation-time
system IANA zone/clock before worker dispatch. The per-comment predicate and best
available publication evidence remain unchanged. No UTC bounds persist.

Times participate in draft/applied equality, status, semantic saved-view validation,
restart and Refresh. Old date-only JSON remains valid. Native form validity guards
Apply and Ctrl+Enter against partial date/time inputs. Failed validation/evaluation
retains applied results and never writes seen state. Query worker deadline,
cancellation and numeric payload remain unchanged.

The small indeterminate acquisition/Refresh/backup/restore ring intentionally keeps
steady rotation under prefers-reduced-motion, including Windows animation effects
disabled. This supersedes only ADR 0022's spinner motion rule. It introduces no
global motion override, percentage, pulse or flash; textual stages and elapsed time
remain, and settlement removes busy UI.

Video headers order actions/status/Refresh, title with source action, optional
thumbnail, description, then metadata. This supersedes ADR 0025's placement only.
Thumbnail caching, expansion, keyboard/menu behavior and comment anchors remain.
Community headers remain unchanged.

Selection circles occupy a shared outer lane rather than moving avatars within
each nested row. They share the avatar center's vertical coordinate. Tree rails
use shared avatar gutter variables and responsive indentation expressions; shallow
elbows and compact deep returns retain their hierarchy. A width budget preserves
content space at narrow widths. Existing virtual row measurement and anchor
restoration handle selection/locale/width changes; no selection semantics change.
When invalidation occurs during scrolling, the virtualizer may skip synchronous
measurement without a subsequent resize event. Keep ordinary idle measurement and
refresh a snapshot of only the mounted rows on the next animation frame in that
case. This prevents estimate-height overlap after narrow/locale/zoom reflow without
adding per-scroll projection or unbounded measurement work.

M8.2 [ADR 0035](0035-reader-menu-selection-and-lifecycle-presentation.md) supersedes
the fixed-column choice: circles now use the same effective row indentation next
to their own avatars, with a reserved gutter and no selection-mode text reflow.
Rail/avatar projection and virtual measurement remain unchanged.

See [Testing](../TESTING.md) for deterministic and disposable Electron evidence.
