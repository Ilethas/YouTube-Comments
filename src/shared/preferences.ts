/** Durable user intent; System resolves through live CSS/OS appearance. */
export type Appearance = 'system' | 'light' | 'dark';
export type Locale = 'en' | 'pl';
export interface Preferences { readonly locale: Locale; readonly appearance: Appearance }

/** First supported OS/browser language base, with English fallback. Used only
 * when there is no explicit persisted language choice. */
export function initialLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0];
    if (base === 'en' || base === 'pl') return base;
  }
  return 'en';
}
