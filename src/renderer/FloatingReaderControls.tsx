import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { ActionIcon } from './ActionIcon';
import { translator } from './i18n';
import type { Locale } from './i18n';

/** Viewport-only observation. Scrolling updates React only at the top threshold;
 * toolbar intersection never depends on virtual row membership or measurement. */
export function FloatingReaderControls({ toolbar, selection, locale, children, onTop }: {
  toolbar: RefObject<HTMLDivElement>; selection: boolean; locale: Locale; children: ReactNode; onTop?: () => void;
}) {
  const origin = useRef<HTMLSpanElement>(null), controls = useRef<HTMLDivElement>(null);
  const focused = useRef<HTMLElement>();
  const [down, setDown] = useState(false), [toolbarVisible, setToolbarVisible] = useState(true);
  const [viewport, setViewport] = useState({ left: 12, bottom: 12, width: 600 });
  const panel = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const root = origin.current?.closest<HTMLElement>('.reader-panel'), target = toolbar.current;
    if (!root || !target) return;
    panel.current = root;
    let wasDown = false;
    const scroll = () => {
      const next = root.scrollTop > Math.max(400, root.clientHeight * .75);
      if (next !== wasDown) { wasDown = next; setDown(next); }
    };
    const measure = () => {
      if (root.hidden) return;
      const rect = root.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const next = { left: rect.left + 12, bottom: Math.max(12, window.innerHeight - rect.bottom + 12), width: Math.max(0, root.clientWidth - 48) };
      setViewport(previous => previous.left === next.left && previous.bottom === next.bottom && previous.width === next.width ? previous : next);
      scroll();
    };
    const intersection = new IntersectionObserver(entries => {
      const entry = entries.find(entry => entry.target === target);
      if (entry) setToolbarVisible(entry.isIntersecting);
    }, { root, threshold: 0 });
    intersection.observe(target);
    const resize = new ResizeObserver(measure); resize.observe(root);
    // Cached panels can switch visibility without rerendering their discussion.
    const visibility = new MutationObserver(measure); visibility.observe(root, { attributes: true, attributeFilter: ['hidden'] });
    root.addEventListener('scroll', scroll, { passive: true }); window.addEventListener('resize', measure);
    measure();
    return () => {
      intersection.disconnect(); resize.disconnect(); visibility.disconnect();
      root.removeEventListener('scroll', scroll); window.removeEventListener('resize', measure); panel.current = null;
    };
  }, [toolbar]);
  const floatingSelection = selection && !toolbarVisible;
  // If Clear/Exit or scrolling removes a focused floating control, retain a
  // useful focus destination without changing the reader's scroll position.
  useLayoutEffect(() => {
    const root = panel.current;
    if (focused.current && !focused.current.isConnected) {
      focused.current = undefined;
      if (root?.isConnected && !root.hidden && document.activeElement === document.body) root.focus({ preventScroll: true });
    }
  }, [down, floatingSelection]);
  const t = translator(locale);
  return <><span ref={origin} hidden />{(down || floatingSelection) && <div ref={controls} className="floating-reader-controls"
    style={{ left: viewport.left, bottom: viewport.bottom, maxWidth: viewport.width }}
    onFocusCapture={event => { focused.current = event.target as HTMLElement; }}
    onBlurCapture={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) focused.current = undefined;
    }}>
    {down && <button type="button" className="back-to-top" aria-label={t('backToTop')} title={t('backToTop')} onClick={() => {
      onTop?.();
      // Dynamic virtual-row measurement can interrupt native smooth scrolling.
      // Immediate native scrolling is reliable and also respects reduced motion.
      panel.current?.scrollTo({ top: 0, behavior: 'instant' });
    }}><ActionIcon name="chevronUp" /></button>}
    {floatingSelection && children}
  </div>}</>;
}
