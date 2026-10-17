// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { DiscussionQueryControls } from './DiscussionQueryControls';
import { DiscussionViewSession } from './discussion-view-session';
import { evaluateDiscussionQuery } from '../domain/discussion-query';
import { dateTestComment } from '../fixtures/date-discussion';
import { translator } from './i18n';
import { required } from './testing/required';

afterEach(cleanup);
it.each(['en', 'pl'] as const)('%s time fields remain drafts until Apply, show applied times, and guard native partial input', async locale => {
  const comments = [dateTestComment('before', '2026-10-16T12:29:59Z'), dateTestComment('inside', '2026-10-16T12:30:45Z')];
  const engine = { evaluate: vi.fn(async (...args: Parameters<typeof evaluateDiscussionQuery>) => evaluateDiscussionQuery(...args)), dispose: vi.fn() };
  const session = new DiscussionViewSession(comments, engine, undefined, () => ({ now: 0, timeZone: 'Europe/Warsaw' }));
  const t = translator(locale);
  function Controls() {
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    return <DiscussionQueryControls state={state} presentation={session.presentation(comments)} locale={locale}
      sort={sort => session.setSort(sort)} edit={draft => session.edit(draft)} apply={() => { void session.apply(comments); }} navigate={vi.fn()} unseenCount={2} />;
  }
  const view = render(<Controls />), original = session.state.result;
  fireEvent.change(screen.getByLabelText(t('dateFrom')), { target: { value: '2026-10-16' } });
  fireEvent.change(screen.getByLabelText(t('dateTo')), { target: { value: '2026-10-16' } });
  fireEvent.change(screen.getByLabelText(t('bulkFromTime')), { target: { value: '14:30' } });
  fireEvent.change(screen.getByLabelText(t('bulkToTime')), { target: { value: '14:30' } });
  expect(session.state.result).toBe(original); expect(engine.evaluate).not.toHaveBeenCalled(); expect(screen.getByText(t('queryDraftPending'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('applyView') }));
  await waitFor(() => expect(session.state.result.activeMatchIds).toEqual(['inside']));
  expect(view.container.querySelector('.query-status')?.textContent).toContain('2026-10-16 14:30');
  expect(screen.queryByText(t('queryDraftPending'))).toBeNull();
  const clock = screen.getByLabelText(t('bulkToTime')) as HTMLInputElement;
  clock.setCustomValidity('Native partially entered time');
  required(view.container.querySelector('form')).requestSubmit();
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(t('queryInvalidTime')));
  expect(engine.evaluate).toHaveBeenCalledTimes(1); expect(session.state.result.activeMatchIds).toEqual(['inside']);
  clock.setCustomValidity('');
  fireEvent.change(screen.getByLabelText(t('publicationPreset')), { target: { value: 'today' } });
  expect(clock.disabled).toBe(true); expect((screen.getByLabelText(t('bulkFromTime')) as HTMLInputElement).disabled).toBe(true);
  expect(comments.every(comment => !comment.seen)).toBe(true);
  session.dispose();
});
