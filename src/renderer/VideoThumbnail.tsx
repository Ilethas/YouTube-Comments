import { useEffect, useState } from 'react';
import type { ContentItem } from '../domain/discussion';
import { videoThumbnailSources } from '../domain/video-thumbnail';
import { CommentContextMenu } from './CommentContextMenu';
import type { CommentMenuTarget } from './CommentContextMenu';
import { translator } from './i18n';
import type { Locale } from './i18n';

/** Isolated header state: image updates never rebuild comment projections. */
export function VideoThumbnail({ item, locale, active }: { item: ContentItem; locale: Locale; active: boolean }) {
  const [url, setUrl] = useState<string>();
  const [loaded, setLoaded] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState<CommentMenuTarget>();
  const [failed, setFailed] = useState(false);
  const t = translator(locale);
  useEffect(() => {
    let cancelled = false;
    if (!active || !videoThumbnailSources(item).length || !window.reader?.getThumbnail) return;
    const request = { itemId: item.id };
    const accept = (value: string | null) => {
      if (!cancelled && value && /^reader-thumbnail:\/\/cache\/[a-f0-9-]{36}$/.test(value)) setUrl(value);
    };
    void (async () => {
      try {
        const cached = await window.reader.getThumbnail(request);
        if (cached.ok) accept(cached.value);
        if (cancelled) return;
        const checked = await window.reader.checkThumbnail(request);
        if (checked.ok) accept(checked.value);
      } catch { /* Best-effort presentation. */ }
    })();
    const timer = setInterval(() => {
      void window.reader.checkThumbnail(request).then(result => { if (result.ok) accept(result.value); }).catch(() => undefined);
    }, 24 * 60 * 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active, item.id, item.sourceId, item.latestAcceptedDiscoveryId]);
  useEffect(() => { if (!active) setMenu(undefined); }, [active]);
  async function open() {
    setFailed(false);
    try { setFailed(!(await window.reader.openThumbnail({ itemId: item.id })).ok); }
    catch { setFailed(true); }
  }
  if (!url) return null;
  return <div className="video-thumbnail-row" hidden={loaded !== url}>
    <button type="button" className={`video-thumbnail ${expanded ? 'expanded' : ''}`} aria-expanded={expanded}
      aria-label={t(expanded ? 'shrinkThumbnail' : 'expandThumbnail')} onClick={() => setExpanded(value => !value)}
      onContextMenu={event => {
        if (loaded !== url) return;
        event.preventDefault();
        setMenu({ id: item.id, x: event.clientX, y: event.clientY, origin: event.currentTarget, selectionText: '' });
      }} onKeyDown={event => {
        if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
          event.preventDefault(); event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ id: item.id, x: rect.left, y: rect.bottom, origin: event.currentTarget, selectionText: '' });
        }
      }}>
      <img src={url} alt="" draggable={false} referrerPolicy="no-referrer" onLoad={() => setLoaded(url)} onError={() => { setLoaded(undefined); setMenu(undefined); }} />
    </button>
    {failed && <small role="status">{t('thumbnailOpenFailed')}</small>}
    {active && menu && <CommentContextMenu target={menu} locale={locale} label={t('thumbnailMenu')} dismiss={() => setMenu(undefined)}
      items={[{ label: t('openThumbnail'), icon: 'external', run: () => { void open(); } }]} />}
  </div>;
}
