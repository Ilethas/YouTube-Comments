import { ActionIcon } from './ActionIcon';
import { memo } from 'react';
import type { Comment } from '../domain/discussion';
import { demoNow } from '../shared/demo-presentation';
import { Locale, publicationTime, translator } from './i18n';
import { Avatar } from './Avatar';
import { recordRenderWork } from './render-work';
import { seenHelp } from './shortcuts';
import { CommentAction } from './CommentActions';
import type { OpenCommentAction } from './CommentActions';

interface Props {
  viewId?: string;
  isDemo?: boolean;
  bulkSelected?: boolean;
  showSelection?: boolean;
  onSelect?: (id: string, shift: boolean) => void;
  descendantCount?: number;
  hiddenUnseen?: number;
  hiddenMatches?: number;
  collapsed?: boolean;
  onCollapse?: (id: string) => void;
  comment: Comment;
  onAction?: OpenCommentAction;
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
export const commentTargetId = (id: string, viewId?: string) => `comment-${viewId ? `${encodeURIComponent(viewId)}:` : ''}${encodeURIComponent(id)}`;

/** A single measured reader article; React never recursively constructs replies. */
export const CommentArticle = memo(function CommentArticle({ viewId, isDemo = false, bulkSelected = false, showSelection = false, onSelect, descendantCount = 0, hiddenUnseen = 0, hiddenMatches = 0, collapsed = false, onCollapse, comment, locale, disabled, onToggle, onAction, role, rawHit, selected, hasChildren, isNew = false, now = demoNow }: Props) {
  recordRenderWork('comment', viewId ?? comment.itemId);
  const t = translator(locale);
  const likes = comment.likeCount === undefined ? undefined : new Intl.NumberFormat(locale).format(comment.likeCount);
  const likesLabel = likes === undefined ? undefined : t('likes', { count: likes });
  const author = comment.author?.displayName ?? comment.author?.handle ?? t('unknownAuthor');
  const time = comment.publishedAt ? publicationTime(comment.publishedAt, locale, now) : undefined;
  const creator = comment.source.kind === 'video' && comment.isCreator === true;
  const evidence = comment.publication?.instantEvidence ?? comment.publication;
  const approximate = evidence && (evidence.precision !== 'exact' || evidence.estimated.status !== 'observed' || evidence.estimated.value);
  const sourceLabel = comment.publication?.label.status === 'observed' ? comment.publication.label.value : undefined;
  const displayedTime = time ? approximate ? sourceLabel ?? t('approximateTime', { time: time.relative }) : time.relative : sourceLabel ?? t('unknownTime');
  const timeHelp = time ? approximate ? t('approximateTime', { time: time.exact }) : time.exact : displayedTime;
  const timeContent = time ? <time dateTime={comment.publishedAt} title={timeHelp} aria-label={timeHelp}>{displayedTime}</time>
    : <span className="muted">{comment.publication?.label.status === 'observed' ? comment.publication.label.value : t('unknownTime')}</span>;
  return <article id={commentTargetId(comment.id, viewId)} data-domain-comment-id={comment.id} data-view-role={role} data-selected={selected} data-bulk-selected={bulkSelected} tabIndex={-1}
    className={`comment ${comment.seen ? 'is-seen' : 'is-unseen'} ${hasChildren ? 'has-replies' : ''}`} aria-label={author}>
    {showSelection && <button type="button" className="selection-circle" aria-pressed={bulkSelected} disabled={disabled}
      aria-label={t('selectComment', { author })} title={t('selectComment', { author })}
      onMouseDown={event => { if (event.shiftKey) event.preventDefault(); }}
      onClick={event => onSelect?.(comment.id, event.shiftKey)}><span aria-hidden="true">{bulkSelected ? '●' : ''}</span></button>}
    <Avatar url={comment.author?.avatarUrl} author={author} locale={locale} />
    <div className="comment-body">
      <div className="comment-byline">
        <strong className={creator ? 'creator-author' : undefined}>{comment.actions?.author && onAction
          ? <CommentAction comment={comment} action="author" locale={locale} open={onAction} detail={author}>{author}</CommentAction> : author}</strong>
        {comment.author?.handle && <span className="muted">{comment.author.handle}</span>}
        {creator && <span className="badge creator-badge">{t('creator')}</span>}
        {comment.isPinned && <span className="badge">{t('pinned')}</span>}
        {comment.actions?.permalink && onAction
          ? <CommentAction comment={comment} action="permalink" locale={locale} open={onAction} detail={displayedTime}>{timeContent}</CommentAction> : timeContent}
      </div>
      <p className="comment-text">{comment.text}</p>
      <div className="comment-meta">
        {descendantCount > 0 && onCollapse && <button type="button" className="reply-toggle"
          aria-expanded={!collapsed} aria-label={t(collapsed ? 'expandReplies' : 'collapseReplies')}
          title={t(collapsed ? 'expandReplies' : 'collapseReplies')} onClick={() => onCollapse(comment.id)}>
          <ActionIcon name={collapsed ? 'chevronRight' : 'chevronDown'} />
          {t(collapsed ? 'showReplies' : 'hideReplies', { count: new Intl.NumberFormat(locale).format(descendantCount) })}
          {collapsed && <span className="reply-summary">{hiddenUnseen > 0 && ` \u00b7 ${t('replyUnseen', { count: new Intl.NumberFormat(locale).format(hiddenUnseen) })}`}{hiddenMatches > 0 && ` \u00b7 ${t('replyMatches', { count: new Intl.NumberFormat(locale).format(hiddenMatches) })}`}</span>}
        </button>}
        {role !== 'normal' && <span className={`badge ${role}-badge`}>{t(role === 'match' ? 'activeMatch' : 'contextComment')}</span>}
        {role === 'context' && rawHit && <span className="badge raw-match-badge">{t('rawSearchHit')}</span>}
        {likes !== undefined && <span className="comment-likes" role="img" aria-label={likesLabel} title={likesLabel}><ActionIcon name="like" />{likes}</span>}
        {!comment.seen && <span className="badge unseen-badge">{t('unseen')}</span>}
        {isNew && <span className="badge new-badge" title={t(isDemo ? 'newHelp' : 'newDiscoveryHelp')}>{t('new')}</span>}
        {comment.actions?.translate && onAction && <CommentAction comment={comment} action="translate" locale={locale} open={onAction} />}
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
