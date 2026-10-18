import type { ReaderState } from './reader-api';

/** Revisions are comparable only within this repository incarnation. A fresh
 * random epoch on reopen/restart requires a fresh authoritative snapshot. */
export interface SharedStamp { readonly profileEpoch: string; readonly commitRevision: number }
export type SharedChange = { readonly kind: 'watermark' | 'helpers' | 'workspace' | 'preferences' }
  | { readonly kind: 'item' | 'removed' | 'seen-invalidation'; readonly itemId: string }
  | { readonly kind: 'seen'; readonly itemId: string; readonly values: readonly { readonly id: string; readonly seen: boolean }[];
      readonly undo: ReaderState['seenUndo'][string] };
export interface SharedCommit extends SharedStamp { readonly change: SharedChange }
/** One owned semantic seed: no comments, geometry, or evaluated result IDs. */
export interface SharedViewSnapshot extends SharedStamp {
  readonly viewId: string;
  readonly instance: ReaderState['viewInstances'][string];
  readonly intent?: ReaderState['discussionViews'][string];
  readonly collapse?: ReaderState['discussionCollapse'][string];
}
export interface SharedSnapshot extends SharedStamp { readonly state: ReaderState }
/** A scoped snapshot includes small global metadata, never unrelated comments.
 * It cannot advance past unseen revisions; the replica requests full recovery then. */
export interface SharedItemSnapshot extends SharedStamp {
  readonly itemId: string;
  readonly item: ReaderState['items'][number] | null;
  readonly comments: ReaderState['comments'][string];
  readonly undo: ReaderState['seenUndo'][string];
  readonly workspace: ReaderState['workspace'];
  readonly viewInstances: ReaderState['viewInstances'];
}
export interface SharedMetadata extends SharedStamp { readonly preferences: ReaderState['preferences']; readonly workspace: ReaderState['workspace']; readonly viewInstances: ReaderState['viewInstances'] }
export const sharedCommitChannel = 'reader:shared-commit';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256 && [...v].every(c => c.charCodeAt(0) >= 32);
export function isSharedStamp(v: unknown): v is SharedStamp {
  return object(v) && typeof v.profileEpoch === 'string' && /^[a-f0-9-]{36}$/.test(v.profileEpoch)
    && Number.isSafeInteger(v.commitRevision) && Number(v.commitRevision) >= 0;
}
/** Exact bounded notifications are checked again inside preload. No arbitrary
 * topics, renderer identities, content text, SQL or executable payloads. */
export function isSharedCommit(v: unknown): v is SharedCommit {
  if (!object(v) || !exact(v, ['profileEpoch', 'commitRevision', 'change']) || !isSharedStamp(v) || !object(v.change)) return false;
  const c = v.change;
  if (['watermark', 'helpers', 'workspace', 'preferences'].includes(String(c.kind))) return exact(c, ['kind']);
  if (c.kind === 'item' || c.kind === 'removed' || c.kind === 'seen-invalidation') return exact(c, ['kind', 'itemId']) && id(c.itemId);
  if (c.kind !== 'seen' || !exact(c, ['kind', 'itemId', 'values', 'undo']) || !id(c.itemId)
    || !Array.isArray(c.values) || c.values.length > 256 || !c.values.every(x => object(x) && exact(x, ['id', 'seen']) && id(x.id) && typeof x.seen === 'boolean')
    || new Set(c.values.map(x => x.id)).size !== c.values.length) return false;
  const u = c.undo;
  return u === null || object(u) && exact(u, ['id', 'itemId', 'createdAt', 'kind', 'targetSeen', 'targetCount', 'changedCount'])
    && id(u.id) && u.itemId === c.itemId && typeof u.createdAt === 'string' && u.createdAt.length <= 40
    && ['all', 'matching', 'publication', 'subtree', 'selected', 'view-prefix'].includes(String(u.kind)) && typeof u.targetSeen === 'boolean'
    && Number.isSafeInteger(u.targetCount) && Number(u.targetCount) >= 0 && Number(u.targetCount) <= 100000
    && Number.isSafeInteger(u.changedCount) && Number(u.changedCount) >= 0 && Number(u.changedCount) <= Number(u.targetCount);
}
