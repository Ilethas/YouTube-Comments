import { useCallback, useEffect, useRef, useState } from 'react';
import type { AcquisitionResult, ErrorCode, ReaderApi, ReaderState, Result } from '../shared/reader-api';
import type { Appearance } from '../shared/preferences';
import { countLabel, initialLocale, Locale, translator } from './i18n';
import { discussionTab } from '../domain/workspace';
import { WorkspaceTabs } from './WorkspaceTabs';
import { TabIcon } from './TabIcon';
import { filterLibrary } from './library';
import { RemovalDialog } from './RemovalDialog';
import type { WorkspaceState } from '../domain/workspace';
import { useDiscussionViews } from './use-discussion-views';
import { DiscussionPanel } from './DiscussionPanel';
import { navigateDiscussion } from './discussion-navigation';

export function App({ api = window.reader }: { api?: ReaderApi }) {
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
    return () => { cancelled = true; };
  }, [api, attempt]);
  if (state) return <Reader initialState={state} api={api} />;
  return <div className="startup-state" role={error ? 'alert' : 'status'}>
    <p>{t(error === 'UNSUPPORTED_SCHEMA' ? 'unsupportedSchema' : error ? 'loadError' : 'loading')}</p>
    {error === 'STORAGE_UNAVAILABLE' && <button onClick={() => setAttempt(value => value + 1)}>{t('retry')}</button>}
  </div>;
}

