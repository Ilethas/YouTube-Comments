import { isDiscussionQuery, isDiscussionViewIntent, isRevision, isViewIdentity } from '../domain/discussion-view';
import type { DiscussionViewIntent } from '../domain/discussion-view';
import type { DiscussionViewResult } from '../domain/discussion-query';
import type { SharedStamp } from './reader-sync';
import { isSharedStamp } from './reader-sync';
import type { Result } from './reader-api';

/** Transient, versioned, identity-only live view. Never written to SQLite.
 * 100k rows and 32 Mi UTF-16 units accommodate existing 50k fixtures without
 * cloning comments, source evidence, DOM objects or worker state. */
export interface LiveViewHandoff {
  readonly version: 1;
  readonly viewId: string;
  readonly itemId: string;
  readonly stamp: SharedStamp;
  readonly intent: DiscussionViewIntent;
  readonly result: DiscussionViewResult;
  readonly runtimeApplied: import('../domain/discussion-query').DiscussionQuery;
  readonly restoreFailed: boolean;
  readonly error: import('../domain/discussion-query').QueryErrorCode | null;
  readonly orderedIds: readonly string[];
  readonly mostLikedAvailable: boolean;
  readonly seenStale: boolean;
  readonly bulkSelected: readonly string[];
  readonly bulkAnchor: string | null;
  readonly selectionMode: boolean;
  readonly discoveryId: string | null;
}
export interface TransferDestination { readonly windowId: string; readonly number: number; readonly revision: number }
export interface TransferRequest {
  readonly tabId: string;
  readonly expectedRevision: number;
  readonly destination: { readonly windowId: string; readonly expectedRevision: number; readonly beforeTabId: string | null } | 'new';
  readonly intentRevision: number | null;
  readonly collapseRevision: number | null;
  readonly ownerGeneration: string | null;
  readonly handoff: LiveViewHandoff | null;
}
/** Main reserves exact endpoints before the source starts its final checkpoint. */
export type TransferStart = Pick<TransferRequest, 'tabId' | 'expectedRevision' | 'destination'>;
export interface TransferSubmission { readonly token: string; readonly request: TransferRequest }
export type TransferEvent = { readonly kind: 'prepare'; readonly token: string; readonly tabKind: 'discussion' | 'library' | 'settings'; readonly handoff: LiveViewHandoff | null }
  | { readonly kind: 'cancelled' | 'committed'; readonly token: string; readonly tabId: string };
