/** Durable user intent; System resolves through live CSS/OS appearance. */
export type Appearance = 'system' | 'light' | 'dark';
export type Locale = 'en' | 'pl';
export const translationTargets = ['app', 'en', 'pl', 'de', 'fr', 'es', 'it', 'pt', 'ja', 'ko', 'zh-CN'] as const;
export type TranslationTarget = typeof translationTargets[number];
export interface Preferences { readonly locale: Locale; readonly appearance: Appearance; readonly translationTarget: TranslationTarget }
/** Resolve the saved semantic choice at activation, so Follow app never goes stale. */
export function effectiveTranslationTarget(preferences: Preferences): Exclude<TranslationTarget, 'app'> {
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
