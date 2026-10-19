import { useEffect, useRef, useMemo } from 'react';
import type { Comment, ContentItem } from '../domain/discussion';
import { DiscussionViewSession } from './discussion-view-session';
import { createQueryExecutor } from './query-executor';
import type { ReaderApi, ReaderState } from '../shared/reader-api';

/** Registry survives tab close/reopen; explicit Library removal disposes its worker/state. */
export function useDiscussionViews(options?: { readonly collapse?: ReaderState['discussionCollapse']; readonly saveCollapse?: ReaderApi['setDiscussionCollapse']; readonly instances?: ReaderState['viewInstances']; readonly handoffs?: ReaderState['liveHandoffs']; readonly adopted?: (viewId: string, ownerGeneration: string) => void; readonly saved: ReaderState['discussionViews']; readonly save: ReaderApi['saveDiscussionView'] }) {
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
    /** Only future sessions consume seeds. Acknowledgments never rehydrate a live view. */
    hydrate(state: Pick<ReaderState, 'viewInstances' | 'discussionViews' | 'discussionCollapse' | 'liveHandoffs'>) {
      for (const [id, session] of sessions.current) {
        const before = initial.current?.instances?.[id], after = state.viewInstances[id];
        if (before && (!after || before.ownerGeneration !== after.ownerGeneration)) { session.dispose(); sessions.current.delete(id); itemIds.current.delete(id); revisions.current.delete(id); }
      }
      if (initial.current) initial.current = { ...initial.current, instances: state.viewInstances, handoffs: state.liveHandoffs, saved: state.discussionViews, collapse: state.discussionCollapse };
    },
    hydrateView(seed: import('../shared/reader-sync').SharedViewSnapshot) {
      const configuration = initial.current;
      if (!configuration || sessions.current.has(seed.viewId)) return;
      const prior = configuration.instances?.[seed.viewId];
      if (prior && (prior.intentRevision > seed.instance.intentRevision || prior.collapseRevision > seed.instance.collapseRevision)) return;
      initial.current = { ...configuration, instances: { ...configuration.instances, [seed.viewId]: seed.instance },
        saved: seed.intent ? { ...configuration.saved, [seed.viewId]: seed.intent } : configuration.saved,
        collapse: seed.collapse ? { ...configuration.collapse, [seed.viewId]: seed.collapse } : configuration.collapse,
        handoffs: seed.handoff ? { ...configuration.handoffs, [seed.viewId]: seed.handoff } : configuration.handoffs };
    },
    async prepareTransfer(id: string, comments: readonly Comment[], item: ContentItem, stamp: import('../shared/reader-sync').SharedStamp, signal?: AbortSignal) {
      const session = this.get(id, comments, item.id);
      await session.restore(comments, item);
      if (signal?.aborted) throw new Error('Transfer cancelled');
      const handoff = await session.prepareTransfer(id, item.id, stamp, item.latestAcceptedDiscoveryId ?? null, signal);
      const revision = revisions.current.get(id), instance = initial.current?.instances?.[id];
      if (!revision || !instance || sessions.current.get(id) !== session) throw new Error('Source removed');
      return { handoff, intentRevision: revision.intent, collapseRevision: revision.collapse, ownerGeneration: instance.ownerGeneration ?? null };
    },
    resumeTransfer(id: string) { sessions.current.get(id)?.resumeTransfer(); },
    async prepareDuplicate(id: string) {
      const session = sessions.current.get(id);
      if (session && !await session.checkpointForDuplicate()) throw new Error('Source checkpoint failed');
      if (session && sessions.current.get(id) !== session) throw new Error('Source removed');
      const version = revisions.current.get(id) ?? initial.current?.instances?.[id];
      return version && ('intent' in version ? { intentRevision: version.intent, collapseRevision: version.collapse } : version);
    },
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
            const result = await saveCollapse({ viewId: id, expectedRevision: revision.collapse, ...(instance?.ownerGeneration ? { ownerGeneration: instance.ownerGeneration } : {}), ...change });
            if (result.ok) revision.collapse++; return result;
          } : undefined,
          saved: removed.current.has(id) ? undefined : configuration?.saved[id],
          save: configuration ? async intent => {
            const result = await configuration.save({ viewId: id, expectedRevision: revision.intent, ...(instance?.ownerGeneration ? { ownerGeneration: instance.ownerGeneration } : {}), ...intent });
            if (result.ok) revision.intent++; return result;
          } : undefined,
        });
        const handoff = configuration?.handoffs?.[id];
        if (handoff) {
          session.adoptTransfer(handoff, comments);
          const generation = instance?.ownerGeneration;
          if (generation) queueMicrotask(() => configuration?.adopted?.(id, generation));
        }
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
          return { command: { ...command, request: { ...command.request, expectedRevision, ...(initial.current?.instances?.[id]?.ownerGeneration ? { ownerGeneration: initial.current.instances[id].ownerGeneration } : {}) } } as typeof command,
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
