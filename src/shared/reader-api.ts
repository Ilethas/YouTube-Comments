import type { Comment, ContentItem } from '../domain/discussion';
import type { Appearance, Locale, Preferences } from './preferences';
import type { WorkspaceState } from '../domain/workspace';
import type { BulkSeenRequest, SeenMutationResult, SeenUndoResult, SeenUndoDescriptor } from '../domain/seen-operation';
import type { HelperRequest, HelperStatus } from './helper-settings';

export type ErrorCode = 'INVALID_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND' | 'STORAGE_UNAVAILABLE' | 'UNSUPPORTED_SCHEMA'
  | 'ACQUISITION_BUSY' | 'HELPER_UNAVAILABLE' | 'HELPER_INCOMPATIBLE' | 'ACQUISITION_FAILED' | 'NOT_REFRESHABLE' | 'NOT_REMOVABLE';
/** Stable codes cross IPC; raw privileged diagnostics never reach the renderer. */
export type Result<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: ErrorCode } };

export interface ReaderState {
  /** Items include a main-derived latest accepted discovery attempt; NEW can be
   * reconstructed after restart without a renderer flag or extra IPC command. */
  readonly items: readonly ContentItem[];
  readonly comments: Readonly<Record<string, readonly Comment[]>>;
  readonly preferences: Preferences;
  readonly workspace: WorkspaceState;
  readonly seenUndo: Readonly<Record<string, SeenUndoDescriptor | null>>;
}
export interface ToggleSeenRequest {
  readonly itemId: string;
  readonly commentId: string;
  readonly subtree: boolean;
}
export type PreferenceChange = { readonly locale: Locale } | { readonly appearance: Appearance };

export interface AcquireRequest { readonly url: string }
export interface TabRequest { readonly tabId: string }
export interface MoveTabRequest extends TabRequest { readonly toIndex: number }
export interface RefreshRequest { readonly itemId: string }
/** Compact acknowledgment, without raw output, process details or provenance. */
export interface AcquisitionResult {
  readonly state: ReaderState;
  readonly summary: { readonly itemId: string; readonly coverage: 'unknown' | 'partial' | 'complete';
    readonly inserted: number; readonly updated: number; readonly warnings: number };
}

/** Intent-only capabilities. No generic invoke, SQL, executable input or Node handles. */
export interface ReaderApi {
  getHelperStatus(request: HelperRequest): Promise<Result<HelperStatus>>;
  chooseHelper(request: HelperRequest): Promise<Result<HelperStatus | null>>;
  clearHelper(request: HelperRequest): Promise<Result<HelperStatus>>;
  bootstrap(): Promise<Result<ReaderState>>;
  toggleSeen(request: ToggleSeenRequest): Promise<Result<SeenMutationResult>>;
  bulkSeen(request: BulkSeenRequest): Promise<Result<SeenMutationResult>>;
  undoSeen(request: RefreshRequest): Promise<Result<SeenUndoResult>>;
  updatePreferences(change: PreferenceChange): Promise<Result<Preferences>>;
  acquire(request: AcquireRequest): Promise<Result<AcquisitionResult>>;
  refresh(request: RefreshRequest): Promise<Result<AcquisitionResult>>;
  openStoredItem(request: RefreshRequest): Promise<Result<WorkspaceState>>;
  activateTab(request: TabRequest): Promise<Result<WorkspaceState>>;
  closeTab(request: TabRequest): Promise<Result<WorkspaceState>>;
  openLibrary(): Promise<Result<WorkspaceState>>;
  openSettings(): Promise<Result<WorkspaceState>>;
  moveTab(request: MoveTabRequest): Promise<Result<WorkspaceState>>;
  removeLibraryItem(request: RefreshRequest): Promise<Result<ReaderState>>;
}

export const readerChannels = {
  getHelperStatus: 'reader:helper-status', chooseHelper: 'reader:choose-helper', clearHelper: 'reader:clear-helper',
  bootstrap: 'reader:bootstrap', toggleSeen: 'reader:toggle-seen', updatePreferences: 'reader:preferences',
  bulkSeen: 'reader:bulk-seen', undoSeen: 'reader:undo-seen',
  acquire: 'reader:acquire', refresh: 'reader:refresh',
  openLibrary: 'reader:open-library', openSettings: 'reader:open-settings', moveTab: 'reader:move-tab', removeLibraryItem: 'reader:remove-library-item',
  openStoredItem: 'reader:open-stored-item', activateTab: 'reader:activate-tab', closeTab: 'reader:close-tab',
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
/** Exact semantic identity only: no path, arguments, environment or shell fields. */
export function isHelperRequest(value: unknown): value is HelperRequest {
  return exactKeys(value, ['kind']) && (value.kind === 'yt-dlp' || value.kind === 'post-archiver');
}
/** Bounded frozen matching payload supports 50k discussions without generic ID writes.
 * Main separately enforces item ownership before any mutation. */
export function isBulkSeenRequest(value: unknown): value is BulkSeenRequest {
  if (!exactKeys(value, ['itemId', 'seen', 'target']) || !identifier(value.itemId) || typeof value.seen !== 'boolean') return false;
  const target = value.target;
  if (exactKeys(target, ['kind']) && target.kind === 'all') return true;
  if (exactKeys(target, ['kind', 'ids']) && target.kind === 'matching') return Array.isArray(target.ids)
    && target.ids.length <= 100000 && target.ids.every(identifier) && new Set(target.ids).size === target.ids.length;
  if (target === null || typeof target !== 'object' || Array.isArray(target)) return false;
  const date = target as Record<string, unknown>;
  return Object.hasOwn(date, 'kind') && date.kind === 'publication' && Object.keys(date).every(key => ['kind', 'from', 'to'].includes(key))
    && (Object.hasOwn(date, 'from') || Object.hasOwn(date, 'to'))
    && ['from', 'to'].every(key => !Object.hasOwn(date, key) || typeof date[key] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date[key] as string));
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

export function isTabRequest(value: unknown): value is TabRequest {
  return exactKeys(value, ['tabId']) && identifier(value.tabId);
}
export function isMoveTabRequest(value: unknown): value is MoveTabRequest {
  return exactKeys(value, ['tabId', 'toIndex']) && identifier(value.tabId)
    && Number.isSafeInteger(value.toIndex) && (value.toIndex as number) >= 0;
}
