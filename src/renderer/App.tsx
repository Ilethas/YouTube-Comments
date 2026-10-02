import { useEffect, useMemo, useState } from 'react';
import { buildCommentTree, toggleSeen } from '../domain/discussion';
import { demoNow, initialComments, items } from '../fixtures/discussions';
import { CommentTree } from './CommentTree';
import { countLabel, initialLocale, Locale, publicationTime, translator } from './i18n';

type Appearance = 'system' | 'light' | 'dark';

export function App() {
  const [locale, setLocale] = useState<Locale>(() => initialLocale(navigator.languages));
  const [appearance, setAppearance] = useState<Appearance>('system');
  const [activeId, setActiveId] = useState(items[0].id);
  // Deliberately ephemeral. Future services must own durable state; no localStorage.
  const [comments, setComments] = useState(initialComments);
  const t = translator(locale);
  const forests = useMemo(() => Object.fromEntries(items.map(item => [item.id, buildCommentTree(comments[item.id])])), [comments]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translator(locale)('appName');
  }, [locale]);
  useEffect(() => {
    document.documentElement.dataset.appearance = appearance;
  }, [appearance]);

  return <div className="app-shell">
    <header className="app-toolbar">
      <div className="brand"><span className="brand-icon" aria-hidden="true">≡</span><strong>{t('appName')}</strong><span className="demo-label">{t('demo')}</span></div>
      <div className="preferences">
        <label>{t('language')}<select value={locale} onChange={event => setLocale(event.target.value as Locale)}>
          <option value="en">{t('en')}</option><option value="pl">{t('pl')}</option>
        </select></label>
        <label>{t('appearance')}<select value={appearance} onChange={event => setAppearance(event.target.value as Appearance)}>
          {(['system', 'light', 'dark'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}
        </select></label>
      </div>
    </header>
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
    <div className="demo-notice">{t('memoryNotice')}</div>
    {items.map(item => {
      const time = item.publishedAt ? publicationTime(item.publishedAt, locale, demoNow) : undefined;
      return <main key={item.id} id={`panel-${item.id}`} role="tabpanel" aria-labelledby={`tab-${item.id}`}
        className="reader-panel" hidden={activeId !== item.id} tabIndex={0}>
        <div className="reading-column">
          <header className={`item-header ${item.kind}`}>
            <div className="eyebrow">{t(item.kind)}</div>
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
            <CommentTree nodes={forests[item.id]} locale={locale} onToggle={(id, subtree) => {
              setComments(current => ({ ...current, [item.id]: toggleSeen(current[item.id], id, subtree) }));
            }} />
          </section>
          <footer className="reader-footer"><p>{t('newHelp')}</p><p>{t('clockNote')}: {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(demoNow)}</p></footer>
        </div>
      </main>;
    })}
  </div>;
}
