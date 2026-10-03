/** Remote observations only: no application IDs, persistence rows, discovery or local state. */
export type ContentSourceKind = 'youtube-video' | 'youtube-community-post';

/** Only observed values may update remote fields later. Unknowns never authorize clearing.
 * `lossy-default` means the backend already collapsed absence and a real empty value;
 * `unreliable` means even a non-default output cannot establish the claimed fact. */
export type ObservedField<T> =
  | { readonly status: 'observed'; readonly value: T }
  | { readonly status: 'unknown'; readonly reason: 'unavailable' | 'lossy-default' | 'unreliable' | 'invalid' | 'unsupported' };

export interface AuthorObservation {
  readonly sourceId: ObservedField<string>;
  readonly displayName: ObservedField<string>;
  readonly handle: ObservedField<string>;
  readonly avatarUrl: ObservedField<string>;
}

/** An instant's spelling/resolution does not establish source precision. Relative labels
 * are retained without resolving them against the parser's clock. */
export interface PublicationObservation {
  readonly instant: ObservedField<string>;
  readonly label: ObservedField<string>;
  readonly precision: 'exact' | 'coarse' | 'unknown';
  readonly estimated: ObservedField<boolean>;
}

/** Thread containment must never be used as a direct replied-to-author relationship. */
export type CommentRelationship =
  | { readonly kind: 'top-level' }
  | { readonly kind: 'direct-parent'; readonly parentSourceId: string }
  | { readonly kind: 'thread-containment'; readonly rootSourceId: string };

export interface ImageObservation {
  readonly url: string;
  readonly width: ObservedField<number>;
  readonly height: ObservedField<number>;
}

export interface LinkObservation {
  readonly url: string;
  readonly text: ObservedField<string>;
}

export interface ContentObservation {
  readonly sourceKind: ContentSourceKind;
  readonly sourceId: string;
  readonly canonicalUrl: ObservedField<string>;
  readonly title: ObservedField<string>;
  readonly text: ObservedField<string>;
  readonly author: AuthorObservation;
  readonly publication: PublicationObservation;
  readonly images: ObservedField<readonly ImageObservation[]>;
  readonly links: ObservedField<readonly LinkObservation[]>;
  readonly likeCount: ObservedField<number>;
  readonly reportedCommentCount: ObservedField<number>;
}

export interface CommentObservation {
  readonly sourceId: string;
  readonly text: ObservedField<string>;
  readonly author: AuthorObservation;
  readonly publication: PublicationObservation;
  readonly relationship: CommentRelationship;
  readonly likeCount: ObservedField<number>;
  readonly pinned: ObservedField<boolean>;
  readonly creator: ObservedField<boolean>;
}

/** Collection presence is separate from coverage: an empty array does not prove completeness. */
export type CommentCollectionObservation =
  | { readonly status: 'present'; readonly comments: readonly CommentObservation[] }
  | { readonly status: 'unavailable'; readonly reason: 'disabled' | 'unknown' };

/** Evidence is supplied by the capture/runner, never inferred from exit status or counts.
 * These adapters reserve `complete` for future affirmative backend evidence and never emit it. */
export type ObservationCoverage =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'partial'; readonly evidence: readonly string[] }
  | { readonly kind: 'complete'; readonly evidence: readonly string[] }
  | { readonly kind: 'failed'; readonly reason: string };

/** Descriptive backend identity does not participate in remote source identity. */
export interface ExtractionProvenance {
  readonly backend: string;
  readonly version: string;
  readonly evidence: readonly string[];
  readonly fixture?: { readonly id: string; readonly preparation: 'captured-sanitized' | 'reconstructed-sanitized' | 'synthetic' };
}

export interface NormalizationIssue {
  readonly code: 'invalid-json' | 'invalid-structure' | 'invalid-field' | 'duplicate-identity' | 'missing-parent' | 'cyclic-relationship';
  readonly severity: 'warning' | 'error';
  /** Structural input location only; never copies untrusted raw record content. */
  readonly location: string;
  readonly sourceId?: string;
  readonly relatedLocations?: readonly string[];
}

/** A candidate observation batch, not a valid stored tree. Duplicate candidates are retained
 * with issues so a later policy cannot silently choose one. Failed batches publish no item. */
export type NormalizedExtraction = {
  readonly provenance: ExtractionProvenance;
  readonly issues: readonly NormalizationIssue[];
} & (
  | { readonly coverage: Exclude<ObservationCoverage, { kind: 'failed' }>; readonly item: ContentObservation; readonly collection: CommentCollectionObservation }
  | { readonly coverage: Extract<ObservationCoverage, { kind: 'failed' }>; readonly item?: never; readonly collection?: never }
);