function Reader({ initialState, api }: { initialState: ReaderState; api: ReaderApi }) {
  const views = useDiscussionViews();
  const [items, setItems] = useState(initialState.items);
  const [locale, setLocale] = useState<Locale>(initialState.preferences.locale);
  const [appearance, setAppearance] = useState<Appearance>(initialState.preferences.appearance);
  const [workspace, setWorkspace] = useState(initialState.workspace);
  const activeId = workspace.activeTabId;
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const workspaceBusy = useRef(false);
  const [showAcquisition, setShowAcquisition] = useState(false);
  const [libraryFilter, setLibraryFilter] = useState('');
  const [removing, setRemoving] = useState<ReaderState['items'][number]>();
  const [removalPending, setRemovalPending] = useState(false);
  const removalBusy = useRef(false);
  const [removalError, setRemovalError] = useState<ErrorCode>();
  const removedIds = useRef(new Set<string>());
  // Acknowledged presentation snapshot. SQLite owns all durable state.
  const [comments, setComments] = useState(initialState.comments);
  const [saving, setSaving] = useState(false);
  const [savingItemId, setSavingItemId] = useState<string>();
  const [saveError, setSaveError] = useState(false);
  const busy = useRef(false);
  const [url, setUrl] = useState('');
  const [acquiring, setAcquiring] = useState<'acquiring' | 'refreshing'>();
  const [acquisitionError, setAcquisitionError] = useState<ErrorCode>();
  const [acquisitionStatus, setAcquisitionStatus] = useState<string>();
  const acquisitionBusy = useRef(false);
  const acknowledgedSeen = useRef(new Map<string, boolean>());
  const acquire = useCallback(async function acquire(action: () => Promise<Result<AcquisitionResult>>, refresh = false) {
    if (acquisitionBusy.current) return;
    acquisitionBusy.current = true;
    acknowledgedSeen.current.clear();
    setAcquiring(refresh ? 'refreshing' : 'acquiring');
    setAcquisitionError(undefined);
    setAcquisitionStatus(undefined);
    try {
      const result = await action();
      if (result.ok) {
        setItems(result.value.state.items.filter(item => !removedIds.current.has(item.id)));
        const mergedComments = Object.fromEntries(Object.entries(result.value.state.comments).filter(([id]) => !removedIds.current.has(id)).map(([id, rows]) => [id,
          rows.map(comment => ({ ...comment, seen: acknowledgedSeen.current.get(comment.id) ?? comment.seen }))]));
        setComments(mergedComments);
        const refreshedId = result.value.summary.itemId;
        if (mergedComments[refreshedId]) views.refresh(refreshedId, mergedComments[refreshedId]);
        acceptWorkspace(result.value.state.workspace);
        if (!refresh) { setUrl(''); setShowAcquisition(false); }
        setAcquisitionStatus(result.value.summary.coverage !== 'complete' ? result.value.summary.itemId : undefined);
      } else setAcquisitionError(result.error.code);
    } catch { setAcquisitionError('ACQUISITION_FAILED'); }
    finally { acquisitionBusy.current = false; setAcquiring(undefined); }
  }, [api, views]);
  function acceptWorkspace(value: WorkspaceState) {
    setWorkspace(current => value.revision >= current.revision ? value : current);
  }
  async function workspaceAction(action: () => Promise<Result<WorkspaceState>>, focusId?: string) {
    if (workspaceBusy.current) return;
    workspaceBusy.current = true; setWorkspaceSaving(true); setSaveError(false);
    try {
      const result = await action();
      if (result.ok) {
        acceptWorkspace(result.value);
        if (focusId) requestAnimationFrame(() => {
          (focusId === '@active' ? document.querySelector<HTMLElement>('[role=tab][aria-selected=true]') ?? document.getElementById('library-toggle') : document.getElementById(`tab-${focusId}`))?.focus();
        });
      } else setSaveError(true);
    } catch { setSaveError(true); }
    finally { workspaceBusy.current = false; setWorkspaceSaving(false); }
  }
  function activate(tabId: string, focus = false) {
    void workspaceAction(() => api.activateTab({ tabId }), focus ? tabId : undefined);
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
        setItems(current => current.filter(item => item.id !== id));
        setComments(current => Object.fromEntries(Object.entries(current).filter(([itemId]) => itemId !== id)));
        acceptWorkspace(result.value.workspace);
        setRemoving(undefined);
      } else setRemovalError(result.error.code);
    } catch { setRemovalError('STORAGE_UNAVAILABLE'); }
    finally { removalBusy.current = false; setRemovalPending(false); }
  }
  const save = useCallback(async function save<T>(action: () => Promise<Result<T>>, accept: (value: T) => void, itemId?: string) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setSavingItemId(itemId);
    setSaveError(false);
    try {
      const result = await action();
      if (result.ok) accept(result.value);
      else setSaveError(true);
    } catch { setSaveError(true); }
    finally { busy.current = false; setSaving(false); setSavingItemId(undefined); }
  }, []);
  const t = translator(locale);
  const openItems = workspace.tabs.flatMap(tab => tab.kind === 'discussion' ? items.find(item => item.id === tab.itemId) ?? [] : []);
  const isOpen = (id: string) => workspace.tabs.some(tab => tab.kind === 'discussion' && tab.itemId === id);
  const itemLabel = (item: ReaderState['items'][number]) => item.kind === 'video' ? item.title
    : `${item.author?.displayName ?? item.author?.handle ?? t('unknownAuthor')} · ${item.text.replace(/\s+/g, ' ').slice(0, 80)}`;
  const errorKey = acquisitionError === 'HELPER_UNAVAILABLE' ? 'helperUnavailable' : acquisitionError === 'HELPER_INCOMPATIBLE' ? 'helperIncompatible'
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
  const toggleComment = useCallback((itemId: string, commentId: string, subtree: boolean) => {
    void save(() => api.toggleSeen({ itemId, commentId, subtree }), value => {
      const seen = new Map(value.map(comment => [comment.id, comment.seen]));
      if (acquisitionBusy.current) for (const [id, state] of seen) acknowledgedSeen.current.set(id, state);
      setComments(current => !current[itemId] ? current : ({ ...current, [itemId]: current[itemId].map(comment => ({ ...comment, seen: seen.get(comment.id) ?? comment.seen })) }));
      views.seenChanged(itemId);
    }, itemId);
  }, [api, save, views]);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      const tab = workspace.tabs.find(tab => tab.id === activeId);
      if (tab?.kind !== 'discussion' || removing) return;
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault(); void views.get(tab.itemId, comments[tab.itemId]).apply(comments[tab.itemId]);
      } else if (event.key === 'F3') {
        event.preventDefault(); navigateDiscussion(views.get(tab.itemId, comments[tab.itemId]), comments[tab.itemId], 'match', event.shiftKey ? -1 : 1);
      }
    }
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  });

  return <div className="app-shell">
    <header className="app-toolbar">
      <div className="brand"><span className="brand-icon" aria-hidden="true">≡</span><strong>{t('appName')}</strong></div>
      <div className="workspace-actions">
        <button aria-expanded={showAcquisition} aria-controls="acquisition-form" onClick={() => { setShowAcquisition(value => !value); }}>{t('acquire')}</button>
        <button id="library-toggle" disabled={workspaceSaving} onClick={() => { void workspaceAction(() => api.openLibrary()); }}>{t('library')}</button>
        <button id="settings-toggle" disabled={workspaceSaving} onClick={() => { void workspaceAction(() => api.openSettings()); }}>{t('settings')}</button>
      </div>
    </header>
    {showAcquisition && <form id="acquisition-form" className="acquisition-bar" onKeyDown={event => {
      if (event.key === 'Escape') { setShowAcquisition(false); document.querySelector<HTMLButtonElement>('[aria-controls="acquisition-form"]')?.focus(); }
    }} onSubmit={event => { event.preventDefault(); if (url.trim()) void acquire(() => api.acquire({ url })); }}>
      <label htmlFor="source-url">{t('sourceUrl')}</label>
      <input id="source-url" type="text" inputMode="url" value={url} placeholder={t('urlPlaceholder')} autoFocus
        onChange={event => setUrl(event.target.value)} autoComplete="off" spellCheck={false} />
      <button type="submit" disabled={!!acquiring || !url.trim()}>{t('openUrl')}</button>
      <button type="button" onClick={() => setShowAcquisition(false)}>{t('cancel')}</button>
    </form>}
    {acquiring && <div className="acquisition-status" role="status">{t(acquiring)}</div>}
    {acquisitionError && <div className="save-error" role="alert">{t(errorKey)}</div>}
    <WorkspaceTabs workspace={workspace} locale={locale} disabled={workspaceSaving}
      label={tab => {
        if (tab.kind !== 'discussion') return t(tab.kind);
        const item = items.find(item => item.id === tab.itemId);
        return item ? itemLabel(item) : t('itemNotFound');
      }}
      icon={tab => tab.kind === 'discussion' ? items.find(item => item.id === tab.itemId)?.kind ?? 'video' : tab.kind}
      activate={activate} close={tabId => { void workspaceAction(() => api.closeTab({ tabId }), '@active'); }}
      move={(tabId, toIndex) => { void workspaceAction(() => api.moveTab({ tabId, toIndex })); }} />
    {saveError && <div className="save-error" role="alert">{t('saveError')}</div>}
    {!workspace.tabs.length && <main className="empty-workspace"><h1>{t('emptyWorkspace')}</h1><p>{t(items.length ? 'reopenHelp' : 'empty')}</p>
      <button onClick={() => { void workspaceAction(() => api.openLibrary()); }}>{t('openStored')}</button></main>}
    {workspace.tabs.some(tab => tab.kind === 'library') && <main id="panel-library" role="tabpanel" aria-labelledby="tab-library"
      className="reader-panel" hidden={activeId !== 'library'} tabIndex={0}>
      <div className="app-view library-view"><h1>{t('library')}</h1>
        <label className="library-filter">{t('libraryFilter')}<input type="search" value={libraryFilter} onChange={event => setLibraryFilter(event.target.value)} /></label>
        <p className="reader-help">{t('libraryHelp')}</p>
        <ul className="library-list">{filterLibrary(items, libraryFilter).map(item => <li key={item.id} className="library-entry">
          <TabIcon kind={item.kind} /><div className="library-details">
            <h2>{itemLabel(item)}</h2>
            <div className="item-meta"><span>{t(item.kind)}</span><strong>{item.author?.displayName ?? t('unknownAuthor')}</strong>
              {item.author?.handle && <span>{item.author.handle}</span>}</div>
            <div className="item-meta"><span>{countLabel(locale, 'comments', comments[item.id].length)}</span>
              <span>{countLabel(locale, 'unseenCount', comments[item.id].filter(comment => !comment.seen).length)}</span>
              {isOpen(item.id) && <span>{t('currentlyOpen')}</span>}</div>
          </div>
          <div className="library-entry-actions"><button disabled={workspaceSaving} onClick={() => {
            void workspaceAction(() => api.openStoredItem({ itemId: item.id }), discussionTab(item.id).id);
          }}>{t(isOpen(item.id) ? 'activate' : 'open')}</button>
          {item.removable ? <button className="destructive" onClick={() => { setRemovalError(undefined); setRemoving(item); }}>{t('removeFromLibrary')}</button>
            : <span className="reader-help" title={t('demoRemovalHelp')}>{t('demoProtected')}</span>}</div>
        </li>)}</ul>
        {!items.length && <p>{t('empty')}</p>}
        {!!items.length && !filterLibrary(items, libraryFilter).length && <p>{t('noLibraryMatches')}</p>}
      </div>
    </main>}
    {workspace.tabs.some(tab => tab.kind === 'settings') && <main id="panel-settings" role="tabpanel" aria-labelledby="tab-settings"
      className="reader-panel" hidden={activeId !== 'settings'} tabIndex={0}>
      <div className="app-view settings-view"><h1>{t('settings')}</h1>
      <div className="preferences">
        <label>{t('language')}<select value={locale} disabled={saving} onChange={event => {
          const next = event.target.value as Locale;
          void save(() => api.updatePreferences({ locale: next }), value => setLocale(value.locale));
        }}>
          <option value="en">{t('en')}</option><option value="pl">{t('pl')}</option>
        </select></label>
        <label>{t('appearance')}<select value={appearance} disabled={saving} onChange={event => {
          const next = event.target.value as Appearance;
          void save(() => api.updatePreferences({ appearance: next }), value => setAppearance(value.appearance));
        }}>
          {(['system', 'light', 'dark'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}
        </select></label>
      </div>
        <h2>{t('externalTools')}</h2><p>{t('externalToolsHelp')}</p>
      </div>
    </main>}
    {removing && <RemovalDialog title={itemLabel(removing)} locale={locale} pending={removalPending}
      error={removalError ? t(removalError === 'ACQUISITION_BUSY' ? 'removalBusy' : 'removalFailed') : undefined}
      cancel={() => setRemoving(undefined)} remove={() => { void removeItem(); }} />}
    {openItems.map(item => <main key={item.id} id={`panel-${item.id}`} role="tabpanel" aria-labelledby={`tab-${discussionTab(item.id).id}`}
      className="reader-panel" hidden={activeId !== discussionTab(item.id).id} tabIndex={0}>
      <DiscussionPanel item={item} comments={comments[item.id]} session={views.get(item.id, comments[item.id])}
        locale={locale} saving={saving && savingItemId === item.id} refreshDisabled={!!acquiring}
        coverageLimited={acquisitionStatus === item.id} onRefresh={refreshItem} onToggle={toggleComment} />
    </main>)}
  </div>;
}
