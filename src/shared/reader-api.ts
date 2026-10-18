import type { SharedStamp, SharedCommit, SharedSnapshot, SharedItemSnapshot, SharedMetadata } from './reader-sync';
import type { AcquisitionNotification, AcquisitionProgress, AcquisitionTimings } from './acquisition';
import type { Comment, ContentItem } from '../domain/discussion';
import { normalizeTranslationCode, translationTargets } from './preferences';
import type { Appearance, Locale, Preferences, TranslationTarget, SelectionControls } from './preferences';
import type { WorkspaceState } from '../domain/workspace';
import type { BulkSeenRequest, SeenMutationResult, SeenUndoResult, SeenUndoDescriptor } from '../domain/seen-operation';
import type { HelperRequest, HelperStatus } from './helper-settings';
import type { DiscussionViewIntent, SaveDiscussionViewRequest } from '../domain/discussion-view';
import type { DiscussionCollapse, SetDiscussionCollapseRequest } from '../domain/discussion-collapse';
import type { DataBackupResult } from './data-backup';

export type ErrorCode = 'INVALID_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND' | 'STORAGE_UNAVAILABLE' | 'UNSUPPORTED_SCHEMA'
  | 'ACQUISITION_CANCELLED' | 'ACQUISITION_BUSY' | 'HELPER_UNAVAILABLE' | 'ACQUISITION_FAILED' | 'NOT_REFRESHABLE' | 'NOT_REMOVABLE' | 'SOURCE_OPEN_FAILED' | 'NOT_OPENABLE'
  | 'UNDO_CONFLICT' | 'TRANSLATION_TOO_LONG' | 'INVALID_BACKUP' | 'NEWER_BACKUP' | 'OLDER_BACKUP' | 'DATA_BUSY' | 'DATA_WRITE_FAILED' | 'RESTORE_FAILED' | 'RECOVERY_REQUIRED';
/** Stable codes cross IPC; raw privileged diagnostics never reach the renderer. */
export type Result<T> = { readonly ok: true; readonly value: T; readonly sync?: SharedStamp | SharedCommit }
  | { readonly ok: false; readonly sync?: SharedStamp | SharedCommit; readonly error: { readonly code: ErrorCode } };

export interface ReaderState {
  /** Items include a main-derived latest accepted discovery attempt; NEW can be
   * reconstructed after restart without a renderer flag or extra IPC command. */
  readonly items: readonly ContentItem[];
  readonly comments: Readonly<Record<string, readonly Comment[]>>;
  readonly preferences: Preferences;
  readonly workspace: WorkspaceState;
  readonly seenUndo: Readonly<Record<string, SeenUndoDescriptor | null>>;
  readonly discussionCollapse: Readonly<Record<string, DiscussionCollapse>>;
  readonly discussionViews: Readonly<Record<string, DiscussionViewIntent>>;
}
export interface ToggleSeenRequest {
  readonly itemId: string;
  readonly commentId: string;
  readonly subtree: boolean;
  readonly seen: boolean;
}
export type PreferenceChange = { readonly locale: Locale } | { readonly appearance: Appearance } | { readonly translationTarget: TranslationTarget; readonly customTranslationTarget?: string }
  | { readonly selectionControls: SelectionControls } | { readonly includeCollapsedInPrefix: boolean };
/** Identity only; main reads content and preferences and reconstructs destinations. */
export interface CommentActionRequest { readonly itemId: string; readonly commentId: string; readonly action: 'author' | 'permalink' | 'translate' | 'copy-permalink' }

export interface AcquireRequest { readonly url: string }
export interface TabRequest { readonly tabId: string }
export interface MoveTabRequest extends TabRequest { readonly toIndex: number }
export interface UndoSeenRequest { readonly itemId: string; readonly expectedOperationId: string }
export interface RefreshRequest { readonly itemId: string }
/** Compact acknowledgment, without raw output, process details or provenance. */
export interface AcquisitionResult {
  readonly operationId: string;
  readonly timings: AcquisitionTimings;
  readonly state: ReaderState;
  readonly summary: { readonly itemId: string; readonly coverage: 'unknown' | 'partial' | 'complete';
    readonly inserted: number; readonly updated: number; readonly warnings: number };
}

