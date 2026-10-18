import { ActionIcon } from './ActionIcon';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Comment } from '../domain/discussion';
import type { BulkSeenRequest, BulkSeenTarget, SeenUndoDescriptor } from '../domain/seen-operation';
import type { DiscussionViewResult } from '../domain/discussion-query';
import { resolveBulkPublication } from '../domain/publication-filter';
import { publicationMatches, ownPublicationInstant } from '../domain/publication-predicate';
import { systemQueryEvaluationTime } from './query-evaluation-time';
import { translator, countLabel } from './i18n';
import type { Locale } from './i18n';
import { shortcutHint } from './shortcuts';

type Scope = 'all' | 'matching' | 'after' | 'before' | 'between';
/** Native modal owns focus/keys until cancellation or acknowledged commit. */
export function BulkConfirmation({ locale, title, description, pending, error, confirm, cancel }: {
  locale: Locale; title?: string; description: string; pending: boolean; error?: string; confirm: () => void; cancel: () => void;
}) {
  const titleId = useId(), descriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null), t = translator(locale);
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement as HTMLElement | null;
    element?.showModal(); element?.querySelector('button')?.focus();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="removal-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); if (!pending) cancel(); }}>
    <h2 id={titleId}>{t('bulkConfirmTitle')}</h2>{title && <p className="remove-item-title">{title}</p>}<p id={descriptionId}>{description}</p>
    <p>{t('bulkRecoveryHelp')}</p>{error && <p role="alert">{error}</p>}
    <div className="dialog-actions"><button autoFocus disabled={pending} onClick={cancel}><ActionIcon name="cancel" />{t('cancel')}</button>
      <button disabled={pending} onClick={confirm}>{t('bulkExecute')}</button></div>
  </dialog>, document.body);
}

export interface SeenFeedback { readonly kind: 'marked' | 'noop' | 'undo' | 'error'; readonly count?: number; readonly skipped?: number; readonly seen?: boolean }
/** Counts are a confirmation preview; main resolves all/date again inside its
 * transaction. Matching intent freezes exactly the currently applied IDs. */
