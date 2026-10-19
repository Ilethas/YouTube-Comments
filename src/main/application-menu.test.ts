import { expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { fileMenu } from './application-menu';
import { windowShortcutLabel } from '../shared/window-actions';
it.each(['en', 'pl'] as const)('native File commands own distinct window accelerators in %s; Ctrl+W remains a tab command', locale => {
  const create = vi.fn(), menu = fileMenu(locale, create, false).submenu as MenuItemConstructorOptions[];
  expect(menu.map(item => item.accelerator).filter(Boolean)).toEqual(['CmdOrCtrl+N', 'CmdOrCtrl+Shift+W', 'Ctrl+Shift+Q']);
  expect(menu[1].role).toBe('close'); expect(menu[3].role).toBe('quit');
  expect(menu[1].label).toBe(locale === 'en' ? 'Close Window' : 'Zamknij okno');
  expect(menu[0].click).toBe(create);
});
it('macOS File does not duplicate appMenu Quit and displays conventional command chords', () => {
  const menu = fileMenu('en', vi.fn(), true).submenu as MenuItemConstructorOptions[];
  expect(menu.some(item => item.role === 'quit')).toBe(false);
  expect(windowShortcutLabel('quitApplication', true)).toBe('Cmd+Q');
  expect(windowShortcutLabel('closeWindow', true)).toBe('Cmd+Shift+W');
});
