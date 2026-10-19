// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoveTabDialog } from './MoveTabDialog';
import type { TabTransferApi, TransferDestination } from '../shared/tab-transfer';

beforeEach(() => {
  // jsdom lacks CSS.escape, used by user-event for native radio-group traversal.
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`) });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const destinations: readonly TransferDestination[] = [
  { windowId: 'b', number: 2, revision: 12, tabCount: 3, activeTab: { kind: 'discussion', title: 'An active discussion' } },
  { windowId: 'c', number: 3, revision: 8, tabCount: 0, activeTab: null },
];
function show(locale: 'en' | 'pl' = 'en', promise = Promise.resolve({ ok: true as const, value: destinations })) {
  const move = vi.fn(), cancel = vi.fn(), api = { destinations: vi.fn(() => promise) } as unknown as TabTransferApi;
  const ui = render(<MoveTabDialog api={api} locale={locale} dirty={false} newWindow={false}
    tabTitle={'A very long source title '.repeat(20)} tabKind="video" move={move} cancel={cancel} />);
  return { ...ui, move, cancel, api };
}
it.each(['en', 'pl'] as const)('shows source and destination context; selection is separate from exact snapshot submission in %s', async locale => {
  const { move } = show(locale);
  const confirm = screen.getByRole('button', { name: locale === 'en' ? 'Move' : 'Przenieś' });
  expect(confirm.hasAttribute('disabled')).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: locale === 'en' ? 'Cancel' : 'Anuluj' }));
  expect(screen.getByRole('dialog').getAttribute('aria-describedby')).toBeTruthy();
  expect(screen.getByTitle('A very long source title '.repeat(20).trim()).getAttribute('title')).toBe('A very long source title '.repeat(20));
  const option = await screen.findByRole('radio', { name: /(?:Window|Okno) 2.*An active discussion/ });
  expect(screen.getByText(locale === 'en' ? '3 tabs' : '3 karty')).toBeTruthy();
  expect(screen.getByText(locale === 'en' ? 'Empty window' : 'Puste okno')).toBeTruthy();
  fireEvent.click(option);
  expect((option as HTMLInputElement).checked).toBe(true); expect(move).not.toHaveBeenCalled();
  fireEvent.click(confirm); fireEvent.click(confirm);
  expect(move).toHaveBeenCalledExactlyOnceWith({ windowId: 'b', expectedRevision: 12, beforeTabId: null });
});
it('native arrow navigation changes selection and Space selects New Window without moving until confirmation', async () => {
  const { move } = show(), user = userEvent.setup();
  const first = await screen.findByRole('radio', { name: /Window 2/ }); first.focus();
  await user.keyboard(' '); expect((first as HTMLInputElement).checked).toBe(true);
  await user.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: /Window 3/ }));
  await user.keyboard('{ArrowDown}');
  expect((screen.getByRole('radio', { name: /Move to New Window/ }) as HTMLInputElement).checked).toBe(true);
  expect(move).not.toHaveBeenCalled();
  await user.tab(); expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  await user.tab(); await user.keyboard('{Enter}'); expect(move).toHaveBeenCalledExactlyOnceWith('new');
});
it('Escape and Cancel preserve the source; unmount restores the invoking control', async () => {
  const origin = document.createElement('button'); document.body.append(origin); origin.focus();
  const { cancel, move, unmount } = show();
  await screen.findByRole('radio', { name: /Window 2/ });
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(cancel).toHaveBeenCalledOnce(); expect(move).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(cancel).toHaveBeenCalledTimes(2);
  unmount(); expect(document.activeElement).toBe(origin); origin.remove();
});
it('loading and failed destinations retain cancellation and an explicit new-window fallback', async () => {
  let resolve!: (v: { ok: true; value: readonly TransferDestination[] }) => void;
  const first = show('en', new Promise(r => { resolve = r; }));
  expect(screen.getByRole('status')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(first.cancel).toHaveBeenCalledOnce(); first.unmount(); resolve({ ok: true, value: destinations });
  const move = vi.fn(), api = { destinations: vi.fn(async () => { throw Error('disconnected'); }) } as unknown as TabTransferApi;
  render(<MoveTabDialog api={api} locale="en" dirty={false} newWindow={false} tabTitle="Library" tabKind="library" move={move} cancel={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not load windows'));
  fireEvent.click(screen.getByRole('radio', { name: /Move to New Window/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Move' })); expect(move).toHaveBeenCalledExactlyOnceWith('new');
});
it('the explicit New Window command needs confirmation and does not query other destinations', () => {
  const move = vi.fn(), api = { destinations: vi.fn() } as unknown as TabTransferApi;
  render(<MoveTabDialog api={api} locale="en" dirty={false} newWindow tabTitle="Library" tabKind="library" move={move} cancel={vi.fn()} />);
  expect(api.destinations).not.toHaveBeenCalled();
  expect((screen.getByRole('radio', { name: /Move to New Window/ }) as HTMLInputElement).checked).toBe(true);
  expect(move).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Move' }));
  expect(move).toHaveBeenCalledExactlyOnceWith('new');
});
