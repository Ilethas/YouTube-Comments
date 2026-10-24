import { DownloadStatus } from './Downloads';
import type { DownloadJob } from '../shared/downloads';
import { ActionIcon } from './ActionIcon';
import type { OpenCommentAction } from './CommentActions';
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Comment, ContentItem } from '../domain/discussion';
import { visibleUnseenIds } from '../domain/discussion-query';
import { demoNow, readerNewCommentIds } from '../shared/demo-presentation';
import { VirtualCommentList } from './VirtualCommentList';
import { countLabel, Locale, publicationTime, translator } from './i18n';
import { DiscussionQueryControls } from './DiscussionQueryControls';
import type { DiscussionViewSession } from './discussion-view-session';
import { navigateDiscussion } from './discussion-navigation';
import { recordRenderWork } from './render-work';
import { seenHelp } from './shortcuts';
import { BulkSeenControls } from './BulkSeenControls';
import type { SeenFeedback } from './BulkSeenControls';
import type { BulkSeenRequest, SeenUndoDescriptor } from '../domain/seen-operation';
import type { Result } from '../shared/reader-api';
import { SourceAction } from './SourceAction';
import { DiscussionActions } from './DiscussionActions';
import type { CommentMenuTarget } from './CommentContextMenu';
import type { SelectionControls } from '../shared/preferences';
import { VideoThumbnail } from './VideoThumbnail';

