// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SourceAction } from './SourceAction';

afterEach(cleanup);
it.each([['en', 'Open on YouTube'], ['pl', 'Otwórz w YouTube']] as const)('accessible %s source action supplies only item identity', async (locale, name) => {
  const open = vi.fn(async () => ({ ok: true as const, value: null }));
  render(<SourceAction itemId="stored-item" locale={locale} open={open} />);
  const button = screen.getByRole('button', { name }); expect(button.title).toBe(name);
  fireEvent.click(button); await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  expect(open).toHaveBeenCalledExactlyOnceWith('stored-item'); expect(screen.queryByRole('alert')).toBeNull();
});
it('pending browser opening prevents duplicate intents and failure is localized and retryable', async () => {
  let finish!: (value: { ok: false; error: { code: 'SOURCE_OPEN_FAILED' } }) => void;
  const open = vi.fn(() => new Promise<{ ok: false; error: { code: 'SOURCE_OPEN_FAILED' } }>(resolve => { finish = resolve; }));
  render(<SourceAction itemId="stored" locale="pl" open={open} />);
  const button = screen.getByRole('button'); fireEvent.click(button); fireEvent.click(button); expect(open).toHaveBeenCalledTimes(1);
  finish({ ok: false, error: { code: 'SOURCE_OPEN_FAILED' } });
  expect((await screen.findByRole('alert')).textContent).toBe('Nie udało się otworzyć strony w przeglądarce. Spróbuj ponownie.');
  expect(button.hasAttribute('disabled')).toBe(false);
});
