import { memo, useRef } from 'react';
import type { Comment } from '../domain/discussion';
import { demoNow } from '../shared/demo-presentation';
import { Locale, publicationTime, translator } from './i18n';
import { Avatar } from './Avatar';
import { recordRenderWork } from './render-work';
import { seenHelp } from './shortcuts';
import { commentHasSelection, isCommentGesture } from './comment-gesture';

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
  const selectionAtStart = useRef(false);
  return <article id={commentTargetId(comment.id)} data-view-role={role} data-selected={selected} tabIndex={-1}
    className={`comment ${comment.seen ? 'is-seen' : 'is-unseen'} ${hasChildren ? 'has-replies' : ''}`} aria-label={author}
    onPointerDown={event => { selectionAtStart.current = commentHasSelection(event.currentTarget); }}
    onClick={event => {
      const selectedText = selectionAtStart.current || commentHasSelection(event.currentTarget);
      selectionAtStart.current = false;
      if (!disabled && isCommentGesture(event) && !selectedText) {
        event.preventDefault(); onToggle(comment.id, event.ctrlKey);
      }
    }}>
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
    <label className="seen-control" title={seenHelp(locale)} onClick={event => {
      // Label forwarding can discard modifiers. Handle its larger surface here
      // and cancel the generated input click; direct/keyboard input clicks own themselves.
      if (!(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        if (!disabled && event.button === 0) { event.currentTarget.control?.focus(); onToggle(comment.id, event.ctrlKey); }
      }
    }}>
      <input type="checkbox" checked={comment.seen} disabled={disabled}
        aria-label={t(comment.seen ? 'markUnseen' : 'markSeen', { author })}
        onChange={() => { /* Click owns the action so its Ctrl modifier is retained. */ }}
        onClick={event => onToggle(comment.id, event.ctrlKey)} />
      <span>{t('seen')}</span>
    </label>
  </article>;
});
