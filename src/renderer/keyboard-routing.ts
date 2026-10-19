import type { WorkspaceTab } from '../domain/workspace';
import { matchesShortcut } from './shortcuts';
import type { ShortcutId } from './shortcuts';

export type ReaderShortcut = Extract<ShortcutId, 'undo-seen' | 'next-tab' | 'previous-tab' | 'move-active-tab-left' | 'move-active-tab-right' | 'close-tab' | 'focus-search' | 'open-url' | 'keyboard-help' | 'apply-view' | 'next-match' | 'previous-match'>;
const commands: readonly ReaderShortcut[] = ['undo-seen', 'next-tab', 'previous-tab', 'move-active-tab-left', 'move-active-tab-right', 'close-tab', 'focus-search', 'open-url', 'keyboard-help', 'apply-view', 'next-match', 'previous-match'];

/** One top-level routing policy; focused-tab arrows and native form/dialog keys stay contextual. */
export function readerShortcut(event: KeyboardEvent, context: {
  activeKind?: WorkspaceTab['kind']; modalOpen: boolean; workspaceBusy: boolean; undoAvailable?: boolean;
}): ReaderShortcut | undefined {
  if (event.defaultPrevented || event.isComposing || context.modalOpen) return;
  if (event.target instanceof Element && event.target.closest('[role="menu"]')) return;
  const command = commands.find(id => matchesShortcut(event, id));
  if (!command) return;
  const reorder = command === 'move-active-tab-left' || command === 'move-active-tab-right';
  if (reorder && (event.repeat || context.workspaceBusy || !context.activeKind
    || document.querySelector('[role="menu"], dialog[open]')
    || event.target instanceof Element && event.target.closest(':disabled, [aria-disabled="true"], [inert]'))) return;
  if (command === 'undo-seen' && (context.activeKind !== 'discussion' || !context.undoAvailable
    || event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
  // Keep Ctrl+W owned while a workspace write is pending: an unconsumed chord
  // can fall through to Chromium's native window Close.
  if (['next-tab', 'previous-tab', 'keyboard-help'].includes(command) && context.workspaceBusy) return;
  if (['next-tab', 'previous-tab', 'close-tab'].includes(command) && !context.activeKind) return;
  if (command === 'focus-search' && context.activeKind !== 'discussion' && context.activeKind !== 'library') return;
  if (['apply-view', 'next-match', 'previous-match'].includes(command)) {
    if (context.activeKind !== 'discussion') return;
    const target = event.target instanceof Element ? event.target : null;
    const editable = target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    // Query commands work inside query controls; URL/other text editing owns its keys.
    if (editable && !target?.closest('.query-controls')) return;
  }
  return command;
}
