export { initialLocale } from '../shared/preferences';
export type { Locale } from '../shared/preferences';
import type { Locale } from '../shared/preferences';

const en = {
  library: 'Library', openStored: 'Open stored discussion', openUrl: 'Open URL', cancel: 'Cancel',
  closeTab: 'Close tab: {title}', emptyWorkspace: 'No open tabs', reopenHelp: 'Your discussions are still saved. Open one from Library or add a YouTube URL.',
  showMore: 'Show description', showLess: 'Hide description', savedShort: 'Saved locally', coverageShort: 'Coverage limited / unknown',
  sourceUrl: 'YouTube URL', urlPlaceholder: 'Public video or individual Community Post URL', acquire: 'Add / Open', refresh: 'Refresh',
  acquiring: 'Acquiring… You can keep reading and marking comments.', refreshing: 'Refreshing… You can keep reading and marking comments.',
  coverageNotice: 'Discussion saved. Some comments may not have been returned by YouTube.',
  localNotice: 'Stored on this device · Seen state is changed only by you.',
  invalidUrl: 'Enter a supported HTTPS YouTube video or individual Community Post URL.',
  helperUnavailable: 'The required development helper is unavailable. Check its executable override or PATH. Windows requires a direct .exe file.',
  helperIncompatible: 'The helper version could not be verified as supported. This build requires yt-dlp 2026.08.19 or post-archiver 0.4.0.',
  acquisitionFailed: 'The discussion could not be acquired. Stored comments are unchanged. Check the connection and try again.',
  acquisitionBusy: 'Another acquisition is already running. Wait for it to finish.',
  notRefreshable: 'This discussion cannot be refreshed from YouTube.', itemNotFound: 'This stored discussion could not be found.',
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
  library: 'Biblioteka', openStored: 'Otwórz zapisaną dyskusję', openUrl: 'Otwórz adres', cancel: 'Anuluj',
  closeTab: 'Zamknij kartę: {title}', emptyWorkspace: 'Brak otwartych kart', reopenHelp: 'Twoje dyskusje są nadal zapisane. Otwórz jedną z Biblioteki lub dodaj adres YouTube.',
  showMore: 'Pokaż opis', showLess: 'Ukryj opis', savedShort: 'Zapisano lokalnie', coverageShort: 'Zakres ograniczony / nieznany',
  sourceUrl: 'Adres YouTube', urlPlaceholder: 'Adres publicznego filmu lub pojedynczego postu społeczności', acquire: 'Dodaj / Otwórz', refresh: 'Odśwież',
  acquiring: 'Pobieranie… Możesz nadal czytać i oznaczać komentarze.', refreshing: 'Odświeżanie… Możesz nadal czytać i oznaczać komentarze.',
  coverageNotice: 'Dyskusja zapisana. YouTube mógł nie zwrócić wszystkich komentarzy.',
  localNotice: 'Zapisane na tym urządzeniu · Tylko Ty zmieniasz stan przeczytania.',
  invalidUrl: 'Podaj obsługiwany adres HTTPS filmu YouTube lub pojedynczego postu społeczności.',
  helperUnavailable: 'Wymagany program pomocniczy jest niedostępny. Sprawdź jego ścieżkę w konfiguracji lub PATH. Windows wymaga bezpośredniego pliku .exe.',
  helperIncompatible: 'Nie udało się potwierdzić obsługiwanej wersji programu. Wymagane są yt-dlp 2026.08.19 lub post-archiver 0.4.0.',
  acquisitionFailed: 'Nie udało się pobrać dyskusji. Zapisane komentarze pozostały bez zmian. Sprawdź połączenie i spróbuj ponownie.',
  acquisitionBusy: 'Trwa już inne pobieranie. Poczekaj na jego zakończenie.',
  notRefreshable: 'Tej dyskusji nie można odświeżyć z YouTube.', itemNotFound: 'Nie znaleziono zapisanej dyskusji.',
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
