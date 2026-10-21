import light from './themes/light.json';
import dark from './themes/dark.json';
import charcoal from './themes/charcoal.json';
import warmGraphite from './themes/warm-graphite.json';
import type { Preferences } from './preferences';

/** Version 1 requires its original 15 tokens. unseen-surface is an optional
 * extension; omitted values retain the original translucent accent-soft rule. */
export const colorTokens = ['background', 'surface', 'surface-raised', 'text', 'muted', 'border', 'creator', 'accent', 'accent-soft', 'unseen', 'new-text', 'new-surface', 'focus', 'danger', 'danger-soft'] as const;
export interface ThemeDefinition {
  readonly schema: 'youtube-comments-theme'; readonly version: 1;
  readonly name: string; readonly colorScheme: 'light' | 'dark';
  readonly tokens: Readonly<Record<typeof colorTokens[number], string> & { 'unseen-surface'?: string }>;
}
export const themeByteLimit = 16384;
export function exactProperties(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function isThemeDefinition(value: unknown): value is ThemeDefinition {
  return exactProperties(value, ['schema', 'version', 'name', 'colorScheme', 'tokens'])
    && value.schema === 'youtube-comments-theme' && value.version === 1
    && typeof value.name === 'string' && value.name.trim() === value.name && value.name.length > 0 && value.name.length <= 80
    && [...value.name].every(character => { const code = character.charCodeAt(0); return code >= 32 && !(code >= 127 && code <= 159); })
    && !/[\u202a-\u202e\u2066-\u2069<>]/u.test(value.name)
    && (value.colorScheme === 'light' || value.colorScheme === 'dark')
    && (exactProperties(value.tokens, colorTokens) || exactProperties(value.tokens, [...colorTokens, 'unseen-surface']))
    && Object.values(value.tokens).every(color => typeof color === 'string' && color.length === 7 && /^#[0-9a-fA-F]{6}$/u.test(color));
}
export function parseTheme(text: string): ThemeDefinition {
  if (new TextEncoder().encode(text).length > themeByteLimit) throw new Error('Invalid theme');
  const value: unknown = JSON.parse(text);
  if (!isThemeDefinition(value)) throw new Error('Invalid theme');
  return value;
}
function builtin(value: unknown): ThemeDefinition {
  if (!isThemeDefinition(value)) throw new Error('Invalid built-in theme');
  return value;
}
export const builtinThemes = { light: builtin(light), dark: builtin(dark), charcoal: builtin(charcoal) } as const;
/** Bundled offline starters use exactly the same format as imported themes. */
export const themeTemplates = { ...builtinThemes, 'warm-graphite': builtin(warmGraphite) } as const;
export const themeExportSources = ['current', 'light', 'dark', 'charcoal', 'warm-graphite'] as const;
export type ThemeExportSource = typeof themeExportSources[number];
export interface ThemeFileIssue { readonly file: string; readonly reason: 'invalid' | 'limit' }
export interface ThemeRefreshResult { readonly preferences: Preferences; readonly issues: readonly ThemeFileIssue[] }
export function isThemeExportRequest(value: unknown): value is { source: ThemeExportSource } {
  return exactProperties(value, ['source']) && themeExportSources.includes(value.source as ThemeExportSource);
}
/** Shared resolution keeps System and custom fallback identical during export
 * and rendering. Export captures a copy without changing the active palette. */
export function resolveTheme(preferences: Pick<Preferences, 'appearance' | 'readerAppearance'>, osDark: boolean): ThemeDefinition {
  const settings = preferences.readerAppearance ?? defaultReaderAppearance;
  const custom = settings.themes.find(theme => theme.id === settings.customThemeId)?.definition;
  return preferences.appearance === 'custom' && isThemeDefinition(custom) ? custom
    : preferences.appearance === 'charcoal' ? builtinThemes.charcoal
      : preferences.appearance === 'dark' || preferences.appearance === 'system' && osDark ? builtinThemes.dark : builtinThemes.light;
}
export const assetId = (value: unknown): value is string => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/u.test(value);
export const themeId = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && /^[a-f0-9-]{36}$/u.test(value);
export interface ReaderAppearance {
  readonly revision: number;
  readonly themes: readonly { readonly id: string; readonly definition: ThemeDefinition }[];
  readonly customThemeId: string | null;
  readonly wallpaperId: string | null;
  readonly wallpaperEnabled: boolean;
  readonly surfaceOpacity: number;
  readonly blur: number;
}
export const defaultReaderAppearance: ReaderAppearance = { revision: 0, themes: [], customThemeId: null, wallpaperId: null, wallpaperEnabled: false, surfaceOpacity: 92, blur: 8 };
export type ReaderAppearanceChange = Pick<ReaderAppearance, 'customThemeId' | 'wallpaperEnabled' | 'surfaceOpacity' | 'blur'> & { readonly expectedRevision: number };
export function isReaderAppearanceChange(value: unknown): value is ReaderAppearanceChange {
  return exactProperties(value, ['expectedRevision', 'customThemeId', 'wallpaperEnabled', 'surfaceOpacity', 'blur'])
    && Number.isSafeInteger(value.expectedRevision) && Number(value.expectedRevision) >= 0
    && (value.customThemeId === null || themeId(value.customThemeId)) && typeof value.wallpaperEnabled === 'boolean'
    && Number.isInteger(value.surfaceOpacity) && Number(value.surfaceOpacity) >= 0 && Number(value.surfaceOpacity) <= 100
    && Number.isInteger(value.blur) && Number(value.blur) >= 0 && Number(value.blur) <= 20;
}
/** Used again when loading SQLite/backups; stored JSON is never trusted CSS. */
export function isReaderAppearance(value: unknown): value is ReaderAppearance {
  if (!exactProperties(value, ['revision', 'themes', 'customThemeId', 'wallpaperId', 'wallpaperEnabled', 'surfaceOpacity', 'blur'])) return false;
  const { revision, themes, wallpaperId, ...settings } = value;
  return isReaderAppearanceChange({ ...settings, expectedRevision: revision })
    && (wallpaperId === null || assetId(wallpaperId)) && (!settings.wallpaperEnabled || wallpaperId !== null)
    && Array.isArray(themes) && themes.length <= 16
    && themes.every(theme => exactProperties(theme, ['id', 'definition']) && themeId(theme.id) && isThemeDefinition(theme.definition))
    && new Set(themes.map(theme => theme.id)).size === themes.length
    && (settings.customThemeId === null || themes.some(theme => theme.id === settings.customThemeId));
}
