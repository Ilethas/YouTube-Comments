import { useEffect, useRef, useState } from 'react';
import type { Comment } from '../domain/discussion';
import { DiscussionViewSession } from './discussion-view-session';
import { createQueryExecutor } from './query-executor';

/** Registry survives tab close/reopen; explicit Library removal disposes its worker/state. */
export function useDiscussionViews() {
  const sessions = useRef(new Map<string, DiscussionViewSession>());
  const lifecycle = useRef(0);
  const [, render] = useState(0);
  useEffect(() => {
    const mounted = ++lifecycle.current;
    // StrictMode probes effect cleanup/setup without unmounting the reader.
    // Defer disposal one microtask so that probe does not invalidate live sessions.
    return () => queueMicrotask(() => {
      if (lifecycle.current !== mounted) return;
      for (const session of sessions.current.values()) session.dispose();
      sessions.current.clear();
    });
  }, []);
  return {
    get(id: string, comments: readonly Comment[]) {
      let session = sessions.current.get(id);
      if (!session) {
        session = new DiscussionViewSession(comments, createQueryExecutor(), () => render(value => value + 1));
        sessions.current.set(id, session);
      }
      return session;
    },
    remove(id: string) { sessions.current.get(id)?.dispose(); sessions.current.delete(id); },
    refresh(id: string, comments: readonly Comment[]) { const session = sessions.current.get(id); if (session) void session.apply(comments, true); },
    seenChanged(id: string) { sessions.current.get(id)?.seenChanged(); },
  };
}
