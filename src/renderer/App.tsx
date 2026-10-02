import { useEffect, useMemo, useRef, useState } from 'react';
import { buildCommentTree } from '../domain/discussion';
import { demoNow } from '../shared/demo-presentation';
import type { AcquisitionResult, ErrorCode, ReaderApi, ReaderState, Result } from '../shared/reader-api';
import type { Appearance } from '../shared/preferences';
import { CommentTree } from './CommentTree';
import { countLabel, initialLocale, Locale, publicationTime, translator } from './i18n';

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
  const [items, setItems] = useState(initialState.items);
  const [locale, setLocale] = useState<Locale>(initialState.preferences.locale);
  const [appearance, setAppearance] = useState<Appearance>(initialState.preferences.appearance);
  const [activeId, setActiveId] = useState(items[0]?.id);
  // Acknowledged presentation snapshot. SQLite owns all durable state.
  const [comments, setComments] = useState(initialState.comments);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const busy = useRef(false);
  const [url, setUrl] = useState('');
  const [acquiring, setAcquiring] = useState<'acquiring' | 'refreshing'>();
  const [acquisitionError, setAcquisitionError] = useState<ErrorCode>();
  const [acquisitionStatus, setAcquisitionStatus] = useState(false);
  const acquisitionBusy = useRef(false);
  const acknowledgedSeen = useRef(new Map<string, boolean>());
  async function acquire(action: () => Promise<Result<AcquisitionResult>>, refresh = false) {
    if (acquisitionBusy.current) return;
    acquisitionBusy.current = true;
    acknowledgedSeen.current.clear();
    setAcquiring(refresh ? 'refreshing' : 'acquiring');
    setAcquisitionError(undefined);
    setAcquisitionStatus(false);
    try {
      const result = await action();
      if (result.ok) {
        setItems(result.value.state.items);
        setComments(Object.fromEntries(Object.entries(result.value.state.comments).map(([id, rows]) => [id,
          rows.map(comment => ({ ...comment, seen: acknowledgedSeen.current.get(comment.id) ?? comment.seen }))])));
        if (!refresh) { setActiveId(result.value.summary.itemId); setUrl(''); }
        setAcquisitionStatus(result.value.summary.coverage !== 'complete');
      } else setAcquisitionError(result.error.code);
    } catch { setAcquisitionError('ACQUISITION_FAILED'); }
    finally { acquisitionBusy.current = false; setAcquiring(undefined); }
  }
  async function save<T>(action: () => Promise<Result<T>>, accept: (value: T) => void) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      const result = await action();
      if (result.ok) accept(result.value);
      else setSaveError(true);
    } catch { setSaveError(true); }
    finally { busy.current = false; setSaving(false); }
  }
  const t = translator(locale);
  const forests = useMemo(() => Object.fromEntries(items.map(item => [item.id, buildCommentTree(comments[item.id])])), [items, comments]);
  const demo = (id: string) => id === 'video-demo' || id === 'post-demo';
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

  return <div className="app-shell">
    <header className="app-toolbar">
      <div className="brand"><span className="brand-icon" aria-hidden="true">≡</span><strong>{t('appName')}</strong></div>
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
    </header>
    <form className="acquisition-bar" onSubmit={event => { event.preventDefault(); if (url.trim()) void acquire(() => api.acquire({ url })); }}>
      <label htmlFor="source-url">{t('sourceUrl')}</label>
      <input id="source-url" type="text" inputMode="url" value={url} placeholder={t('urlPlaceholder')}
        onChange={event => setUrl(event.target.value)} autoComplete="off" spellCheck={false} />
      <button type="submit" disabled={!!acquiring || !url.trim()}>{t('acquire')}</button>
    </form>
    {acquiring && <div className="acquisition-status" role="status">{t(acquiring)}</div>}
    {acquisitionError && <div className="save-error" role="alert">{t(errorKey)}</div>}
    {acquisitionStatus && <div className="acquisition-status" role="status">{t('coverageNotice')}</div>}
    <div className="tabs" role="tablist" aria-label={t('discussions')}>
      {items.map((item, index) => <button key={item.id} role="tab" id={`tab-${item.id}`} aria-controls={`panel-${item.id}`}
        aria-selected={activeId === item.id} tabIndex={activeId === item.id ? 0 : -1}
        onClick={() => setActiveId(item.id)} onKeyDown={event => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
            : event.key === 'ArrowRight' ? (index + 1) % items.length
              : event.key === 'ArrowLeft' ? (index + items.length - 1) % items.length : undefined;
          if (next !== undefined) {
            event.preventDefault();
            setActiveId(items[next].id);
            document.getElementById(`tab-${items[next].id}`)?.focus();
          }
        }}>
        <span className="tab-kind">{t(item.kind)}</span>
        <span className="tab-title">{item.kind === 'video' ? item.title : item.author?.displayName}</span>
      </button>)}
    </div>
    {saveError && <div className="save-error" role="alert">{t('saveError')}</div>}
    <div className="demo-notice">{t(!items.length ? 'empty' : activeId && demo(activeId) ? 'demoNotice' : 'localNotice')}</div>
    {items.map(item => {
      const time = item.publishedAt ? publicationTime(item.publishedAt, locale, demo(item.id) ? demoNow : Date.now()) : undefined;
      return <main key={item.id} id={`panel-${item.id}`} role="tabpanel" aria-labelledby={`tab-${item.id}`}
        className="reader-panel" hidden={activeId !== item.id} tabIndex={0}>
        <div className="reading-column">
          <header className={`item-header ${item.kind}`}>
            <div className="item-actions"><div className="eyebrow">{t(item.kind)} {demo(item.id) && <span className="demo-label">{t('demo')}</span>}</div>
              {!demo(item.id) && <button disabled={!!acquiring} onClick={() => { void acquire(() => api.refresh({ itemId: item.id }), true); }}>{t('refresh')}</button>}
            </div>
            {item.kind === 'video' ? <><h1>{item.title}</h1><p className="item-description">{item.description}</p></>
              : <><h1>{item.author?.displayName ?? t('unknownAuthor')}</h1><p className="post-text">{item.text}</p></>}
            <div className="item-meta"><strong>{item.author?.displayName ?? t('unknownAuthor')}</strong>
              {item.author?.handle && <span>{item.author.handle}</span>}
              {time && <time dateTime={item.publishedAt} title={time.exact} tabIndex={0} aria-label={time.exact}>{time.relative}</time>}
            </div>
          </header>
          <section aria-label={t('discussion')}>
            <div className="discussion-heading"><h2>{countLabel(locale, 'comments', comments[item.id].length)}</h2>
              <span>{countLabel(locale, 'unseenCount', comments[item.id].filter(comment => !comment.seen).length)}</span></div>
            <p className="reader-help">{t('seenHelp')}</p>
            <CommentTree nodes={forests[item.id]} locale={locale} now={demo(item.id) ? demoNow : Date.now()} disabled={saving} onToggle={(id, subtree) => {
              void save(() => api.toggleSeen({ itemId: item.id, commentId: id, subtree }), value => {
                const seen = new Map(value.map(comment => [comment.id, comment.seen]));
                if (acquisitionBusy.current) for (const [id, state] of seen) acknowledgedSeen.current.set(id, state);
                setComments(current => ({ ...current, [item.id]: current[item.id].map(comment => ({ ...comment, seen: seen.get(comment.id) ?? comment.seen })) }));
              });
            }} />
          </section>
          {demo(item.id) && <footer className="reader-footer"><p>{t('newHelp')}</p><p>{t('clockNote')}: {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(demoNow)}</p></footer>}
        </div>
      </main>;
    })}
  </div>;
}
