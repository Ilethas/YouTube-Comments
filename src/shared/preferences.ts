/** Durable user intent; System resolves through live CSS/OS appearance. */
export type Appearance = 'system' | 'light' | 'dark';
export type Locale = 'en' | 'pl';
export const translationTargets = ['app', 'en', 'pl', 'de', 'fr', 'es', 'it', 'pt', 'ja', 'ko', 'zh-CN', 'custom'] as const;
export type TranslationTarget = typeof translationTargets[number];
export type SelectionControls = 'on-demand' | 'always';
export interface Preferences {
  readonly locale: Locale; readonly appearance: Appearance; readonly translationTarget: TranslationTarget;
  readonly selectionControls: SelectionControls;
  readonly includeCollapsedInPrefix: boolean;
  readonly customTranslationTarget?: string;
}
/** Bounded Google tl syntax, not a claim of Google language availability. */
export function normalizeTranslationCode(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 128 || [...value].some(character => {
    const code = character.charCodeAt(0); return code < 32 || code >= 127 && code <= 159;
  })) return undefined;
  const code = value.trim();
  return code.length <= 35 && /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/u.test(code) && code.toLowerCase() !== 'auto' ? code : undefined;
}
/** Resolve the saved semantic choice at activation, so Follow app never goes stale. */
export function effectiveTranslationTarget(preferences: Preferences): string {
  if (preferences.translationTarget === 'custom') {
    const code = normalizeTranslationCode(preferences.customTranslationTarget);
    if (!code) throw new Error('Invalid custom translation target');
    return code;
  }
  return preferences.translationTarget === 'app' ? preferences.locale : preferences.translationTarget;
}

/** First supported OS/browser language base, with English fallback. Used only
 * when there is no explicit persisted language choice. */
export function initialLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0];
    if (base === 'en' || base === 'pl') return base;
  }
  return 'en';
}
