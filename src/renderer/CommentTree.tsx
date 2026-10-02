import type { CommentNode } from '../domain/discussion';
import { demoNewCommentIds, demoNow } from '../fixtures/discussions';
import { Locale, publicationTime, translator } from './i18n';

interface Props {
  nodes: readonly CommentNode[];
  locale: Locale;
  onToggle: (id: string, subtree: boolean) => void;
}

export function CommentTree({ nodes, locale, onToggle }: Props) {
  const t = translator(locale);
  return <ol className="comment-tree">
    {nodes.map(({ comment, children }) => {
      const author = comment.author?.displayName ?? comment.author?.handle ?? t('unknownAuthor');
      const time = comment.publishedAt ? publicationTime(comment.publishedAt, locale, demoNow) : undefined;
      return <li key={comment.id}>
        <article className={`comment ${comment.seen ? 'is-seen' : 'is-unseen'}`} aria-label={author}>
          <div className="avatar" aria-hidden="true">{author.slice(0, 1).toLocaleUpperCase(locale)}</div>
          <div className="comment-body">
            <div className="comment-byline">
              <strong>{author}</strong>
              {comment.author?.handle && <span className="muted">{comment.author.handle}</span>}
              {comment.isCreator && <span className="badge">{t('creator')}</span>}
              {comment.isPinned && <span className="badge">{t('pinned')}</span>}
              {time ? <time dateTime={comment.publishedAt} title={time.exact} tabIndex={0} aria-label={time.exact}>{time.relative}</time> : <span className="muted">{t('unknownTime')}</span>}
            </div>
            <p className="comment-text">{comment.text}</p>
            <div className="comment-meta">
              {comment.likeCount !== undefined && <span>{t('likes', { count: new Intl.NumberFormat(locale).format(comment.likeCount) })}</span>}
              {!comment.seen && <span className="badge unseen-badge">{t('unseen')}</span>}
              {demoNewCommentIds.has(comment.id) && <span className="badge new-badge" title={t('newHelp')}>{t('new')}</span>}
            </div>
          </div>
          <label className="seen-control" title={t('seenHelp')}>
            <input type="checkbox" checked={comment.seen}
              aria-label={t(comment.seen ? 'markUnseen' : 'markSeen', { author })}
              onChange={() => { /* Click owns the action so its Ctrl modifier is retained. */ }}
              onClick={event => onToggle(comment.id, event.ctrlKey)} />
            <span>{t('seen')}</span>
          </label>
        </article>
        {children.length > 0 && <CommentTree nodes={children} locale={locale} onToggle={onToggle} />}
      </li>;
    })}
  </ol>;
}