export interface TabTransferApi {
  destinations(): Promise<Result<readonly TransferDestination[]>>;
  begin(request: TransferStart): Promise<Result<{ readonly token: string }>>;
  move(submission: TransferSubmission): Promise<Result<{ readonly tabId: string; readonly mergedIntoTabId: string | null }>>;
  ready(request: { readonly token: string; readonly accept: boolean }): Promise<Result<null>>;
  cancel(request: { readonly token: string }): Promise<Result<null>>;
  adopted(request: { readonly viewId: string; readonly ownerGeneration: string }): Promise<Result<null>>;
  onEvent(listener: (event: TransferEvent) => void): () => void;
}
export const transferChannels = { destinations: 'reader:transfer-destinations', begin: 'reader:transfer-begin', move: 'reader:transfer-move', ready: 'reader:transfer-ready', cancel: 'reader:transfer-cancel', adopted: 'reader:transfer-adopted', event: 'reader:transfer-event' } as const;
export const exactTransferKeys = (v: unknown, keys: readonly string[]): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const ids = (v: unknown): v is readonly string[] => Array.isArray(v) && v.length <= 100000 && v.every(isViewIdentity) && new Set(v).size === v.length;
export function isLiveViewHandoff(v: unknown): v is LiveViewHandoff {
  if (!exactTransferKeys(v, ['version', 'viewId', 'itemId', 'stamp', 'intent', 'result', 'runtimeApplied', 'restoreFailed', 'error', 'orderedIds', 'mostLikedAvailable', 'seenStale', 'bulkSelected', 'bulkAnchor', 'selectionMode', 'discoveryId'])
    || v.version !== 1 || !isViewIdentity(v.viewId) || !isViewIdentity(v.itemId) || !isSharedStamp(v.stamp) || !exactTransferKeys(v.stamp, ['profileEpoch', 'commitRevision'])
    || !isDiscussionQuery(v.runtimeApplied) || typeof v.restoreFailed !== 'boolean'
    || !(v.error === null || ['NO_SEARCH_FIELDS', 'INVALID_REGEX', 'QUERY_TOO_EXPENSIVE', 'QUERY_FAILED', 'QUERY_CANCELLED', 'INVALID_PUBLICATION_DATE', 'INVALID_PUBLICATION_RANGE', 'INVALID_PUBLICATION_TIME', 'INVALID_LOCAL_TIME'].includes(String(v.error)))
    || !isDiscussionViewIntent(v.intent) || !ids(v.orderedIds) || !ids(v.bulkSelected) || !(v.bulkAnchor === null || isViewIdentity(v.bulkAnchor))
    || !(v.discoveryId === null || isViewIdentity(v.discoveryId)) || !['mostLikedAvailable', 'seenStale', 'selectionMode'].every(k => typeof v[k] === 'boolean')) return false;
  const r = v.result;
  if (!exactTransferKeys(r, ['restrictive', 'searchActive', 'rawSearchMatchIds', 'activeMatchIds', 'containingThreadIds', 'visibleCommentIds', 'visibleParentIds', 'orderedMatchIds', 'matchCount', 'threadCount'])
    || typeof r.restrictive !== 'boolean' || typeof r.searchActive !== 'boolean'
    || ![r.rawSearchMatchIds, r.activeMatchIds, r.containingThreadIds, r.visibleCommentIds, r.orderedMatchIds].every(ids)
    || !isRevision(r.matchCount) || !isRevision(r.threadCount) || r.matchCount !== (r.activeMatchIds as string[]).length || r.threadCount !== (r.containingThreadIds as string[]).length
    || !r.visibleParentIds || typeof r.visibleParentIds !== 'object' || Array.isArray(r.visibleParentIds)) return false;
  const visible = new Set(r.visibleCommentIds as string[]), parents = r.visibleParentIds as Record<string, unknown>;
  if (Object.keys(parents).length !== visible.size || v.orderedIds.length !== visible.size || v.orderedIds.some(id => !visible.has(id))
    || [...visible].some(id => !Object.hasOwn(parents, id) || parents[id] !== null && (!isViewIdentity(parents[id]) || !visible.has(parents[id] as string)))
    || [r.activeMatchIds, r.containingThreadIds, r.orderedMatchIds, v.bulkSelected].some(list => (list as string[]).some(id => !visible.has(id)))) return false;
  const visited = new Set<string>();
  for (const id of v.orderedIds) { if (parents[id] !== null && !visited.has(parents[id] as string)) return false; visited.add(id); }
  if (v.bulkAnchor !== null && !visible.has(v.bulkAnchor) || v.intent.selected !== null && !visible.has(v.intent.selected)) return false;
  return JSON.stringify(v).length <= 32 * 1024 * 1024;
}
export function isTransferRequest(v: unknown): v is TransferRequest {
  return exactTransferKeys(v, ['tabId', 'expectedRevision', 'destination', 'intentRevision', 'collapseRevision', 'ownerGeneration', 'handoff'])
    && isViewIdentity(v.tabId) && isRevision(v.expectedRevision)
    && (v.destination === 'new' || exactTransferKeys(v.destination, ['windowId', 'expectedRevision', 'beforeTabId']) && isViewIdentity(v.destination.windowId)
      && isRevision(v.destination.expectedRevision) && (v.destination.beforeTabId === null || isViewIdentity(v.destination.beforeTabId)))
    && (v.intentRevision === null || isRevision(v.intentRevision)) && (v.collapseRevision === null || isRevision(v.collapseRevision))
    && (v.ownerGeneration === null || isViewIdentity(v.ownerGeneration)) && (v.handoff === null || isLiveViewHandoff(v.handoff));
}
export function isTransferStart(v: unknown): v is TransferStart {
  return exactTransferKeys(v, ['tabId', 'expectedRevision', 'destination']) && isTransferRequest({ ...v, intentRevision: null, collapseRevision: null, ownerGeneration: null, handoff: null });
}
export function isTransferEvent(v: unknown): v is TransferEvent {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return isViewIdentity(r.token) && (r.kind === 'prepare' ? exactTransferKeys(r, ['kind', 'token', 'tabKind', 'handoff'])
    && ['discussion', 'library', 'settings'].includes(String(r.tabKind)) && (r.handoff === null || isLiveViewHandoff(r.handoff))
    : exactTransferKeys(r, ['kind', 'token', 'tabId']) && ['cancelled', 'committed'].includes(String(r.kind)) && isViewIdentity(r.tabId));
}
