import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActionIcon } from './ActionIcon';
import { translator } from './i18n';
import type { Locale } from './i18n';

export interface CommentMenuTarget {
  readonly id: string; readonly x: number; readonly y: number;
  readonly origin: HTMLElement; readonly selectionText: string;
  readonly selectionRanges?: readonly Range[];
}
export interface CommentMenuItem {
  readonly label: string; readonly icon: Parameters<typeof ActionIcon>[0]['name'];
  readonly run: () => void; readonly disabled?: boolean;
}
/** Small focus-managed menu. Text is captured at invocation; focusing menu items
 * never substitutes full-comment text for the explicit Copy selection command. */
export function CommentContextMenu({ target, items, locale, dismiss }: {
  target: CommentMenuTarget; items: readonly CommentMenuItem[]; locale: Locale; dismiss: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: target.x, top: target.y });
  const restore = useRef(true), close = useRef(dismiss); close.current = dismiss;
  function focusPreservingText(element: HTMLElement | undefined | null) {
    element?.focus({ preventScroll: true });
    if (!target.selectionRanges?.length) return;
    const selection = document.getSelection();
    selection?.removeAllRanges();
    for (const range of target.selectionRanges) if (range.commonAncestorContainer.isConnected) selection?.addRange(range);
  }
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setPosition({ left: Math.max(4, Math.min(target.x, window.innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(target.y, window.innerHeight - rect.height - 4)) });
    focusPreservingText(element.querySelector<HTMLElement>('button:not(:disabled)'));
    const outside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) { restore.current = false; close.current(); }
    };
    const invalidate = () => { restore.current = false; close.current(); };
    const scroll = (event: Event) => { if (!element.contains(event.target as Node)) invalidate(); };
    const panel = target.origin.closest<HTMLElement>('.reader-panel');
    const observer = new MutationObserver(() => { if (!target.origin.isConnected || panel?.hidden) invalidate(); });
    if (panel) observer.observe(panel, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true });
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true); window.addEventListener('resize', invalidate);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', invalidate);
      observer.disconnect();
      if (restore.current && target.origin.isConnected && !target.origin.closest('[hidden]')) focusPreservingText(target.origin);
    };
  }, [target]);
  return createPortal(<div ref={menu} role="menu" aria-label={translator(locale)('commentMenu')} className="comment-context-menu"
    style={position} onContextMenu={event => event.preventDefault()} onMouseDown={event => event.preventDefault()}
    onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); dismiss(); return; }
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === 'ArrowDown' ? (current + 1) % buttons.length : event.key === 'ArrowUp' ? (current - 1 + buttons.length) % buttons.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : undefined;
      if (index !== undefined) { event.preventDefault(); event.stopPropagation(); focusPreservingText(buttons[index]); }
    }}>
    {items.map((item, index) => <button key={index} type="button" role="menuitem" tabIndex={-1} disabled={item.disabled}
      onClick={() => { dismiss(); item.run(); }}><ActionIcon name={item.icon} />{item.label}</button>)}
  </div>, document.body);
}
