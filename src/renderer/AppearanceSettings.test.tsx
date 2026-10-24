// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppearanceSettings } from './AppearanceSettings';
import { builtinThemes, defaultReaderAppearance } from '../shared/appearance';
import type { ReaderApi } from '../shared/reader-api';
import { applyAppearance } from './appearance';
import type { Preferences } from '../shared/preferences';

afterEach(cleanup);
it('lists custom names in one appearance selector and atomically reactivates an already selected custom ID', async () => {
  const id = '11111111-1111-1111-1111-111111111111', other = '22222222-2222-2222-2222-222222222222', save = vi.fn(async () => true);
  render(<AppearanceSettings preferences={{ appearance: 'dark', readerAppearance: { ...defaultReaderAppearance, revision: 4, customThemeId: id,
    themes: [{ id, definition: { ...builtinThemes.light, name: 'My palette' } }, { id: other, definition: { ...builtinThemes.dark, name: 'My palette' } }] } }}
  locale="en" disabled={false} api={{}} save={save} imported={async () => true} onDirty={() => undefined} missingWallpaper={false} />);
  const select = screen.getByRole('combobox', { name: 'Appearance' });
  expect(screen.queryByRole('combobox', { name: 'Custom theme' })).toBeNull();
  expect(screen.getByRole('option', { name: 'My palette (11111111)' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'My palette (22222222)' })).toBeTruthy();
  fireEvent.change(select, { target: { value: id } });
  expect(save).toHaveBeenCalledWith({ selectTheme: { id, expectedRevision: 4 } });
});
it('refreshes through reconciliation, reports individual files and disables file mutations during a wallpaper draft', async () => {
  const preferences: Preferences = { appearance: 'light', readerAppearance: defaultReaderAppearance, locale: 'en', translationTarget: 'app',
    selectionControls: 'on-demand', includeCollapsedInPrefix: true, maximumConcurrentDownloads: 3, notificationDismissal: 'automatic', notificationDurationSeconds: 5 };
  const api = { refreshThemes: vi.fn(async () => ({ ok: true as const, value: { preferences, issues: [{ file: 'bad.json', reason: 'invalid' as const }, { file: 'extra.json', reason: 'limit' as const }] } })),
    openThemesFolder: vi.fn(async () => ({ ok: true as const, value: null })), saveThemeCopy: vi.fn(async () => ({ ok: true as const, value: preferences })) };
  const imported = vi.fn(async (action: () => Promise<unknown>) => { await action(); return true; });
  render(<AppearanceSettings preferences={preferences} locale="en" disabled={false} api={api} save={async () => true} imported={imported} onDirty={() => undefined} missingWallpaper={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh themes' }));
  expect((await screen.findByRole('list', { name: 'Rejected theme files' })).textContent).toContain('bad.json: Invalid theme');
  expect(screen.getByRole('list').textContent).toContain('extra.json: Up to 16');
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Refresh themes' }).closest('fieldset')?.disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Open themes folder' }));
  await vi.waitFor(() => expect(api.openThemesFolder).toHaveBeenCalledWith());
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Refresh themes' }).closest('fieldset')?.disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Save editable copy in themes folder' }));
  await vi.waitFor(() => expect(api.saveThemeCopy).toHaveBeenCalledWith({ source: 'current' }));
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Refresh themes' }).closest('fieldset')?.disabled).toBe(false));
  fireEvent.change(screen.getAllByRole('slider')[0], { target: { value: '80' } });
  expect((screen.getByRole('button', { name: 'Refresh themes' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Save editable copy in themes folder' }) as HTMLButtonElement).disabled).toBe(true);
});
it('exports offline starters through a narrow intent without changing preferences', async () => {
  const exportTheme = vi.fn<NonNullable<ReaderApi['exportTheme']>>().mockResolvedValue({ ok: true, value: null });
  const save = vi.fn(async () => true), imported = vi.fn(async () => true);
  render(<AppearanceSettings preferences={{ appearance: 'charcoal' }} locale="en" disabled={false} api={{ exportTheme }} save={save} imported={imported} onDirty={() => undefined} missingWallpaper={false} />);
  expect(screen.getByText(/external text editor/)).toBeTruthy();
  const selector = screen.getByRole('combobox', { name: 'Theme to export' });
  for (const source of ['current', 'light', 'dark', 'charcoal', 'warm-graphite']) {
    fireEvent.change(selector, { target: { value: source } });
    fireEvent.click(screen.getByRole('button', { name: 'Export theme as JSON…' }));
    await vi.waitFor(() => expect(exportTheme).toHaveBeenLastCalledWith({ source }));
    await vi.waitFor(() => expect(selector.closest('fieldset')?.disabled).toBe(false));
  }
  expect(save).not.toHaveBeenCalled(); expect(imported).not.toHaveBeenCalled();
  exportTheme.mockRejectedValueOnce(Error('transport'));
  fireEvent.click(screen.getByRole('button', { name: 'Export theme as JSON…' }));
  expect((await screen.findByRole('alert')).textContent).toContain('could not be exported');
});
it('clears optional surfaces on theme switches and preserves the original Dark mix', () => {
  applyAppearance({ appearance: 'charcoal' }, false);
  expect(document.documentElement.style.getPropertyValue('--unseen-background')).toBe('#353331');
  for (const token of ['accent', 'accent-soft', 'unseen', 'focus'] as const) {
    expect(document.documentElement.style.getPropertyValue('--' + token)).toBe(builtinThemes.charcoal.tokens[token]);
  }
  applyAppearance({ appearance: 'light' }, false);
  expect(document.documentElement.style.getPropertyValue('--unseen-background')).toBe('#d6e5fb');
  for (const appearance of ['dark', 'system'] as const) {
    applyAppearance({ appearance }, true);
    expect(document.documentElement.style.getPropertyValue('--unseen-background')).toBe('color-mix(in srgb, var(--accent-soft) 65%, transparent)');
  }
  const id = '11111111-1111-1111-1111-111111111111';
  applyAppearance({ appearance: 'custom', readerAppearance: { ...defaultReaderAppearance, customThemeId: id, themes: [{ id, definition: builtinThemes.dark }] } }, false);
  expect(document.documentElement.style.getPropertyValue('--unseen-background')).toBe('color-mix(in srgb, var(--accent-soft) 65%, transparent)');
});
it.each(['en', 'pl'] as const)('labels sliders with numeric values and saves one bounded draft in %s', async locale => {
  const save = vi.fn(async () => true), dirty = vi.fn();
  render(<AppearanceSettings preferences={{ appearance: 'charcoal', readerAppearance: defaultReaderAppearance }} locale={locale} disabled={false} api={{} as ReaderApi} save={save} imported={async () => true} onDirty={dirty} missingWallpaper={false} />);
  const sliders = screen.getAllByRole('slider');
  expect(sliders[0].getAttribute('aria-valuetext')).toBe('92%'); expect(sliders[1].getAttribute('aria-valuetext')).toBe('8 px');
  expect(screen.getByRole('slider', { name: locale === 'en' ? /Reading surface opacity/ : /Krycie powierzchni/ })).toBe(sliders[0]);
  fireEvent.change(sliders[0], { target: { value: '100' } }); fireEvent.change(sliders[1], { target: { value: '0' } });
  expect(save).not.toHaveBeenCalled(); expect(dirty).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Apply wallpaper settings' : 'Zastosuj ustawienia tapety' }));
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]).toEqual([{ readerAppearance: { expectedRevision: 0, customThemeId: null, wallpaperEnabled: false, surfaceOpacity: 100, blur: 0 } }]);
});
it('keeps invalid import errors localized and displays missing wallpaper fallback', async () => {
  const importTheme = vi.fn<NonNullable<ReaderApi['importTheme']>>().mockResolvedValueOnce({ ok: false, error: { code: 'INVALID_THEME' } }).mockRejectedValueOnce(Error('transport failed'));
  render(<AppearanceSettings preferences={{ appearance: 'light', readerAppearance: { ...defaultReaderAppearance, wallpaperId: 'a'.repeat(64), wallpaperEnabled: true } }} locale="en" disabled={false} api={{ importTheme }} save={async () => true} imported={async action => (await action()).ok} onDirty={() => undefined} missingWallpaper={true} />);
  expect(screen.getByText(/wallpaper is missing or invalid/)).toBeTruthy();
  const button = screen.getByRole('button', { name: /Import JSON/ }); fireEvent.click(button);
  expect((await screen.findByRole('alert')).textContent).toContain('Invalid theme');
  await vi.waitFor(() => expect(button.closest('fieldset')?.disabled).toBe(false)); fireEvent.click(button);
  await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be imported or saved'));
});
it('resolves original System palettes, Charcoal and native color-scheme live', () => {
  applyAppearance({ appearance: 'system' }, true); expect(document.documentElement.style.colorScheme).toBe('dark'); expect(document.documentElement.style.getPropertyValue('--background')).toBe('#151b23');
  applyAppearance({ appearance: 'system' }, false); expect(document.documentElement.style.colorScheme).toBe('light');
  applyAppearance({ appearance: 'charcoal' }, false); expect(document.documentElement.style.getPropertyValue('--background')).toBe('#151515'); expect(document.documentElement.style.colorScheme).toBe('dark');
  applyAppearance({ appearance: 'light' }, true); expect(document.documentElement.style.colorScheme).toBe('light');
});
