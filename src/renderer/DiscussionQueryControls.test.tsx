// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

it.each(['en', 'pl'] as const)('%s Most liked remains selectable and selected through empty Unseen results and genuine data changes', async locale => {
  let comments = [dateTestComment('unknown', undefined, { seen: true }),
    dateTestComment('known', undefined, { likeCount: 0, seen: true })];
  const engine = { evaluate: vi.fn(async (...args: Parameters<typeof evaluateDiscussionQuery>) => evaluateDiscussionQuery(...args)), dispose: vi.fn() };
  const session = new DiscussionViewSession(comments, engine);
  const t = translator(locale);
  function Controls() {
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    return <DiscussionQueryControls state={state} presentation={session.presentation(comments)} locale={locale}
      sort={sort => session.setSort(sort)} edit={draft => session.edit(draft)} apply={() => { void session.apply(comments); }} navigate={vi.fn()} unseenCount={0} />;
  }
  render(<Controls />);
  const select = screen.getByLabelText<HTMLSelectElement>(t('sortConversations'));
  const option = screen.getByRole<HTMLOptionElement>('option', { name: t('sortMostLiked') });
  for (const [index, seen] of ['unseen', 'all', 'unseen'].entries()) {
    fireEvent.change(screen.getByLabelText(t('seenFilter')), { target: { value: seen } });
    fireEvent.click(screen.getByRole('button', { name: t('applyView') }));
    await waitFor(() => expect(session.state.pending).toBe(false));
    expect(session.state.result.matchCount).toBe(seen === 'all' ? 2 : 0);
    expect(option.disabled).toBe(false);
    expect(screen.queryByText(t('sortLikesUnavailable'))).toBeNull();
    if (index === 0) fireEvent.change(select, { target: { value: 'most-liked' } });
    expect(select.value).toBe('most-liked');
    expect(session.persistentIntent().sort).toBe('most-liked');
  }
  // Genuine loss of root evidence disables the option without replacing intent.
  comments = comments.map(comment => ({ ...comment, likeCount: undefined }));
  await act(async () => { await session.refresh(comments); });
  expect(option.disabled).toBe(true); expect(select.value).toBe('most-liked');
  expect(screen.getByText(t('sortLikesUnavailable')).id).toBe(select.getAttribute('aria-describedby'));
  expect(session.persistentIntent().sort).toBe('most-liked');
  fireEvent.change(select, { target: { value: 'original' } });
  expect(select.value).toBe('original');
  session.dispose();
});
