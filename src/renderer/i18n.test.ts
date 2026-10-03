import { describe, expect, it } from 'vitest';
import { countLabel, initialLocale, messages, publicationTime, translator } from './i18n';

describe('localization', () => {
  it('covers every key and interpolation in Polish', () => {
    for (const [key, value] of Object.entries(messages.en)) {
      expect(messages.pl[key]).toBeTruthy();
      expect(messages.pl[key].match(/\{\w+\}/g)).toEqual(value.match(/\{\w+\}/g));
    }
    expect(translator('pl')('markSeen', { author: 'Marta' })).toContain('Marta');
  });
  it('selects supported language bases with English fallback', () => {
    expect(initialLocale(['pl-PL', 'en'])).toBe('pl');
    expect(initialLocale(['de-DE', 'en-GB'])).toBe('en');
    expect(initialLocale(['fr'])).toBe('en');
    expect(initialLocale([])).toBe('en');
  });
  it('uses English and Polish plural forms', () => {
    expect(countLabel('en', 'comments', 1)).toBe('1 comment');
    expect(countLabel('en', 'comments', 2)).toBe('2 comments');
    expect(countLabel('pl', 'comments', 1)).toBe('1 komentarz');
    expect(countLabel('pl', 'comments', 2)).toBe('2 komentarze');
    expect(countLabel('pl', 'comments', 5)).toBe('5 komentarzy');
    expect(countLabel('pl', 'comments', 22)).toBe('22 komentarze');
  });
  it('formats publication time against an explicit reference clock', () => {
    const now = Date.parse('2026-09-20T12:00:00Z');
    expect(publicationTime('2026-09-20T10:00:00Z', 'en', now).relative).toBe('2 hours ago');
    expect(publicationTime('2026-09-20T10:00:00Z', 'pl', now).relative).toBe('2 godziny temu');
  });
});
it('preserves Polish accents in workspace and destructive confirmation text', () => {
  const t = translator('pl');
  expect(t('removeFromLibrary')).toBe('Usuń z Biblioteki');
  expect(t('removeDescription')).toContain('trwałe usunięcie');
  expect(t('removeDescription')).toContain('historii odświeżania');
  expect(t('externalToolsHelp')).toContain('Ścieżki');
  expect(t('reorderHelp')).toContain('Przeciągnij kartę');
});
