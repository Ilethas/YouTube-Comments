import { MoveTabDialog } from './MoveTabDialog';
import { DiscussionViewSession } from './discussion-view-session';
import { createQueryExecutor } from './query-executor';
import type { TransferRequest } from '../shared/tab-transfer';
import { ReaderReplica } from './reader-replica';
import { AcquisitionStatus } from './AcquisitionStatus';
import { useAcquisitionProgress } from './use-acquisition-progress';
import type { AcquisitionProgress } from '../shared/acquisition';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AcquisitionResult, ErrorCode, ReaderApi, ReaderState, Result } from '../shared/reader-api';
import { TranslationSettings } from './TranslationSettings';
import type { TranslationTarget, Appearance, SelectionControls } from '../shared/preferences';
import { countLabel, initialLocale, Locale, translator } from './i18n';
import { WorkspaceTabs } from './WorkspaceTabs';
import { TabIcon } from './TabIcon';
import { ActionIcon } from './ActionIcon';
import { filterLibrary } from './library';
import { RemovalDialog } from './RemovalDialog';
import type { WorkspaceState } from '../domain/workspace';
import { useDiscussionViews } from './use-discussion-views';
import { DiscussionPanel } from './DiscussionPanel';
import { navigateDiscussion } from './discussion-navigation';
import { KeyboardShortcuts, keyboardShortcutsTarget } from './KeyboardShortcuts';
import { shortcutHint } from './shortcuts';
import { readerShortcut } from './keyboard-routing';
import type { BulkSeenRequest, SeenMutationResult } from '../domain/seen-operation';
import type { SeenFeedback } from './BulkSeenControls';
import { ExternalTools } from './ExternalTools';
import { DataBackups } from './DataBackups';
import { RendererProfileLifecycle } from './profile-lifecycle';
import type { Checkpoint } from './profile-lifecycle';
import type { PendingMutation } from '../shared/profile-operation';

export function App({ api: transport = window.reader }: { api?: ReaderApi }) {
  const replica = useMemo(() => typeof transport.onSharedCommit === 'function' ? new ReaderReplica(transport) : undefined, [transport]);
  const api = replica?.api ?? transport;
  const [state, setState] = useState<ReaderState>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const t = translator(initialLocale(navigator.languages));
  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    async function load() {
      try {
        const result = await api.bootstrap();
        if (cancelled) return;
        if (result.ok) setState(result.value);
        else setError(result.error.code);
      } catch { if (!cancelled) setError('STORAGE_UNAVAILABLE'); }
    }
    void load();
    return () => { cancelled = true; replica?.stop(); };
  }, [api, attempt, replica]);
  useEffect(() => { if (state || error) void transport.windowReady?.().catch(() => undefined); }, [state, error, transport]);
  if (state) return <Reader initialState={state} api={api} replica={replica} />;
  return <div className="startup-state" role={error ? 'alert' : 'status'}>
    <p>{t(error === 'UNSUPPORTED_SCHEMA' ? 'unsupportedSchema' : error ? 'loadError' : 'loading')}</p>
    {error === 'STORAGE_UNAVAILABLE' && <button onClick={() => setAttempt(value => value + 1)}>{t('retry')}</button>}
  </div>;
}

