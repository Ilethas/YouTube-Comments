export { initialLocale } from '../shared/preferences';
export type { Locale } from '../shared/preferences';
import type { Locale } from '../shared/preferences';

const en = {
  appName: 'Discussion reader', demo: 'LOCAL DEMO', language: 'Language', appearance: 'Appearance',
  en: 'English', pl: 'Polski', system: 'System', light: 'Light', dark: 'Dark',
  discussions: 'Discussions', video: 'Video', post: 'Community Post', discussion: 'Discussion',
  demoNotice: 'Synthetic discussions · Seen state and preferences are saved on this device.',
  loading: 'Loading the reader…', loadError: 'The reader could not load its stored data.',
  saveError: 'The change could not be confirmed. The previous state is still shown.',
  unsupportedSchema: 'This database needs a newer version of the application.',
  retry: 'Try again', empty: 'No discussions are stored in this profile.',
  seenHelp: 'Check a comment to mark it seen. Ctrl+click also sets all its replies to the same state.',
  newHelp: 'NEW shows fixed examples of later discoveries in this demo; it is independent of UNSEEN.',
  clockNote: 'Demo reference time', unknownAuthor: 'Unknown author', unknownTime: 'Publication time unavailable',
  seen: 'Seen', unseen: 'UNSEEN', new: 'NEW', creator: 'Creator', pinned: 'Pinned',
  likes: 'Likes: {count}', markSeen: 'Mark comment by {author} seen', markUnseen: 'Mark comment by {author} unseen',
  comments_one: '{count} comment', comments_other: '{count} comments',
  unseenCount_one: '{count} unseen comment', unseenCount_other: '{count} unseen comments',
};
type Key = keyof typeof en;
const pl: Record<Key, string> & Record<string, string> = {
  appName: 'Czytnik dyskusji', demo: 'LOKALNE DEMO', language: 'Język', appearance: 'Wygląd',
  en: 'English', pl: 'Polski', system: 'Systemowy', light: 'Jasny', dark: 'Ciemny',
  discussions: 'Dyskusje', video: 'Film', post: 'Post społeczności', discussion: 'Dyskusja',
  demoNotice: 'Przykładowe dyskusje · Stan przeczytania i ustawienia są zapisywane na tym urządzeniu.',
  loading: 'Wczytywanie czytnika…', loadError: 'Nie udało się wczytać zapisanych danych czytnika.',
  saveError: 'Nie udało się potwierdzić zmiany. Nadal wyświetlany jest poprzedni stan.',
  unsupportedSchema: 'Ta baza danych wymaga nowszej wersji aplikacji.',
  retry: 'Spróbuj ponownie', empty: 'W tym profilu nie ma zapisanych dyskusji.',
  seenHelp: 'Zaznacz komentarz, aby oznaczyć go jako przeczytany. Ctrl+kliknięcie ustawia ten sam stan dla wszystkich jego odpowiedzi.',
  newHelp: 'NOWY oznacza stałe przykłady późniejszych odkryć w tym demo, niezależnie od stanu NIEPRZECZYTANY.',
  clockNote: 'Czas odniesienia demo', unknownAuthor: 'Nieznany autor', unknownTime: 'Brak daty publikacji',
  seen: 'Przeczytany', unseen: 'NIEPRZECZYTANY', new: 'NOWY', creator: 'Twórca', pinned: 'Przypięty',
  likes: 'Polubienia: {count}', markSeen: 'Oznacz komentarz autora {author} jako przeczytany',
  markUnseen: 'Oznacz komentarz autora {author} jako nieprzeczytany',
  comments_one: '{count} komentarz', comments_few: '{count} komentarze', comments_many: '{count} komentarzy', comments_other: '{count} komentarza',
  unseenCount_one: '{count} nieprzeczytany komentarz', unseenCount_few: '{count} nieprzeczytane komentarze',
  unseenCount_many: '{count} nieprzeczytanych komentarzy', unseenCount_other: '{count} nieprzeczytanego komentarza',
};
export const messages: Record<Locale, Record<string, string>> = { en, pl };

export function translator(locale: Locale) {
  return (key: Key, values: Record<string, string | number> = {}): string => {
    const message = messages[locale][key] ?? en[key];
    return message.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
  };
}

export function countLabel(locale: Locale, key: 'comments' | 'unseenCount', count: number): string {
  const category = new Intl.PluralRules(locale).select(count);
  const template = messages[locale][`${key}_${category}`] ?? messages.en[`${key}_other`];
  return template.replace('{count}', new Intl.NumberFormat(locale).format(count));
}

export function publicationTime(iso: string, locale: Locale, now: number) {
  const date = new Date(iso);
  const hours = (date.getTime() - now) / 3600000;
  const unit = Math.abs(hours) >= 24 ? 'day' : 'hour';
  return {
    relative: new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(unit === 'day' ? hours / 24 : hours), unit),
    exact: new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'long' }).format(date),
  };
}
