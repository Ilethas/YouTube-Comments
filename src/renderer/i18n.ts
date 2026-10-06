export { initialLocale } from '../shared/preferences';
export type { Locale } from '../shared/preferences';
import type { Locale } from '../shared/preferences';
import type { RulerBucket } from './discussion-ruler';

const en = {
  overviewRuler: 'Discussion overview: unseen, applied matches, new discoveries',
  rulerKeyboardHelp: 'Up/Down: marker band. Left/Right: category. Home/End: first/last band. Enter/Space: navigate.',
  rulerUnseen: '{count} unseen', rulerMatch: '{count} matches', rulerNew: '{count} new',
  newDiscoveryHelp: 'First discovered in the latest accepted refresh after the baseline. Remains NEW until the next accepted refresh, independently of seen state.',
  keyboardShortcuts: 'Keyboard shortcuts', shortcutWorkspace: 'Workspace', shortcutSearch: 'Search and filtering',
  shortcutComments: 'Comments', shortcutAcquisition: 'Acquisition and forms', shortcutHelp: 'Help and cancellation',
  shortcutNextTab: 'Next tab', shortcutPreviousTab: 'Previous tab', shortcutCloseTab: 'Close active tab',
  shortcutMoveLeft: 'Move focused tab left', shortcutMoveRight: 'Move focused tab right', shortcutFirstTab: 'First tab', shortcutLastTab: 'Last tab',
  shortcutFocusSearch: 'Focus / select search', shortcutSubtree: 'Set comment and descendants to the same seen state', shortcutSubmit: 'Submit form',
  shortcutFocusedTab: 'Focused workspace tab', shortcutSearchScope: 'Active discussion or Library metadata filter', shortcutDiscussion: 'Active discussion; query controls also accept these keys',
  shortcutSeenCheckbox: 'Seen checkbox; applies the clicked comment’s resulting state', shortcutSubmitScope: 'URL input or discussion query form',
  shortcutCancelScope: 'Tab drag, URL form, or removal dialog unless a removal is pending',
  shortcutPlatformHelp: 'Current bindings target Windows. Future platform mappings may differ. Workspace and discussion commands are suspended during removal confirmation. Ordinary typing and navigation stay with editable controls.',
  searchDiscussion: 'Search this discussion', searchFields: 'Search fields', searchContent: 'Comment contents', searchAuthor: 'Comment author', searchRepliedTo: 'Direct replied-to author',
  seenFilter: 'Seen filter', filterAll: 'All', filterUnseen: 'Unseen', filterSeen: 'Seen', caseSensitive: 'Case sensitive', regexMode: 'Regular expression',
  applyView: 'Apply', applyHelp: 'Apply view', queryDraftPending: 'Draft criteria · Apply to update',
  querySeenPending: 'Seen changes saved · Apply to update this view', queryEvaluating: 'Evaluating…',
  queryInvalidRegex: 'Invalid regular expression. The previous applied view remains.', queryNoFields: 'Select at least one search field. The previous applied view remains.',
  queryTooExpensive: 'This query exceeded the time limit. Simplify it and Apply again. The previous applied view remains.',
  queryFailed: 'The query could not be evaluated. The previous applied view remains.', noDiscussionMatches: 'No comments match the applied criteria.',
  appliedCounts: 'Applied: {comments} · {threads}', activeMatch: 'MATCH', contextComment: 'CONTEXT', rawSearchHit: 'SEARCH HIT',
  matchingComments_one: '{count} matching comment', matchingComments_other: '{count} matching comments',
  containingThreads_one: '{count} containing thread', containingThreads_other: '{count} containing threads',
  discussionNavigation: 'Discussion navigation', previousMatch: 'Previous match', nextMatch: 'Next match', previousUnseen: 'Previous unseen', nextUnseen: 'Next unseen', matchPosition: 'Applied match position',
  settings: 'Settings', reorderHelp: 'Drag tabs to reorder, or use {left} / {right} on a focused tab.',
  libraryFilter: 'Filter Library', libraryHelp: 'Filter titles, post text, authors and handles. Closing a tab keeps its discussion here.',
  currentlyOpen: 'Open tab', activate: 'Activate', open: 'Open', noLibraryMatches: 'No discussions match this metadata filter.',
  removeFromLibrary: 'Remove from Library', removeTitle: 'Remove locally stored discussion?', remove: 'Remove',
  removeDescription: 'This permanently deletes the locally stored discussion and comments, seen state, and refresh history. It does not affect YouTube.',
  demoProtected: 'Demo · removal unavailable', demoRemovalHelp: 'Synthetic demo discussions cannot be removed because development initialization may recreate them.',
  removalBusy: 'This discussion is being acquired or refreshed. Wait for it to finish before removing it.',
  removalFailed: 'Removal could not be saved. The discussion remains in Library.',
  externalTools: 'External tools', externalToolsHelp: 'Development helper executable overrides are configured at application startup through environment configuration. Path editing is not available here.',

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
  seenHelp: 'Check a comment to mark it seen. {shortcut} also sets all its replies to the same state.',
  newHelp: 'NEW shows fixed examples of later discoveries in this demo; it is independent of UNSEEN.',
  clockNote: 'Demo reference time', unknownAuthor: 'Unknown author', unknownTime: 'Publication time unavailable',
  seen: 'Seen', unseen: 'UNSEEN', new: 'NEW', creator: 'Creator', pinned: 'Pinned',
  likes: 'Likes: {count}', markSeen: 'Mark comment by {author} seen', markUnseen: 'Mark comment by {author} unseen',
  comments_one: '{count} comment', comments_other: '{count} comments',
  unseenCount_one: '{count} unseen comment', unseenCount_other: '{count} unseen comments',
};
export type TranslationKey = keyof typeof en;
type Key = TranslationKey;
const pl: Record<Key, string> & Record<string, string> = {
  overviewRuler: 'Przegląd dyskusji: nieprzeczytane, zastosowane dopasowania, nowe odkrycia',
  rulerKeyboardHelp: 'Góra/Dół: pas znaczników. Lewo/Prawo: kategoria. Home/End: pierwszy/ostatni pas. Enter/Spacja: przejdź.',
  rulerUnseen: 'Nieprzeczytane: {count}', rulerMatch: 'Dopasowania: {count}', rulerNew: 'Nowe: {count}',
  newDiscoveryHelp: 'Pierwsze odkrycie w ostatnim zaakceptowanym odświeżeniu po bazowym pobraniu. NOWY pozostaje do kolejnego zaakceptowanego odświeżenia, niezależnie od stanu przeczytania.',
  keyboardShortcuts: 'Skróty klawiaturowe', shortcutWorkspace: 'Obszar roboczy', shortcutSearch: 'Wyszukiwanie i filtrowanie',
  shortcutComments: 'Komentarze', shortcutAcquisition: 'Pobieranie i formularze', shortcutHelp: 'Pomoc i anulowanie',
  shortcutNextTab: 'Następna karta', shortcutPreviousTab: 'Poprzednia karta', shortcutCloseTab: 'Zamknij aktywną kartę',
  shortcutMoveLeft: 'Przesuń kartę z fokusem w lewo', shortcutMoveRight: 'Przesuń kartę z fokusem w prawo', shortcutFirstTab: 'Pierwsza karta', shortcutLastTab: 'Ostatnia karta',
  shortcutFocusSearch: 'Ustaw fokus / zaznacz wyszukiwanie', shortcutSubtree: 'Ustaw ten sam stan przeczytania komentarza i jego potomków', shortcutSubmit: 'Wyślij formularz',
  shortcutFocusedTab: 'Karta obszaru roboczego z fokusem', shortcutSearchScope: 'Aktywna dyskusja lub filtr metadanych Biblioteki', shortcutDiscussion: 'Aktywna dyskusja; skróty działają też w kontrolkach zapytania',
  shortcutSeenCheckbox: 'Pole stanu przeczytania; stosuje wynikowy stan klikniętego komentarza', shortcutSubmitScope: 'Pole adresu URL lub formularz zapytania dyskusji',
  shortcutCancelScope: 'Przeciąganie karty, formularz URL lub okno usuwania, jeśli usuwanie nie trwa',
  shortcutPlatformHelp: 'Obecne skróty są przeznaczone dla Windows. Przyszłe mapowania dla innych platform mogą się różnić. Polecenia obszaru roboczego i dyskusji są wstrzymane podczas potwierdzania usunięcia. Pola edycji zachowują zwykłe wpisywanie i nawigację.',
  searchDiscussion: 'Szukaj w tej dyskusji', searchFields: 'Pola wyszukiwania', searchContent: 'Treść komentarza', searchAuthor: 'Autor komentarza', searchRepliedTo: 'Autor bezpośrednio poprzedzającego komentarza',
  seenFilter: 'Stan przeczytania', filterAll: 'Wszystkie', filterUnseen: 'Nieprzeczytane', filterSeen: 'Przeczytane', caseSensitive: 'Rozróżniaj wielkość liter', regexMode: 'Wyrażenie regularne',
  applyView: 'Zastosuj', applyHelp: 'Zastosuj widok', queryDraftPending: 'Robocze kryteria · Zastosuj, aby zaktualizować',
  querySeenPending: 'Stan przeczytania zapisany · Zastosuj, aby zaktualizować widok', queryEvaluating: 'Obliczanie…',
  queryInvalidRegex: 'Nieprawidłowe wyrażenie regularne. Zachowano poprzedni zastosowany widok.', queryNoFields: 'Wybierz przynajmniej jedno pole wyszukiwania. Zachowano poprzedni zastosowany widok.',
  queryTooExpensive: 'Zapytanie przekroczyło limit czasu. Uprość je i zastosuj ponownie. Zachowano poprzedni zastosowany widok.',
  queryFailed: 'Nie udało się obliczyć wyników. Zachowano poprzedni zastosowany widok.', noDiscussionMatches: 'Brak komentarzy pasujących do zastosowanych kryteriów.',
  appliedCounts: 'Zastosowano: {comments} · {threads}', activeMatch: 'DOPASOWANIE', contextComment: 'KONTEKST', rawSearchHit: 'TRAFIENIE WYSZUKIWANIA',
  matchingComments_one: '{count} pasujący komentarz', matchingComments_few: '{count} pasujące komentarze', matchingComments_many: '{count} pasujących komentarzy', matchingComments_other: '{count} pasującego komentarza',
  containingThreads_one: '{count} zawierający je wątek', containingThreads_few: '{count} zawierające je wątki', containingThreads_many: '{count} zawierających je wątków', containingThreads_other: '{count} zawierającego je wątku',
  discussionNavigation: 'Nawigacja w dyskusji', previousMatch: 'Poprzednie dopasowanie', nextMatch: 'Następne dopasowanie', previousUnseen: 'Poprzedni nieprzeczytany', nextUnseen: 'Następny nieprzeczytany', matchPosition: 'Pozycja zastosowanego dopasowania',
  settings: 'Ustawienia', reorderHelp: 'Przeciągnij kartę lub użyj {left} / {right} na karcie z fokusem.',
  libraryFilter: 'Filtruj Bibliotekę', libraryHelp: 'Filtruj tytuły, treść postów, autorów i nazwy użytkowników. Zamknięcie karty zachowuje tutaj dyskusję.',
  currentlyOpen: 'Otwarta karta', activate: 'Aktywuj', open: 'Otwórz', noLibraryMatches: 'Brak dyskusji pasujących do filtra metadanych.',
  removeFromLibrary: 'Usuń z Biblioteki', removeTitle: 'Usunąć lokalnie zapisaną dyskusję?', remove: 'Usuń',
  removeDescription: 'Spowoduje to trwałe usunięcie lokalnie zapisanej dyskusji i komentarzy, stanu przeczytania oraz historii odświeżania. Nie wpłynie to na YouTube.',
  demoProtected: 'Demo · usuwanie niedostępne', demoRemovalHelp: 'Dyskusji demonstracyjnych nie można usunąć, ponieważ inicjalizacja deweloperska może utworzyć je ponownie.',
  removalBusy: 'Ta dyskusja jest właśnie pobierana lub odświeżana. Poczekaj na zakończenie przed usunięciem.',
  removalFailed: 'Nie udało się zapisać usunięcia. Dyskusja pozostaje w Bibliotece.',
  externalTools: 'Programy pomocnicze', externalToolsHelp: 'Ścieżki programów pomocniczych w wersji deweloperskiej są konfigurowane przy uruchamianiu aplikacji przez zmienne środowiskowe. Edycja ścieżek nie jest tutaj dostępna.',

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
  seenHelp: 'Zaznacz komentarz, aby oznaczyć go jako przeczytany. {shortcut} ustawia ten sam stan dla wszystkich jego odpowiedzi.',
  newHelp: 'NOWY oznacza stałe przykłady późniejszych odkryć w tym demo, niezależnie od stanu NIEPRZECZYTANY.',
  clockNote: 'Czas odniesienia demo', unknownAuthor: 'Nieznany autor', unknownTime: 'Brak daty publikacji',
  seen: 'Przeczytany', unseen: 'NIEPRZECZYTANY', new: 'NOWY', creator: 'Twórca', pinned: 'Przypięty',
  likes: 'Polubienia: {count}', markSeen: 'Oznacz komentarz autora {author} jako przeczytany',
  markUnseen: 'Oznacz komentarz autora {author} jako nieprzeczytany',
  comments_one: '{count} komentarz', comments_few: '{count} komentarze', comments_many: '{count} komentarzy', comments_other: '{count} komentarza',
  unseenCount_one: '{count} nieprzeczytany komentarz', unseenCount_few: '{count} nieprzeczytane komentarze',
  unseenCount_many: '{count} nieprzeczytanych komentarzy', unseenCount_other: '{count} nieprzeczytanego komentarza',
};
/** Compact localized counts; one contribution may occur in several lanes. */
export function rulerBucketLabel(locale: Locale, bucket: RulerBucket): string {
  const t = translator(locale), number = new Intl.NumberFormat(locale);
  return [t('rulerUnseen', { count: number.format(bucket.targets.unseen.length) }),
    t('rulerMatch', { count: number.format(bucket.targets.match.length) }),
    t('rulerNew', { count: number.format(bucket.targets.new.length) })].join('\n');
}
export const messages: Record<Locale, Record<string, string>> = { en, pl };

export function translator(locale: Locale) {
  return (key: Key, values: Record<string, string | number> = {}): string => {
    const message = messages[locale][key] ?? en[key];
    return message.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
  };
}

export function countLabel(locale: Locale, key: 'comments' | 'unseenCount' | 'matchingComments' | 'containingThreads', count: number): string {
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
