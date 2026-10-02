# Documentation map

This is the persistent specification for a YouTube discussion inbox/reader. The repository includes the synthetic Electron/React reader and its SQLite persistence milestone: main-owned discussions and manual seen state, durable English/Polish and System/Light/Dark preferences, ordered migrations, isolated profiles, and a typed validated preload API. Development/demo initialization still uses only synthetic data. Acquisition, refresh, filtering, workspace restoration, virtualization, and the overview ruler remain targets. See [the foundation ADR](decisions/0001-synthetic-reader-foundation.md), [persistence ADR](decisions/0002-sqlite-and-typed-reader-boundary.md), and [verification status](TESTING.md).

Pure extractor observation contracts, backend-specific parsers, command descriptions and sanitized deterministic fixtures are implemented in [ADR 0003](decisions/0003-extractor-observations-and-normalization.md). They have no live process, SQLite ingestion, preload or renderer integration. The initial product targets Windows and one active discussion at a time for normal search/filtering and generic bulk actions. Core search and the overview ruler remain required targets. The owner's clarified decisions are under [accepted foundations](decisions/README.md); remaining questions do not reopen them.

## Reading paths

For the project owner, begin with [How it works](HOW_IT_WORKS.md), then [Product requirements](PRODUCT_REQUIREMENTS.md). For implementation, read [agent guidance](../AGENTS.md), [Architecture](ARCHITECTURE.md), and the documents covering the requested increment. Review [open decisions](decisions/README.md) before filling in missing behavior.

| Document | Purpose |
| --- | --- |
| [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) | Scope, mandatory behavior, and acceptance examples |
| [HOW_IT_WORKS.md](HOW_IT_WORKS.md) | Plain-language end-to-end explanation for the owner |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Process boundaries, service responsibilities, data flow, and performance |
| [DOMAIN_MODEL.md](DOMAIN_MODEL.md) | Source-independent identities, comments, trees, and local/view state |
| [SEEN_STATE.md](SEEN_STATE.md) | Manual per-comment state and mutation rules |
| [REFRESH_AND_MERGE.md](REFRESH_AND_MERGE.md) | Discovery, safe merging, and refresh history |
| [FILTERING_AND_SEARCH.md](FILTERING_AND_SEARCH.md) | Match/context semantics, stable results, dates, and search |
| [UI_AND_NAVIGATION.md](UI_AND_NAVIGATION.md) | Tabs, reading, sorting, keyboard navigation, and overview ruler |
| [DATABASE.md](DATABASE.md) | SQLite storage, transactions, migrations, backup, and isolation |
| [EXTRACTORS.md](EXTRACTORS.md) | External helper adapters, normalization, and process lifecycle |
| [LOCALIZATION_AND_THEMING.md](LOCALIZATION_AND_THEMING.md) | English/Polish, locale-independent search, and appearance |
| [TESTING.md](TESTING.md) | Deterministic verification and later UI/release checks |
| [PACKAGING.md](PACKAGING.md) | Scaffold packaging status and future distribution requirements |
| [decisions/README.md](decisions/README.md) | Accepted foundations, unresolved choices, and ADR guidance |

## How to interpret these documents

- **Required / invariant**: behavior supplied by the product requirements; future increments must preserve it.
- **Proposed / candidate**: an implementation direction to evaluate, not an installed dependency or approved final design.
- **Unresolved / open**: behavior or policy still requiring a decision. Keep it explicit until settled; the [decision register](decisions/README.md) collects these questions.
- **Current scaffold**: a statement about files currently in the repository, separate from the target architecture.

Examples explain requirements; they do not supply otherwise unspecified defaults. Conceptual entity names, directory layouts, service names, and diagrams describe responsibilities rather than committed APIs or schemas. The detailed documents own their respective contracts; [Product requirements](PRODUCT_REQUIREMENTS.md) connects them. If descriptions conflict, resolve the conflict against the owner's requirements and update all affected documents together.

## Cross-cutting glossary

| Term | Meaning |
| --- | --- |
| Content item / discussion | One video or one Community Post with its locally stored discussion |
| Comment | An individual root comment or reply, each with its own seen state |
| Thread / conversation tree | A top-level comment and its descendants; not a persistent seen-state entity |
| Active discussion | The video or Community Post in the currently active reader tab; initial search/filter/bulk scope |
| Raw search match | A comment satisfying the search predicate itself, before the other filters |
| Active-filter match | A comment satisfying the complete filter set at the currently applied view evaluation |
| Context comment | A displayed conversation member that did not itself satisfy that evaluation's complete filter set |
| Unseen | A durable, manually controlled per-comment state |
| Discovery / visual NEW | Discovery is recorded for every imported comment; visual NEW excludes the first successful acquisition baseline and concerns subsequent refresh discoveries |
| Apply changes / Update view | Recompute a view from local data already persisted |
| Refresh | Remote acquisition, safe merge, then automatic recomputation of the active view after successful explicit refresh |

Seen edits update durable state immediately but retain the applied matching set and displayed membership/order until local Apply or successful explicit Refresh recomputes the view. Matching bulk actions and filtered-reader match navigation use that applied active-filter set. Publication-date predicates use `publishedAt`; "new since refresh" refers to discovery history, not publication dates. See [Filtering and search](FILTERING_AND_SEARCH.md).

See [Domain model](DOMAIN_MODEL.md) for identity and relationships and [Filtering](FILTERING_AND_SEARCH.md) for the precise result-set distinction.

## Maintenance

Documentation and tests are part of every behavior change. Update affected contracts and acceptance examples; record substantial architectural decisions as small [ADRs](decisions/README.md). Move a choice from open to accepted only when it is actually resolved. Avoid duplicating implementation detail in [AGENTS.md](../AGENTS.md); keep that file a concise instruction set and map.
