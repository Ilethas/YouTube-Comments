import { memo } from 'react';
import type { Comment } from '../domain/discussion';
import { demoNow } from '../shared/demo-presentation';
import { Locale, publicationTime, translator } from './i18n';
import { Avatar } from './Avatar';
import { recordRenderWork } from './render-work';
import { seenHelp } from './shortcuts';

interface Props {
  comment: Comment;
  locale: Locale;
  disabled: boolean;
  now?: number;
  hasChildren: boolean;
  role: 'normal' | 'match' | 'context';
  rawHit: boolean;
  selected: boolean;
  isNew?: boolean;
  onToggle: (id: string, subtree: boolean) => void;
}

/** Stable application-owned reveal target; no source IDs or selector interpolation. */
export const commentTargetId = (id: string) => `comment-${encodeURIComponent(id)}`;

/** A single measured reader article; React never recursively constructs replies. */
export const CommentArticle = memo(function CommentArticle({ comment, locale, disabled, onToggle, role, rawHit, selected, hasChildren, isNew = false, now = demoNow }: Props) {
  recordRenderWork('comment', comment.itemId);
  const t = translator(locale);
  const author = comment.author?.displayName ?? comment.author?.handle ?? t('unknownAuthor');
  const time = comment.publishedAt ? publicationTime(comment.publishedAt, locale, now) : undefined;
  return <article id={commentTargetId(comment.id)} data-view-role={role} data-selected={selected} tabIndex={-1}
    className={`comment ${comment.seen ? 'is-seen' : 'is-unseen'} ${hasChildren ? 'has-replies' : ''}`} aria-label={author}>
    <Avatar url={comment.author?.avatarUrl} author={author} locale={locale} />
    <div className="comment-body">
      <div className="comment-byline">
        <strong>{author}</strong>
        {comment.author?.handle && <span className="muted">{comment.author.handle}</span>}
        {comment.isCreator && <span className="badge">{t('creator')}</span>}
        {comment.isPinned && <span className="badge">{t('pinned')}</span>}
        {time ? <time dateTime={comment.publishedAt} title={time.exact} tabIndex={0} aria-label={time.exact}>{time.relative}</time>
          : <span className="muted">{comment.publication?.label.status === 'observed' ? comment.publication.label.value : t('unknownTime')}</span>}
      </div>
      <p className="comment-text">{comment.text}</p>
      <div className="comment-meta">
        {role !== 'normal' && <span className={`badge ${role}-badge`}>{t(role === 'match' ? 'activeMatch' : 'contextComment')}</span>}
        {role === 'context' && rawHit && <span className="badge raw-match-badge">{t('rawSearchHit')}</span>}
        {comment.likeCount !== undefined && <span>{t('likes', { count: new Intl.NumberFormat(locale).format(comment.likeCount) })}</span>}
        {!comment.seen && <span className="badge unseen-badge">{t('unseen')}</span>}
        {isNew && <span className="badge new-badge" title={t(comment.itemId === 'video-demo' || comment.itemId === 'post-demo' ? 'newHelp' : 'newDiscoveryHelp')}>{t('new')}</span>}
      </div>
    </div>
    <label className="seen-control" title={seenHelp(locale)}>
      <input type="checkbox" checked={comment.seen} disabled={disabled}
        aria-label={t(comment.seen ? 'markUnseen' : 'markSeen', { author })}
        onChange={() => { /* Click owns the action so its Ctrl modifier is retained. */ }}
        onClick={event => onToggle(comment.id, event.ctrlKey)} />
      <span>{t('seen')}</span>
    </label>
  </article>;
});
