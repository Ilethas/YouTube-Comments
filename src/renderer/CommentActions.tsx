import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Comment } from '../domain/discussion';
import type { CommentActionRequest, Result } from '../shared/reader-api';
import { translator } from './i18n';
import type { Locale } from './i18n';
import { ActionIcon } from './ActionIcon';

export type OpenCommentAction = (request: CommentActionRequest) => Promise<Result<null>>;
function hasSelection(element: HTMLElement): boolean {
  const selection = element.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed) return false;
  for (let index = 0; index < selection.rangeCount; index++) if (selection.getRangeAt(index).intersectsNode(element)) return true;
  return false;
}
/** Per-mounted-row state; activation neither selects a row nor writes seen/view. */
export function CommentAction({ comment, action, locale, open, children, detail }: {
  comment: Comment; action: CommentActionRequest['action']; locale: Locale; open: OpenCommentAction; children?: ReactNode; detail?: string;
}) {
  const t = translator(locale), busy = useRef(false);
  const selectedAtStart = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<'long' | 'open' | 'copy' | null>(null);
  const [copied, setCopied] = useState(false);
  const label = t(action === 'author' ? 'openAuthor' : action === 'permalink' ? 'openComment' : 'translateBrowser');
  async function activate() {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null); setCopied(false);
    try {
      const result = await open({ itemId: comment.itemId, commentId: comment.id, action });
      if (!result.ok) setError(result.error.code === 'TRANSLATION_TOO_LONG' ? 'long' : 'open');
    } catch { setError('open'); }
    finally { busy.current = false; setPending(false); }
  }
  return <span className={`comment-action action-${action}`}>
    <button type="button" className={action === 'translate' ? 'comment-translate' : 'inline-link'} title={label} aria-label={detail ? `${label}: ${detail}` : label}
      disabled={pending} onPointerDown={event => { selectedAtStart.current = hasSelection(event.currentTarget); }}
      onClick={event => {
        const selecting = selectedAtStart.current || hasSelection(event.currentTarget);
        selectedAtStart.current = false;
        if (!selecting) void activate();
      }}>
      {action === 'translate' ? <><ActionIcon name="translate" />{label}</> : <>{children}<ActionIcon name="external" /></>}
    </button>
    {error && <span className="comment-action-feedback" role="alert">{t(error === 'long' ? 'translationTooLong' : error === 'copy' ? 'copyFailed' : 'sourceOpenFailed')}
      {action === 'translate' && <button type="button" title={t('copyComment')} onClick={() => {
        void (async () => {
          try { await navigator.clipboard.writeText(comment.text); setCopied(true); }
          catch { setError('copy'); }
        })();
      }}><ActionIcon name="copy" />{t('copyComment')}</button>}
    </span>}
    {copied && <span role="status">{t('copied')}</span>}
  </span>;
}
