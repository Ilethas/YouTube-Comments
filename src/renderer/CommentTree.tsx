import type { CSSProperties } from 'react';
import type { CommentNode } from '../domain/discussion';
import { demoNewCommentIds, demoNow } from '../shared/demo-presentation';
import { Locale, publicationTime, translator } from './i18n';
import { Avatar } from './Avatar';

interface Props {
  nodes: readonly CommentNode[];
  locale: Locale;
  disabled: boolean;
  now?: number;
  depth?: number;
  onToggle: (id: string, subtree: boolean) => void;
  view?: { restrictive: boolean; active: ReadonlySet<string>; raw: ReadonlySet<string>; selected?: string };
}

/** Stable application-owned reveal target; no source IDs or selector interpolation. */
export const commentTargetId = (id: string) => `comment-${encodeURIComponent(id)}`;

export function CommentTree({ nodes, locale, disabled, onToggle, view, now = demoNow, depth = 0 }: Props) {
  const t = translator(locale);
  return <ol className={`comment-tree ${depth ? 'reply-rail' : 'root-tree'}`} data-depth={depth} data-compact={depth >= 5}
    style={{ '--reply-indent': `${depth < 5 ? 22 : depth < 10 ? 10 : 3}px` } as CSSProperties}>
    {nodes.map(({ comment, children }) => {
      const author = comment.author?.displayName ?? comment.author?.handle ?? t('unknownAuthor');
      const time = comment.publishedAt ? publicationTime(comment.publishedAt, locale, now) : undefined;
      const role = !view?.restrictive ? 'normal' : view.active.has(comment.id) ? 'match' : 'context';
      return <li key={comment.id} className="comment-branch" data-comment-id={comment.id} data-depth={depth}>
        {depth > 0 && <span className="reply-elbow" aria-hidden="true" />}
        <div className="comment-row" data-has-replies={children.length > 0}>
        <article id={commentTargetId(comment.id)} data-view-role={role} data-selected={view?.selected === comment.id}
          className={`comment ${comment.seen ? 'is-seen' : 'is-unseen'} ${children.length ? 'has-replies' : ''}`} aria-label={author}>
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
              {role === 'context' && view?.raw.has(comment.id) && <span className="badge raw-match-badge">{t('rawSearchHit')}</span>}
              {comment.likeCount !== undefined && <span>{t('likes', { count: new Intl.NumberFormat(locale).format(comment.likeCount) })}</span>}
              {!comment.seen && <span className="badge unseen-badge">{t('unseen')}</span>}
              {demoNewCommentIds.has(comment.id) && <span className="badge new-badge" title={t('newHelp')}>{t('new')}</span>}
            </div>
          </div>
          <label className="seen-control" title={t('seenHelp')}>
            <input type="checkbox" checked={comment.seen} disabled={disabled}
              aria-label={t(comment.seen ? 'markUnseen' : 'markSeen', { author })}
              onChange={() => { /* Click owns the action so its Ctrl modifier is retained. */ }}
              onClick={event => onToggle(comment.id, event.ctrlKey)} />
            <span>{t('seen')}</span>
          </label>
        </article>
        </div>
        {children.length > 0 && <CommentTree nodes={children} depth={depth + 1} locale={locale} now={now} disabled={disabled} onToggle={onToggle} view={view} />}
      </li>;
    })}
  </ol>;
}