export function BulkSeenControls({ itemId, title, comments, result, locale, disabled, undo, feedback, execute, recover, modalChanged }: {
  itemId: string; title?: string; comments: readonly Comment[]; result: DiscussionViewResult; locale: Locale; disabled: boolean;
  undo?: SeenUndoDescriptor | null; feedback?: SeenFeedback;
  execute: (request: BulkSeenRequest) => Promise<boolean>; recover: (itemId: string) => void; modalChanged: (open: boolean) => void;
}) {
  const t = translator(locale), [scope, setScope] = useState<Scope>('all'), [seen, setSeen] = useState(true);
  const number = new Intl.NumberFormat(locale);
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [error, setError] = useState<string>();
  const [fromTime, setFromTime] = useState(''), [toTime, setToTime] = useState('');
  const [confirmation, setConfirmation] = useState<{ request: BulkSeenRequest; description: string }>();
  const [pending, setPending] = useState(false);
  const fields = useRef<HTMLDivElement>(null);
  const matchingAvailable = result.restrictive;
  useEffect(() => { modalChanged(!!confirmation); return () => { modalChanged(false); }; }, [confirmation, modalChanged]);
  async function commit(request: BulkSeenRequest) {
    setPending(true); setError(undefined);
    try { if (await execute(request)) setConfirmation(undefined); else setError(t('bulkFailed')); }
    finally { setPending(false); }
  }
  function prepare() {
    setError(undefined);
    // Native partially entered dates/times may report an empty value with
    // badInput. Such a clock entry must never become a whole-day command.
    if (fields.current?.querySelector('input:invalid')) { setError(t('bulkInvalidDate')); return; }
    let target: BulkSeenTarget, count: number;
    if (scope === 'matching') {
      if (!matchingAvailable) return;
      target = { kind: 'matching', ids: [...result.activeMatchIds] }; count = target.ids.length;
    } else if (scope === 'all') { target = { kind: 'all' }; count = comments.length; }
    else {
      const needsFrom = scope !== 'before', needsTo = scope !== 'after';
      if (needsFrom && !from || needsTo && !to) { setError(t('bulkInvalidDate')); return; }
      target = { kind: 'publication', ...(needsFrom ? { from, ...(fromTime ? { fromTime } : {}) } : {}), ...(needsTo ? { to, ...(toTime ? { toTime } : {}) } : {}) };
      const resolved = resolveBulkPublication(target, systemQueryEvaluationTime());
      if (!resolved.ok) { setError(t(resolved.error === 'INVALID_LOCAL_TIME' ? 'bulkInvalidLocalTime' : 'bulkInvalidDate')); return; }
      count = comments.filter(comment => publicationMatches(ownPublicationInstant(comment.publishedAt), resolved.bounds)).length;
    }
    const request = { itemId, seen, target };
    const label = scope === 'all' ? t('bulkAll') : scope === 'matching' ? t('bulkAppliedMatches', { count: number.format(count) })
      : scope === 'after' ? t('bulkAfterDate', { date: `${from}${fromTime ? ` ${fromTime}` : ''}` }) : scope === 'before' ? t('bulkBeforeDate', { date: `${to}${toTime ? ` ${toTime}` : ''}` })
        : t('bulkBetweenDates', { from: `${from}${fromTime ? ` ${fromTime}` : ''}`, to: `${to}${toTime ? ` ${toTime}` : ''}` });
    if (scope !== 'matching' || count > 1) setConfirmation({ request, description: t('bulkConfirm', { action: t(seen ? 'bulkMarkSeen' : 'bulkMarkUnseen'), scope: label, count: number.format(count) }) });
    else void commit(request);
  }
  return <div className="bulk-area">
    <details className="bulk-controls"><summary>{t('bulkActions')}</summary>
      <div ref={fields} className="bulk-fields">
        <label>{t('bulkAction')}<select disabled={disabled || pending} value={String(seen)} onChange={event => setSeen(event.target.value === 'true')}>
          <option value="true">{t('bulkMarkSeen')}</option><option value="false">{t('bulkMarkUnseen')}</option></select></label>
        <label>{t('bulkScope')}<select disabled={disabled || pending} value={scope} onChange={event => { setScope(event.target.value as Scope); setError(undefined); }}>
          <option value="all">{t('bulkAll')}</option><option value="matching" disabled={!matchingAvailable}>{t('bulkAppliedMatches', { count: number.format(result.matchCount) })}</option>
          <option value="after">{t('bulkAfter')}</option><option value="before">{t('bulkBefore')}</option><option value="between">{t('bulkBetween')}</option>
        </select></label>
        {scope !== 'all' && scope !== 'matching' && <>
          {scope !== 'before' && <label>{t('bulkFromDate')}<input name="bulk-from" type="date" value={from} disabled={disabled || pending} onChange={event => setFrom(event.target.value)} /></label>}
          {scope !== 'before' && <label>{t('bulkFromTime')}<input name="bulk-fromTime" type="time" step="60" value={fromTime} disabled={disabled || pending} onChange={event => setFromTime(event.target.value)} /></label>}
          {scope !== 'after' && <label>{t('bulkToDate')}<input name="bulk-to" type="date" value={to} disabled={disabled || pending} onChange={event => setTo(event.target.value)} /></label>}
          {scope !== 'after' && <label>{t('bulkToTime')}<input name="bulk-toTime" type="time" step="60" value={toTime} disabled={disabled || pending} onChange={event => setToTime(event.target.value)} /></label>}
          <p className="reader-help">{t('bulkDateHelp')}</p>
        </>}
        <button disabled={disabled || pending || scope === 'matching' && !matchingAvailable} onClick={prepare}><ActionIcon name={seen ? 'seen' : 'unseen'} />{t('bulkExecute')}</button>
      </div><p className="reader-help">{t('bulkScopeHelp')}</p>
    </details>
    {feedback && <span role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.kind === 'error' ? t('bulkFailed') : feedback.kind === 'noop' ? t('bulkNoop')
      : feedback.kind === 'undo' ? t('bulkRestored', { comments: countLabel(locale, 'comments', feedback.count ?? 0), skipped: number.format(feedback.skipped ?? 0) })
        : t(feedback.seen ? 'bulkMarkedSeen' : 'bulkMarkedUnseen', { comments: countLabel(locale, 'comments', feedback.count ?? 0) })} </span>}
    {undo && <button className="text-button" title={shortcutHint(locale, 'undo-seen')} disabled={disabled || pending} onClick={() => recover(itemId)}><ActionIcon name="undo" />{t('bulkUndo')}</button>}
    {error && !confirmation && <p role="alert">{error}</p>}
    {confirmation && <BulkConfirmation locale={locale} title={title} description={confirmation.description} pending={pending} error={error}
      confirm={() => { void commit(confirmation.request); }} cancel={() => setConfirmation(undefined)} />}
  </div>;
}
