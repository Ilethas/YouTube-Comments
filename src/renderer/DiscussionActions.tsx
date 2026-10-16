import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Comment, ContentItem } from '../domain/discussion';
import type { BulkSeenRequest } from '../domain/seen-operation';
import type { Preferences } from '../shared/preferences';
import { BulkConfirmation } from './BulkSeenControls';
import { ActionIcon } from './ActionIcon';
import { CommentContextMenu } from './CommentContextMenu';
import type { CommentMenuItem, CommentMenuTarget } from './CommentContextMenu';
import type { DiscussionViewSession } from './discussion-view-session';
import type { OpenCommentAction } from './CommentActions';
import { viewPrefix } from './comment-selection';
import { translator } from './i18n';
import type { Locale, TranslationKey } from './i18n';

/** Confirmed IDs and description are captured together. Later sort/filter/Refresh
 * cannot enlarge this scope; main validates the entire snapshot at commit. */
export function DiscussionActions({ item, comments, session, locale, disabled, includeCollapsedInPrefix, menu, dismissMenu, onAction, execute, modalChanged }: {
  item: ContentItem; comments: readonly Comment[]; session: DiscussionViewSession; locale: Locale; disabled: boolean;
  includeCollapsedInPrefix: Preferences['includeCollapsedInPrefix']; menu?: CommentMenuTarget; dismissMenu: () => void;
  onAction?: OpenCommentAction; execute?: (request: BulkSeenRequest) => Promise<boolean>; modalChanged?: (open: boolean) => void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot), t = translator(locale), number = new Intl.NumberFormat(locale);
  const displayed = session.displayed(comments), complete = session.presentation(comments);
  const [confirmation, setConfirmation] = useState<{ request: BulkSeenRequest; description: string; title: string }>();
  const [pending, setPending] = useState(false), committing = useRef(false);
  const [error, setError] = useState<string>(), [feedback, setFeedback] = useState<TranslationKey>();
  const [copyFallback, setCopyFallback] = useState<string>();
  useEffect(() => { modalChanged?.(!!confirmation); return () => modalChanged?.(false); }, [confirmation, modalChanged]);
  const hiddenSelected = [...state.bulkSelected].reduce((count, id) => count + Number(!displayed.indexById.has(id)), 0);
  async function commit(request: BulkSeenRequest) {
    if (committing.current || !execute) return;
    committing.current = true; setPending(true); setError(undefined);
    try { if (await execute(request)) setConfirmation(undefined); else setError(t('bulkFailed')); }
    catch { setError(t('bulkFailed')); }
    finally { committing.current = false; setPending(false); }
  }
  function prepare(ids: readonly string[], seen: boolean, reason: 'selected' | 'view-prefix', scope: string, hidden: number) {
    if (!ids.length || disabled || !execute) return;
    const snapshot = [...ids], byId = new Map(comments.map(comment => [comment.id, comment]));
    const changed = snapshot.reduce((count, id) => count + Number(byId.get(id)?.seen !== seen), 0);
    const request: BulkSeenRequest = { itemId: item.id, seen, target: { kind: 'explicit', reason, ids: snapshot } };
    const description = t('explicitPreview', { action: t(seen ? 'markRead' : 'markUnread'), count: number.format(snapshot.length), changed: number.format(changed), hidden: number.format(hidden) })
      + '\n' + scope + '\n' + t('frozenScope');
    setError(undefined);
    if (reason === 'view-prefix' || snapshot.length > 1) setConfirmation({ request, description, title: item.kind === 'video' ? item.title : item.author?.displayName ?? t('unknownAuthor') });
    else void commit(request);
  }
  function selected(seen: boolean) { prepare([...state.bulkSelected], seen, 'selected', t('selectedScope'), hiddenSelected); }
  function prefix(seen: boolean) {
    if (!menu) return;
    const snapshot = viewPrefix(complete, displayed, menu.id, includeCollapsedInPrefix);
    const index = complete.indexById.get(menu.id), endpoint = index === undefined ? undefined : complete.rows[index].comment;
    if (!snapshot || !endpoint) return;
    const scope = t('prefixScope', { author: endpoint.author?.displayName ?? t('unknownAuthor'), id: endpoint.id, position: number.format(snapshot.position), total: number.format(snapshot.total) })
      + (state.result.restrictive ? '\n' + t('prefixContext') : '');
    prepare(snapshot.ids, seen, 'view-prefix', scope, snapshot.hidden);
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setFeedback('copied'); }
    catch { setFeedback('copyFailed'); }
  }
  async function external(action: Parameters<OpenCommentAction>[0]['action']) {
    if (!menu || !onAction) return;
    try {
      const result = await onAction({ itemId: item.id, commentId: menu.id, action });
      if (!result.ok) {
        setFeedback(result.error.code === 'TRANSLATION_TOO_LONG' ? 'translationTooLong' : 'sourceOpenFailed');
        if (result.error.code === 'TRANSLATION_TOO_LONG') {
          const index = complete.indexById.get(menu.id); if (index !== undefined) setCopyFallback(complete.rows[index].comment.text);
        }
      }
      else if (action === 'copy-permalink') setFeedback('copied');
    } catch { setFeedback('sourceOpenFailed'); }
  }
  const items: CommentMenuItem[] = [];
  const targetIndex = menu ? complete.indexById.get(menu.id) : undefined, row = targetIndex === undefined ? undefined : complete.rows[targetIndex];
  const expandableSelected = [...state.bulkSelected].some(id => { const index = complete.indexById.get(id); return index !== undefined && complete.rows[index].hasChildren; });
  if (row && menu) {
    const comment = row.comment;
    if (menu.selectionText) items.push({ label: t('copySelection'), icon: 'copy', run: () => { void copy(menu.selectionText); } });
    items.push({ label: t(comment.seen ? 'markUnread' : 'markRead'), icon: comment.seen ? 'unseen' : 'seen', disabled: disabled || !execute,
      run: () => prepare([comment.id], !comment.seen, 'selected', t('selectedScope'), 0) });
    items.push({ label: t('prefixRead'), icon: 'seen', disabled: disabled || !execute, run: () => prefix(true) },
      { label: t('prefixUnread'), icon: 'unseen', disabled: disabled || !execute, run: () => prefix(false) });
    if (state.bulkSelected.has(comment.id) && state.bulkSelected.size > 1) {
      items.push({ label: t('markSelectedRead'), icon: 'seen', disabled: disabled || !execute, run: () => selected(true) },
        { label: t('markSelectedUnread'), icon: 'unseen', disabled: disabled || !execute, run: () => selected(false) });
      if (expandableSelected) items.push({ label: t('expandSelected'), icon: 'chevronDown', disabled, run: () => session.collapseSelected(false) },
        { label: t('collapseSelected'), icon: 'chevronUp', disabled, run: () => session.collapseSelected(true) });
    }
    if (row.hasChildren) {
      const collapsed = displayed.collapsed.has(row.id);
      items.push({ label: t(collapsed ? 'expandReplies' : 'collapseReplies'), icon: collapsed ? 'chevronDown' : 'chevronUp', disabled,
        run: () => session.setCollapsed({ kind: 'comments', ids: [row.id], collapsed: !collapsed }) });
    }
    if (onAction && comment.actions?.translate) items.push({ label: t('translateBrowser'), icon: 'translate', run: () => { void external('translate'); } });
    if (onAction && comment.actions?.permalink) items.push({ label: t('openComment'), icon: 'external', run: () => { void external('permalink'); } },
      { label: t('copyPermalink'), icon: 'copy', run: () => { void external('copy-permalink'); } });
    items.push({ label: t('copyComment'), icon: 'copy', run: () => { void copy(comment.text); } });
  }
  return <>
    {!state.selectionMode && <button className="text-button" disabled={disabled} onClick={() => session.setSelectionMode(true)}><ActionIcon name="select" />{t('selectComments')}</button>}
    {(state.selectionMode || state.bulkSelected.size > 0) && <div className="selection-toolbar" role="group" aria-label={t('selectComments')}>
      <span role="status">{t('selectedCount', { count: number.format(state.bulkSelected.size), hidden: number.format(hiddenSelected) })}</span>
      <button disabled={disabled || !state.bulkSelected.size || !execute} onClick={() => selected(true)}><ActionIcon name="seen" />{t('markSelectedRead')}</button>
      <button disabled={disabled || !state.bulkSelected.size || !execute} onClick={() => selected(false)}><ActionIcon name="unseen" />{t('markSelectedUnread')}</button>
      <button disabled={disabled || !expandableSelected} onClick={() => session.collapseSelected(false)}><ActionIcon name="chevronDown" />{t('expandSelected')}</button>
      <button disabled={disabled || !expandableSelected} onClick={() => session.collapseSelected(true)}><ActionIcon name="chevronUp" />{t('collapseSelected')}</button>
      <button disabled={!state.bulkSelected.size} onClick={() => session.clearBulkSelection()}><ActionIcon name="cancel" />{t('clearSelection')}</button>
      <button onClick={() => session.setSelectionMode(false)}><ActionIcon name="cancel" />{t('exitSelection')}</button>
    </div>}
    {feedback && <p role="status">{t(feedback)}</p>}
    {copyFallback !== undefined && <button onClick={() => { void copy(copyFallback); }}><ActionIcon name="copy" />{t('copyComment')}</button>}
    {error && !confirmation && <p role="alert">{error}</p>}
    {menu && row && <CommentContextMenu target={menu} items={items} locale={locale} dismiss={dismissMenu} />}
    {confirmation && <BulkConfirmation locale={locale} title={confirmation.title} description={confirmation.description} pending={pending} error={error}
      confirm={() => { void commit(confirmation.request); }} cancel={() => setConfirmation(undefined)} />}
  </>;
}
