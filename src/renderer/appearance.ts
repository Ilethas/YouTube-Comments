import { builtinThemes, colorTokens, defaultReaderAppearance, isThemeDefinition } from '../shared/appearance';
import type { Preferences } from '../shared/preferences';

/** One color-rule vocabulary for built-ins and imported data. System retains
 * the original light/dark palettes and follows matchMedia for the document life. */
export function applyAppearance(preferences: Pick<Preferences, 'appearance' | 'readerAppearance'>, osDark: boolean, root = document.documentElement): void {
  const appearance = preferences.appearance;
  const settings = preferences.readerAppearance ?? defaultReaderAppearance;
  const custom = settings.themes.find(theme => theme.id === settings.customThemeId)?.definition;
  const theme = appearance === 'custom' && isThemeDefinition(custom) ? custom
    : appearance === 'charcoal' ? builtinThemes.charcoal
      : appearance === 'dark' || appearance === 'system' && osDark ? builtinThemes.dark : builtinThemes.light;
  root.dataset.appearance = appearance;
  root.style.colorScheme = theme.colorScheme;
  for (const token of colorTokens) root.style.setProperty(`--${token}`, theme.tokens[token]);
  root.style.setProperty('--reader-surface-opacity', `${settings.surfaceOpacity}%`);
  root.style.setProperty('--reader-background-blur', `${settings.blur}px`);
}
