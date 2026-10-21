import { expect, it } from 'vitest';
import { builtinThemes, colorTokens, defaultReaderAppearance, isReaderAppearance, isReaderAppearanceChange, isThemeDefinition, parseTheme, themeTemplates } from './appearance';
import warmGraphiteExample from '../../docs/examples/warm-graphite.json';
import { isPreferenceChange } from './reader-api';

it('retains original v1 imports and validates the optional unread surface strictly', () => {
  const legacy = { ...builtinThemes.light, tokens: { ...builtinThemes.light.tokens } };
  delete legacy.tokens['unseen-surface'];
  expect(parseTheme(JSON.stringify(legacy))).toEqual(legacy);
  for (const color of [null, '', 'red', '#fff', '#11223344', 'var(--text)', 'url(x)']) {
    expect(isThemeDefinition({ ...legacy, tokens: { ...legacy.tokens, 'unseen-surface': color } })).toBe(false);
  }
  for (const theme of Object.values(themeTemplates)) expect(parseTheme(JSON.stringify(theme))).toEqual(theme);
  expect(themeTemplates['warm-graphite']).toEqual(warmGraphiteExample);
});

const rgb = (hex: string) => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
function luminance(channels: number[]) {
  return channels.map(channel => { const c = channel / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a: number[], b: number[]) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
it.each(['light', 'charcoal'] as const)('gives %s unread rows a stronger independent surface while retaining text contrast', name => {
  const t = builtinThemes[name].tokens, unread = rgb(t['unseen-surface'] ?? '');
  const background = rgb(t.background);
  const previous = rgb(t['accent-soft']).map((c, i) => c * .65 + background[i] * .35);
  // A palette regression floor, not a WCAG requirement for decorative row fills.
  expect(contrast(unread, background)).toBeGreaterThan(1.12);
  expect(contrast(unread, background)).toBeGreaterThan(contrast(previous, background) + .08);
  for (const token of ['text', 'muted', 'creator', 'accent'] as const) expect(contrast(rgb(t[token]), unread)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(rgb(t.focus), unread)).toBeGreaterThanOrEqual(3);
});

it('keeps both original palettes exact and adds neutral Charcoal surfaces', () => {
  expect(builtinThemes.light.tokens).toEqual({ background: '#f2f4f6', surface: '#ffffff', 'surface-raised': '#f7f9fb', text: '#202b37', muted: '#596778', border: '#d7dfe7', creator: '#6f4093', accent: '#235ba8', 'accent-soft': '#eaf2fd', unseen: '#235ba8', 'unseen-surface': '#d6e5fb', 'new-text': '#715000', 'new-surface': '#fff0bd', focus: '#005fcc', danger: '#a12935', 'danger-soft': '#fcebed' });
  expect(builtinThemes.dark.tokens).toEqual({ background: '#151b23', surface: '#1d2530', 'surface-raised': '#242e3b', text: '#e5eaf0', muted: '#abb8c8', border: '#3a4859', creator: '#d4b0f0', accent: '#9dc7ff', 'accent-soft': '#223956', unseen: '#9dc7ff', 'new-text': '#ffdc88', 'new-surface': '#4e4021', focus: '#9dc7ff', danger: '#ffadb5', 'danger-soft': '#48232b' });
  for (const key of ['background', 'surface', 'surface-raised', 'border', 'text'] as const) {
    expect(builtinThemes.charcoal.tokens[key]).toMatch(/^#([0-9a-f]{2})\1\1$/);
  }
  expect(builtinThemes.charcoal.tokens.background).toBe('#151515');
  for (const theme of Object.values(builtinThemes)) { expect(isThemeDefinition(theme)).toBe(true); expect(Object.keys(theme.tokens)).toHaveLength(colorTokens.length + ('unseen-surface' in theme.tokens ? 1 : 0)); }
});
it.each(['red', '#fff', '#12345678', 'url(https://evil.test/x)', 'var(--text)', 'rgb(0 0 0)', 'expression(alert(1))', '#ffffff; color:red', '<script>', '@import "x"'])('rejects unsafe/unversioned color %s', color => {
  expect(() => parseTheme(JSON.stringify({ ...builtinThemes.dark, tokens: { ...builtinThemes.dark.tokens, text: color } }))).toThrow();
});
it('rejects unexpected properties, missing tokens, bad metadata, oversized and malformed JSON', () => {
  expect(isThemeDefinition({ ...builtinThemes.dark, tokens: { ...builtinThemes.dark.tokens, text: '#ffffff\n' } })).toBe(false);
  for (const value of [null, [], { ...builtinThemes.dark, css: '' }, { ...builtinThemes.dark, version: 2 }, { ...builtinThemes.dark, name: '<b>Theme</b>' }, { ...builtinThemes.dark, name: 'a\n' }, { ...builtinThemes.dark, tokens: { ...builtinThemes.dark.tokens, extra: '#ffffff' } }, { ...builtinThemes.dark, tokens: {} }, { ...builtinThemes.dark, colorScheme: 'url(x)' }]) expect(isThemeDefinition(value)).toBe(false);
  expect(() => parseTheme(' '.repeat(16385))).toThrow(); expect(() => parseTheme('{')).toThrow();
  expect(parseTheme(JSON.stringify(builtinThemes.charcoal))).toEqual(builtinThemes.charcoal);
});
it('bounds sliders and rejects untrusted asset paths, selections and revisions', () => {
  const change = { expectedRevision: 0, customThemeId: null, wallpaperEnabled: false, surfaceOpacity: 92, blur: 8 };
  expect(isReaderAppearance(defaultReaderAppearance)).toBe(true);
  for (const surfaceOpacity of [-1, 101, 92.5, NaN]) expect(isReaderAppearanceChange({ ...change, surfaceOpacity })).toBe(false);
  for (const blur of [-1, 21, 1.5]) expect(isReaderAppearanceChange({ ...change, blur })).toBe(false);
  expect(isReaderAppearanceChange({ ...change, surfaceOpacity: 0, blur: 20 })).toBe(true);
  expect(isReaderAppearance({ ...defaultReaderAppearance, wallpaperId: '../../secret' })).toBe(false);
  expect(isReaderAppearance({ ...defaultReaderAppearance, customThemeId: 'a'.repeat(36) })).toBe(false);
  expect(isPreferenceChange({ appearance: 'charcoal' })).toBe(true);
  expect(isPreferenceChange({ readerAppearance: { ...change, file: 'x' } })).toBe(false);
});
