import { useEffect, useRef, useMemo } from 'react';
import type { Comment, ContentItem } from '../domain/discussion';
import { DiscussionViewSession } from './discussion-view-session';
import { createQueryExecutor } from './query-executor';
import type { ReaderApi, ReaderState } from '../shared/reader-api';

/** Registry survives tab close/reopen; explicit Library removal disposes its worker/state. */
export function useDiscussionViews(options?: { readonly collapse?: ReaderState['discussionCollapse']; readonly saveCollapse?: ReaderApi['setDiscussionCollapse']; readonly saved: ReaderState['discussionViews']; readonly save: ReaderApi['saveDiscussionView'] }) {
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
    get(id: string, comments: readonly Comment[]) {
      let session = sessions.current.get(id);
      if (!session) {
        const configuration = initial.current, saveCollapse = configuration?.saveCollapse;
        session = new DiscussionViewSession(comments, createQueryExecutor(), undefined, undefined, {
          collapse: removed.current.has(id) ? undefined : configuration?.collapse?.[id],
          saveCollapse: saveCollapse ? change => saveCollapse({ itemId: id, ...change }) : undefined,
          saved: removed.current.has(id) ? undefined : configuration?.saved[id],
          save: configuration ? intent => configuration.save({ itemId: id, ...intent }) : undefined,
        });
        sessions.current.set(id, session);
      }
      return session;
    },
    has(id: string) { return sessions.current.has(id); },
    freeze(activeItemId?: string) { for (const [id, session] of sessions.current) session.freeze(id === activeItemId); },
    async checkpoints() { return (await Promise.all([...sessions.current].map(([id, session]) => session.drainCheckpoints(id)))).flat(); },
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
    remove(id: string) { removed.current.add(id); sessions.current.get(id)?.dispose(); sessions.current.delete(id); },
    refresh(id: string, comments: readonly Comment[], item?: ContentItem) { const session = sessions.current.get(id); return session?.refresh(comments, item) ?? Promise.resolve(); },
    seenChanged(id: string) { sessions.current.get(id)?.seenChanged(); },
  }), []);
}
