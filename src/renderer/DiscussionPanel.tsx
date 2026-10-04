import { memo, useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { buildCommentTree } from '../domain/discussion';
import type { Comment, ContentItem } from '../domain/discussion';
import type { DiscussionViewResult } from '../domain/discussion-query';
import { visibleUnseenIds } from '../domain/discussion-query';
import { demoNow } from '../shared/demo-presentation';
import { CommentTree } from './CommentTree';
import { countLabel, Locale, publicationTime, translator } from './i18n';
import { DiscussionQueryControls } from './DiscussionQueryControls';
import type { DiscussionViewSession } from './discussion-view-session';
import { navigateDiscussion } from './discussion-navigation';
import { recordRenderWork } from './render-work';

const demo = (id: string) => id === 'video-demo' || id === 'post-demo';
interface Props {
  item: ContentItem;
  comments: readonly Comment[];
  session: DiscussionViewSession;
  locale: Locale;
  saving: boolean;
  refreshDisabled: boolean;
  coverageLimited: boolean;
  onRefresh: (itemId: string) => void;
  onToggle: (itemId: string, commentId: string, subtree: boolean) => void;
}

function VideoDescription({ id, text, locale }: { id: string; text: string; locale: Locale }) {
  const [expanded, setExpanded] = useState(false);
  const t = translator(locale);
  return <div className="description-block">
    <p id={`description-${id}`} className={`item-description ${expanded ? 'expanded' : 'preview'}`}>{text}</p>
    <button className="text-button" aria-expanded={expanded} aria-controls={`description-${id}`} onClick={() => setExpanded(value => !value)}>{t(expanded ? 'showLess' : 'showMore')}</button>
  </div>;
}

/** Mounted content is independent of its workspace visibility wrapper.
 * Session notifications update only this discussion; draft edits reuse the forest. */
export const DiscussionPanel = memo(function DiscussionPanel({ item, comments, session, locale, saving, refreshDisabled, coverageLimited, onRefresh, onToggle }: Props) {
  recordRenderWork('panel', item.id);
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const t = translator(locale);
  const now = useMemo(() => demo(item.id) ? demoNow : Date.now(), [item, comments]);
  const time = item.publishedAt ? publicationTime(item.publishedAt, locale, now) : undefined;
  const toggle = useCallback((id: string, subtree: boolean) => onToggle(item.id, id, subtree), [onToggle, item.id]);
  return (
        <div className="reading-column">
          <header className={`item-header ${item.kind}`}>
            <div className="item-actions"><div className="eyebrow">{t(item.kind)} {demo(item.id) && <span className="demo-label">{t('demo')}</span>}</div>
              <span className="item-status" title={t(coverageLimited ? 'coverageNotice' : demo(item.id) ? 'demoNotice' : 'localNotice')}
                role={coverageLimited ? 'status' : undefined}>{t(coverageLimited ? 'coverageShort' : 'savedShort')}</span>
              {!demo(item.id) && <button disabled={refreshDisabled} onClick={() => { onRefresh(item.id); }}>{t('refresh')}</button>}
            </div>
            {item.kind === 'video' ? <><h1>{item.title}</h1>{item.description && <VideoDescription id={item.id} text={item.description} locale={locale} />}</>
              : <><h1>{item.author?.displayName ?? t('unknownAuthor')}</h1><p className="post-text">{item.text}</p></>}
            <div className="item-meta"><strong>{item.author?.displayName ?? t('unknownAuthor')}</strong>
              {item.author?.handle && <span>{item.author.handle}</span>}
              {time && <time dateTime={item.publishedAt} title={time.exact} tabIndex={0} aria-label={time.exact}>{time.relative}</time>}
              {!time && item.remote?.publication.label.status === 'observed' && <span>{item.remote.publication.label.value}</span>}
            </div>
          </header>
          <section aria-label={t('discussion')}>
            <div className="discussion-heading"><h2>{countLabel(locale, 'comments', comments.length)}</h2>
              <span>{countLabel(locale, 'unseenCount', comments.filter(comment => !comment.seen).length)}</span></div>
            <p className="reader-help">{t('seenHelp')}</p>
            <DiscussionQueryControls state={view} locale={locale} edit={draft => session.edit(draft)}
              apply={() => { void session.apply(comments); }} navigate={(kind, direction) => navigateDiscussion(session, comments, kind, direction)}
              unseenCount={visibleUnseenIds(view.result, comments).length} />
            {view.result.restrictive && !view.result.matchCount && <p className="reader-help">{t('noDiscussionMatches')}</p>}
            <DiscussionForest itemId={item.id} comments={comments} result={view.result} selected={view.selected}
              locale={locale} disabled={saving} onToggle={toggle} now={now} />
          </section>
          {demo(item.id) && <footer className="reader-footer"><p>{t('newHelp')}</p><p>{t('clockNote')}: {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(demoNow)}</p></footer>}
        </div>
  );
});

interface ForestProps {
  itemId: string;
  comments: readonly Comment[];
  result: DiscussionViewResult;
  selected?: string;
  locale: Locale;
  disabled: boolean;
  now: number;
  onToggle: (id: string, subtree: boolean) => void;
}
/** Projection uses frozen applied placement with live acknowledged seen data.
 * Only a new comment snapshot or applied result requires rebuilding the forest. */
const DiscussionForest = memo(function DiscussionForest({ itemId, comments, result, selected, locale, disabled, now, onToggle }: ForestProps) {
  const nodes = useMemo(() => {
    recordRenderWork('forest', itemId);
    const byId = new Map(comments.map(comment => [comment.id, comment]));
    const rows = result.visibleCommentIds.flatMap(id => {
      const comment = byId.get(id);
      return comment ? [{ ...comment, parentId: result.visibleParentIds[id] }] : [];
    });
    return buildCommentTree(rows);
  }, [comments, result, itemId]);
  const view = useMemo(() => ({ restrictive: result.restrictive, active: new Set(result.activeMatchIds), raw: new Set(result.rawSearchMatchIds), selected }), [result, selected]);
  return <CommentTree nodes={nodes} locale={locale} view={view} now={now} disabled={disabled} onToggle={onToggle} />;
});
