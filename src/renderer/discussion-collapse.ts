import type { DiscussionCollapse } from '../domain/discussion-collapse';
import type { ReaderPresentation, ReaderRow } from './discussion-presentation';

export interface ReplySummary { readonly descendants: number; readonly unseen: number; readonly matches: number }
/** Complete logical order remains authoritative. Only rows/indexById are
 * compressed; every logical ID maps to its closest visible hiding ancestor. */
export interface CollapsedPresentation {
  readonly rows: readonly ReaderRow[];
  readonly indexById: ReadonlyMap<string, number>;
  readonly representativeById: ReadonlyMap<string, string>;
  readonly summaries: ReadonlyMap<string, ReplySummary>;
  readonly collapsed: ReadonlySet<string>;
}
/** Two iterative linear passes over the safe applied display preorder. Shared
 * ancestry is never copied or recursively traversed for each comment. */
export function projectCollapsedRows(complete: ReaderPresentation, state: DiscussionCollapse): CollapsedPresentation {
  const exceptions = new Set(state.overrides), collapsed = new Set<string>();
  const summaries = new Map<string, { descendants: number; unseen: number; matches: number }>();
  const rows: ReaderRow[] = [], indexById = new Map<string, number>(), representativeById = new Map<string, string>();
  for (const row of complete.rows) {
    summaries.set(row.id, { descendants: 0, unseen: 0, matches: 0 });
    if (row.hasChildren && (state.defaultCollapsed !== exceptions.has(row.id))) collapsed.add(row.id);
    const parentRepresentative = row.parentId === null ? undefined : representativeById.get(row.parentId);
    const hiddenBy = parentRepresentative !== undefined && (parentRepresentative !== row.parentId || collapsed.has(parentRepresentative))
      ? parentRepresentative : undefined;
    representativeById.set(row.id, hiddenBy ?? row.id);
    if (hiddenBy === undefined) { indexById.set(row.id, rows.length); rows.push(row); }
  }
  for (let index = complete.rows.length - 1; index >= 0; index--) {
    const row = complete.rows[index];
    if (row.parentId === null) continue;
    const own = summaries.get(row.id), parent = summaries.get(row.parentId);
    if (!own || !parent) throw new Error('Complete applied presentation must contain display parents');
    parent.descendants += own.descendants + 1;
    parent.unseen += own.unseen + Number(!row.comment.seen);
    parent.matches += own.matches + Number(row.role === 'match');
  }
  return { rows, indexById, representativeById, summaries, collapsed };
}

/** One ancestor walk only for an explicit target; unrelated branches and the
 * target's own collapsed preference remain untouched. */
export function collapsedAncestors(id: string, complete: ReaderPresentation, state: DiscussionCollapse): string[] {
  const exceptions = new Set(state.overrides), ids: string[] = [];
  let index = complete.indexById.get(id);
  let parent = index === undefined ? null : complete.rows[index].parentId;
  while (parent !== null) {
    if (state.defaultCollapsed !== exceptions.has(parent)) ids.push(parent);
    index = complete.indexById.get(parent);
    parent = index === undefined ? null : complete.rows[index].parentId;
  }
  return ids;
}
