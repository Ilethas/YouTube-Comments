import { useEffect, useRef, useMemo } from 'react';
import type { Comment, ContentItem } from '../domain/discussion';
import { DiscussionViewSession } from './discussion-view-session';
import { createQueryExecutor } from './query-executor';
import type { ReaderApi, ReaderState } from '../shared/reader-api';

/** Registry survives tab close/reopen; explicit Library removal disposes its worker/state. */
export function useDiscussionViews(options?: { readonly collapse?: ReaderState['discussionCollapse']; readonly saveCollapse?: ReaderApi['setDiscussionCollapse']; readonly instances?: ReaderState['viewInstances']; readonly saved: ReaderState['discussionViews']; readonly save: ReaderApi['saveDiscussionView'] }) {
  const itemIds = useRef(new Map<string, string>());
  const revisions = useRef(new Map<string, { intent: number; collapse: number }>());
  const sessions = useRef(new Map<string, DiscussionViewSession>());
  // Bootstrap intent is considered once per new session, never on acknowledgments.
  const initial = useRef(options);
  const removed = useRef(new Set<string>());
  const lifecycle = useRef(0);
  useEffect(() => {
    const mounted = ++lifecycle.current;
    // StrictMode probes effect cleanup/setup without unmounting the reader.
    // Defer disposal one microtask so that probe does not invalidate live sessions.
    return () => queueMicrotask(() => {
      if (lifecycle.current !== mounted) return;
      for (const session of sessions.current.values()) void session.flush().finally(() => session.dispose());
      sessions.current.clear();
    });
  }, []);
  return useMemo(() => ({
    get(id: string, comments: readonly Comment[], itemId: string) {
      let session = sessions.current.get(id);
      if (session && itemIds.current.get(id) !== itemId) throw new Error('View item identity changed');
      if (!session) {
        const configuration = initial.current, saveCollapse = configuration?.saveCollapse;
        itemIds.current.set(id, itemId);
        const instance = configuration?.instances?.[id];
        const revision = { intent: instance?.intentRevision ?? 0, collapse: instance?.collapseRevision ?? 0 };
        revisions.current.set(id, revision);
        session = new DiscussionViewSession(comments, createQueryExecutor(), undefined, undefined, {
          collapse: removed.current.has(id) ? undefined : configuration?.collapse?.[id],
          saveCollapse: saveCollapse ? async change => {
            const result = await saveCollapse({ viewId: id, expectedRevision: revision.collapse, ...change });
            if (result.ok) revision.collapse++; return result;
          } : undefined,
          saved: removed.current.has(id) ? undefined : configuration?.saved[id],
          save: configuration ? async intent => {
            const result = await configuration.save({ viewId: id, expectedRevision: revision.intent, ...intent });
            if (result.ok) revision.intent++; return result;
          } : undefined,
        });
        sessions.current.set(id, session);
      }
      return session;
    },
    has(id: string) { return sessions.current.has(id); },
    freeze(activeItemId?: string) { for (const [id, session] of sessions.current) session.freeze(id === activeItemId); },
    async checkpoints() {
      return (await Promise.all([...sessions.current].map(async ([id, session]) => {
        const entries = await session.drainCheckpoints(id), revision = revisions.current.get(id);
        if (!revision) throw new Error('Missing view transport revision');
        let collapse = revision.collapse;
        return entries.map(entry => {
          const command = entry.command;
          if (command.kind !== 'view' && command.kind !== 'collapse') return entry;
          const lane = command.kind === 'view' ? 'intent' : 'collapse';
          const expectedRevision = lane === 'intent' ? revision.intent : collapse++;
          return { command: { ...command, request: { ...command.request, expectedRevision } } as typeof command,
            accept: (result: Parameters<typeof entry.accept>[0]) => { if (result.ok) revision[lane] = expectedRevision + 1; entry.accept(result); } };
        });
      }))).flat();
    },
    resume() { for (const session of sessions.current.values()) session.resume(); },
    flush(id: string) { return sessions.current.get(id)?.flush() ?? Promise.resolve(); },
    async flushAll(): Promise<boolean> {
      const current = [...sessions.current.values()];
      // Let accepted worker evaluations settle before freezing their semantic
      // applied intent. The existing executor owns cancellation/deadlines.
      await Promise.all(current.map(session => new Promise<void>(resolve => {
        if (!session.state.pending) { resolve(); return; }
        const unsubscribe = session.subscribe(() => { if (!session.state.pending) { unsubscribe(); resolve(); } });
      })));
      await Promise.all(current.map(session => session.flush()));
      return current.every(session => !session.state.saveFailed && !session.state.collapseSaveFailed);
    },
    hasItem(itemId: string) { return [...itemIds.current.values()].includes(itemId); },
    remove(itemId: string) { for (const [id, item] of itemIds.current) if (item === itemId) { removed.current.add(id); sessions.current.get(id)?.dispose(); sessions.current.delete(id); itemIds.current.delete(id); revisions.current.delete(id); } },
    async refresh(itemId: string, comments: readonly Comment[], item?: ContentItem) { await Promise.all([...sessions.current].filter(([id]) => itemIds.current.get(id) === itemId).map(([, session]) => session.refresh(comments, item))); },
    seenChanged(itemId: string) { for (const [id, session] of sessions.current) if (itemIds.current.get(id) === itemId) session.seenChanged(); },
  }), []);
}
