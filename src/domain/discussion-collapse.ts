import { isViewIdentity, isRevision } from './discussion-view';

/** IDs are sparse exceptions to the discussion default, including currently
 * filtered-out comments. No row means fully expanded. */
export interface DiscussionCollapse {
  readonly defaultCollapsed: boolean;
  readonly overrides: readonly string[];
}
export const expandedDiscussion: DiscussionCollapse = { defaultCollapsed: false, overrides: [] };
/** Assignment commands are idempotent and bounded. Main validates ownership of
 * every identity before changing any state. All never materializes comment IDs. */
export type CollapseChange = { readonly kind: 'all'; readonly collapsed: boolean }
  | { readonly kind: 'comments'; readonly ids: readonly string[]; readonly collapsed: boolean };
export type SetDiscussionCollapseRequest = CollapseChange & { readonly viewId: string; readonly expectedRevision: number };
/** Exact runtime shape and size validation only; item ownership belongs to main. */
export function isSetDiscussionCollapseRequest(value: unknown): value is SetDiscussionCollapseRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (!isViewIdentity(row.viewId) || !isRevision(row.expectedRevision) || typeof row.collapsed !== 'boolean') return false;
  const keys = row.kind === 'all' ? ['viewId', 'expectedRevision', 'kind', 'collapsed'] : ['viewId', 'expectedRevision', 'kind', 'collapsed', 'ids'];
  return Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key))
    && (row.kind === 'all' || row.kind === 'comments' && Array.isArray(row.ids) && row.ids.length > 0 && row.ids.length <= 100000
      && row.ids.every(isViewIdentity) && new Set(row.ids).size === row.ids.length);
}
/** Pure immutable assignment shared by manual controls and ancestor reveal. */
export function changeCollapse(state: DiscussionCollapse, change: CollapseChange): DiscussionCollapse {
  if (change.kind === 'all') return { defaultCollapsed: change.collapsed, overrides: [] };
  const overrides = new Set(state.overrides);
  for (const id of change.ids) {
    if (change.collapsed === state.defaultCollapsed) overrides.delete(id);
    else overrides.add(id);
  }
  return { defaultCollapsed: state.defaultCollapsed, overrides: [...overrides] };
}