interface Props {
  viewId?: string;
  active?: boolean;
  frozen?: boolean;
  selectionControls?: SelectionControls;
  includeCollapsedInPrefix?: boolean;
  onAction?: OpenCommentAction;
  item: ContentItem;
  comments: readonly Comment[];
  session: DiscussionViewSession;
  locale: Locale;
  saving: boolean;
  refreshDisabled: boolean;
  download?: DownloadJob;
  coverageLimited: boolean;
  onRefresh: (itemId: string) => void;
  onOpenSource?: (itemId: string) => Promise<Result<null>>;
  onToggle: (itemId: string, commentId: string, subtree: boolean) => void;
  undo?: SeenUndoDescriptor | null;
  feedback?: SeenFeedback;
  onBulk?: (request: BulkSeenRequest) => Promise<boolean>;
  onUndo?: (itemId: string) => void;
  onBulkModal?: (open: boolean) => void;
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
export const DiscussionPanel = memo(function DiscussionPanel({ viewId, active = true, frozen = false, selectionControls = 'on-demand', includeCollapsedInPrefix = true, item, comments, session, locale, saving, refreshDisabled, download, coverageLimited, onRefresh, onOpenSource, onToggle, onAction, undo, feedback, onBulk, onUndo, onBulkModal }: Props) {
  recordRenderWork('panel', viewId ?? item.id);
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [menu, setMenu] = useState<CommentMenuTarget>();
  const dismissMenu = useCallback(() => setMenu(undefined), []);
  useEffect(() => { setMenu(undefined); }, [active, frozen, view.result, view.sort, view.collapse, comments]);
  const presentation = session.presentation(comments);
  const t = translator(locale);
  const limited = coverageLimited || download?.state === 'completed' && download.coverage !== undefined && download.coverage !== 'complete';
  const now = useMemo(() => item.isDemo ? demoNow : Date.now(), [item]);
  const newIds = useMemo(() => readerNewCommentIds(item, comments), [item, comments]);
  const time = item.publishedAt ? publicationTime(item.publishedAt, locale, now) : undefined;
  const toggle = useCallback((id: string, subtree: boolean) => onToggle(item.id, id, subtree), [onToggle, item.id]);
  useEffect(() => { void session.restore(comments, item); }, [session, comments, item]);
  if (view.restoring) return <div className="reading-column" role="status" aria-busy="true"><p>{t('viewRestoring')}</p></div>;
  return (
        <div className="reading-column">
          <header className={`item-header ${item.kind}`}>
            <div className="item-actions"><div className="eyebrow">{t(item.kind)} {item.isDemo && <span className="demo-label">{t('demo')}</span>}</div>
              <span className="item-status" title={t(limited ? 'coverageNotice' : item.isDemo ? 'demoNotice' : 'localNotice')}
                role={limited ? 'status' : undefined}>{t(limited ? 'coverageShort' : 'savedShort')}</span>
              {download && <DownloadStatus job={download} locale={locale} />}
              {!item.isDemo && <button disabled={refreshDisabled} onClick={() => { onRefresh(item.id); }}><ActionIcon name="refresh" />{t('refresh')}</button>}
            </div>
            <div className="item-title"><h1>{item.kind === 'video' ? item.title : item.author?.displayName ?? t('unknownAuthor')}</h1>
              {!item.isDemo && onOpenSource && <SourceAction itemId={item.id} locale={locale} open={onOpenSource} />}</div>
            {item.kind === 'video' && <VideoThumbnail key={`${item.id}:${item.sourceId}`} item={item} locale={locale} active={active} />}
            {item.kind === 'video' ? item.description && <VideoDescription id={viewId ?? item.id} text={item.description} locale={locale} /> : <p className="post-text">{item.text}</p>}
            <div className="item-meta"><strong>{item.author?.displayName ?? t('unknownAuthor')}</strong>
              {item.author?.handle && <span>{item.author.handle}</span>}
              {time && <time dateTime={item.publishedAt} title={time.exact} tabIndex={0} aria-label={time.exact}>{time.relative}</time>}
              {!time && item.remote?.publication.label.status === 'observed' && <span>{item.remote.publication.label.value}</span>}
            </div>
          </header>
          <section aria-label={t('discussion')}>
            {view.restoreFailed && <p className="query-error" role="alert">{t('viewRestoreFailed')}</p>}
            {view.collapseSaveFailed && <p className="query-error" role="alert">{t('collapseSaveFailed')} <button onClick={() => { void session.flush(); }}>{t('retry')}</button></p>}
            {view.saveFailed && <p className="query-error" role="alert">{t('viewSaveFailed')}</p>}
            <div className="discussion-heading"><h2>{countLabel(locale, 'comments', comments.length)}</h2>
              <span>{countLabel(locale, 'unseenCount', comments.filter(comment => !comment.seen).length)}</span></div>
            <p className="reader-help">{seenHelp(locale)}</p>
            {!frozen && onBulk && onUndo && onBulkModal && <BulkSeenControls itemId={item.id} title={item.kind === 'video' ? item.title : item.author?.displayName ?? t('unknownAuthor')} comments={comments} result={view.result} locale={locale} disabled={saving}
              undo={undo} feedback={feedback} execute={onBulk} recover={onUndo} modalChanged={onBulkModal} />}
            <DiscussionQueryControls setCollapsed={collapsed => session.setCollapsed({ kind: 'all', collapsed })} state={view} presentation={presentation} sort={sort => session.setSort(sort)} locale={locale} edit={draft => session.edit(draft)}
              apply={() => { void session.apply(comments, false, item); }} navigate={(kind, direction) => navigateDiscussion(session, comments, kind, direction)}
              unseenCount={visibleUnseenIds(view.result, comments).length} />
            {view.result.restrictive && !view.result.matchCount && <p className="reader-help">{t('noDiscussionMatches')}</p>}
            {!frozen && <DiscussionActions item={item} comments={comments} session={session} locale={locale} disabled={saving}
              includeCollapsedInPrefix={includeCollapsedInPrefix} menu={active ? menu : undefined} dismissMenu={dismissMenu}
              onAction={onAction} execute={onBulk} modalChanged={onBulkModal} />}
            <VirtualCommentList viewId={viewId} active={active} itemId={item.id} isDemo={item.isDemo} comments={comments} result={view.result} selected={view.selected} session={session} scrollRequest={view.scrollRequest}
              showSelection={selectionControls === 'always' || view.selectionMode} bulkSelected={view.bulkSelected} onContextMenu={setMenu}
              locale={locale} disabled={saving} onToggle={toggle} onAction={onAction} now={now} newIds={newIds} />
          </section>
          {item.isDemo && <footer className="reader-footer"><p>{t('newHelp')}</p><p>{t('clockNote')}: {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(demoNow)}</p></footer>}
        </div>
  );
});
