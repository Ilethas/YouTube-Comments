import { vi } from 'vitest';

/** Deterministic layout/ResizeObserver driver. Models geometry and events only;
 * React and the actual pinned virtualizer run normally (no virtualizer mocks). */
export function installReaderLayout(viewportHeight = 600, initialWidth = 1000) {
  let width = initialWidth;
  const heights = new Map<string, number>();
  const observers = new Set<LayoutObserver>();
  class LayoutObserver {
    readonly targets = new Set<Element>();
    constructor(readonly callback: ResizeObserverCallback) { observers.add(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); observers.delete(this); }
  }
  const rowHeight = (element: Element) => {
    const id = (element as HTMLElement).dataset.commentId;
    const measured = id ? heights.get(id) : undefined;
    if (measured !== undefined) return measured;
    const text = element.querySelector('.comment-text')?.textContent ?? '';
    const lines = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(12, Math.floor(width / 9)))), 0);
    return 76 + lines * 20;
  };
  vi.stubGlobal('ResizeObserver', LayoutObserver);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => viewportHeight);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function(this: HTMLElement) {
    return 280 + (parseFloat(this.querySelector<HTMLElement>('.virtual-reader')?.style.height ?? '0') || 0);
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const panel = this.closest<HTMLElement>('.reader-panel');
    const row = this.closest<HTMLElement>('.virtual-comment');
    const translate = row ? Number(/translateY\(([-\d.]+)px\)/.exec(row.style.transform)?.[1] ?? 0) : 0;
    const top = this.classList.contains('reader-panel') ? 0 : 280 + translate - (panel?.scrollTop ?? 0);
    const height = row ? rowHeight(row) : this.classList.contains('virtual-reader') ? parseFloat(this.style.height) || 0 : viewportHeight;
    return { x: 0, y: top, top, bottom: top + height, left: 0, right: width, width, height, toJSON: () => ({}) };
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: function(this: HTMLElement, options: ScrollToOptions) {
    this.scrollTop = Math.max(0, options.top ?? 0);
    queueMicrotask(() => { if (this.isConnected) this.dispatchEvent(new Event('scroll')); });
  } });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  function notify() {
    for (const observer of [...observers]) {
      const entries = [...observer.targets].map(target => ({ target,
        borderBoxSize: [{ blockSize: target.classList.contains('virtual-comment') ? rowHeight(target) : viewportHeight, inlineSize: width }],
      } as unknown as ResizeObserverEntry));
      observer.callback(entries, observer as unknown as ResizeObserver);
    }
  }
  return { notify, resize(nextWidth: number) { width = nextWidth; notify(); }, setHeight(id: string, height: number) { heights.set(id, height); notify(); } };
}
