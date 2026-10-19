import type { MenuItemConstructorOptions } from 'electron';
import { windowAccelerators } from '../shared/window-actions';
import type { Locale } from '../shared/preferences';

/** Explicit window chords leave Ctrl/Cmd+W to the renderer's active tab. The
 * native roles retain their established Close and coordinated app Quit paths. */
export function fileMenu(locale: Locale, newWindow: () => void, mac: boolean): MenuItemConstructorOptions {
  const pl = locale === 'pl', keys = windowAccelerators(mac);
  return { label: pl ? 'Plik' : 'File', submenu: [
    { id: 'new-reader-window', label: pl ? 'Nowe okno' : 'New Window', accelerator: keys.newWindow, click: newWindow },
    { id: 'close-reader-window', label: pl ? 'Zamknij okno' : 'Close Window', role: 'close', accelerator: keys.closeWindow },
    // macOS appMenu already owns its one standard Cmd+Q item.
    ...(!mac ? [{ type: 'separator' as const }, { id: 'quit-reader-application', label: pl ? 'Zakończ aplikację' : 'Quit Application', role: 'quit' as const, accelerator: keys.quitApplication }] : []),
  ] };
}
