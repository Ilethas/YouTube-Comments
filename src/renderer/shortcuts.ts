import { translator } from './i18n';
import type { Locale, TranslationKey } from './i18n';

type ShortcutKey = 'Ctrl' | 'Shift' | 'Alt' | 'Tab' | 'W' | 'F' | 'L' | 'Enter' | 'F1' | 'F3' | 'Left' | 'Right' | 'Home' | 'End' | 'Click' | 'Escape';
interface ShortcutDefinition {
  readonly id: string;
  readonly keys: readonly ShortcutKey[];
  readonly description: TranslationKey;
  readonly group: TranslationKey;
  readonly scope?: TranslationKey;
}

/** Renderer presentation metadata only. Contextual handlers own availability and effects. */
export const shortcuts = [
  { id: 'next-tab', keys: ['Ctrl', 'Tab'], description: 'shortcutNextTab', group: 'shortcutWorkspace' },
  { id: 'previous-tab', keys: ['Ctrl', 'Shift', 'Tab'], description: 'shortcutPreviousTab', group: 'shortcutWorkspace' },
  { id: 'close-tab', keys: ['Ctrl', 'W'], description: 'shortcutCloseTab', group: 'shortcutWorkspace' },
  { id: 'open-url', keys: ['Ctrl', 'L'], description: 'acquire', group: 'shortcutWorkspace' },
  { id: 'move-tab-left', keys: ['Alt', 'Left'], description: 'shortcutMoveLeft', group: 'shortcutWorkspace', scope: 'shortcutFocusedTab' },
  { id: 'move-tab-right', keys: ['Alt', 'Right'], description: 'shortcutMoveRight', group: 'shortcutWorkspace', scope: 'shortcutFocusedTab' },
  { id: 'tab-left', keys: ['Left'], description: 'shortcutPreviousTab', group: 'shortcutWorkspace', scope: 'shortcutFocusedTab' },
  { id: 'tab-right', keys: ['Right'], description: 'shortcutNextTab', group: 'shortcutWorkspace', scope: 'shortcutFocusedTab' },
  { id: 'tab-first', keys: ['Home'], description: 'shortcutFirstTab', group: 'shortcutWorkspace', scope: 'shortcutFocusedTab' },
  { id: 'tab-last', keys: ['End'], description: 'shortcutLastTab', group: 'shortcutWorkspace', scope: 'shortcutFocusedTab' },
  { id: 'focus-search', keys: ['Ctrl', 'F'], description: 'shortcutFocusSearch', group: 'shortcutSearch', scope: 'shortcutSearchScope' },
  { id: 'apply-view', keys: ['Ctrl', 'Enter'], description: 'applyHelp', group: 'shortcutSearch', scope: 'shortcutDiscussion' },
  { id: 'next-match', keys: ['F3'], description: 'nextMatch', group: 'shortcutSearch', scope: 'shortcutDiscussion' },
  { id: 'previous-match', keys: ['Shift', 'F3'], description: 'previousMatch', group: 'shortcutSearch', scope: 'shortcutDiscussion' },
  { id: 'comment-subtree', keys: ['Ctrl', 'Click'], description: 'shortcutSubtree', group: 'shortcutComments', scope: 'shortcutSeenCheckbox' },
  { id: 'submit', keys: ['Enter'], description: 'shortcutSubmit', group: 'shortcutAcquisition', scope: 'shortcutSubmitScope' },
  { id: 'keyboard-help', keys: ['F1'], description: 'keyboardShortcuts', group: 'shortcutHelp' },
  { id: 'cancel', keys: ['Escape'], description: 'cancel', group: 'shortcutHelp', scope: 'shortcutCancelScope' },
] as const satisfies readonly ShortcutDefinition[];

export type ShortcutId = typeof shortcuts[number]['id'];
export function shortcut(id: ShortcutId): ShortcutDefinition {
  const definition = shortcuts.find(definition => definition.id === id);
  if (!definition) throw new RangeError(`Unknown shortcut: ${id}`);
  return definition;
}

const windowsNames: Readonly<Record<ShortcutKey, string>> = {
  Ctrl: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Tab: 'Tab', W: 'W', F: 'F', L: 'L', Enter: 'Enter',
  F1: 'F1', F3: 'F3', Left: 'Left', Right: 'Right', Home: 'Home', End: 'End', Click: 'Click', Escape: 'Escape',
};
/** Display names are independent of bindings, ready for a future platform naming map. */
export function shortcutKeyLabels(id: ShortcutId, names: Partial<Record<ShortcutKey, string>> = {}): string[] {
  return shortcut(id).keys.map(key => names[key] ?? windowsNames[key]);
}
export function formatShortcut(id: ShortcutId, names?: Partial<Record<ShortcutKey, string>>): string {
  return shortcutKeyLabels(id, names).join('+');
}
export function shortcutHint(locale: Locale, id: ShortcutId, label?: string): string {
  return `${label ?? translator(locale)(shortcut(id).description)} (${formatShortcut(id)})`;
}
export function seenHelp(locale: Locale): string {
  return translator(locale)('seenHelp', { shortcut: formatShortcut('comment-subtree') });
}
export function reorderHelp(locale: Locale): string {
  return translator(locale)('reorderHelp', { left: formatShortcut('move-tab-left'), right: formatShortcut('move-tab-right') });
}

/** Exact modifiers avoid stealing unassigned chords or composing text. */
export function matchesShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>, id: ShortcutId): boolean {
  const keys = shortcut(id).keys;
  const key = keys[keys.length - 1];
  const browserKey = key === 'Left' ? 'ArrowLeft' : key === 'Right' ? 'ArrowRight' : key;
  return !event.metaKey && event.ctrlKey === keys.includes('Ctrl') && event.shiftKey === keys.includes('Shift')
    && event.altKey === keys.includes('Alt') && event.key.toLowerCase() === browserKey.toLowerCase();
}
