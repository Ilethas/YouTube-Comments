import type { Comment, ContentItem } from '../domain/discussion';
import type { Appearance, Locale, Preferences } from './preferences';

export type ErrorCode = 'INVALID_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND' | 'STORAGE_UNAVAILABLE' | 'UNSUPPORTED_SCHEMA'
  | 'ACQUISITION_BUSY' | 'HELPER_UNAVAILABLE' | 'HELPER_INCOMPATIBLE' | 'ACQUISITION_FAILED' | 'NOT_REFRESHABLE';
/** Stable codes cross IPC; privileged diagnostics/paths never reach the renderer. */
export type Result<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: ErrorCode } };

export interface ReaderState {
  readonly items: readonly ContentItem[];
  readonly comments: Readonly<Record<string, readonly Comment[]>>;
  readonly preferences: Preferences;
}
export interface ToggleSeenRequest {
  readonly itemId: string;
  readonly commentId: string;
  readonly subtree: boolean;
}
export type PreferenceChange = { readonly locale: Locale } | { readonly appearance: Appearance };

export interface AcquireRequest { readonly url: string }
export interface RefreshRequest { readonly itemId: string }
/** Compact acknowledgment, without raw output, process details or provenance. */
export interface AcquisitionResult {
  readonly state: ReaderState;
  readonly summary: { readonly itemId: string; readonly coverage: 'unknown' | 'partial' | 'complete';
    readonly inserted: number; readonly updated: number; readonly warnings: number };
}

/** Intent-only capabilities. No generic invoke, SQL, paths or Node handles. */
export interface ReaderApi {
  bootstrap(): Promise<Result<ReaderState>>;
  toggleSeen(request: ToggleSeenRequest): Promise<Result<readonly Comment[]>>;
  updatePreferences(change: PreferenceChange): Promise<Result<Preferences>>;
  acquire(request: AcquireRequest): Promise<Result<AcquisitionResult>>;
  refresh(request: RefreshRequest): Promise<Result<AcquisitionResult>>;
}

export const readerChannels = {
  bootstrap: 'reader:bootstrap', toggleSeen: 'reader:toggle-seen', updatePreferences: 'reader:preferences',
  acquire: 'reader:acquire', refresh: 'reader:refresh',
} as const;
export type ReaderOperation = keyof typeof readerChannels;

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && [...value].every(character => character.charCodeAt(0) >= 32);
}
/** Validate untrusted serialized payloads at main, including unexpected fields. */
export function isToggleSeenRequest(value: unknown): value is ToggleSeenRequest {
  return exactKeys(value, ['itemId', 'commentId', 'subtree'])
    && identifier(value.itemId) && identifier(value.commentId) && typeof value.subtree === 'boolean';
}
export function isPreferenceChange(value: unknown): value is PreferenceChange {
  return (exactKeys(value, ['locale']) && (value.locale === 'en' || value.locale === 'pl'))
    || (exactKeys(value, ['appearance']) && ['system', 'light', 'dark'].includes(value.appearance as string));
}
export function isAcquireRequest(value: unknown): value is AcquireRequest {
  return exactKeys(value, ['url']) && typeof value.url === 'string' && value.url.length > 0 && value.url.length <= 2048;
}
export function isRefreshRequest(value: unknown): value is RefreshRequest {
  return exactKeys(value, ['itemId']) && identifier(value.itemId);
}