/** Intent-only capabilities. No generic invoke, SQL, executable input or Node handles. */
export interface ReaderApi {
  readonly lifecycle?: import('./profile-operation').ProfileLifecycleApi;
  onSharedCommit(listener: (commit: SharedCommit) => void): () => void;
  getSharedSnapshot(request?: RefreshRequest): Promise<Result<SharedSnapshot | SharedItemSnapshot>>;
  getSharedMetadata(): Promise<Result<SharedMetadata>>;
  getThumbnail(request: RefreshRequest): Promise<Result<string | null>>;
  checkThumbnail(request: RefreshRequest): Promise<Result<string | null>>;
  openThumbnail(request: RefreshRequest): Promise<Result<null>>;
  openCommentAction(request: CommentActionRequest): Promise<Result<null>>;
  createBackup(): Promise<Result<DataBackupResult>>;
  restoreBackup(): Promise<Result<DataBackupResult>>;
  onAcquisitionProgress(listener: (progress: AcquisitionNotification) => void): () => void;
  getAcquisitionProgress(): Promise<Result<AcquisitionProgress | null>>;
  cancelAcquisition(request: { readonly operationId: string }): Promise<Result<null>>;
  setDiscussionCollapse(request: SetDiscussionCollapseRequest): Promise<Result<null>>;
  saveDiscussionView(request: SaveDiscussionViewRequest): Promise<Result<null>>;
  openSource(request: RefreshRequest): Promise<Result<null>>;
  getHelperStatus(request: HelperRequest): Promise<Result<HelperStatus>>;
  chooseHelper(request: HelperRequest): Promise<Result<HelperStatus | null>>;
  clearHelper(request: HelperRequest): Promise<Result<HelperStatus>>;
  bootstrap(): Promise<Result<ReaderState>>;
  toggleSeen(request: ToggleSeenRequest): Promise<Result<SeenMutationResult>>;
  bulkSeen(request: BulkSeenRequest): Promise<Result<SeenMutationResult>>;
  undoSeen(request: UndoSeenRequest): Promise<Result<SeenUndoResult>>;
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
  getSharedSnapshot: 'reader:shared-snapshot', getSharedMetadata: 'reader:shared-metadata',
  getThumbnail: 'reader:get-thumbnail', checkThumbnail: 'reader:check-thumbnail', openThumbnail: 'reader:open-thumbnail',
  openCommentAction: 'reader:comment-action',
  createBackup: 'reader:create-backup', restoreBackup: 'reader:restore-backup',
  getAcquisitionProgress: 'reader:acquisition-current', cancelAcquisition: 'reader:cancel-acquisition',
  setDiscussionCollapse: 'reader:set-discussion-collapse',
  saveDiscussionView: 'reader:save-discussion-view',
  openSource: 'reader:open-source',
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
/** Bounded frozen matching/explicit intents support 50k discussions with narrow reasons.
 * Main separately enforces item ownership before any mutation. */
export function isBulkSeenRequest(value: unknown): value is BulkSeenRequest {
  if (!exactKeys(value, ['itemId', 'seen', 'target']) || !identifier(value.itemId) || typeof value.seen !== 'boolean') return false;
  const target = value.target;
  if (exactKeys(target, ['kind']) && target.kind === 'all') return true;
  if (exactKeys(target, ['kind', 'ids']) && target.kind === 'matching') return Array.isArray(target.ids)
    && target.ids.length <= 100000 && target.ids.every(identifier) && new Set(target.ids).size === target.ids.length;
  if (exactKeys(target, ['kind', 'reason', 'ids']) && target.kind === 'explicit') return ['selected', 'view-prefix'].includes(target.reason as string)
    && Array.isArray(target.ids) && target.ids.length > 0 && target.ids.length <= 100000
    && target.ids.every(identifier) && new Set(target.ids).size === target.ids.length;
  if (target === null || typeof target !== 'object' || Array.isArray(target)) return false;
  const date = target as Record<string, unknown>;
  return Object.hasOwn(date, 'kind') && date.kind === 'publication' && Object.keys(date).every(key => ['kind', 'from', 'to', 'fromTime', 'toTime'].includes(key))
    && (Object.hasOwn(date, 'from') || Object.hasOwn(date, 'to'))
    && ['from', 'to'].every(key => !Object.hasOwn(date, key) || typeof date[key] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date[key] as string))
    && ['from', 'to'].every(key => !Object.hasOwn(date, `${key}Time`) || Object.hasOwn(date, key)
      && typeof date[`${key}Time`] === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(date[`${key}Time`] as string));
}
/** Validate untrusted serialized payloads at main, including unexpected fields. */
export function isToggleSeenRequest(value: unknown): value is ToggleSeenRequest {
  return exactKeys(value, ['itemId', 'commentId', 'subtree', 'seen'])
    && identifier(value.itemId) && identifier(value.commentId) && typeof value.subtree === 'boolean' && typeof value.seen === 'boolean';
}
export function isPreferenceChange(value: unknown): value is PreferenceChange {
  return (exactKeys(value, ['locale']) && (value.locale === 'en' || value.locale === 'pl'))
    || (exactKeys(value, ['appearance']) && ['system', 'light', 'dark'].includes(value.appearance as string))
    || (exactKeys(value, ['translationTarget']) && translationTargets.includes(value.translationTarget as TranslationTarget))
    || (exactKeys(value, ['translationTarget', 'customTranslationTarget']) && value.translationTarget === 'custom'
      && normalizeTranslationCode(value.customTranslationTarget) !== undefined)
    || (exactKeys(value, ['selectionControls']) && ['on-demand', 'always'].includes(value.selectionControls as string))
    || (exactKeys(value, ['includeCollapsedInPrefix']) && typeof value.includeCollapsedInPrefix === 'boolean');
}
export function isCommentActionRequest(value: unknown): value is CommentActionRequest {
  return exactKeys(value, ['itemId', 'commentId', 'action']) && identifier(value.itemId) && identifier(value.commentId)
    && ['author', 'permalink', 'translate', 'copy-permalink'].includes(value.action as string);
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

export function isUndoSeenRequest(value: unknown): value is UndoSeenRequest {
  return exactKeys(value, ['itemId', 'expectedOperationId']) && identifier(value.itemId) && identifier(value.expectedOperationId);
}
