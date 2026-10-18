import type { ReaderRepository } from '../persistence/reader-repository';
import type { WorkspaceTab } from '../../domain/workspace';
import type { ReaderState } from '../../shared/reader-api';
import type { DatabaseSync } from 'node:sqlite';

/** Resolve real opaque identities in integration assertions, including dormant views. */
export function viewIdentity(repo: ReaderRepository, itemId: string): string {
  return Object.entries(repo.bootstrap(['en']).viewInstances).find(([, view]) => view.itemId === itemId)?.[0] ?? 'missing-view';
}
export function viewVersion(repo: ReaderRepository, itemId: string, lane: 'intent' | 'collapse' = 'intent') {
  const viewId = viewIdentity(repo, itemId), view = repo.bootstrap(['en']).viewInstances[viewId];
  return { viewId, expectedRevision: (lane === 'intent' ? view?.intentRevision : view?.collapseRevision) ?? 0 };
}
export function storedTab(repo: ReaderRepository, itemId: string): WorkspaceTab { return { id: viewIdentity(repo, itemId), kind: 'discussion', itemId }; }

/** Compare fixtures predating M4 by their legacy semantics. New M4 identities and
 * CAS counters did not exist there; dedicated M4 tests assert those exactly. */
export function legacyComparableState(state: ReaderState) {
  const { viewInstances, discussionViews, discussionCollapse, workspace, ...shared } = state;
  const id = (tabId: string) => { const tab = workspace.tabs.find(t => t.id === tabId); return tab?.kind === 'discussion' ? `discussion:${tab.itemId}` : tab?.kind ?? tabId; };
  const records = <T>(value: Readonly<Record<string,T>>) => Object.fromEntries(Object.entries(value).map(([key, v]) => [viewInstances[key]?.itemId ?? key, v]));
  return { ...shared, discussionViews: records(discussionViews), discussionCollapse: records(discussionCollapse), workspace: {
    ...workspace, activeTabId: workspace.activeTabId === null ? null : id(workspace.activeTabId), tabs: workspace.tabs.map(tab => ({ ...tab, id: id(tab.id) })) } };
}
/** Old migration tests still assert their original workspace fields after the
 * complete forward chain; this projects the final relational representation. */
export function historicalRows(db: DatabaseSync, table: string) {
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='app_windows'").get() || !['workspace','workspace_tabs'].includes(table)) return db.prepare(`SELECT * FROM ${table}`).all();
  if (table === 'workspace') return db.prepare(`SELECT 1 AS id,CASE WHEN w.active_tab_id IS NULL THEN NULL WHEN t.kind='discussion' THEN 'discussion:'||t.item_id ELSE t.kind END AS active_tab_id,w.topology_revision AS revision FROM app_windows w LEFT JOIN tab_instances t ON t.id=w.active_tab_id`).all();
  return db.prepare(`SELECT CASE t.kind WHEN 'discussion' THEN 'discussion:'||t.item_id ELSE t.kind END AS id,t.kind,t.item_id,p.position FROM window_tabs p JOIN tab_instances t ON t.id=p.tab_id ORDER BY p.position`).all();
}
