import { required } from './testing/required';
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommentArticle } from './CommentTree';
import { initialComments } from '../fixtures/discussions';
import type { Comment } from '../domain/discussion';
import { translator } from './i18n';
import type { Locale } from './i18n';

afterEach(() => { cleanup(); document.getSelection()?.removeAllRanges(); });
function row(locale: Locale = 'en', changes: Partial<Comment> = {}, open = vi.fn(async () => ({ ok: true as const, value: null }))) {
  const comment: Comment = { ...initialComments['video-demo'][0], actions: { author: true, permalink: true, translate: true }, ...changes };
  const onToggle = vi.fn();
  const view = render(<CommentArticle comment={comment} locale={locale} disabled={false} hasChildren role="match" rawHit selected isNew onToggle={onToggle} onAction={open} />);
  return { ...view, comment, onToggle, open };
}
it.each(['en', 'pl'] as const)('localized actions are visible, named, keyboard accessible and send only application identity (%s)', async locale => {
  const { comment, open, onToggle, container } = row(locale), t = translator(locale);
  expect(open).not.toHaveBeenCalled();
  for (const [action, label] of [['author', t('openAuthor')], ['permalink', t('openComment')], ['translate', t('translateBrowser')]] as const) {
    const button = screen.getByRole('button', { name: name => name.startsWith(label) });
    expect(button.title).toBe(label); expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    button.focus(); await userEvent.keyboard('{Enter}');
    expect(open).toHaveBeenLastCalledWith({ itemId: comment.itemId, commentId: comment.id, action });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  }
  expect(open).toHaveBeenCalledTimes(3); expect(onToggle).not.toHaveBeenCalled();
  expect(container.querySelector('article')?.dataset.selected).toBe('true');
  expect(container.querySelector('article')?.dataset.viewRole).toBe('match');
  expect(container.querySelector('.new-badge')).toBeTruthy();
});
it('creator presentation requires positive video evidence, never a post relationship or display name', () => {
  const { container, rerender, comment, onToggle } = row('en', { isCreator: true });
  expect(container.querySelector('.creator-author')).toBeTruthy(); expect(container.querySelector('.creator-badge')?.textContent).toBe('Creator');
  for (const changes of [{ isCreator: false }, { isCreator: undefined }, { source: { ...comment.source, kind: 'post' as const } }]) {
    rerender(<CommentArticle comment={{ ...comment, ...changes }} locale="en" disabled={false} hasChildren role="normal" rawHit={false} selected={false} onToggle={onToggle} />);
    expect(container.querySelector('.creator-author')).toBeNull(); expect(container.querySelector('.creator-badge')).toBeNull();
  }
});
it('missing safe affordances leave author and timestamp as selectable ordinary text', () => {
  const { container, open } = row('en', { actions: { author: false, permalink: false, translate: false } });
  expect(screen.queryByRole('button')).toBeNull(); expect(container.querySelector('.comment-byline strong')?.textContent).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
});
it('cross-element selection and Shift actions on author/time never activate or mark; publication label stays honest', () => {
  const { container, onToggle, open } = row('en', { publishedAt: undefined, publication: { precision: 'coarse', estimated: { status: 'observed', value: true }, instant: { status: 'unknown', reason: 'unavailable' }, label: { status: 'observed', value: 'about 2 weeks ago' } } });
  const author = required(container.querySelector('.action-author button')), timestamp = required(container.querySelector('.action-permalink button'));
  expect(timestamp.textContent).toContain('about 2 weeks ago');
  const range = document.createRange(); range.setStart(required(author.firstChild), 0); range.setEndAfter(timestamp); document.getSelection()?.addRange(range);
  const selected = document.getSelection()?.toString();
  fireEvent.pointerDown(author); fireEvent.click(author, { shiftKey: true }); fireEvent.click(timestamp, { shiftKey: true, ctrlKey: true });
  expect(open).not.toHaveBeenCalled(); expect(onToggle).not.toHaveBeenCalled(); expect(document.getSelection()?.toString()).toBe(selected);
});
it('long translations explain manual copy without truncation, and a browser failure stays localized', async () => {
  const copy = vi.fn(async () => undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  const open = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'TRANSLATION_TOO_LONG' } }).mockRejectedValueOnce(new Error('private'));
  const { comment, onToggle } = row('pl', { text: '中文 한국어\n🦊 & ?' }, open);
  fireEvent.click(screen.getByRole('button', { name: 'Przetłumacz w przeglądarce' }));
  expect((await screen.findByRole('alert')).textContent).toContain('zbyt długi');
  fireEvent.click(screen.getByRole('button', { name: 'Kopiuj tekst komentarza' }));
  await screen.findByText('Skopiowano'); expect(copy).toHaveBeenCalledExactlyOnceWith(comment.text);
  fireEvent.click(screen.getByRole('button', { name: 'Przetłumacz w przeglądarce' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Nie udało się otworzyć strony'));
  expect(onToggle).not.toHaveBeenCalled();
});
