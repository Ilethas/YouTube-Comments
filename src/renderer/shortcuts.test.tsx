// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { formatShortcut, matchesShortcut, shortcuts, shortcutKeyLabels } from './shortcuts';
import { messages, translator } from './i18n';
import { readerShortcut } from './keyboard-routing';

afterEach(cleanup);
it('has unique stable IDs and familiar Windows labels with independent naming overrides', () => {
  expect(new Set(shortcuts.map(definition => definition.id)).size).toBe(shortcuts.length);
  expect(formatShortcut('previous-tab')).toBe('Ctrl+Shift+Tab');
  expect(formatShortcut('new-window')).toBe('Ctrl+N');
  expect(formatShortcut('close-window')).toBe('Ctrl+Shift+W');
  expect(formatShortcut('quit-application')).toBe('Ctrl+Shift+Q');
  expect(formatShortcut('move-tab-left')).toBe('Alt+Left');
  expect(formatShortcut('move-active-tab-left')).toBe('Ctrl+Shift+PageUp');
  expect(formatShortcut('move-active-tab-right')).toBe('Ctrl+Shift+PageDown');
  expect(formatShortcut('previous-match')).toBe('Shift+F3');
  expect(formatShortcut('comment-subtree')).toBe('Ctrl+Click');
  expect(formatShortcut('apply-view')).toBe('Ctrl+Enter');
  expect(formatShortcut('keyboard-help')).toBe('F1');
  expect(formatShortcut('focus-search', { Ctrl: 'Control' })).toBe('Control+F');
  expect(matchesShortcut(new KeyboardEvent('keydown', { key: 'W', ctrlKey: true }), 'close-tab')).toBe(true);
  expect(matchesShortcut(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, altKey: true }), 'close-tab')).toBe(false);
});
it.each(['en', 'pl'] as const)('renders the complete registry in %s with localized actions/scopes and semantic key markup', locale => {
  render(<KeyboardShortcuts locale={locale} />);
  const t = translator(locale);
  expect(screen.getByRole('heading', { name: t('keyboardShortcuts') }).tabIndex).toBe(-1);
  const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('tr[data-shortcut-id]'));
  expect(rows.map(row => row.dataset.shortcutId)).toEqual(shortcuts.map(definition => definition.id));
  for (const [index, definition] of shortcuts.entries()) {
    expect(messages[locale][definition.description]).toBeTruthy();
    const heading = within(rows[index]).getByRole('rowheader');
    expect(heading.textContent).toContain(t(definition.description));
    if ('scope' in definition) expect(heading.textContent).toContain(t(definition.scope));
    expect(Array.from(rows[index].querySelectorAll('kbd'), key => key.textContent)).toEqual(shortcutKeyLabels(definition.id));
    expect(within(rows[index]).getByRole('cell').textContent).toBe(formatShortcut(definition.id));
  }
  expect(document.querySelector('[data-shortcut-id="move-active-tab-left"]')?.textContent).toContain(locale === 'en' ? 'Move active tab left' : 'Przesuń aktywną kartę w lewo');
  expect(document.querySelector('[data-shortcut-id="move-active-tab-right"]')?.textContent).toContain(locale === 'en' ? 'Move active tab right' : 'Przesuń aktywną kartę w prawo');
});
it('routes exact global reorder chords from editing controls, respecting disabled/menu/dialog/composition/repeat gates', () => {
  const context = { activeKind: 'discussion' as const, modalOpen: false, workspaceBusy: false };
  const event = (init: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key: 'PageUp', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true, ...init });
  expect(readerShortcut(event(), context)).toBe('move-active-tab-left');
  for (const init of [{ altKey: true }, { metaKey: true }, { ctrlKey: false }, { shiftKey: false }, { isComposing: true }, { repeat: true }]) expect(readerShortcut(event(init), context)).toBeUndefined();
  expect(readerShortcut(event(), { ...context, workspaceBusy: true })).toBeUndefined();
  expect(readerShortcut(event(), { ...context, activeKind: undefined })).toBeUndefined();
  expect(readerShortcut(event(), { ...context, modalOpen: true })).toBeUndefined();
  for (const markup of ['<input>', '<textarea></textarea>', '<select></select>', '<div contenteditable="true"></div>', '<input disabled>', '<div inert><input></div>', '<div role="menu"><button></button></div>', '<dialog open><input></dialog>']) {
    const host = document.createElement('div'); host.innerHTML = markup; document.body.append(host);
    const target = host.querySelector('input, textarea, select, button, [contenteditable]');
    if (!target) throw Error('Missing target');
    let routed: ReturnType<typeof readerShortcut>;
    target.addEventListener('keydown', e => { routed = readerShortcut(e as KeyboardEvent, context); });
    target.dispatchEvent(event());
    expect(routed).toBe(markup.includes('disabled') || markup.includes('inert') || markup.includes('menu') || markup.includes('dialog') ? undefined : 'move-active-tab-left');
    host.remove();
  }
});
it('routes only assigned chords and leaves unbound, composing, handled and modal keys alone', () => {
  const context = { activeKind: 'discussion' as const, modalOpen: false, workspaceBusy: false };
  for (const key of ['ArrowLeft', 'Home', 'a', 'F5', 'r', '1']) {
    expect(readerShortcut(new KeyboardEvent('keydown', { key, ctrlKey: key === 'r' || key === '1' }), context)).toBeUndefined();
  }
  expect(readerShortcut(new KeyboardEvent('keydown', { key: 'F1', isComposing: true }), context)).toBeUndefined();
  const handled = new KeyboardEvent('keydown', { key: 'F1', cancelable: true }); handled.preventDefault();
  expect(readerShortcut(handled, context)).toBeUndefined();
  for (const definition of shortcuts) {
    const key = definition.keys.at(-1) ?? '';
    const event = new KeyboardEvent('keydown', { key, ctrlKey: (definition.keys as readonly string[]).includes('Ctrl'), shiftKey: (definition.keys as readonly string[]).includes('Shift') });
    expect(readerShortcut(event, { ...context, modalOpen: true })).toBeUndefined();
  }
  expect(readerShortcut(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true }), { ...context, workspaceBusy: true })).toBeUndefined();
});
