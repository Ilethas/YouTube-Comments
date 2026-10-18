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
export function CommentContextMenu({ target, items, locale, dismiss, label }: {
  target: CommentMenuTarget; items: readonly CommentMenuItem[]; locale: Locale; dismiss: () => void; label?: string;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() => items.findIndex(item => !item.disabled));
  // Coordinates change only on actual pointer movement. Focus/layout/rendering
  // cannot reclaim activity from the keyboard under a stationary pointer.
  const pointer = useRef<{ x: number; y: number }>({ x: target.x, y: target.y });
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
    const scroll = (event: Event) => {
      const scrolled = event.target;
      // Only an ancestor's scroll moves this origin. A sibling reader (including
      // a hidden duplicate) must not dismiss another view's menu or a tab menu.
      if (scrolled instanceof Node && (element.contains(scrolled) || !scrolled.contains(target.origin))) return;
      invalidate();
    };
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
  return createPortal(<div ref={menu} role="menu" aria-label={label ?? translator(locale)('commentMenu')} className="comment-context-menu"
    style={position} onContextMenu={event => event.preventDefault()} onMouseDown={event => event.preventDefault()}
    onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); dismiss(); return; }
      const enabled = items.flatMap((item, index) => item.disabled ? [] : [index]);
      const current = enabled.indexOf(active);
      const index = event.key === 'ArrowDown' ? enabled[(current + 1) % enabled.length] : event.key === 'ArrowUp' ? enabled[(current - 1 + enabled.length) % enabled.length]
        : event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1) : undefined;
      if (index !== undefined) {
        event.preventDefault(); event.stopPropagation(); setActive(index);
        focusPreservingText(menu.current?.querySelectorAll('button')[index]);
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); event.stopPropagation();
        if (active >= 0 && !items[active]?.disabled) { dismiss(); items[active]?.run(); }
      }
    }}>
    {items.map((item, index) => <button key={index} type="button" role="menuitem" tabIndex={-1} disabled={item.disabled}
      data-active={active === index && !item.disabled}
      onFocus={() => { if (!item.disabled) setActive(index); }}
      onPointerMove={event => {
        if (event.clientX === pointer.current.x && event.clientY === pointer.current.y) return;
        pointer.current = { x: event.clientX, y: event.clientY };
        if (!item.disabled) { setActive(index); focusPreservingText(event.currentTarget); }
      }}
      onClick={() => { dismiss(); item.run(); }}><ActionIcon name={item.icon} />{item.label}</button>)}
  </div>, document.body);
}
