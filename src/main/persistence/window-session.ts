import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { isWindowGeometry } from '../../domain/window-geometry';
import type { WindowGeometry } from '../../domain/window-geometry';

export class WindowSessionConflict extends Error {}
export interface WindowSession { readonly revision: number; readonly windowIds: readonly string[]; readonly lastFocusedId: string }
export interface GeometryRecord { readonly revision: number; readonly geometry: WindowGeometry | null }
/** Main-only session authority. Each mutation participates in the repository's
 * ordered post-COMMIT stream; its CAS lane is independent of tab/view lanes. */
export class WindowSessionStore {
  constructor(private readonly db: DatabaseSync, private readonly commit: <T>(action: () => T) => T) {}
  read(): WindowSession {
    const row = this.db.prepare('SELECT * FROM window_session WHERE id=1').get();
    if (!row) throw new Error('Missing session');
    return { revision: Number(row.revision), lastFocusedId: String(row.last_focused_id),
      windowIds: this.db.prepare('SELECT window_id FROM window_restore ORDER BY position').all().map(r => String(r.window_id)) };
  }
  private advance(expected: number): void {
    if (!Number.isSafeInteger(expected) || expected < 0 || !this.db.prepare('UPDATE window_session SET revision=revision+1 WHERE id=1 AND revision=?').run(expected).changes) throw new WindowSessionConflict('Stale session');
  }
  private replace(ids: readonly string[], focus: string): void {
    if (!ids.length || new Set(ids).size !== ids.length || !ids.includes(focus)) throw new Error('Invalid restore set');
    this.db.exec('DELETE FROM window_restore');
    const insert = this.db.prepare('INSERT INTO window_restore VALUES (?,?)');
    ids.forEach((id, position) => insert.run(id, position));
    this.db.prepare('UPDATE window_session SET last_focused_id=? WHERE id=1').run(focus);
  }
  /** Provisional identity is durable but dormant. A main crash before native
   * construction/registration must not manufacture an intended live window. */
  allocate(): string {
    return this.commit(() => { const id = randomUUID(); this.db.prepare('INSERT INTO app_windows VALUES (?,NULL,0)').run(id); return id; });
  }
  create(expected = this.read().revision, liveIds?: readonly string[]): string {
    return this.commit(() => {
      this.advance(expected); const previous = this.read(), id = randomUUID();
      this.db.prepare('INSERT INTO app_windows VALUES (?,NULL,0)').run(id);
      const base = liveIds ?? previous.windowIds;
      this.replace([...base, id], base.includes(previous.lastFocusedId) ? previous.lastFocusedId : id); return id;
    });
  }
  /** New native creation has not succeeded. Its empty logical row may remain
   * dormant, but it cannot enter the next launch's session. */
  abandon(id: string, expected = this.read().revision, fallback?: WindowSession): void {
    if (!this.read().windowIds.includes(id)) return;
    this.commit(() => {
      this.advance(expected); const state = this.read(), ids = state.windowIds.filter(value => value !== id);
      if (!ids.length && fallback) this.replace(fallback.windowIds, fallback.lastFocusedId);
      else this.replace(ids, ids.includes(state.lastFocusedId) ? state.lastFocusedId : ids[0]);
    });
  }
  closed(id: string, expected = this.read().revision): void {
    this.commit(() => {
      this.advance(expected); const state = this.read();
      if (!state.windowIds.includes(id)) throw new WindowSessionConflict('Window is dormant');
      const ids = state.windowIds.length === 1 ? [id] : state.windowIds.filter(value => value !== id);
      this.replace(ids, ids.includes(state.lastFocusedId) ? state.lastFocusedId : ids[ids.length - 1]);
    });
  }
  quit(ids: readonly string[], focus: string | undefined, expected = this.read().revision): void {
    this.commit(() => {
      this.advance(expected); const state = this.read();
      // Zero live windows on macOS/last-close retains the final acknowledged set.
      const next = ids.length ? ids : state.windowIds;
      this.replace(next, focus && next.includes(focus) ? focus : next.includes(state.lastFocusedId) ? state.lastFocusedId : next[next.length - 1]);
    });
  }
  focused(id: string, expected = this.read().revision): void {
    if (this.read().lastFocusedId === id) return;
    this.commit(() => {
      this.advance(expected);
      if (!this.read().windowIds.includes(id)) throw new WindowSessionConflict('Window is dormant');
      this.db.prepare('UPDATE window_session SET last_focused_id=? WHERE id=1').run(id);
    });
  }
  geometry(id: string): GeometryRecord {
    const row = this.db.prepare('SELECT * FROM window_geometry WHERE window_id=?').get(id);
    if (!row) throw new Error('Unknown native window');
    let geometry: unknown = null;
    try { geometry = row.geometry_json === null ? null : JSON.parse(String(row.geometry_json)); } catch { /* Reachable fallback. */ }
    return { revision: Number(row.revision), geometry: isWindowGeometry(geometry) ? geometry : null };
  }
  saveGeometry(id: string, geometry: WindowGeometry, expected: number): number {
    if (!isWindowGeometry(geometry) || !Number.isSafeInteger(expected) || expected < 0) throw new Error('Invalid native geometry');
    return this.commit(() => {
      if (!this.db.prepare('UPDATE window_geometry SET geometry_json=?,revision=revision+1 WHERE window_id=? AND revision=?').run(JSON.stringify(geometry), id, expected).changes) throw new WindowSessionConflict('Stale geometry');
      return expected + 1;
    });
  }
}
