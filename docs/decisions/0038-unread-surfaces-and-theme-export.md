# ADR 0038: Independent unread surfaces and offline theme export

Status: Implemented, uncommitted for owner review (2026-10-21).

Actual Windows use exposed weak unseen-row contrast in Light and Charcoal:
the shared accent-soft token served ordinary controls and was further diluted by
the row's 65% transparency. Changing it would also recolor ordinary Charcoal
surfaces. Introduce one optional version-1 token, unseen-surface, with exactly
the existing hex validation. All original 15 tokens remain required; unknown
tokens still reject. Old imported/stored/backup palettes remain valid and retain
the original mix when this token is absent. Dark omits it and keeps its exact
palette and row rendering. Light/Charcoal supply opaque unread fills, so wallpaper
cannot dilute them. This changes neither database schema 15 nor historical migrations.

Use the same shared palette resolver for rendering and export, including System
OS resolution. Settings offers the current palette and all four offline starter
templates through one narrow enum-only export intent. Main captures the palette
before the native Save dialog, authenticates its exact parent document, checks
lifecycle fences afterward and before atomic replacement, and writes validated
UTF-8 JSON. No renderer paths, JSON payloads or generic filesystem capability.
Exports/imports share the existing single pending appearance-dialog slot; exports
do not change SQLite, CAS revisions, active appearance or shared commit state.
Profile-directory destinations (including parent junction aliases) are rejected.

Default the native Save dialog to Documents rather than installed resources.
Bundling all starters behind this action gives packaged ZIP users offline editable
copies without another directory picker, automatic folder creation or watcher.
Warm Graphite's bundled definition must exactly equal the documented example.
Editing remains external, followed by an explicit Settings import.

Verification: strict legacy/optional-token validation, text/focus contrast floors,
all-template and selected-custom export/import round-trips, System resolution,
no-mutation/cancel/write failure/origin/barrier checks, native long virtualized
reader theme/wallpaper/badge/focus matrix, and real Save dialogs in the unmodified
ZIP EXE. Personal-image/physical-display preferences remain owner review.
