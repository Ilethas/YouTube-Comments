# ADR 0037: Validated themes and bounded reader wallpaper

Status: Implemented, uncommitted for owner review (2026-10-21).

The owner requested neutral Charcoal surfaces, safe editable JSON palettes and
optional stationary wallpaper behind a centered reading column. Existing
System/Light/Dark choices, multi-window/lifecycle authority and reading geometry
must remain intact.

Use one strict version-1 semantic token structure for built-in JSON and imported
palettes. Install only allowlisted hex colors into the existing CSS variables.
Store validated custom definitions in SQLite configuration so themes survive both
upgrades and database backups; external theme-file execution/loading is unnecessary.
Schema 15 rebuilds only preferences with the expanded appearance CHECK and copies
every existing field verbatim, then adds one bounded `reader_appearance` JSON row.
Migrations 1–14 remain exact. Validate appearance JSON during loading and backup
validation. Keep the existing pre-migration safety and staged restore machinery.

Use authenticated payload-free native pickers. Main bounds files and raster
dimensions before actual decoding and converts wallpaper into immutable, digest-named
profile-owned JPEGs. nativeImage handles PNG/JPEG; static WebP uses a dedicated
sandboxed, network-denied WebContentsView with no preload or native window, a
deadline and explicit retained lifetime/cleanup. Main revalidates its output using
nativeImage. No renderer filesystem, arbitrary URL/CSS, new dependency, scripting
language, marketplace or application-directory discovery is introduced.

Wallpaper assets remain outside SQLite backups, like thumbnail presentation bytes,
but are not automatically regenerable. State this explicitly in Settings/docs;
missing/tampered assets safely fall back with a localized Settings notice. Retain
old immutable bytes to allow same-profile historical restore; asset pruning is a
separate policy. Production/development/demo/test paths follow database isolation.

Synchronize through existing post-COMMIT preferences notifications and replica
reconciliation. Appearance configuration has its own CAS revision; import captures
it before opening the picker, and selection/removal/deletion/draft Apply reject stale
revisions. Recheck exact origin and profile barriers after each import. Sliders stay
local until one acknowledged Apply; dirty drafts participate in Settings transfer
preserve/discard. Existing appearance choices retain their original ordered writes.

Keep wallpaper and translucent/blurred reading surface as empty stationary siblings
of the existing scroll panel inside a flex viewport wrapper. Blur is bounded to one
viewport-sized surface and cannot establish a fixed-position containing block for
menus/ruler/floating controls. Observe the actual column's horizontal bounds rather
than guessing scrollbar/DPI gutters. Ignore hidden zero scroll-offset observations
and reconcile retained native offsets on cached-tab reactivation, as the existing
measurement adapter already does for hidden zero dimensions. Row positioning,
anchors, selection and query membership retain their existing semantics. Forced
colors suppress decorative layers.

See [Appearance](../APPEARANCE.md) for the format, limits, backup contract and
verification; [Testing](../TESTING.md) records evidence and remaining owner gates.
