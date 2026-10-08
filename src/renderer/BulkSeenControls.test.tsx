// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { BulkSeenControls } from './BulkSeenControls';
import { initialComments } from '../fixtures/discussions';
import { queryComments, unrestrictedView, defaultQuery } from '../domain/discussion-query';
import { translator } from './i18n';
import type { Locale } from './i18n';
import type { BulkSeenRequest } from '../domain/seen-operation';
import { evaluateTestQuery } from '../fixtures/query-testing';

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const comments = initialComments['video-demo'];
function controls(locale: Locale = 'en', execute = vi.fn(async (request: BulkSeenRequest) => !!request.itemId), restrictive = false) {
  const applied = evaluateTestQuery(queryComments(comments), { ...defaultQuery, seen: 'unseen' });
  if (!applied.ok) throw new Error('Invalid query');
  const result = restrictive ? applied.result : unrestrictedView(queryComments(comments));
  const modalChanged = vi.fn();
  render(<BulkSeenControls itemId="video-demo" comments={comments} result={result} locale={locale} disabled={false} execute={execute} recover={vi.fn()} modalChanged={modalChanged} />);
  return { execute, modalChanged, result, t: translator(locale) };
}
it.each(['en', 'pl'] as const)('compact %s controls confirm discussion/action/scope/count, with initial Cancel focus and Escape', locale => {
  const { t, execute } = controls(locale);
  if (locale === 'pl') expect(t('bulkActions')).toBe('Działania zbiorcze');
  expect(document.querySelector('details')?.open).toBe(false);
  const matching = screen.getByRole<HTMLOptionElement>('option', { name: t('bulkAppliedMatches', { count: comments.length }) });
  expect(matching.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: t('bulkExecute') }));
  const dialog = screen.getByRole('dialog');
  expect(dialog.textContent).toContain(t('bulkConfirm', { action: t('bulkMarkSeen'), scope: t('bulkAll'), count: comments.length }));
  expect(dialog.textContent).toContain(t('bulkRecoveryHelp'));
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: t('cancel') }));
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(execute).not.toHaveBeenCalled();
});
it('freezes exact applied IDs for confirmation, never adds context or reevaluates stale state', async () => {
  const { execute, result } = controls('en', undefined, true);
  fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'matching' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByRole('dialog').textContent).toContain(`Current APPLIED matches (${result.matchCount})`);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(execute).toHaveBeenCalledWith({ itemId: 'video-demo', seen: true, target: { kind: 'matching', ids: result.activeMatchIds } });
});
it('keeps the named confirmation outside a discussion hidden by parallel acquisition', async () => {
  const execute = vi.fn(async () => true);
  const { container } = render(<BulkSeenControls itemId="video-demo" title="Captured discussion" comments={comments}
    result={unrestrictedView(queryComments(comments))} locale="en" disabled={false} execute={execute} recover={vi.fn()} modalChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  container.hidden = true;
  const dialog = screen.getByRole('dialog');
  expect(dialog.parentElement).toBe(document.body);
  expect(dialog.textContent).toContain('Captured discussion');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(execute).toHaveBeenCalledWith({ itemId: 'video-demo', seen: true, target: { kind: 'all' } }));
});
it('keeps confirmation open and non-cancellable while pending; a failure retains it for retry', async () => {
  let finish!: (success: boolean) => void;
  const execute = vi.fn((_request: BulkSeenRequest) => new Promise<boolean>(resolve => { if (_request.itemId) finish = resolve; }));
  controls('en', execute);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
  expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true);
  fireEvent(dialog, new Event('cancel', { cancelable: true })); expect(screen.getByRole('dialog')).toBe(dialog);
  finish(false);
  await within(dialog).findByRole('alert');
  expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(false);
});
it.each(['after', 'before', 'between'] as const)('publication %s shows only required dates and sends semantic criteria', async scope => {
  const { execute } = controls();
  fireEvent.change(screen.getByLabelText('Scope'), { target: { value: scope } });
  expect(document.querySelectorAll('input[type=date]').length).toBe(scope === 'between' ? 2 : 1);
  const dates = { ...(scope !== 'before' ? { from: '2026-09-01' } : {}), ...(scope !== 'after' ? { to: '2026-10-08' } : {}) };
  if (dates.from) fireEvent.change(screen.getByLabelText('From'), { target: { value: dates.from } });
  if (dates.to) fireEvent.change(screen.getByLabelText('To (whole day)'), { target: { value: dates.to } });
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'false' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(execute).toHaveBeenCalledWith({ itemId: 'video-demo', seen: false, target: { kind: 'publication', ...dates } }));
});
it('rejects missing/reversed dates before dispatch', () => {
  const { execute } = controls();
  fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'between' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' })); expect(screen.getByRole('alert')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-08' } });
  fireEvent.change(screen.getByLabelText('To (whole day)'), { target: { value: '2026-10-07' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(execute).not.toHaveBeenCalled();
});
