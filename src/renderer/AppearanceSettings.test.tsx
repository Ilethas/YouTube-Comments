// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppearanceSettings } from './AppearanceSettings';
import { defaultReaderAppearance } from '../shared/appearance';
import type { ReaderApi } from '../shared/reader-api';
import { applyAppearance } from './appearance';

afterEach(cleanup);
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
