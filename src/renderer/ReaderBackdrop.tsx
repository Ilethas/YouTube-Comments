import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** The only backdrop-filter lives on an empty, viewport-bounded sibling. It is
 * never an ancestor of fixed menus/ruler/controls or measured virtual rows. */
export function ReaderBackdrop({ active, url, children, failed }: { active: boolean; url?: string; children: ReactNode; failed: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const wrapper = ref.current;
    if (!wrapper || !active || !url) return;
    const panel = wrapper.querySelector('.reader-panel');
    const column = wrapper.querySelector('.reading-column');
    if (!panel || !column) return;
    const measure = () => {
      const bounds = column.getBoundingClientRect(), outer = wrapper.getBoundingClientRect();
      if (bounds.width) setGeometry(previous => previous.left === bounds.left - outer.left && previous.width === bounds.width ? previous : { left: bounds.left - outer.left, width: bounds.width });
    };
    const observer = new ResizeObserver(measure); observer.observe(panel); observer.observe(column); measure();
    return () => observer.disconnect();
  }, [active, url]);
  return <div ref={ref} className="discussion-viewport" hidden={!active} data-wallpaper={!!url}>
    {active && url && <><img className="reader-wallpaper" src={url} alt="" aria-hidden="true" draggable={false} onError={failed} />
      <div className="reader-surface-layer" aria-hidden="true" style={geometry} /></>}
    {children}
  </div>;
}
