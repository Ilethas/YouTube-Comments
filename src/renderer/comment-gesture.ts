import type { MouseEvent } from 'react';

const interactive = 'input,button,a,select,textarea,label,summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"],[role="checkbox"],[role="slider"],[role="textbox"],[role="combobox"],[tabindex],[data-interactive]';

/** Selection belongs to an interaction when its range touches the comment.
 * Capture on pointer down as well as click: native Shift selection can change
 * between those events. Never cancel pointer down or native text selection. */
export function commentHasSelection(article: HTMLElement): boolean {
  const selection = article.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed) return false;
  for (let index = 0; index < selection.rangeCount; index++) {
    if (selection.getRangeAt(index).intersectsNode(article)) return true;
  }
  return false;
}

/** The row owns only intentional Windows primary Shift/Ctrl+Shift gestures.
 * A data-interactive marker also excludes future controls and their descendants. */
export function isCommentGesture(event: MouseEvent<HTMLElement>): boolean {
  if (event.defaultPrevented || event.button !== 0 || !event.shiftKey || event.altKey || event.metaKey) return false;
  const target = event.target instanceof Element ? event.target : null;
  const control = target?.closest(interactive);
  return !control || control === event.currentTarget;
}
