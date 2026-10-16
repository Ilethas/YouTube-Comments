import type { ReaderPresentation } from './discussion-presentation';
import type { CollapsedPresentation } from './discussion-collapse';

/** Explicit controls alone invoke this additive visual range operation. Hidden
 * and offscreen IDs never depend on mounted elements or source insertion order. */
export function toggleBulkSelection(selected: ReadonlySet<string>, id: string, anchor: string | undefined,
  shift: boolean, displayed: Pick<CollapsedPresentation, 'rows' | 'indexById'>): ReadonlySet<string> {
  const end = displayed.indexById.get(id);
  if (end === undefined) return selected;
  const next = new Set(selected), start = anchor === undefined ? undefined : displayed.indexById.get(anchor);
  if (shift && start !== undefined) {
    for (let index = Math.min(start, end); index <= Math.max(start, end); index++) next.add(displayed.rows[index].id);
  } else if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** Inclusive exact endpoint, never its subtree end. Snapshot uses complete
 * applied sorted order by default; visible-only mode removes collapsed replies. */
export function viewPrefix(complete: ReaderPresentation, displayed: CollapsedPresentation, endpoint: string, includeHidden: boolean) {
  if (!displayed.indexById.has(endpoint)) return undefined;
  const source = includeHidden ? complete : displayed, end = source.indexById.get(endpoint);
  if (end === undefined) return undefined;
  const rows = source.rows.slice(0, end + 1);
  return { ids: rows.map(row => row.id), hidden: rows.reduce((count, row) => count + Number(!displayed.indexById.has(row.id)), 0),
    position: end + 1, total: source.rows.length };
}
