import type { Locale } from './preferences';

export type DataBackupResult = { readonly status: 'cancelled' } | { readonly status: 'created'; readonly destination: string }
  | { readonly status: 'restarting' };
export const dataBackupMessages = {
  en: {
    title: 'Data and backups', create: 'Create backup…', restore: 'Restore backup…',
    explanation: 'Save a complete SQLite snapshot of this profile. Restoring replaces all current profile data and restarts the application.',
    privacy: 'Backups may contain personal discussion metadata and local machine-specific helper paths.',
    running: 'Preparing, verifying and saving data… Please keep the application open.',
    created: 'Verified backup saved to:', cancelled: 'Cancelled. Your current profile was not replaced.',
    restarting: 'Restore verified. Restarting the application…',
    confirmTitle: 'Replace all profile data?',
    confirm: 'Restoring this backup will replace your current library, reading states, history and settings. A safety backup of your current data will be created first. The application will restart.',
    cancel: 'Cancel', replace: 'Restore and restart', saveTitle: 'Create complete profile backup', openTitle: 'Choose profile backup',
    failed: 'The operation failed. Your previous data and recovery copies are preserved. Check disk space and file permissions.',
    INVALID_BACKUP: 'This file is not a valid, complete YouTube Comments SQLite backup. The current profile was not replaced.',
    NEWER_BACKUP: 'This backup uses a newer database schema. Open it with a compatible newer application. Downgrades are not supported.',
    UNSUPPORTED_SCHEMA: 'This profile uses a newer database schema. Open it with a compatible newer application. Downgrades are not supported.',
    DATA_BUSY: 'Another data operation or acquisition is running. Wait for it to finish and try again.',
    DATA_WRITE_FAILED: 'The backup could not be saved. Check disk space, permissions and the destination. Existing files are never overwritten; choose a new filename.',
    RECOVERY_REQUIRED: 'The application could not safely open this profile. Keep reader.sqlite and every file in the profile recovery directory. No empty replacement database was created.',
    recovered: 'An interrupted or failed restore was rolled back to the verified safety snapshot. Recovery files were preserved.',
    restored: 'The complete profile backup was restored successfully.',
  },
  pl: {
    title: 'Dane i kopie zapasowe', create: 'Utwórz kopię zapasową…', restore: 'Przywróć kopię zapasową…',
    explanation: 'Zapisz pełną kopię SQLite tego profilu. Przywrócenie zastępuje wszystkie bieżące dane profilu i ponownie uruchamia aplikację.',
    privacy: 'Kopie mogą zawierać prywatne metadane dyskusji i ścieżki narzędzi właściwe dla lokalnego komputera.',
    running: 'Przygotowywanie, sprawdzanie i zapisywanie danych… Pozostaw aplikację otwartą.',
    created: 'Sprawdzona kopia została zapisana w:', cancelled: 'Anulowano. Bieżący profil nie został zastąpiony.',
    restarting: 'Przywrócona kopia została sprawdzona. Ponowne uruchamianie aplikacji…',
    confirmTitle: 'Zastąpić wszystkie dane profilu?',
    confirm: 'Przywrócenie tej kopii zastąpi bieżącą bibliotekę, stany przeczytania, historię i ustawienia. Najpierw zostanie utworzona zabezpieczająca kopia bieżących danych. Aplikacja uruchomi się ponownie.',
    cancel: 'Anuluj', replace: 'Przywróć i uruchom ponownie', saveTitle: 'Utwórz pełną kopię profilu', openTitle: 'Wybierz kopię profilu',
    failed: 'Operacja nie powiodła się. Poprzednie dane i kopie odzyskiwania zostały zachowane. Sprawdź miejsce na dysku i uprawnienia.',
    INVALID_BACKUP: 'Ten plik nie jest prawidłową, pełną kopią SQLite aplikacji YouTube Comments. Bieżący profil nie został zastąpiony.',
    NEWER_BACKUP: 'Kopia używa nowszego schematu bazy. Otwórz ją w zgodnej, nowszej wersji aplikacji. Obniżanie wersji nie jest obsługiwane.',
    UNSUPPORTED_SCHEMA: 'Profil używa nowszego schematu bazy. Otwórz go w zgodnej, nowszej wersji aplikacji. Obniżanie wersji nie jest obsługiwane.',
    DATA_BUSY: 'Trwa inna operacja na danych lub pobieranie. Poczekaj na jej zakończenie i spróbuj ponownie.',
    DATA_WRITE_FAILED: 'Nie udało się zapisać kopii. Sprawdź miejsce na dysku, uprawnienia i miejsce docelowe. Istniejące pliki nie są nadpisywane; wybierz nową nazwę.',
    RECOVERY_REQUIRED: 'Nie można bezpiecznie otworzyć profilu. Zachowaj reader.sqlite i wszystkie pliki w katalogu recovery profilu. Nie utworzono pustej bazy zastępczej.',
    recovered: 'Przerwane lub nieudane przywracanie wycofano do sprawdzonej kopii zabezpieczającej. Pliki odzyskiwania zostały zachowane.',
    restored: 'Pełna kopia profilu została pomyślnie przywrócona.',
  },
} as const;
export const backupText = (locale: Locale) => dataBackupMessages[locale];