function Reader({ initialState, api, replica }: { initialState: ReaderState; api: ReaderApi; replica?: ReaderReplica }) {
  const views = useDiscussionViews({ instances: initialState.viewInstances, handoffs: initialState.liveHandoffs, adopted: (viewId, ownerGeneration) => {
    replica?.releaseHandoff(viewId, ownerGeneration); void api.transfers?.adopted({ viewId, ownerGeneration });
  }, collapse: initialState.discussionCollapse, saveCollapse: request => api.setDiscussionCollapse(request), saved: initialState.discussionViews, save: request => api.saveDiscussionView(request) });
  const [items, setItems] = useState(initialState.items);
  const [locale, setLocale] = useState<Locale>(initialState.preferences.locale);
  const [appearance, setAppearance] = useState<Appearance>(initialState.preferences.appearance);
  const [translationTarget, setTranslationTarget] = useState<TranslationTarget>(initialState.preferences.translationTarget);
  const [customTranslationTarget, setCustomTranslationTarget] = useState(initialState.preferences.customTranslationTarget);
  const [selectionControls, setSelectionControls] = useState<SelectionControls>(initialState.preferences.selectionControls);
  const [includeCollapsedInPrefix, setIncludeCollapsedInPrefix] = useState(initialState.preferences.includeCollapsedInPrefix);
  const [workspace, setWorkspace] = useState(initialState.workspace);
  const activeId = workspace.activeTabId;
  const activeDiscussion = useRef<string>();
  const activeTab = workspace.tabs.find(tab => tab.id === activeId);
  activeDiscussion.current = activeTab?.kind === 'discussion' ? activeTab.id : undefined;
  const [cloning, setCloning] = useState(false);
  const [moveDialog, setMoveDialog] = useState<{ id: string; newWindow: boolean }>();
  const [movingId, setMovingId] = useState<string>();
  const moving = useRef<string>();
  const cancelledMove = useRef(false);
  const movingToken = useRef<string>();
  const moveAbort = useRef<AbortController>();
  const [moveFeedback, setMoveFeedback] = useState<'movingTab' | 'tabMoved' | 'tabReceived' | 'moveFailed'>();
  const [transferFocus, setTransferFocus] = useState<string>();
  const provisional = useRef<{ token: string; session?: DiscussionViewSession }>();
  const settingsDirty = useRef(false);
  const markSettingsDirty = useCallback((value: boolean) => { settingsDirty.current = value; }, []);

  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const workspaceBusy = useRef(false);
  const [showAcquisition, setShowAcquisition] = useState(false);
  const [focusUrl, setFocusUrl] = useState(false);
  const [helpRequest, setHelpRequest] = useState<{ revision: number }>();
  const [libraryFilter, setLibraryFilter] = useState('');
  const [removing, setRemoving] = useState<ReaderState['items'][number]>();
  const [removalPending, setRemovalPending] = useState(false);
  const removalBusy = useRef(false);
  const [removalError, setRemovalError] = useState<ErrorCode>();
  const removedIds = useRef(new Set<string>());
  // Acknowledged presentation snapshot. SQLite owns all durable state.
  const [comments, setComments] = useState(initialState.comments);
  const displayedComments = useRef(comments); displayedComments.current = comments;
  const [seenUndo, setSeenUndo] = useState(initialState.seenUndo);
  const displayedUndo = useRef(seenUndo); displayedUndo.current = seenUndo;
  const [seenFeedback, setSeenFeedback] = useState<Readonly<Record<string, SeenFeedback>>>({});
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const acknowledgedUndo = useRef(new Map<string, SeenMutationResult['undo']>());
  const saveQueue = useRef(Promise.resolve());
  const submittedSave = useRef<Promise<unknown>>(Promise.resolve());
  const queuedSaves = useRef(new Map<symbol, { checkpoint: () => Promise<Checkpoint>; resume: () => void }>());
  const lastSaveFailed = useRef(false);
  const [saving, setSaving] = useState(false);
  const [savingItemId, setSavingItemId] = useState<string>();
  const [saveError, setSaveError] = useState(false);
  const busy = useRef(false);
  const [url, setUrl] = useState('');
  const [acquiring, setAcquiring] = useState<'acquiring' | 'refreshing'>();
  const [acquisitionError, setAcquisitionError] = useState<ErrorCode>();
  const [acquisitionStatus, setAcquisitionStatus] = useState<string>();
  const progress = useAcquisitionProgress(api);
  const [updatingView, setUpdatingView] = useState<AcquisitionProgress>();
  const [completion, setCompletion] = useState<Pick<AcquisitionResult, 'summary' | 'timings'>>();
  const [cancelledKind, setCancelledKind] = useState<'acquire' | 'refresh'>();
  const acquisitionBusy = useRef(false);
  const dataBusy = useRef(false);
  const shell = useRef<HTMLDivElement>(null);
  const profileOverlay = useRef<HTMLDivElement>(null);
  const profilePreviousFocus = useRef<HTMLElement | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileFailed, setProfileFailed] = useState(false);
  const profileController = useRef<RendererProfileLifecycle>();
  const [releaseFailed, setReleaseFailed] = useState(false);
  const otherSaveFailed = useRef(false);
  useLayoutEffect(() => { if (shell.current) shell.current.inert = profileBusy || cloning || !!movingId; }, [profileBusy, cloning, movingId]);
  useLayoutEffect(() => { if (profileBusy) profileOverlay.current?.focus({ preventScroll: true }); }, [profileBusy]);
  const afterData = useRef(new Set<() => void>());
  const acknowledgedSeen = useRef(new Map<string, boolean>());
  const sharedState = useRef(initialState);
  const sharedRefreshes = useRef(new Map<string, Promise<void>>());
  const pendingSharedRefresh = useRef(new Map<string, { run: () => void; cancel: () => void }>());
  useLayoutEffect(() => {
    if (!replica) return;
    let deferred = false, disposed = false;
    const apply = (next: ReaderState) => {
      if (disposed) return;
      if (dataBusy.current) {
        if (!deferred) { deferred = true; afterData.current.add(() => { deferred = false; apply(replica.current); }); }
        return;
      }
      const previous = sharedState.current;
      sharedState.current = next;
      for (const item of previous.items) if (!next.items.some(i => i.id === item.id)) {
        removedIds.current.add(item.id); views.remove(item.id); pendingSharedRefresh.current.get(item.id)?.cancel(); pendingSharedRefresh.current.delete(item.id); sharedRefreshes.current.delete(item.id);
      }
      for (const item of next.items) {
        const before = previous.items.find(i => i.id === item.id);
        if (before && before.latestAcceptedDiscoveryId !== item.latestAcceptedDiscoveryId && views.hasItem(item.id)) {
          // Promote content props before publishing a new worker result. A
          // synchronous external-store render with old props would otherwise
          // cache a projection that omits newly discovered comment identities.
          pendingSharedRefresh.current.get(item.id)?.cancel();
          let settle: () => void = () => undefined;
          const task = new Promise<void>(resolve => { settle = resolve; });
          sharedRefreshes.current.set(item.id, task);
          pendingSharedRefresh.current.set(item.id, { cancel: settle, run: () => {
            void views.refresh(item.id, next.comments[item.id], item).then(settle, settle);
          } });
          void task.then(() => { if (sharedRefreshes.current.get(item.id) === task) sharedRefreshes.current.delete(item.id); });
        }
        else if (previous.comments[item.id] !== next.comments[item.id]) {
          const seen = new Map(previous.comments[item.id]?.map(c => [c.id, c.seen]));
          if (next.comments[item.id]?.some(c => seen.get(c.id) !== c.seen)) views.seenChanged(item.id);
        }
      }
      views.hydrate(next);
      setItems(next.items); setComments(next.comments); setSeenUndo(next.seenUndo);
      setWorkspace(next.workspace);
      setLocale(next.preferences.locale); setAppearance(next.preferences.appearance);
      setTranslationTarget(next.preferences.translationTarget); setCustomTranslationTarget(next.preferences.customTranslationTarget);
      setSelectionControls(next.preferences.selectionControls); setIncludeCollapsedInPrefix(next.preferences.includeCollapsedInPrefix);
    };
    const unsubscribe = replica.subscribe(apply);
    apply(replica.current);
    return () => { disposed = true; unsubscribe(); };
  }, [replica, views]);
  useLayoutEffect(() => {
    const pending = [...pendingSharedRefresh.current.values()];
    pendingSharedRefresh.current.clear();
    for (const refresh of pending) refresh.run();
  }, [comments, items]);
  const acquire = useCallback(async function acquire(action: () => Promise<Result<AcquisitionResult>>, refresh = false) {
    if (acquisitionBusy.current || dataBusy.current) return;
    if (activeDiscussion.current) void views.flush(activeDiscussion.current);
    acquisitionBusy.current = true;
    acknowledgedSeen.current.clear();
    acknowledgedUndo.current.clear();
    setAcquiring(refresh ? 'refreshing' : 'acquiring');
    setAcquisitionError(undefined);
    setCancelledKind(undefined); setCompletion(undefined);
    setAcquisitionStatus(undefined);
    try {
      let result = await action();
      // A cancelled/failed preflight must still deliver an acquisition accepted
      // while the native dialog was open. A committed restore never releases
      // this barrier: the new process owns all subsequent presentation state.
      while (dataBusy.current) await new Promise<void>(resolve => afterData.current.add(resolve));
      if (result.ok && replica) result = { ...result, value: { ...result.value, state: replica.current } };
      if (result.ok) {
        if (!replica) setItems(result.value.state.items.filter(item => !removedIds.current.has(item.id)));
        const mergedComments = replica?.current.comments ?? Object.fromEntries(Object.entries(result.value.state.comments).filter(([id]) => !removedIds.current.has(id)).map(([id, rows]) => [id,
          rows.map(comment => ({ ...comment, seen: acknowledgedSeen.current.get(comment.id) ?? comment.seen }))]));
        if (!replica) setComments(mergedComments);
        if (!replica) setSeenUndo(Object.fromEntries(Object.entries(result.value.state.seenUndo).filter(([id]) => !removedIds.current.has(id))
          .map(([id, undo]) => [id, acknowledgedUndo.current.has(id) ? acknowledgedUndo.current.get(id) ?? null : undo])));
        const refreshedId = result.value.summary.itemId;
        if (mergedComments[refreshedId]) {
          setUpdatingView({ operationId: result.value.operationId, kind: refresh ? 'refresh' : 'acquire',
            sourceKind: result.value.state.items.find(item => item.id === refreshedId)?.sourceKind === 'youtube-community-post' ? 'youtube-community-post' : 'youtube-video',
            stage: 'saving', startedAt: Date.now() - result.value.timings.totalMs, cancellable: false });
          await (replica ? sharedRefreshes.current.get(refreshedId) : views.refresh(refreshedId, mergedComments[refreshedId], result.value.state.items.find(item => item.id === refreshedId)));
          setUpdatingView(undefined);
        }
        setCompletion({ summary: result.value.summary, timings: result.value.timings });
        acceptWorkspace(result.value.state.workspace);
        if (!refresh) { setUrl(''); setShowAcquisition(false); }
        setAcquisitionStatus(result.value.summary.coverage !== 'complete' ? result.value.summary.itemId : undefined);
      } else if (result.error.code === 'ACQUISITION_CANCELLED') setCancelledKind(refresh ? 'refresh' : 'acquire');
      else setAcquisitionError(result.error.code);
    } catch { setAcquisitionError('ACQUISITION_FAILED'); }
    finally { acquisitionBusy.current = false; setAcquiring(undefined); setUpdatingView(undefined); }
  }, [api, views, replica]);
  function acceptWorkspace(value: WorkspaceState) {
    if (replica) return;
    setWorkspace(current => value.revision >= current.revision ? value : current);
  }
  async function workspaceAction(action: () => Promise<Result<WorkspaceState>>, focusId?: string) {
    if (workspaceBusy.current) return;
    const leaving = workspace.tabs.find(tab => tab.id === activeId);
    if (leaving?.kind === 'discussion') void views.flush(leaving.id);
    workspaceBusy.current = true; setWorkspaceSaving(true); setSaveError(false);
    try {
      const result = await action();
      if (result.ok) {
        otherSaveFailed.current = false;
        acceptWorkspace(result.value);
        if (focusId === '@shortcuts' && result.value.tabs.some(tab => tab.id === result.value.activeTabId && tab.kind === 'settings')) setHelpRequest({ revision: result.value.revision });
        else if (focusId) requestAnimationFrame(() => {
          (focusId === '@active' ? document.querySelector<HTMLElement>('[role=tab][aria-selected=true]') ?? document.getElementById('library-toggle') : document.getElementById(`tab-${focusId}`))?.focus();
        });
      } else { setSaveError(true); otherSaveFailed.current = true; }
    } catch { setSaveError(true); otherSaveFailed.current = true; }
    finally { workspaceBusy.current = false; setWorkspaceSaving(false); }
  }
  function activate(tabId: string, focus = false) {
    void workspaceAction(() => api.activateTab({ tabId, expectedRevision: workspace.revision }), focus ? tabId : undefined);
  }
  async function duplicate(sourceViewId: string) {
    if (workspaceBusy.current || dataBusy.current) return;
    setCloning(true);
    try {
      await workspaceAction(async () => {
        const version = await views.prepareDuplicate(sourceViewId);
        if (dataBusy.current) return { ok: false, error: { code: 'DATA_BUSY' } };
        // An unvisited source already has acknowledged database intent.
        const instance = version ?? initialState.viewInstances[sourceViewId];
        if (!instance) return { ok: false, error: { code: 'NOT_FOUND' } };
        const result = await api.duplicateTab({ sourceViewId, expectedRevision: workspace.revision,
          intentRevision: instance.intentRevision, collapseRevision: instance.collapseRevision });
        if (!result.ok) return result;
        if (!removedIds.current.has(result.value.view.instance.itemId)) views.hydrateView(result.value.view);
        return { ...result, value: result.value.workspace };
      }, '@active');
    } finally { setCloning(false); }
  }
  async function transfer(tabId: string, destination: TransferRequest['destination']) {
    const transferApi = api.transfers;
    if (!transferApi || moving.current || workspaceBusy.current || dataBusy.current) return;
    const tab = workspace.tabs.find(tab => tab.id === tabId); if (!tab) return;
    moving.current = tabId; cancelledMove.current = false; setMovingId(tabId); setMoveDialog(undefined); setMoveFeedback('movingTab');
    if (shell.current) shell.current.inert = true;
    document.getSelection()?.removeAllRanges(); setRemoving(undefined);
    const controller = new AbortController(); moveAbort.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    let committed = false;
    const check = () => { if (controller.signal.aborted || cancelledMove.current || dataBusy.current) throw new Error('Transfer cancelled'); };
    try {
      const prepare = async () => {
        const begun = await transferApi.begin({ tabId, destination, expectedRevision: workspace.revision });
        if (!begun.ok) throw new Error('Reservation failed');
        if (controller.signal.aborted || moveAbort.current !== controller) {
          void transferApi.cancel({ token: begun.value.token }); throw new Error('Obsolete reservation reply');
        }
        movingToken.current = begun.value.token;
        await saveQueue.current; check();
        if (lastSaveFailed.current || api.lifecycle && !await api.lifecycle.settleAccepted()) throw new Error('Pending command failed');
        await replica?.check(); check();
        // Shared Refresh reconciliation queues its worker after React promotes
        // the new content props. Wait for that accepted work before capturing
        // the source, rather than stamping old results with newer metadata.
        if (tab.kind === 'discussion') {
          for (;;) {
            const refreshing = sharedRefreshes.current.get(tab.itemId);
            if (!refreshing) break;
            await refreshing; check();
          }
        }
        const stamp = replica?.stamp;
        const current = replica?.current ?? sharedState.current;
        const item = tab.kind === 'discussion' ? current.items.find(item => item.id === tab.itemId) : undefined;
        const live = item && stamp ? await views.prepareTransfer(tab.id, current.comments[item.id], item, stamp, controller.signal) : undefined;
        if (tab.kind === 'discussion' && !live) throw new Error('Transfer unavailable');
        check();
        return { token: begun.value.token, request: { tabId, destination, expectedRevision: workspace.revision,
          intentRevision: live?.intentRevision ?? null, collapseRevision: live?.collapseRevision ?? null,
          ownerGeneration: live?.ownerGeneration ?? null, handoff: live?.handoff ?? null } };
      };
      const cancelled = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Transfer cancelled')), { once: true }));
      const submission = await Promise.race([prepare(), cancelled]);
      clearTimeout(timer);
      const result = await api.transfers.move(submission);
      committed = result.ok;
      if (result.sync) await replica?.reconcile(result.sync);
      setMoveFeedback(result.ok ? 'tabMoved' : 'moveFailed');
    } catch { setMoveFeedback(committed ? 'tabMoved' : 'moveFailed'); }
    finally {
      clearTimeout(timer); controller.abort();
      if (movingToken.current) void api.transfers.cancel({ token: movingToken.current });
      movingToken.current = undefined; moveAbort.current = undefined;
      views.resumeTransfer(tabId); moving.current = undefined; setMovingId(undefined);
      if (shell.current) shell.current.inert = dataBusy.current;
      requestAnimationFrame(() => {
        if (moving.current || dataBusy.current || document.querySelector('[role=menu], dialog[open]')) return;
        (document.getElementById(`tab-${tabId}`) ?? document.querySelector<HTMLElement>('[role=tab][aria-selected=true]') ?? document.getElementById('library-toggle'))?.focus();
      });
    }
  }
  useEffect(() => {
    if (!api.transfers) return;
    const unsubscribe = api.transfers.onEvent(event => {
      if (event.kind === 'cancelled' && movingToken.current === event.token) moveAbort.current?.abort();
      if (event.kind === 'prepare') {
        if (dataBusy.current || workspaceBusy.current || moving.current || provisional.current) {
          void api.transfers?.ready({ token: event.token, accept: false }); return;
        }
        const prepared: { token: string; session?: DiscussionViewSession } = { token: event.token };
        provisional.current = prepared;
        void (async () => {
          let accept = false;
          try {
            const h = event.handoff;
            if (h) {
              await replica?.reconcile(h.stamp);
              if (provisional.current !== prepared || dataBusy.current) throw new Error('Readiness cancelled');
              const rows = replica?.current.comments[h.itemId] ?? displayedComments.current[h.itemId];
              const owned = new Set(rows?.map(c => c.id));
              if (!rows || h.result.visibleCommentIds.some(id => !owned.has(id))) throw new Error('Item unavailable');
              prepared.session = new DiscussionViewSession(rows, createQueryExecutor()); prepared.session.adoptTransfer(h, rows);
            }
            accept = provisional.current === prepared && !dataBusy.current;
          } catch { prepared.session?.dispose(); }
          if (!accept && provisional.current === prepared) provisional.current = undefined;
          void api.transfers?.ready({ token: event.token, accept });
        })();
      } else if (provisional.current?.token === event.token) {
        provisional.current.session?.dispose(); provisional.current = undefined;
        if (event.kind === 'committed') { setTransferFocus(event.tabId); setMoveFeedback('tabReceived'); }
      }
    });
    return () => { unsubscribe(); provisional.current?.session?.dispose(); provisional.current = undefined; moveAbort.current?.abort(); };
  }, [api, replica]);
  useLayoutEffect(() => {
    if (!transferFocus || !workspace.tabs.some(t => t.id === transferFocus)) return;
    document.getElementById(`tab-${transferFocus}`)?.focus(); setTransferFocus(undefined);
  }, [workspace, transferFocus]);
  function close(tabId: string) {
    const tab = workspace.tabs.find(tab => tab.id === tabId);
    if (tab?.kind === 'discussion') void views.flush(tab.id);
    void workspaceAction(() => api.closeTab({ tabId, expectedRevision: workspace.revision }), '@active');
  }
  async function removeItem() {
    if (!removing || removalBusy.current) return;
    const id = removing.id;
    removalBusy.current = true; setRemovalPending(true); setRemovalError(undefined);
    try {
      const result = await api.removeLibraryItem({ itemId: id });
      if (result.ok) {
        removedIds.current.add(id);
        views.remove(id);
        setSeenUndo(current => Object.fromEntries(Object.entries(current).filter(([itemId]) => itemId !== id)));
        setSeenFeedback(current => Object.fromEntries(Object.entries(current).filter(([itemId]) => itemId !== id)));
        setItems(current => current.filter(item => item.id !== id));
        setComments(current => Object.fromEntries(Object.entries(current).filter(([itemId]) => itemId !== id)));
        acceptWorkspace(result.value.workspace);
        setRemoving(undefined);
      } else setRemovalError(result.error.code);
    } catch { setRemovalError('STORAGE_UNAVAILABLE'); }
    finally { removalBusy.current = false; setRemovalPending(false); }
  }
  const save = useCallback(function save<T>(action: () => Promise<Result<T>>, accept: (value: T) => void, itemId?: string, command?: PendingMutation): Promise<boolean> {
    // FIFO acknowledgments preserve later user intent, including across discussions.
    const key = Symbol();
    let resolveDrain!: (result: Result<unknown> | undefined) => void;
    const drained = new Promise<Result<unknown> | undefined>(resolve => { resolveDrain = resolve; });
    const staged = command && api.lifecycle && busy.current ? api.lifecycle.stage(structuredClone(command)) : undefined;
    if (command && staged) queuedSaves.current.set(key, { checkpoint: async () => {
      const result = await staged; if (!result.ok) throw new Error('Queued intent was not accepted');
      return { command: { ...command, ticket: result.value }, accept: resolveDrain };
    }, resume: () => resolveDrain(undefined) });
    let succeeded = false;
    const run = async () => {
      busy.current = true; setSaving(true); setSavingItemId(itemId); setSaveError(false);
      try {
        let result: Result<T>;
        if (staged && api.lifecycle) {
          submittedSave.current = staged;
          const ticket = await staged;
          if (!ticket.ok) result = ticket;
          else {
            let saved: Result<unknown> | undefined;
            if (dataBusy.current) saved = await drained;
            if (!saved) {
              const response = api.lifecycle.submit(ticket.value); submittedSave.current = response;
              saved = await response;
              if (!saved.ok && saved.error.code === 'DATA_BUSY') saved = await drained;
              if (!saved) { const retry = api.lifecycle.submit(ticket.value); submittedSave.current = retry; saved = await retry; }
            }
            result = saved as Result<T>;
          }
        } else {
          const response = action(); submittedSave.current = response;
          result = await response;
        }
        queuedSaves.current.delete(key);
        if (result.sync) await replica?.reconcile(result.sync);
        if (result.ok) { accept(result.value); succeeded = true; lastSaveFailed.current = false; }
        else { setSaveError(true); lastSaveFailed.current = true; }
      } catch { setSaveError(true); lastSaveFailed.current = true; }
      finally { busy.current = false; setSaving(false); setSavingItemId(undefined); }
    };
    const task = busy.current ? saveQueue.current.then(run) : run();
    saveQueue.current = task.catch(() => undefined);
    return task.then(() => succeeded);
  }, [api, replica]);
  useEffect(() => {
    if (!api.lifecycle) return;
    const blockInput = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key === 'Tab' && event.target instanceof Element && event.target.closest('.profile-operation-overlay')) return;
      if (dataBusy.current && !(event.target instanceof Element && event.target.closest('[data-profile-retry]'))) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const inputEvents = ['keydown', 'pointerdown', 'click', 'input', 'change', 'submit'];
    inputEvents.forEach(kind => document.addEventListener(kind, blockInput, true));
    const settledSubmitted = async () => {
      let pending: Promise<unknown>;
      do { pending = submittedSave.current; await pending.catch(() => undefined); } while (pending !== submittedSave.current);
    };
    const lifecycle = new RendererProfileLifecycle(api.lifecycle, {
      freeze: () => {
        cancelledMove.current = true; moveAbort.current?.abort(); setMoveDialog(undefined);
        if (!dataBusy.current) profilePreviousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dataBusy.current = true;
        if (shell.current) shell.current.inert = true;
        views.freeze(activeDiscussion.current); setProfileBusy(true); setProfileFailed(false); setReleaseFailed(false);
      },
      checkpoints: async () => { await settledSubmitted(); return [...await Promise.all([...queuedSaves.current.values()].map(entry => entry.checkpoint())), ...await views.checkpoints()]; },
      settled: async () => { await settledSubmitted(); return !lastSaveFailed.current && !otherSaveFailed.current; },
      reconcile: async () => { await replica?.check(); },
      release: failed => {
        views.resume(); dataBusy.current = false;
        for (const entry of queuedSaves.current.values()) entry.resume();
        for (const resume of afterData.current) resume(); afterData.current.clear();
        if (shell.current) shell.current.inert = false;
        if (profilePreviousFocus.current?.isConnected) profilePreviousFocus.current.focus({ preventScroll: true });
        setProfileBusy(false); setProfileFailed(failed);
      },
      releaseFailure: () => setReleaseFailed(true),
    });
    profileController.current = lifecycle;
    lifecycle.start(); return () => { lifecycle.stop(); inputEvents.forEach(kind => document.removeEventListener(kind, blockInput, true)); };
  }, [api, replica, views]);
  const openSource = useCallback((itemId: string) => api.openSource({ itemId }), [api]);
  const openCommentAction = useCallback((request: Parameters<ReaderApi['openCommentAction']>[0]) => api.openCommentAction(request), [api]);
  const t = translator(locale);
  const operationProgress = updatingView ?? progress;
  const openItems = workspace.tabs.flatMap(tab => { if (tab.kind !== 'discussion') return []; const item = items.find(item => item.id === tab.itemId); return item ? [{ tab, item }] : []; });
  const libraryTab = workspace.tabs.find(tab => tab.kind === 'library');
  const settingsTab = workspace.tabs.find(tab => tab.kind === 'settings');
  const isOpen = (id: string) => workspace.tabs.some(tab => tab.kind === 'discussion' && tab.itemId === id);
  const itemLabel = (item: ReaderState['items'][number]) => item.kind === 'video' ? item.title
    : `${item.author?.displayName ?? item.author?.handle ?? t('unknownAuthor')} · ${item.text.replace(/\s+/g, ' ').slice(0, 80)}`;
  const errorKey = acquisitionError === 'HELPER_UNAVAILABLE' ? 'helperUnavailable'
    : acquisitionError === 'INVALID_REQUEST' ? 'invalidUrl' : acquisitionError === 'ACQUISITION_BUSY' ? 'acquisitionBusy'
      : acquisitionError === 'NOT_REFRESHABLE' ? 'notRefreshable' : acquisitionError === 'NOT_FOUND' ? 'itemNotFound'
        : acquisitionError === 'STORAGE_UNAVAILABLE' || acquisitionError === 'UNSUPPORTED_SCHEMA' ? 'saveError' : 'acquisitionFailed';

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translator(locale)('appName');
  }, [locale]);
  useEffect(() => {
    document.documentElement.dataset.appearance = appearance;
  }, [appearance]);

  const refreshItem = useCallback((itemId: string) => { void acquire(() => api.refresh({ itemId }), true); }, [acquire, api]);
  const acceptSeen = useCallback((itemId: string, value: SeenMutationResult) => {
    // Production shared values enter only through the replica subscription.
    // Command callbacks retain feedback without reinstalling an older value.
    if (replica || removedIds.current.has(itemId)) return;
    const seen = new Map(value.comments.map(comment => [comment.id, comment.seen]));
    if (acquisitionBusy.current) {
      for (const [id, state] of seen) acknowledgedSeen.current.set(id, state);
      acknowledgedUndo.current.set(itemId, value.undo);
    }
    setSeenUndo(current => ({ ...current, [itemId]: value.undo }));
    setComments(current => !current[itemId] ? current : ({ ...current, [itemId]: current[itemId].map(comment => {
      const next = seen.get(comment.id) ?? comment.seen;
      return next === comment.seen ? comment : { ...comment, seen: next };
    }) }));
    if (value.changedCount) views.seenChanged(itemId);
  }, [views, replica]);
  const toggleComment = useCallback((itemId: string, commentId: string, subtree: boolean) => {
    const seen = !displayedComments.current[itemId]?.find(c => c.id === commentId)?.seen;
    void save(() => api.toggleSeen({ itemId, commentId, subtree, seen }), value => {
      acceptSeen(itemId, value);
      if (subtree && value.changedCount > 1) setSeenFeedback(current => ({ ...current, [itemId]: { kind: 'marked', count: value.changedCount, seen } }));
    }, itemId, { kind: 'toggleSeen', request: { itemId, commentId, subtree, seen } });
  }, [api, save, acceptSeen]);
  const bulkSeen = useCallback(async (request: BulkSeenRequest) => {
    const success = await save(() => api.bulkSeen(request), value => {
      acceptSeen(request.itemId, value);
      setSeenFeedback(current => ({ ...current, [request.itemId]: { kind: value.changedCount ? 'marked' : 'noop', count: value.changedCount, seen: request.seen } }));
    }, request.itemId, { kind: 'bulkSeen', request });
    if (!success) setSeenFeedback(current => ({ ...current, [request.itemId]: { kind: 'error' } }));
    return success;
  }, [api, save, acceptSeen]);
  const undoSeen = useCallback((itemId: string) => {
    const expectedOperationId = displayedUndo.current[itemId]?.id;
    if (!expectedOperationId) return;
    void save(() => api.undoSeen({ itemId, expectedOperationId }), value => {
      acceptSeen(itemId, value);
      setSeenFeedback(current => ({ ...current, [itemId]: { kind: 'undo', count: value.restored, skipped: value.skipped } }));
    }, itemId, { kind: 'undoSeen', request: { itemId, expectedOperationId } }).then(success => { if (!success) setSeenFeedback(current => ({ ...current, [itemId]: { kind: 'error' } })); });
  }, [api, save, acceptSeen]);
  useLayoutEffect(() => {
    if (!showAcquisition || !focusUrl) return;
    const input = document.getElementById('source-url') as HTMLInputElement | null;
    input?.focus(); input?.select(); setFocusUrl(false);
  }, [showAcquisition, focusUrl]);
  useLayoutEffect(() => {
    if (!helpRequest || workspace.revision < helpRequest.revision) return;
    if (activeTab?.kind === 'settings' && !removing) {
      const target = document.getElementById(keyboardShortcutsTarget);
      target?.scrollIntoView({ block: 'start' }); target?.focus({ preventScroll: true });
    }
    setHelpRequest(undefined);
  }, [workspace, activeId, helpRequest, removing]);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (dataBusy.current || moving.current || provisional.current) return;
      const tab = workspace.tabs.find(tab => tab.id === activeId);
      const command = readerShortcut(event, { activeKind: tab?.kind, modalOpen: !!removing || bulkModalOpen || !!moveDialog, workspaceBusy: workspaceBusy.current, undoAvailable: tab?.kind === 'discussion' && !!seenUndo[tab.itemId] });
      if (!command) return;
      if (command === 'next-tab' || command === 'previous-tab') {
        const index = workspace.tabs.findIndex(value => value.id === activeId);
        const next = workspace.tabs[(index + (command === 'next-tab' ? 1 : -1) + workspace.tabs.length) % workspace.tabs.length];
        if (!next) return;
        activate(next.id, true);
      } else if (command === 'close-tab') {
        if (!tab) return;
        close(tab.id);
      } else if (command === 'focus-search') {
        const panel = document.getElementById(tab?.kind === 'discussion' ? `panel-${tab.id}` : 'panel-library');
        const input = panel?.querySelector<HTMLInputElement>('input[type=search]');
        if (!input) return;
        input.focus(); input.select();
      } else if (command === 'open-url') {
        setShowAcquisition(true); setFocusUrl(true);
      } else if (command === 'keyboard-help') {
        void workspaceAction(() => api.openSettings({ expectedRevision: workspace.revision }), '@shortcuts');
      } else if (tab?.kind === 'discussion') {
        const session = views.get(tab.id, comments[tab.itemId], tab.itemId);
        if (command === 'undo-seen') undoSeen(tab.itemId);
        else if (command === 'apply-view') document.querySelector<HTMLFormElement>('.reader-panel:not([hidden]) .query-controls')?.requestSubmit();
        else navigateDiscussion(session, comments[tab.itemId], 'match', command === 'previous-match' ? -1 : 1);
      } else {
        return;
      }
      event.preventDefault();
    }
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  });

  return <><div className="app-shell" ref={shell}>
    {profileFailed && <p role="alert">{t('profileDrainFailed')}</p>}
    <header className="app-toolbar">
      <div className="brand"><span className="brand-icon" aria-hidden="true">≡</span><strong>{t('appName')}</strong></div>
      <div className="workspace-actions">
        <button title={shortcutHint(locale, 'open-url')} disabled={!!acquiring || !!progress} aria-expanded={showAcquisition} aria-controls="acquisition-form" onClick={() => { setShowAcquisition(value => !value); }}>{t('acquire')}</button>
        <button id="library-toggle" disabled={workspaceSaving} onClick={() => { void workspaceAction(() => api.openLibrary({ expectedRevision: workspace.revision })); }}><ActionIcon name="library" />{t('library')}</button>
        <button id="settings-toggle" title={shortcutHint(locale, 'keyboard-help')} disabled={workspaceSaving} onClick={() => { void workspaceAction(() => api.openSettings({ expectedRevision: workspace.revision })); }}><ActionIcon name="settings" />{t('settings')}</button>
      </div>
    </header>
    {showAcquisition && <form id="acquisition-form" className="acquisition-bar" onKeyDown={event => {
      if (event.key === 'Escape') { setShowAcquisition(false); document.querySelector<HTMLButtonElement>('[aria-controls="acquisition-form"]')?.focus(); }
    }} onSubmit={event => { event.preventDefault(); if (url.trim()) void acquire(() => api.acquire({ url })); }}>
      <label htmlFor="source-url">{t('sourceUrl')}</label>
      <input id="source-url" type="text" inputMode="url" value={url} placeholder={t('urlPlaceholder')} autoFocus
        onChange={event => setUrl(event.target.value)} autoComplete="off" spellCheck={false} />
      <button type="submit" title={shortcutHint(locale, 'submit', t('openUrl'))} disabled={!!acquiring || !!progress || !url.trim()}>{t('openUrl')}</button>
      <button type="button" title={shortcutHint(locale, 'cancel')} onClick={() => setShowAcquisition(false)}><ActionIcon name="cancel" />{t('cancel')}</button>
    </form>}
    {operationProgress ? <AcquisitionStatus key={operationProgress.operationId} progress={operationProgress} locale={locale} updating={!!updatingView}
      cancel={() => api.cancelAcquisition({ operationId: operationProgress.operationId })} />
      : acquiring && <div className="acquisition-status" role="status">{t(acquiring)}</div>}
    {cancelledKind && <div className="acquisition-completion" role="status">{t(cancelledKind === 'refresh' ? 'refreshCancelled' : 'acquireCancelled')}</div>}
    {completion && <div className="acquisition-completion" aria-live="polite">{t('acquisitionSummary', { inserted: completion.summary.inserted, updated: completion.summary.updated, warnings: completion.summary.warnings })}
      {completion.timings && <> {t('acquisitionCompleted', { seconds: new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(completion.timings.totalMs / 1000) })}</>}</div>}
    {acquisitionError && <div className="save-error" role="alert">{t(errorKey)}</div>}
    <WorkspaceTabs workspace={workspace} locale={locale} disabled={workspaceSaving || !!movingId}
      transfer={api.transfers ? (id, newWindow) => { setMoveDialog({ id, newWindow }); } : undefined}
      label={tab => {
        if (tab.kind !== 'discussion') return t(tab.kind);
        const item = items.find(item => item.id === tab.itemId);
        const siblings = workspace.tabs.filter(t => t.kind === 'discussion' && t.itemId === tab.itemId);
        const title = item ? itemLabel(item) : t('itemNotFound');
        return siblings.length > 1 ? t('discussionInstance', { title, number: siblings.findIndex(t => t.id === tab.id) + 1 }) : title;
      }}
      icon={tab => tab.kind === 'discussion' ? items.find(item => item.id === tab.itemId)?.kind ?? 'video' : tab.kind}
      activate={activate} close={close} duplicate={id => { void duplicate(id); }}
      move={(tabId, toIndex) => { void workspaceAction(() => api.moveTab({ tabId, toIndex, expectedRevision: workspace.revision })); }} />
    {saveError && <div className="save-error" role="alert">{t('saveError')}</div>}
    {!workspace.tabs.length && <main className="empty-workspace"><h1>{t('emptyWorkspace')}</h1><p>{t(items.length ? 'reopenHelp' : 'empty')}</p>
      <button onClick={() => { void workspaceAction(() => api.openLibrary({ expectedRevision: workspace.revision })); }}>{t('openStored')}</button></main>}
    {workspace.tabs.some(tab => tab.kind === 'library') && <main id="panel-library" role="tabpanel" aria-labelledby={`tab-${libraryTab?.id}`}
      className="reader-panel" hidden={activeTab?.kind !== 'library'} tabIndex={0}>
      <div className="app-view library-view"><h1>{t('library')}</h1>
        <label className="library-filter">{t('libraryFilter')}<input type="search" title={shortcutHint(locale, 'focus-search', t('libraryFilter'))} value={libraryFilter} onChange={event => setLibraryFilter(event.target.value)} /></label>
        <p className="reader-help">{t('libraryHelp')}</p>
        <ul className="library-list">{filterLibrary(items, libraryFilter).map(item => <li key={item.id} className="library-entry">
          <TabIcon kind={item.kind} /><div className="library-details">
            <h2>{itemLabel(item)}</h2>
            <div className="item-meta"><span>{t(item.kind)}</span>{item.isDemo && <span className="demo-label">{t('demo')}</span>}<strong>{item.author?.displayName ?? t('unknownAuthor')}</strong>
              {item.author?.handle && <span>{item.author.handle}</span>}</div>
            <div className="item-meta"><span>{countLabel(locale, 'comments', comments[item.id].length)}</span>
              <span>{countLabel(locale, 'unseenCount', comments[item.id].filter(comment => !comment.seen).length)}</span>
              {isOpen(item.id) && <span>{t('currentlyOpen')}</span>}</div>
          </div>
          <div className="library-entry-actions"><button disabled={workspaceSaving} onClick={() => {
            void workspaceAction(() => api.openStoredItem({ itemId: item.id, expectedRevision: workspace.revision }), '@active');
          }}>{t(isOpen(item.id) ? 'activate' : 'open')}</button>
          {item.removable && <button className="destructive" onClick={() => { setRemovalError(undefined); setRemoving(item); }}>{t('removeFromLibrary')}</button>}</div>
        </li>)}</ul>
        {!items.length && <p>{t('empty')}</p>}
        {!!items.length && !filterLibrary(items, libraryFilter).length && <p>{t('noLibraryMatches')}</p>}
      </div>
    </main>}
    {workspace.tabs.some(tab => tab.kind === 'settings') && <main id="panel-settings" role="tabpanel" aria-labelledby={`tab-${settingsTab?.id}`}
      className="reader-panel" hidden={activeTab?.kind !== 'settings'} tabIndex={0}>
      <div className="app-view settings-view"><h1>{t('settings')}</h1>
      <div className="preferences">
        <label>{t('language')}<select value={locale} disabled={saving} onChange={event => {
          const next = event.target.value as Locale;
          void save(() => api.updatePreferences({ locale: next }), value => { if (!replica) setLocale(value.locale); }, undefined, { kind: 'updatePreferences', request: { locale: next } });
        }}>
          <option value="en">{t('en')}</option><option value="pl">{t('pl')}</option>
        </select></label>
        <label>{t('appearance')}<select value={appearance} disabled={saving} onChange={event => {
          const next = event.target.value as Appearance;
          void save(() => api.updatePreferences({ appearance: next }), value => { if (!replica) setAppearance(value.appearance); }, undefined, { kind: 'updatePreferences', request: { appearance: next } });
        }}>
          {(['system', 'light', 'dark'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}
        </select></label>
        <TranslationSettings preferences={{ translationTarget, customTranslationTarget }} onDirty={markSettingsDirty} locale={locale} disabled={saving}
          save={change => save(() => api.updatePreferences(change), value => {
            if (!replica) { setTranslationTarget(value.translationTarget); setCustomTranslationTarget(value.customTranslationTarget); }
          }, undefined, { kind: 'updatePreferences', request: change })} />
        <label>{t('selectionControls')}<select value={selectionControls} disabled={saving} onChange={event => {
          const next = event.target.value as SelectionControls;
          void save(() => api.updatePreferences({ selectionControls: next }), value => { if (!replica) setSelectionControls(value.selectionControls); }, undefined, { kind: 'updatePreferences', request: { selectionControls: next } });
        }}><option value="on-demand">{t('selectionOnDemand')}</option><option value="always">{t('selectionAlways')}</option></select></label>
        <label><input type="checkbox" checked={includeCollapsedInPrefix} disabled={saving} onChange={event => {
          const next = event.target.checked;
          void save(() => api.updatePreferences({ includeCollapsedInPrefix: next }), value => { if (!replica) setIncludeCollapsedInPrefix(value.includeCollapsedInPrefix); }, undefined, { kind: 'updatePreferences', request: { includeCollapsedInPrefix: next } });
        }} />{t('includeCollapsedInPrefix')}</label>
      </div>
        <p className="reader-help">{t('translationPrivacy')}</p>
        <ExternalTools api={api} locale={locale} active={activeTab?.kind === 'settings'} />
        <DataBackups api={api} locale={locale} onBusy={value => {
          if (api.lifecycle) return;
          dataBusy.current = value;
          if (!value) { for (const resume of afterData.current) resume(); afterData.current.clear(); }
        }} prepare={async () => {
          await saveQueue.current;
          return !lastSaveFailed.current && await views.flushAll();
        }} />
        <KeyboardShortcuts locale={locale} />
      </div>
    </main>}
    {removing && <RemovalDialog title={itemLabel(removing)} locale={locale} pending={removalPending}
      error={removalError ? t(removalError === 'ACQUISITION_BUSY' ? 'removalBusy' : 'removalFailed') : undefined}
      cancel={() => setRemoving(undefined)} remove={() => { void removeItem(); }} />}
    {openItems.map(({ tab, item }) => <main key={tab.id} id={`panel-${tab.id}`} data-item-id={item.id} data-view-id={tab.id} role="tabpanel" aria-labelledby={`tab-${tab.id}`}
      className="reader-panel" hidden={activeId !== tab.id} tabIndex={0}>
      {(activeId === tab.id || views.has(tab.id)) && <DiscussionPanel viewId={tab.id} active={activeId === tab.id} frozen={movingId === tab.id} item={item} comments={comments[item.id]} session={views.get(tab.id, comments[item.id], item.id)}
        selectionControls={selectionControls} includeCollapsedInPrefix={includeCollapsedInPrefix}
        locale={locale} saving={saving && savingItemId === item.id} refreshDisabled={!!acquiring || !!progress}
        coverageLimited={acquisitionStatus === item.id} onRefresh={refreshItem} onOpenSource={openSource} onAction={openCommentAction} onToggle={toggleComment}
        undo={seenUndo[item.id]} feedback={seenFeedback[item.id]} onBulk={bulkSeen} onUndo={undoSeen} onBulkModal={setBulkModalOpen} />}
    </main>)}
  </div>{moveFeedback && <p role="status" aria-live="polite">{t(moveFeedback)}</p>}
  {movingId && !profileBusy && <div className="profile-operation-overlay" role="dialog" aria-modal="true" aria-label={t('movingTab')}>
    <p>{t('movingTab')}</p><button autoFocus onClick={() => { cancelledMove.current = true; moveAbort.current?.abort(); if (movingToken.current) void api.transfers?.cancel({ token: movingToken.current }); }}>{t('cancel')}</button>
  </div>}
  {moveDialog && api.transfers && !profileBusy && <MoveTabDialog api={api.transfers} locale={locale} newWindow={moveDialog.newWindow}
    dirty={workspace.tabs.find(t => t.id === moveDialog.id)?.kind === 'settings' && settingsDirty.current}
    cancel={() => setMoveDialog(undefined)} move={destination => { void transfer(moveDialog.id, destination); }} />}
  {profileBusy && <div className="profile-operation-overlay" role="dialog" aria-modal="true" tabIndex={-1} ref={profileOverlay} aria-label={t('profileQuiescing')}>
    <p role="status"><span className="acquisition-spinner" aria-hidden="true" /> {t('profileQuiescing')}</p>
    {releaseFailed && <div role="alert"><p>{t('profileReconcileFailed')}</p><button autoFocus data-profile-retry onClick={() => profileController.current?.retryRelease()}>{t('retry')}</button></div>}
  </div>}</>;
}
